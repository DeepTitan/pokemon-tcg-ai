import { createHash } from 'node:crypto';
import { projectPublicLeaderboardSnapshot } from './generated/leaderboard-public-snapshot.mjs';

// Only this derived, public feed is fetched. Raw match archives remain private.
const feedUrl = 'https://p5xbv2rfya.execute-api.us-east-1.amazonaws.com/v1/leaderboard';

export function createLeaderboardFeedLoader({ fetcher = fetch, now = Date.now, cacheMs = 3000 } = {}) {
  let cached, checkedAt = -Infinity, pending;
  return async function load() {
    if (cached && now() - checkedAt < cacheMs) return cached;
    if (pending) return pending;
    pending = (async () => {
      const response = await fetcher(feedUrl, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(8000), cache: 'no-store', redirect: 'error',
      });
      if (!response.ok) throw new Error('Leaderboard feed unavailable');
      const snapshot = projectPublicLeaderboardSnapshot(await response.json());
      const body = JSON.stringify(snapshot);
      const etag = `"${createHash('sha256').update(body).digest('hex')}"`;
      cached = { snapshot, body, etag };
      checkedAt = now();
      return cached;
    })();
    try { return await pending; } finally { pending = undefined; }
  };
}

export const loadLeaderboardFeed = createLeaderboardFeedLoader();
