import https from 'node:https';
import { gunzipSync } from 'node:zlib';
import { archiveMatchup, representativePokemon as boardRepresentative, publicCardArtUrl } from './generated/share-matchup.mjs';
import { shareCardCatalog } from './share-catalog.mjs';

export { publicCardArtUrl };

const TRACE_API_URL = 'https://p5xbv2rfya.execute-api.us-east-1.amazonaws.com';

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function finalSnapshot(review) {
  const turns = asArray(review?.turns);
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const snapshot = asObject(turns[index]?.snapshot);
    if (Object.keys(asObject(snapshot.players)).length) return snapshot;
  }
  return { players: {} };
}

/** The desktop's board fallback, only for matches without a starting decklist. */
export function representativePokemon(board) {
  if (!board) return undefined;
  return boardRepresentative({ ...board, bench: asArray(board.bench) }, shareCardCatalog());
}

function formatDate(iso) {
  const value = new Date(iso);
  if (Number.isNaN(value.valueOf())) return 'Match replay';
  const parts = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/Chicago',
    timeZoneName: 'short',
  }).formatToParts(value);
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${lookup.month} ${lookup.day} · ${lookup.hour}:${lookup.minute} ${lookup.dayPeriod} ${lookup.timeZoneName}`;
}

function formatDuration(seconds) {
  if (finiteNumber(seconds) == null || seconds < 0) return undefined;
  const wholeSeconds = Math.round(seconds);
  if (wholeSeconds < 60) return `${Math.max(1, wholeSeconds)}s`;
  const hours = Math.floor(wholeSeconds / 3_600);
  const minutes = Math.floor((wholeSeconds % 3_600) / 60);
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}

export function socialCardData(payload) {
  const review = asObject(payload?.review);
  const summary = asObject(payload?.summary);
  const localPlayer = String(review.localPlayer || summary.localPlayer || 'You');
  const opponent = String(review.opponent || summary.opponent || 'Opponent');
  const winner = typeof review.winner === 'string' ? review.winner
    : typeof summary.winner === 'string' ? summary.winner : undefined;
  const snapshot = finalSnapshot(review);
  const players = asObject(snapshot.players);
  const localBoard = asObject(players[localPlayer]);
  const opponentBoard = asObject(players[opponent]);
  const preview = asObject(summary.socialPreview);
  const decklists = asArray(review.decklists);
  const matchup = archiveMatchup({
    localPlayer, opponent, decklists,
    finalSnapshot: { players: Object.fromEntries(Object.entries(players).map(([name, board]) =>
      [name, { ...asObject(board), bench: asArray(board?.bench) }])) },
  }, shareCardCatalog(decklists));
  const localPokemon = matchup.localCard || {
    name: preview.localCardName,
    cardId: preview.localCardId,
  };
  const opponentPokemon = matchup.opponentCard || {
    name: preview.opponentCardName,
    cardId: preview.opponentCardId,
  };
  const localPrizes = finiteNumber(localBoard.prizesTaken) ?? finiteNumber(preview.localPrizes);
  const opponentPrizes = finiteNumber(opponentBoard.prizesTaken) ?? finiteNumber(preview.opponentPrizes);
  const result = winner ? (winner === localPlayer ? 'VICTORY' : 'DEFEAT') : 'MATCH';
  const localName = String(localPokemon?.name || 'Unknown deck');
  const opponentName = String(opponentPokemon?.name || 'Unknown deck');
  const prizeScore = localPrizes != null && opponentPrizes != null
    ? `${localPrizes}–${opponentPrizes}` : '—';
  const localRating = finiteNumber(review.localRating) ?? finiteNumber(summary.localRating);
  const opponentRating = finiteNumber(review.opponentRating) ?? finiteNumber(summary.opponentRating);
  const duration = formatDuration(finiteNumber(summary.durationSeconds) ?? finiteNumber(review.durationSeconds));
  const date = formatDate(review.importedAt || summary.importedAt);
  const title = `${localPlayer} vs. ${opponent}`;
  const resultVerb = result === 'VICTORY' ? 'defeated' : result === 'DEFEAT' ? 'played' : 'played';

  return {
    title,
    description: `${localPlayer} ${resultVerb} ${opponent}. ${localName} vs. ${opponentName} · ${prizeScore} prizes. Review the full match on Trace.`,
    result,
    localPlayer,
    opponent,
    localRating,
    opponentRating,
    localPokemon: {
      name: localName,
      cardId: localPokemon?.cardId,
      image: publicCardArtUrl(localPokemon?.cardId),
    },
    opponentPokemon: {
      name: opponentName,
      cardId: opponentPokemon?.cardId,
      image: publicCardArtUrl(opponentPokemon?.cardId),
    },
    date,
    duration,
    prizeScore,
    actionCount: finiteNumber(summary.operationCount) ?? asArray(review.turns).length,
  };
}

export async function fetchSharedReplay(shareId, signal, summaryOnly = false) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(shareId || '')) {
    const error = new Error('Invalid share id');
    error.status = 400;
    throw error;
  }
  const suffix = summaryOnly ? '?summary=1' : '';
  const url = `${TRACE_API_URL}/v1/shares/${encodeURIComponent(shareId)}${suffix}`;
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', abort);
      callback(value);
    };
    const abort = () => request.destroy(new Error('Shared replay request timed out'));
    const request = https.get(url, { headers: { accept: 'application/json', connection: 'close' } }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('error', (error) => finish(reject, error));
      response.on('end', () => {
        const status = response.statusCode || 500;
        if (status < 200 || status >= 300) {
          const error = new Error(status === 404 ? 'Shared replay not found' : 'Shared replay unavailable');
          error.status = status;
          finish(reject, error);
          return;
        }
        try {
          const bytes = Buffer.concat(chunks);
          const decoded = response.headers['content-encoding']?.includes('gzip') ? gunzipSync(bytes) : bytes;
          finish(resolve, JSON.parse(decoded.toString('utf8')));
        } catch {
          finish(reject, new Error('Shared replay returned invalid data'));
        }
      });
    });
    request.setTimeout(8_000, abort);
    request.on('error', (error) => finish(reject, error));
    if (signal?.aborted) abort();
    else signal?.addEventListener('abort', abort, { once: true });
  });
}

export function requestShareId(request) {
  const queryValue = request?.query?.shareId;
  if (typeof queryValue === 'string') return queryValue;
  if (Array.isArray(queryValue)) return queryValue[0] || '';
  try {
    return new URL(request.url, 'https://victoryroad.app').searchParams.get('shareId') || '';
  } catch {
    return '';
  }
}

// Reuse only the tiny derived thumbnail model, never retain full replay payloads.
// Reads the same already-public replay as the browser; no new public data fields.
export function createSharedCardLoader(fetchReplay = fetchSharedReplay, now = Date.now) {
  const cache = new Map();
  return async (shareId) => {
    const existing = cache.get(shareId);
    if (existing && existing.expires > now()) return existing.card;
    const entry = { expires: now() + 300_000 };
    entry.card = fetchReplay(shareId, AbortSignal.timeout(15_000), false).then(socialCardData);
    cache.delete(shareId);
    if (cache.size >= 32) cache.delete(cache.keys().next().value);
    cache.set(shareId, entry);
    try { return await entry.card; }
    catch (error) {
      if (cache.get(shareId) === entry) cache.delete(shareId);
      throw error;
    }
  };
}

export const loadSharedSocialCard = createSharedCardLoader();
