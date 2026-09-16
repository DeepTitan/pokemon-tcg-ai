import { createHash } from 'node:crypto';
import { Resvg } from '@resvg/resvg-js';
import { originalCardArt, shareCardCatalog } from '../lib/share-catalog.mjs';
import { artDataUri, measureCardArt } from '../lib/share-card-art.mjs';
import { publicCardArtUrl } from '../lib/generated/share-matchup.mjs';

const cardBack = '/trace/leaderboard-static/pokemon-card-back.jpg';
const imageHosts = new Set(['images.pokemontcg.io', 'limitlesstcg.nyc3.cdn.digitaloceanspaces.com']);

/** Finish aliases are allowed only when their exact printing is in the catalog. */
export function knownCardId(input, catalog) {
  if (typeof input !== 'string' || !/^[a-z0-9-]+_\d+(?:_[a-z0-9]+)?$/i.test(input)) return undefined;
  const id = input.toLowerCase();
  if (catalog.has(id)) return id;
  const printing = id.replace(/_ph\d*$/, '');
  return printing !== id && catalog.has(printing) ? id : undefined;
}

/** Crop the audited PTCGL frame, rather than shrinking its square texture. */
export function renderLeaderboardCardArt(image) {
  const bounds = measureCardArt(image);
  const height = 256, width = Math.round(height * bounds.width / bounds.height);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}"><image href="${artDataUri(image)}" width="256" height="256" preserveAspectRatio="xMidYMid meet"/></svg>`;
  return new Resvg(svg, { font: { loadSystemFonts: false } }).render().asPng();
}

function requestCardId(request) {
  if (request.query && Object.hasOwn(request.query, 'cardId')) return request.query.cardId;
  try {
    const values = new URL(request.url || '/', 'https://victoryroad.app').searchParams.getAll('cardId');
    return values.length === 1 ? values[0] : undefined;
  } catch { return undefined; }
}

function safePublicUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && imageHosts.has(url.hostname) && !url.username && !url.password && !url.port
      && /^\/[A-Za-z0-9_./-]+\.png$/.test(url.pathname) && !url.search && !url.hash ? url.href : undefined;
  } catch { return undefined; }
}

function redirect(response, location, known) {
  response.statusCode = 302;
  response.setHeader('Location', location);
  response.setHeader('Cache-Control', known ? 'public, max-age=3600, s-maxage=86400' : 'public, max-age=30, s-maxage=30');
  response.setHeader('Content-Length', '0');
  response.end();
}

export function createLeaderboardArtHandler({ catalog = shareCardCatalog(), originalArt = originalCardArt, publicUrl = publicCardArtUrl } = {}) {
  const cache = new Map();
  return function handler(request, response) {
    const method = request.method || 'GET';
    response.setHeader('X-Content-Type-Options', 'nosniff');
    if (method !== 'GET' && method !== 'HEAD') {
      response.statusCode = 405;
      response.setHeader('Allow', 'GET, HEAD');
      response.setHeader('Cache-Control', 'no-store');
      response.end();
      return;
    }
    const id = knownCardId(requestCardId(request), catalog);
    if (!id) { redirect(response, cardBack, false); return; }
    let rendered = cache.get(id);
    if (!rendered) {
      try {
        const image = originalArt(id);
        if (image) {
          const png = renderLeaderboardCardArt(image);
          rendered = { png, etag: `"${createHash('sha256').update(png).digest('hex')}"` };
          if (cache.size >= 64) cache.delete(cache.keys().next().value);
          cache.set(id, rendered);
        }
      } catch { /* A missing or unsupported bundled texture can use its known public printing. */ }
    }
    if (!rendered) {
      const url = safePublicUrl(publicUrl(id.replace(/_ph\d*$/, '')));
      redirect(response, url ?? cardBack, !!url);
      return;
    }
    response.setHeader('Content-Type', 'image/png');
    response.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=86400');
    response.setHeader('ETag', rendered.etag);
    if (request.headers?.['if-none-match'] === rendered.etag) { response.statusCode = 304; response.end(); return; }
    response.statusCode = 200;
    response.setHeader('Content-Length', String(rendered.png.length));
    response.end(method === 'HEAD' ? undefined : rendered.png);
  };
}

export default createLeaderboardArtHandler();
