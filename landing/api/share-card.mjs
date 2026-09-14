import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import {
  fetchSharedReplay,
  requestShareId,
  socialCardData,
} from '../lib/share-card-data.mjs';

const ink = '#203653';
const muted = '#66717c';
const cream = '#faf9f5';
const backgroundImage = readFileSync(new URL('../assets/trace-share-background.png', import.meta.url));
const mascotImage = readFileSync(new URL('../assets/trace-mascot-og.png', import.meta.url));
const cardBackImage = {
  bytes: readFileSync(new URL('../assets/pokemon-card-back.jpg', import.meta.url)),
  contentType: 'image/jpeg',
};
const fontFiles = [400, 600, 800, 900].map((weight) =>
  fileURLToPath(new URL(`../assets/fonts/nunito-${weight}.ttf`, import.meta.url)));

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function truncate(value, length) {
  const text = String(value || '');
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}

function dataUri(bytes, contentType) {
  return `data:${contentType};base64,${Buffer.from(bytes).toString('base64')}`;
}

async function embeddedCardArt(url) {
  if (!url) return cardBackImage;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(6_000) });
    const contentType = response.headers.get('content-type')?.split(';')[0];
    if (!response.ok || !contentType?.startsWith('image/')) return cardBackImage;
    return { bytes: await response.arrayBuffer(), contentType };
  } catch {
    return cardBackImage;
  }
}

function textUnits(value) {
  return [...value].reduce((total, char) => total
    + (/[ilI1 .,:']/u.test(char) ? .32 : /[MW@%]/u.test(char) ? .95 : .64), 0);
}

function fittedLabel(value, maxLength, maxWidth, preferred, minimum) {
  let text = truncate(value, maxLength);
  while (text.length > 1 && textUnits(text) * minimum > maxWidth) {
    text = `${text.slice(0, text.endsWith('…') ? -2 : -1)}…`;
  }
  return { text, size: Math.max(minimum, Math.min(preferred, Math.floor(maxWidth / Math.max(1, textUnits(text))))) };
}

function playerColumn(pokemon, player, rating, centerX) {
  const ratingWidth = rating != null ? textUnits(String(rating)) * 29 + 14 : 0;
  const name = fittedLabel(player, 24, 350 - ratingWidth, 42, 23);
  const deck = fittedLabel(pokemon.name || 'Unknown deck', 28, 350, 32, 20);
  const image = pokemon.embeddedImage || cardBackImage;
  return `
    <text x="${centerX - 144}" y="107" fill="${ink}" font-size="${name.size}" font-weight="900"><tspan>${escapeXml(name.text)}</tspan>${rating != null ? `<tspan dx="14" fill="${muted}" font-size="29" font-weight="800">${escapeXml(rating)}</tspan>` : ''}</text>
    <image href="${dataUri(image.bytes, image.contentType)}" x="${centerX - 144}" y="124" width="288" height="402" preserveAspectRatio="xMidYMid meet" filter="url(#cardShadow)"/>
    <text x="${centerX}" y="557" text-anchor="middle" fill="${ink}" font-size="${deck.size}" font-weight="900">${escapeXml(deck.text)}</text>`;
}

export function socialCardSvg(card) {
  const resultColor = card.result === 'VICTORY' ? '#287140'
    : card.result === 'DEFEAT' ? '#a13f34' : '#526277';
  const winner = card.result === 'VICTORY' ? card.localPlayer : card.result === 'DEFEAT' ? card.opponent : undefined;
  const winnerName = winner ? fittedLabel(winner, 24, 238, 38, 21) : undefined;
  return `<?xml version="1.0" encoding="UTF-8"?>
  <svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg" font-family="Nunito, sans-serif">
    <defs>
      <filter id="cardShadow" x="-15%" y="-10%" width="130%" height="125%">
        <feDropShadow dx="0" dy="8" stdDeviation="7" flood-color="#203653" flood-opacity=".14"/>
      </filter>
    </defs>
    <rect width="1200" height="630" fill="${cream}"/>
    <image href="${dataUri(backgroundImage, 'image/png')}" x="0" y="0" width="1200" height="630" preserveAspectRatio="xMidYMid slice"/>
    <image href="${dataUri(mascotImage, 'image/png')}" x="435" y="17" width="50" height="64" preserveAspectRatio="xMidYMid meet"/>
    <text x="497" y="55" fill="${ink}" font-size="32" font-weight="900">TRACE</text>
    <line x1="620" y1="30" x2="620" y2="60" stroke="#b8b8b3"/>
    <text x="639" y="50" fill="#7b8591" font-size="16" font-weight="800" letter-spacing="1.3">MATCH REPLAY</text>
    ${playerColumn(card.localPokemon, card.localPlayer, card.localRating, 235)}
    ${playerColumn(card.opponentPokemon, card.opponent, card.opponentRating, 965)}
    <text x="600" y="190" text-anchor="middle" fill="${resultColor}" font-size="42" font-weight="900" letter-spacing="4">${escapeXml(card.result)}</text>
    <line x1="568" y1="221" x2="632" y2="221" stroke="#c8c4be" stroke-width="1.5"/>
    <text x="600" y="355" text-anchor="middle" fill="${ink}" font-size="148" font-weight="900" letter-spacing="-2">${escapeXml(card.prizeScore)}</text>
    <text x="600" y="394" text-anchor="middle" fill="${muted}" font-size="24" font-weight="900" letter-spacing="4">PRIZES TAKEN</text>
    ${winnerName ? `<line x1="568" y1="434" x2="632" y2="434" stroke="#c8c4be" stroke-width="1.5"/>
    <text x="600" y="484" text-anchor="middle" fill="${ink}" font-size="${winnerName.size}" font-weight="900"><tspan>${escapeXml(winnerName.text)}</tspan><tspan dx="10" fill="${muted}" font-weight="600">wins</tspan></text>` : ''}
  </svg>`;
}

export function renderSocialCardPng(card) {
  return new Resvg(socialCardSvg(card), {
    font: { fontFiles, loadSystemFonts: false, defaultFontFamily: 'Nunito', sansSerifFamily: 'Nunito' },
    imageRendering: 0,
    textRendering: 1,
  }).render().asPng();
}

export default async function handler(request, response) {
  const shareId = requestShareId(request);
  try {
    const payload = await fetchSharedReplay(shareId, AbortSignal.timeout(8_000), true);
    const card = socialCardData(payload);
    const [localImage, opponentImage] = await Promise.all([
      embeddedCardArt(card.localPokemon.image),
      embeddedCardArt(card.opponentPokemon.image),
    ]);
    card.localPokemon.embeddedImage = localImage;
    card.opponentPokemon.embeddedImage = opponentImage;
    const png = renderSocialCardPng(card);
    response.statusCode = 200;
    response.setHeader('content-type', 'image/png');
    response.setHeader('content-length', String(png.length));
    response.setHeader('cache-control', 'public, max-age=86400, s-maxage=31536000, immutable');
    response.setHeader('content-disposition', `inline; filename="trace-${shareId}.png"`);
    response.end(png);
  } catch (error) {
    response.statusCode = Number(error?.status) || 500;
    response.setHeader('content-type', 'text/plain; charset=utf-8');
    response.setHeader('cache-control', 'no-store');
    response.end(error instanceof Error ? error.message : 'Unable to render match thumbnail');
  }
}
