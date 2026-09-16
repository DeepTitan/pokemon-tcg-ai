import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import { getLeaderboardPreviewData, getPlayerPreviewData } from './generated/leaderboard-social-preview.mjs';
import { originalCardArt, shareCardCatalog } from './share-catalog.mjs';
import { artDataUri, framedCardArt, measureCardArt } from './share-card-art.mjs';

const ink = '#172b49', muted = '#627084', cream = '#fcfaf6', line = '#ded8ce';
const mascot = artDataUri({ bytes: readFileSync(new URL('../assets/trace-mascot.png', import.meta.url)), contentType: 'image/png' });
const cardBack = { bytes: readFileSync(new URL('../assets/pokemon-card-back.jpg', import.meta.url)), contentType: 'image/jpeg' };
const fontFiles = [400, 600, 800, 900].map(weight => fileURLToPath(new URL(`../assets/fonts/nunito-${weight}.ttf`, import.meta.url)));
const catalog = shareCardCatalog();
const artCache = new Map();
const number = value => Math.round(value).toLocaleString('en-US');
const percent = row => row.games ? `${Math.round(row.wins / row.games * 100)}%` : '—';
const record = row => row.games ? `${row.wins}W  ${row.losses}L${row.draws ? `  ${row.draws}D` : ''}` : 'No rated matches';
const delta = value => `${value < 0 ? '−' : value > 0 ? '+' : ''}${Math.abs(value).toFixed(1)}`;
const xml = value => String(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');

function units(value) {
  return [...value].reduce((total, c) => total + (/[ilI1 .,:']/u.test(c) ? .29 : /[MW@%]/u.test(c) ? .95 : .6), 0);
}
function fit(value, maxWidth, size) {
  let label = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (units(label) * size <= maxWidth) return label;
  while (label.length && units(`${label}…`) * size > maxWidth) label = [...label].slice(0, -1).join('');
  return `${label}…`;
}
function text(value, x, y, size = 20, weight = 600, color = ink, extra = '') {
  return `<text x="${x}" y="${y}" font-size="${size}" font-weight="${weight}" fill="${color}" ${extra}>${xml(value)}</text>`;
}
function rule(y, x1 = 38, x2 = 1162) {
  return `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="${line}"/>`;
}
function header() {
  return `<rect width="1200" height="630" fill="${cream}"/>
    <rect width="1200" height="59" fill="#f7f3eb"/>
    <image href="${mascot}" x="39" y="2" width="38" height="53" preserveAspectRatio="xMidYMid meet"/>
    ${text('Trace', 84, 38, 28, 900)}
    ${text('Leaderboard', 212, 36, 16, 800)}
    ${text('How ratings work', 361, 36, 16, 600, muted)}
    <line x1="208" y1="57" x2="320" y2="57" stroke="#c69c35" stroke-width="3"/>
    ${rule(59, 0, 1200)}`;
}

function bundledLeaderboardArt(input) {
  if (typeof input !== 'string' || !/^[a-z0-9-]+_\d+(?:_[a-z0-9]+)?$/i.test(input)) return undefined;
  const id = input.toLowerCase();
  if (!catalog.has(id)) return undefined;
  try {
    return { bytes: readFileSync(new URL(`../leaderboard/card-art/${id}.png`, import.meta.url)), contentType: 'image/png' };
  } catch { return undefined; }
}

// Known catalog / manifest files only. Incoming names cannot become paths or URLs.
function cardArt(pokemon) {
  const candidates = [pokemon?.artCardId, pokemon?.cardId];
  const key = candidates.join('|');
  if (artCache.has(key)) return artCache.get(key);
  let image;
  for (const id of candidates) {
    try {
      const bundled = originalCardArt(id) ?? bundledLeaderboardArt(id);
      if (bundled) { image = { ...bundled, bounds: measureCardArt(bundled) }; break; }
    } catch { /* Missing or corrupt bundled printing uses a safe fallback. */ }
  }
  if (!image) {
    // A different illustration is safe only after the exact printed card is known.
    const printed = typeof pokemon?.cardId === 'string' ? catalog.get(pokemon.cardId.toLowerCase()) : undefined;
    if (printed) for (const candidate of catalog.values()) {
      if (candidate.name !== printed.name) continue;
      try {
        const bundled = originalCardArt(candidate.id) ?? bundledLeaderboardArt(candidate.id);
        if (bundled) { image = { ...bundled, bounds: measureCardArt(bundled) }; break; }
      } catch { /* Continue to another known illustration. */ }
    }
  }
  image ??= { ...cardBack, bounds: measureCardArt(cardBack) };
  if (artCache.size >= 64) artCache.delete(artCache.keys().next().value);
  artCache.set(key, image);
  return image;
}
function pokemonCell(side, x, top) {
  const pokemon = side?.pokemon;
  let name = pokemon?.name?.trim();
  if (!name || name === pokemon?.cardId || name === pokemon?.artCardId || /^[a-z0-9-]+_\d+(?:_[a-z0-9]+)?$/i.test(name)) name = 'Not recorded';
  const words = name.split(/\s+/), lines = [''];
  for (const word of words) {
    const previous = lines.at(-1), next = previous ? `${previous} ${word}` : word;
    if (units(next) * 15 > 130 && previous && lines.length < 2) lines.push(word);
    else lines[lines.length - 1] = next;
  }
  return `${framedCardArt(cardArt(pokemon), x + 17, top + 7, 46)}
    ${lines.map((label, i) => text(fit(label, 130, 15), x + 44, top + (lines.length > 1 ? 25 : 36) + i * 19, 15, 600)).join('')}`;
}

function board(snapshot) {
  const { registeredRows } = getLeaderboardPreviewData(snapshot);
  const rows = registeredRows.slice(0, 10);
  const start = 195, rowHeight = 36;
  return `${header()}
    ${text('Leaderboard', 38, 115, 44, 900)}
    ${text('Pokémon TCG Live · All-time', 39, 145, 19, 600, muted)}
    <rect x="38" y="161" width="1124" height="${34 + Math.max(rows.length, 1) * rowHeight}" fill="#fffdf9" stroke="${line}"/>
    <rect x="39" y="162" width="1122" height="33" fill="#f2efe8"/>
    ${text('Rank', 55, 184, 15, 800)}${text('Player', 169, 184, 15, 800)}
    ${text('Trace rating', 643, 184, 15, 800)}${text('Record', 838, 184, 15, 800)}${text('Win rate', 1053, 184, 15, 800)}
    ${rows.map((row, i) => {
      const top = start + i * rowHeight, fill = (row.games ? ['#f5cf68', '#d3d6d8', '#dbb995'][i] : undefined) ?? (i % 2 ? '#f8f5ee' : '#fffdf9');
      return `<rect x="39" y="${top}" width="1122" height="${rowHeight}" fill="${fill}"/>
        ${text(row.games ? i + 1 : '—', 56, top + 25, 20, i < 3 ? 800 : 600)}
        ${i === 0 && row.games ? '<path d="M106 218l-4-13 8 6 6-10 6 10 8-6-4 13z" fill="none" stroke="#172b49" stroke-width="1.7"/>' : ''}
        ${text(fit(row.name, 430, 21), 169, top + 25, 21, 800)}
        ${text(row.games ? number(row.rating) : '—', 644, top + 26, 24, 900)}
        ${text(record(row), 839, top + 25, row.games ? 19 : 15, 600)}
        ${text(percent(row), 1054, top + 25, 20, 800)}${rule(top + rowHeight)}`;
    }).join('')}
    ${!rows.length ? text('No Trace players yet.', 58, 221, 20, 600, muted) : ''}
    ${text(`${registeredRows.length} Trace players`, 38, Math.min(592, start + Math.max(rows.length, 1) * rowHeight + 29), 15, 600, muted)}
    ${text('Select a player to see their match history.', 1162, Math.min(592, start + Math.max(rows.length, 1) * rowHeight + 29), 15, 600, muted, 'text-anchor="end"')}`;
}

function profile(snapshot, playerId) {
  const { row, rank, rankLabel, isRegistered, updates } = getPlayerPreviewData(snapshot, playerId);
  const names = new Map(snapshot.players.map(player => [player.id, player.name]));
  const playerUpdates = new Map(updates.filter(update => update.playerId === playerId).map(update => [update.matchId, update]));
  // Only replay-accepted matches can appear; missing ranked Elo, duplicates and
  // unconfirmed matches never acquire a fictitious rating change in this image.
  const seen = new Set();
  const history = snapshot.matches.filter(match => {
    if (!playerUpdates.has(match.id) || seen.has(match.id)) return false;
    seen.add(match.id); return true;
  }).sort((a, b) => b.playedAt.localeCompare(a.playedAt) || a.id.localeCompare(b.id)).slice(0, 6);
  return `${header()}
    ${text(fit(row.name, 820, 43), 38, 113, 43, 900, isRegistered ? ink : muted)}
    ${text(rank ? `${rankLabel} #${rank}${isRegistered ? '' : ' · Not registered'}` : isRegistered ? 'No ranked matches yet' : 'Not registered', 38, 140, 16, 800, isRegistered ? ink : muted)}
    ${text('Trace rating', 1162, 87, 16, 600, muted, 'text-anchor="end"')}
    ${text(row.games ? number(row.rating) : '—', 1162, 139, 51, 900, ink, 'text-anchor="end"')}
    ${text(record(row), 38, 174, 22, 800)}
    ${text(`${percent(row)} win rate`, 310, 174, 18, 600, muted)}
    ${text(`${number(row.games)} ranked matches`, 502, 174, 18, 600, muted)}
    ${rule(189)}
    ${text('Match history', 38, 214, 20, 800)}
    ${text('Most recent ranked matches', 1162, 213, 13, 600, muted, 'text-anchor="end"')}
    <rect x="38" y="224" width="1124" height="${30 + Math.max(1, history.length) * 59}" fill="#fffdf9" stroke="${line}"/>
    <rect x="39" y="225" width="1122" height="29" fill="#f2efe8"/>
    ${text('Result', 54, 244, 13, 800)}${text('Trace points', 156, 244, 13, 800)}
    ${text('Opponent', 287, 244, 13, 800)}${text('Live rating', 484, 244, 13, 800)}
    ${text('Pokémon · player vs. opponent', 590, 244, 13, 800)}${text('Prizes taken', 1067, 244, 13, 800)}
    ${history.map((match, i) => {
      const update = playerUpdates.get(match.id), top = 254 + i * 59;
      const opponent = names.get(update.opponentId) ?? 'Unknown player';
      const won = update.score === 1, lost = update.score === 0;
      const result = won ? 'WIN' : lost ? 'LOSS' : 'DRAW', color = won ? '#287247' : lost ? '#a8443b' : muted;
      const own = match.history?.players[playerId], other = match.history?.players[update.opponentId];
      const played = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago' }).format(new Date(match.playedAt));
      const live = match.liveRatings?.[update.opponentId];
      return `<rect x="39" y="${top}" width="1122" height="59" fill="${won ? '#f3f8f0' : lost ? '#fcf2ee' : '#f8f5ee'}"/>
        <rect x="39" y="${top}" width="4" height="59" fill="${color}"/>
        <rect x="54" y="${top + 13}" width="78" height="34" rx="4" fill="${color}"/>
        ${text(result, 93, top + 37, 20, 900, '#ffffff', 'text-anchor="middle"')}
        ${text(delta(update.adjustment), 156, top + 37, 23, 800, update.adjustment > 0 ? '#287247' : update.adjustment < 0 ? '#a8443b' : ink)}
        ${text(fit(opponent, 182, 18), 287, top + 26, 18, 800)}
        ${text(played, 287, top + 46, 12, 600, muted)}
        ${text(Number.isFinite(live) ? number(live) : '—', 484, top + 37, 21, 800)}
        ${pokemonCell(own, 590, top)}${text('vs.', 781, top + 36, 14, 600, muted)}${pokemonCell(other, 820, top)}
        ${text(`${own?.prizesTaken ?? '—'} – ${other?.prizesTaken ?? '—'}`, 1115, top + 37, 23, 800, ink, 'text-anchor="middle"')}${rule(top + 59)}`;
    }).join('')}
    ${!history.length ? text('No matches counted toward this rating yet.', 58, 292, 21, 600, muted) : ''}`;
}

/** A screenshot-like view built only from the current public feed and shared Elo replay. */
export function leaderboardPreviewSvg(snapshot, playerId) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" font-family="Nunito, sans-serif">${playerId ? profile(snapshot, playerId) : board(snapshot)}</svg>`;
}

export async function renderLeaderboardPreview(snapshot, playerId) {
  return new Resvg(leaderboardPreviewSvg(snapshot, playerId), {
    font: { fontFiles, loadSystemFonts: false, defaultFontFamily: 'Nunito', sansSerifFamily: 'Nunito' },
    imageRendering: 0, textRendering: 1,
  }).render().asPng();
}
