import { loadLeaderboardFeed } from '../lib/leaderboard-feed.mjs';

export function createLeaderboardDataHandler(load = loadLeaderboardFeed) {
  return async function handler(request, response) {
    const method = request.method || 'GET';
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('CDN-Cache-Control', 'no-store');
    response.setHeader('Vercel-CDN-Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    if (!['GET', 'HEAD'].includes(method)) {
      response.statusCode = 405;
      response.setHeader('Allow', 'GET, HEAD');
      response.end(JSON.stringify({ error: 'Method not allowed' }));
      return;
    }
    try {
      const { body, etag } = await load();
      response.setHeader('ETag', etag);
      const condition = request.headers?.['if-none-match'];
      const matches = typeof condition === 'string' && condition.split(',').some(value => {
        const tag = value.trim().replace(/^W\//, '');
        return tag === '*' || tag === etag;
      });
      response.statusCode = matches ? 304 : 200;
      if (!matches) response.setHeader('Content-Length', Buffer.byteLength(body));
      response.end(method === 'HEAD' || matches ? undefined : body);
    } catch {
      response.statusCode = 503;
      response.setHeader('Retry-After', '15');
      response.end(method === 'HEAD' ? undefined : JSON.stringify({ error: 'Leaderboard temporarily unavailable' }));
    }
  };
}

export default createLeaderboardDataHandler();
