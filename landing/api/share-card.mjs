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
const gold = '#d99a05';
const cream = '#f8f5ee';
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

function pokemonCard(card, options) {
  const { x, y, width, height, rotation, tone, label, rating, clipId } = options;
  const border = tone === 'local' ? '#58a7df' : '#d17969';
  const labelBackground = tone === 'local' ? '#2e83c9' : '#b75b4f';
  const padding = 8;
  const imageX = x + padding;
  const imageY = y + padding;
  const imageWidth = width - padding * 2;
  const imageHeight = height - padding * 2;
  const labelHeight = 43;
  const labelY = y + height - labelHeight - 15;
  const ratingCopy = rating != null ? ` · ${rating}` : '';
  return `
    <g transform="rotate(${rotation} ${x + width / 2} ${y + height / 2})">
      <rect x="${x}" y="${y}" width="${width}" height="${height}" rx="22" fill="#fff" stroke="${border}" stroke-width="4" filter="url(#cardShadow)"/>
      <clipPath id="${clipId}"><rect x="${imageX}" y="${imageY}" width="${imageWidth}" height="${imageHeight}" rx="13"/></clipPath>
      <image href="${dataUri(card.image.bytes, card.image.contentType)}" x="${imageX}" y="${imageY}" width="${imageWidth}" height="${imageHeight}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${clipId})"/>
      <rect x="${x + 18}" y="${labelY}" width="${width - 36}" height="${labelHeight}" rx="12" fill="${labelBackground}" filter="url(#labelShadow)"/>
      <text x="${x + width / 2}" y="${labelY + 28}" text-anchor="middle" fill="#fff" font-size="21" font-weight="900" letter-spacing=".4">${escapeXml(label + ratingCopy)}</text>
    </g>`;
}

function metadataBlock(x, y, width, label, value, accent = '#8b7745') {
  return `
    <rect x="${x}" y="${y}" width="${width}" height="86" rx="20" fill="#fffdf9" stroke="#dfd7c9" stroke-width="2"/>
    <circle cx="${x + 26}" cy="${y + 26}" r="8" fill="${accent}"/>
    <text x="${x + 45}" y="${y + 31}" fill="#8a796a" font-size="13" font-weight="900" letter-spacing="1.5">${escapeXml(label)}</text>
    <text x="${x + 22}" y="${y + 65}" fill="${ink}" font-size="21" font-weight="800">${escapeXml(value)}</text>`;
}

function socialCardSvg(card) {
  const resultTone = card.result === 'VICTORY'
    ? { background: '#dcefdc', color: '#287140' }
    : card.result === 'DEFEAT'
      ? { background: '#f8d9d4', color: '#a13f34' }
      : { background: '#e7edf4', color: '#526277' };
  const localCard = { ...card.localPokemon, image: card.localPokemon.embeddedImage };
  const opponentCard = { ...card.opponentPokemon, image: card.opponentPokemon.embeddedImage };
  const title = `vs. ${truncate(card.opponent, 20)}`;
  const localPlayer = truncate(card.localPlayer, 20).toLocaleUpperCase();
  const matchup = `${truncate(card.localPokemon.name, 18)}  vs.  ${truncate(card.opponentPokemon.name, 18)}`;
  return `<?xml version="1.0" encoding="UTF-8"?>
  <svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg" font-family="Nunito, sans-serif">
    <defs>
      <filter id="cardShadow" x="-25%" y="-25%" width="150%" height="170%">
        <feDropShadow dx="0" dy="16" stdDeviation="14" flood-color="#203653" flood-opacity=".18"/>
      </filter>
      <filter id="labelShadow" x="-20%" y="-30%" width="140%" height="180%">
        <feDropShadow dx="0" dy="5" stdDeviation="6" flood-color="#203653" flood-opacity=".22"/>
      </filter>
      <filter id="softShadow" x="-30%" y="-30%" width="160%" height="160%">
        <feDropShadow dx="0" dy="7" stdDeviation="8" flood-color="#203653" flood-opacity=".18"/>
      </filter>
    </defs>
    <rect width="1200" height="630" fill="${cream}"/>
    <rect x="0" y="0" width="590" height="630" fill="#eef5f9"/>
    <rect x="588" y="0" width="3" height="630" fill="#dec470"/>
    <image href="${dataUri(mascotImage, 'image/png')}" x="43" y="30" width="51" height="56" preserveAspectRatio="xMidYMid meet"/>
    <text x="110" y="58" fill="${ink}" font-size="28" font-weight="900" letter-spacing="-.4">TRACE</text>
    <text x="110" y="79" fill="#5c7284" font-size="14" font-weight="800" letter-spacing="2">MATCH REPLAY</text>
    ${pokemonCard(localCard, { x: 78, y: 139, width: 250, height: 350, rotation: -2, tone: 'local', label: 'YOU', rating: card.localRating, clipId: 'localCard' })}
    ${pokemonCard(opponentCard, { x: 302, y: 177, width: 218, height: 305, rotation: 2, tone: 'opponent', label: 'THEM', rating: card.opponentRating, clipId: 'opponentCard' })}
    <circle cx="294" cy="322" r="39" fill="${cream}" stroke="#fff" stroke-width="6" filter="url(#softShadow)"/>
    <text x="294" y="331" text-anchor="middle" fill="#665f53" font-size="24" font-weight="900">VS</text>

    <rect x="649" y="58" width="126" height="42" rx="21" fill="${resultTone.background}"/>
    <text x="712" y="85" text-anchor="middle" fill="${resultTone.color}" font-size="16" font-weight="900" letter-spacing="1.4">${escapeXml(card.result)}</text>
    <text x="793" y="84" fill="#8a796a" font-size="14" font-weight="800" letter-spacing="1.6">SHARED FROM TRACE</text>

    <text x="650" y="145" fill="#8a796a" font-size="14" font-weight="900" letter-spacing="1.8">${escapeXml(localPlayer)}’S MATCH</text>
    <text x="647" y="205" fill="${ink}" font-size="52" font-weight="900" letter-spacing="-2">${escapeXml(title)}</text>
    <text x="650" y="258" fill="${ink}" font-size="26" font-weight="800">${escapeXml(matchup)}</text>
    <line x1="650" y1="286" x2="1148" y2="286" stroke="#ded6c9" stroke-width="2"/>

    ${metadataBlock(650, 307, 307, 'MATCH PLAYED', card.date)}
    ${metadataBlock(975, 307, 173, 'TIME', card.duration || `${card.actionCount} actions`)}
    ${metadataBlock(650, 411, 498, 'PRIZE SCORE', `${card.prizeScore} prizes`, gold)}

    <text x="650" y="552" fill="${ink}" font-size="24" font-weight="900">Review the spot. Find the line.</text>
    <text x="650" y="581" fill="${muted}" font-size="16" font-weight="600">Open the complete turn-by-turn match at victoryroad.app</text>
  </svg>`;
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
    const renderer = new Resvg(socialCardSvg(card), {
      font: {
        fontFiles,
        loadSystemFonts: false,
        defaultFontFamily: 'Nunito',
        sansSerifFamily: 'Nunito',
      },
      imageRendering: 0,
      textRendering: 1,
    });
    const png = renderer.render().asPng();
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
