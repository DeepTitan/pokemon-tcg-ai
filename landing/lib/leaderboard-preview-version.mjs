import { createHash } from 'node:crypto';

// Bump when the renderer changes. The timestamp is omitted so reprocessing
// unchanged matches does not create a new social image identity.
export function leaderboardPreviewVersion(snapshot) {
  const { generatedAt, ...content } = snapshot;
  return createHash('sha256').update('trace-table-preview-v3\n')
    .update(JSON.stringify(content)).digest('hex').slice(0, 24);
}

export function leaderboardPreviewUrl(snapshot, playerId) {
  const url = new URL('https://victoryroad.app/trace/leaderboard-preview.png');
  if (playerId !== undefined) url.searchParams.set('player', playerId);
  url.searchParams.set('v', leaderboardPreviewVersion(snapshot));
  return url.href;
}
