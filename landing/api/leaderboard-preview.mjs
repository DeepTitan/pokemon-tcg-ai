import { createHash } from 'node:crypto';
import { loadLeaderboardFeed } from '../lib/leaderboard-feed.mjs';
import { leaderboardPreviewVersion } from '../lib/leaderboard-preview-version.mjs';

function requestedPlayer(request) {
  if (request.query && Object.hasOwn(request.query, 'player')) return request.query.player;
  const values = new URL(request.url || '/', 'https://victoryroad.app').searchParams.getAll('player');
  return values.length === 0 ? undefined : values.length === 1 ? values[0] : null;
}

function fail(response, method, status, message) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'text/plain; charset=utf-8');
  response.setHeader('Content-Length', String(Buffer.byteLength(message)));
  if (status === 503) response.setHeader('Retry-After', '15');
  response.end(method === 'HEAD' ? undefined : message);
}

/** Render from the same sanitized feed as the page. A supplied revision is an
 * image identity for social crawlers, never a request for a stale snapshot.
 */
export function createLeaderboardPreviewHandler({
  readFeed = loadLeaderboardFeed,
  render = async (snapshot, playerId) => (await import('../lib/leaderboard-preview-render.mjs'))
    .renderLeaderboardPreview(snapshot, playerId),
} = {}) {
  const rendered = new Map();
  return async function handler(request, response) {
    const method = request.method || 'GET';
    response.setHeader('X-Content-Type-Options', 'nosniff');
    for (const name of ['Cache-Control', 'CDN-Cache-Control', 'Vercel-CDN-Cache-Control']) response.setHeader(name, 'no-store');
    if (method !== 'GET' && method !== 'HEAD') {
      response.setHeader('Allow', 'GET, HEAD');
      fail(response, method, 405, 'This request is not supported.');
      return;
    }
    let feed;
    try { feed = await readFeed(); } catch {
      fail(response, method, 503, 'Live previews are temporarily unavailable. Please try again.');
      return;
    }
    try {
      const requested = requestedPlayer(request);
      // Image URLs contain IDs; a display name must never shadow another ID.
      const player = requested === undefined ? undefined : typeof requested !== 'string' || !requested ? null
        : feed.snapshot.players.find(entry => entry.id === requested)
          ?? feed.snapshot.players.find(entry => entry.name === requested) ?? null;
      if (player === null) { fail(response, method, 404, 'Player not found.'); return; }
      const version = leaderboardPreviewVersion(feed.snapshot);
      const key = JSON.stringify([version, player?.id]);
      let pending = rendered.get(key);
      if (!pending) {
        pending = Promise.resolve().then(() => render(feed.snapshot, player?.id)).then(bytes => {
          const png = Buffer.from(bytes);
          return { png, etag: `"${createHash('sha256').update(png).digest('hex')}"` };
        });
        if (rendered.size >= 16) rendered.delete(rendered.keys().next().value);
        rendered.set(key, pending);
        pending.catch(() => { if (rendered.get(key) === pending) rendered.delete(key); });
      }
      const { png, etag } = await pending;
      response.setHeader('Content-Type', 'image/png');
      response.setHeader('ETag', etag);
      response.setHeader('X-Trace-Preview-Version', version);
      if (request.headers?.['if-none-match'] === etag) { response.statusCode = 304; response.end(); return; }
      response.statusCode = 200;
      response.setHeader('Content-Length', String(png.length));
      response.end(method === 'HEAD' ? undefined : png);
    } catch {
      fail(response, method, 503, 'The preview could not be created. Please try again.');
    }
  };
}

export default createLeaderboardPreviewHandler();
