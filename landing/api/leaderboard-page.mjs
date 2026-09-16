import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';

let cachedPages;

async function loadPages() {
  cachedPages ??= readFile(new URL('../assets/leaderboard-pages.json.gz', import.meta.url))
    .then(bytes => JSON.parse(gunzipSync(bytes).toString('utf8')))
    .then(pages => {
      if (pages.version !== 1 || typeof pages.board?.html !== 'string' || !Array.isArray(pages.players)
        || pages.players.some(player => typeof player?.id !== 'string' || typeof player?.name !== 'string' || typeof player?.html !== 'string')) {
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
export function findLeaderboardPage(pages, player) {
  if (player === undefined) return pages.board.html;
  if (typeof player !== 'string' || !player) return null;
  const record = pages.players.find(entry => entry.name === player)
    ?? pages.players.find(entry => entry.id === player);
  return record?.html ?? null;
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
  const explanation = missing ? 'Check the player name or find them on the leaderboard.' : 'Please return to the leaderboard and try again.';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${heading} · Trace</title><meta name="robots" content="noindex"><style>body{margin:0;padding:64px 24px;background:#f7f2e8;color:#172b49;font:18px/1.6 system-ui,sans-serif}main{max-width:720px;margin:auto}h1{font-size:32px;line-height:1.2}a{color:inherit}</style></head><body><main><h1>${heading}</h1><p>${explanation}</p><a href="/trace/leaderboard">Back to leaderboard</a></main></body></html>`;
}

function sendHtml(response, method, status, html) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.setHeader('Cache-Control', status === 200 ? 'public, max-age=0, s-maxage=300, stale-while-revalidate=86400' : 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Content-Length', Buffer.byteLength(html));
  response.end(method === 'HEAD' ? undefined : html);
}

/** A local bundle keeps crawler metadata available without runtime network requests. */
export function createLeaderboardPageHandler(readPages = loadPages) {
  return async function handler(request, response) {
    const method = request.method || 'GET';
    if (method !== 'GET' && method !== 'HEAD') {
      response.setHeader('Allow', 'GET, HEAD');
      sendHtml(response, method, 405, errorPage(405));
      return;
    }
    try {
      const html = findLeaderboardPage(await readPages(), requestedPlayer(request));
      sendHtml(response, method, html === null ? 404 : 200, html ?? errorPage(404));
    } catch {
      sendHtml(response, method, 500, errorPage(500));
    }
  };
}

export default createLeaderboardPageHandler();
