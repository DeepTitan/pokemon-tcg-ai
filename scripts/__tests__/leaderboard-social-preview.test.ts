import assert from 'node:assert/strict';
import { ACTIVE_ELO_OPTIONS, replayEloRatings } from '../../src/leaderboard/elo.js';
import {
  escapePreviewHtml, getLeaderboardSocialMetadata, getPlayerSocialMetadata, renderSocialMetadata,
  PlayerPreviewNotFoundError, type SocialPreviewSnapshot,
} from '../leaderboard-social-preview.js';

const snapshot: SocialPreviewSnapshot = {
  generatedAt: '2026-09-16T12:00:00Z',
  players: [
    { id: 'alice', name: 'Alice <&" >', traceStatus: 'trace-user' },
    { id: 'bob', name: 'Bob', traceStatus: 'trace-user' },
    { id: 'opponent/<&', name: 'Opponent <script>alert(1)</script>', traceStatus: 'opponent-only' },
    { id: 'unrated', name: 'New Player', traceStatus: 'trace-user' },
  ],
  matches: [
    { id: 'one', playedAt: '2026-09-15T12:00:00Z', confirmed: true, playerIds: ['alice', 'opponent/<&'], outcome: { type: 'win', winnerId: 'alice' }, liveRatings: { alice: 1900, 'opponent/<&': 1900 } },
    { id: 'two', playedAt: '2026-09-16T12:00:00Z', confirmed: true, playerIds: ['alice', 'bob'], outcome: { type: 'win', winnerId: 'bob' }, liveRatings: { alice: 1900, bob: 1700 } },
    { id: 'missing', playedAt: '2026-09-16T13:00:00Z', confirmed: true, playerIds: ['alice', 'bob'], outcome: { type: 'win', winnerId: 'alice' } },
  ],
};
const original = JSON.stringify(snapshot);
const replay = replayEloRatings(snapshot.matches, snapshot.players, ACTIVE_ELO_OPTIONS);
const alice = replay.rows.find(player => player.playerId === 'alice')!;
const metadata = getPlayerSocialMetadata(snapshot, 'alice', 'http://127.0.0.1:5178');
assert.equal(metadata.canonicalUrl, 'http://127.0.0.1:5178/players/Alice%20%3C%26%22%20%3E');
assert.equal(metadata.imageUrl, 'http://127.0.0.1:5178/api/leaderboard/players/alice/preview.jpg');
assert.ok(metadata.description.includes(`${Math.round(alice.rating).toLocaleString('en-US')} Trace rating`));
assert.ok(metadata.description.includes('1W · 1L'), 'Only eligible records count');
assert.ok(!renderSocialMetadata(metadata).includes('<&" >'));
assert.ok(renderSocialMetadata(metadata).includes('Alice &lt;&amp;&quot; &gt;'));
assert.ok(renderSocialMetadata(metadata).includes('content="1200"'));
assert.ok(renderSocialMetadata(metadata).includes('summary_large_image'));
assert.equal(escapePreviewHtml('<script x="1">&\u0000\'</script>'), '&lt;script x=&quot;1&quot;&gt;&amp;&#39;&lt;/script&gt;');
assert.throws(() => getPlayerSocialMetadata(snapshot, 'absent', 'http://localhost:5178'), PlayerPreviewNotFoundError);
assert.throws(() => getLeaderboardSocialMetadata(snapshot, 'javascript:alert(1)'), TypeError);
assert.throws(() => getLeaderboardSocialMetadata(snapshot, 'https://user:secret@example.com'), TypeError);

const sortedRegistered = replay.rows.filter(row => snapshot.players.some(player => player.id === row.playerId && player.traceStatus === 'trace-user'))
  .sort((a, b) => Number(b.games > 0) - Number(a.games > 0) || b.rating - a.rating || a.name.localeCompare(b.name));
const aliceRank = sortedRegistered.findIndex(player => player.playerId === 'alice') + 1;
assert.ok(metadata.description.includes(`Trace rank #${aliceRank}`), 'Registered rank matches the production leaderboard');
const board = getLeaderboardSocialMetadata(snapshot, 'http://127.0.0.1:5178');
assert.ok(board.description.includes('3 Trace players'));
assert.ok(board.description.includes('2 rated matches'));
assert.equal(board.canonicalUrl, 'http://127.0.0.1:5178/leaderboard.html');
assert.equal(board.imageUrl, 'http://127.0.0.1:5178/api/leaderboard/preview.jpg');
const opponent = getPlayerSocialMetadata(snapshot, 'opponent/<&', 'http://127.0.0.1:5178');
assert.ok(opponent.description.includes('All-player rank #'));
assert.ok(opponent.imageUrl.includes('opponent%2F%3C%26/preview.jpg'));
assert.ok(!renderSocialMetadata(opponent).includes('<script>'));
assert.ok(renderSocialMetadata(opponent).includes('&lt;script&gt;'));
const unrated = getPlayerSocialMetadata(snapshot, 'unrated', 'http://127.0.0.1:5178');
assert.ok(unrated.description.includes('No rated matches recorded yet.'));
assert.ok(!unrated.description.includes('#undefined'));
assert.deepEqual(getPlayerSocialMetadata(snapshot, 'alice', 'http://127.0.0.1:5178'), metadata);
assert.equal(JSON.stringify(snapshot), original, 'Metadata generation must not mutate the archive');
console.log('Social metadata: production ratings and ranks, eligible records, safe HTML/URLs, and missing players verified');
