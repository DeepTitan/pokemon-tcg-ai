import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { loadLeaderboardFeed } from '../lib/leaderboard-feed.mjs';
import { leaderboardPreviewUrl } from '../lib/leaderboard-preview-version.mjs';

let cachedPages;

async function loadPages() {
  cachedPages ??= readFile(new URL('../assets/leaderboard-pages.json.gz', import.meta.url))
    .then(bytes => JSON.parse(gunzipSync(bytes).toString('utf8')))
    .then(pages => {
      if (pages.version !== 3 || typeof pages.shell !== 'string' || !/<title>[^<]*<\/title>/i.test(pages.shell)) {
        throw new Error('Invalid leaderboard page bundle');
      }
      return pages;
    }).catch(error => {
      cachedPages = undefined;
      throw error;
    });
  return cachedPages;
}

/** Array lookup deliberately avoids treating names such as __proto__ as object keys. */
export function findLeaderboardPlayer(snapshot, player) {
  if (player === undefined) return undefined;
  if (typeof player !== 'string' || !player) return null;
  return snapshot.players.find(entry => entry.name === player)
    ?? snapshot.players.find(entry => entry.id === player) ?? null;
}

/** Both metadata and the preview image follow the current public feed. */
export function renderCurrentLeaderboardPage(pages, snapshot, player, social, shareVersion) {
  const origin = 'https://victoryroad.app';
  const metadata = player ? social.getPlayerSocialMetadata(snapshot, player.id, origin) : social.getLeaderboardSocialMetadata(snapshot, origin);
  metadata.canonicalUrl = player ? `${origin}/trace/players/${encodeURIComponent(player.name)}` : `${origin}/trace/leaderboard`;
  metadata.imageUrl = leaderboardPreviewUrl(snapshot, player?.id);
  metadata.imageType = 'image/png';
  if (typeof shareVersion === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(shareVersion)) {
    metadata.shareUrl = `${metadata.canonicalUrl}?v=${shareVersion}`;
  }
  // The callback preserves literal replacement characters in player names.
  return pages.shell.replace(/<title>[^<]*<\/title>/i, () => social.renderSocialMetadata(metadata));
}

function requestedPlayer(request) {
  for (const key of ['player', 'name']) {
    if (request.query && Object.hasOwn(request.query, key)) return request.query[key];
  }
  const url = new URL(request.url || '/', 'https://victoryroad.app');
  for (const key of ['player', 'name']) {
    if (url.searchParams.has(key)) {
      const values = url.searchParams.getAll(key);
      return values.length === 1 ? values[0] : null;
    }
  }
  return undefined;
}

function errorPage(status) {
  const missing = status === 404;
  const heading = missing ? 'Player not found' : status === 405 ? 'This request is not supported' : 'The leaderboard could not be opened';
  const explanation = missing ? 'Check the player name or find them on the leaderboard.' : status === 503
    ? 'Live match updates are temporarily unavailable. Please try again in a moment.' : 'Please return to the leaderboard and try again.';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${heading} · Trace</title><meta name="robots" content="noindex"><style>body{margin:0;padding:64px 24px;background:#f7f2e8;color:#172b49;font:18px/1.6 system-ui,sans-serif}main{max-width:720px;margin:auto}h1{font-size:32px;line-height:1.2}a{color:inherit}</style></head><body><main><h1>${heading}</h1><p>${explanation}</p><a href="/trace/leaderboard">Back to leaderboard</a></main></body></html>`;
}

function sendHtml(response, method, status, html) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('CDN-Cache-Control', 'no-store');
  response.setHeader('Vercel-CDN-Cache-Control', 'no-store');
  if (status === 503) response.setHeader('Retry-After', '15');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Content-Length', Buffer.byteLength(html));
  response.end(method === 'HEAD' ? undefined : html);
}

/** The feed loader coalesces requests; HTML must not cache an old player roster. */
export function createLeaderboardPageHandler({
  readPages = loadPages,
  readFeed = loadLeaderboardFeed,
  readSocial = () => import('../lib/generated/leaderboard-social-preview.mjs'),
} = {}) {
  return async function handler(request, response) {
    const method = request.method || 'GET';
    if (method !== 'GET' && method !== 'HEAD') {
      response.setHeader('Allow', 'GET, HEAD');
      sendHtml(response, method, 405, errorPage(405));
      return;
    }
    try {
      const [pages, social] = await Promise.all([readPages(), readSocial()]);
      let feed;
      try { feed = await readFeed(); } catch {
        sendHtml(response, method, 503, errorPage(503));
        return;
      }
      const player = findLeaderboardPlayer(feed.snapshot, requestedPlayer(request));
      const shareVersion = request.query?.v ?? new URL(request.url || '/', 'https://victoryroad.app').searchParams.get('v');
      const html = player === null ? null : renderCurrentLeaderboardPage(pages, feed.snapshot, player, social, shareVersion);
      sendHtml(response, method, html === null ? 404 : 200, html ?? errorPage(404));
    } catch {
      sendHtml(response, method, 500, errorPage(500));
    }
  };
}

export default createLeaderboardPageHandler();
