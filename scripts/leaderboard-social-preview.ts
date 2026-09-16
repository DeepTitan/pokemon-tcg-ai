import { ACTIVE_ELO_OPTIONS, replayEloRatings, type EloLeaderboardRow, type LiveEloEvent } from '../src/leaderboard/elo.js';
import type { LiveScaleCalibration } from '../src/leaderboard/live-scale.js';

/** Only the public-facing local leaderboard projection is needed. Never pass raw capture logs. */
export interface SocialPreviewSnapshot {
  generatedAt: string;
  players: readonly { id: string; name: string; traceStatus?: 'trace-user' | 'opponent-only' }[];
  matches: readonly LiveEloEvent[];
  liveScaleCalibrations?: readonly LiveScaleCalibration[];
}

export interface SocialPreviewMetadata {
  title: string;
  description: string;
  canonicalUrl: string;
  shareUrl?: string;
  imageUrl: string;
  imageAlt: string;
  imageWidth: 1200;
  imageHeight: 630;
  imageType?: 'image/jpeg' | 'image/png';
}

export class PlayerPreviewNotFoundError extends Error {
  constructor() { super('Player not found in the local leaderboard.'); this.name = 'PlayerPreviewNotFoundError'; }
}

const number = (value: number) => Math.round(value).toLocaleString('en-US');
const record = (row: EloLeaderboardRow) => `${row.wins}W · ${row.losses}L${row.draws ? ` · ${row.draws}D` : ''}`;
/** Safe in HTML text and quoted attributes; all names and descriptions use this boundary. */
export const escapePreviewHtml = (value: string) => value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);

export function getLeaderboardPreviewData(snapshot: SocialPreviewSnapshot) {
  const replay = replayEloRatings(snapshot.matches, snapshot.players, {
    ...ACTIVE_ELO_OPTIONS, liveScaleCalibrations: snapshot.liveScaleCalibrations,
  });
  const rows = [...replay.rows].sort((a, b) => Number(b.games > 0) - Number(a.games > 0) || b.rating - a.rating || a.name.localeCompare(b.name));
  const registered = new Set(snapshot.players.filter(player => player.traceStatus === 'trace-user').map(player => player.id));
  return { ...replay, rows, registered, registeredRows: rows.filter(row => registered.has(row.playerId)) };
}

export function getPlayerPreviewData(snapshot: SocialPreviewSnapshot, playerId: string) {
  const result = getLeaderboardPreviewData(snapshot);
  const row = result.rows.find(player => player.playerId === playerId);
  if (!row) throw new PlayerPreviewNotFoundError();
  const isRegistered = result.registered.has(playerId);
  const population = isRegistered ? result.registeredRows : result.rows;
  const rank = row.games > 0 ? population.findIndex(player => player.playerId === playerId) + 1 : undefined;
  return { ...result, row, isRegistered, rank, rankLabel: isRegistered ? 'Trace rank' : 'All-player rank' };
}

function originUrl(origin: string) {
  const url = new URL(origin);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new TypeError('A plain HTTP or HTTPS origin is required.');
  return url.origin;
}

/** Host comes from the caller. No production origin is assumed for this local prototype. */
export function getLeaderboardSocialMetadata(snapshot: SocialPreviewSnapshot, origin: string): SocialPreviewMetadata {
  const result = getLeaderboardPreviewData(snapshot), base = originUrl(origin);
  return {
    title: 'Trace leaderboard',
    description: `One rating, built from recorded matches. Explore ${result.registeredRows.length} Trace players and ${result.ratedMatchCount} rated matches.`,
    canonicalUrl: `${base}/leaderboard.html`, imageUrl: `${base}/api/leaderboard/preview.jpg`,
    imageAlt: 'Trace leaderboard with the leading registered players and their Trace ratings.', imageWidth: 1200, imageHeight: 630,
  };
}

export function getPlayerSocialMetadata(snapshot: SocialPreviewSnapshot, playerId: string, origin: string): SocialPreviewMetadata {
  const { row, rank, rankLabel } = getPlayerPreviewData(snapshot, playerId), base = originUrl(origin);
  return {
    title: `${row.name} · Trace`,
    description: row.games ? `${number(row.rating)} Trace rating · ${record(row)} · ${rankLabel} #${rank}. See ${row.name}’s recorded match history.` : `${row.name}’s Trace profile. No rated matches recorded yet.`,
    canonicalUrl: `${base}/players/${encodeURIComponent(row.name)}`,
    imageUrl: `${base}/api/leaderboard/players/${encodeURIComponent(playerId)}/preview.jpg`,
    imageAlt: `${row.name}’s Trace rating, match record, and recent results.`, imageWidth: 1200, imageHeight: 630,
  };
}

/** Server-render these into <head>; social crawlers do not need to execute React. */
export function renderSocialMetadata(meta: SocialPreviewMetadata): string {
  const attribute = escapePreviewHtml;
  return `<title>${attribute(meta.title)}</title>\n` + [
    `<meta name="description" content="${attribute(meta.description)}">`,
    `<link rel="canonical" href="${attribute(meta.canonicalUrl)}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="Trace">`,
    `<meta property="og:title" content="${attribute(meta.title)}">`,
    `<meta property="og:description" content="${attribute(meta.description)}">`,
    `<meta property="og:url" content="${attribute(meta.shareUrl ?? meta.canonicalUrl)}">`,
    `<meta property="og:image" content="${attribute(meta.imageUrl)}">`,
    `<meta property="og:image:type" content="${meta.imageType ?? 'image/jpeg'}">`,
    `<meta property="og:image:width" content="${meta.imageWidth}">`,
    `<meta property="og:image:height" content="${meta.imageHeight}">`,
    `<meta property="og:image:alt" content="${attribute(meta.imageAlt)}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${attribute(meta.title)}">`,
    `<meta name="twitter:description" content="${attribute(meta.description)}">`,
    `<meta name="twitter:image" content="${attribute(meta.imageUrl)}">`,
    `<meta name="twitter:image:alt" content="${attribute(meta.imageAlt)}">`,
  ].join('\n');
}
