import assert from 'node:assert/strict';
import test from 'node:test';
import { replayEloRatings } from '../elo.js';
import { leaderboardRating, rankingViewFromSearch, sortLeaderboardRows } from '../ranking-view.js';

const players = [
  { id: 'trace-leader', name: 'Trace leader', latestLiveRating: 1600 },
  { id: 'live-leader', name: 'Live leader', latestLiveRating: 1900 },
  { id: 'observation-only', name: 'Observed only', latestLiveRating: 1800 },
  { id: 'missing', name: 'Missing' },
  { id: 'zero', name: 'Zero', latestLiveRating: 0 },
];
const match = { id: 'game', playedAt: '2026-11-01T12:00:00Z', playerIds: ['trace-leader', 'live-leader'] as [string, string],
  confirmed: true, outcome: { type: 'win' as const, winnerId: 'trace-leader' },
  liveRatings: { 'trace-leader': 1600, 'live-leader': 1900 } };
const replay = replayEloRatings([match], players);

test('Live is the default; only the explicit Trace query selects Trace', () => {
  for (const search of ['', '?ranking=live', '?ranking=unknown', '?preview=share']) assert.equal(rankingViewFromSearch(search), 'live');
  assert.equal(rankingViewFromSearch('?v=abc&ranking=trace'), 'trace');
});

test('Live uses exact observed ratings, including players without a counted match', () => {
  const rows = sortLeaderboardRows(replay.rows, players, 'live');
  assert.deepEqual(rows.map(row => row.playerId), ['live-leader', 'observation-only', 'trace-leader', 'zero', 'missing']);
  assert.equal(leaderboardRating(rows[0], 'live', players[1]), 1900);
  assert.equal(leaderboardRating(rows[1], 'live', players[2]), 1800);
  assert.equal(leaderboardRating(rows[3], 'live', players[4]), 0);
  assert.equal(leaderboardRating(rows[4], 'live', players[3]), undefined);
});

test('switching views preserves the Trace replay, records and profile order', () => {
  const before = JSON.stringify(replay);
  const trace = sortLeaderboardRows(replay.rows, players, 'trace');
  sortLeaderboardRows(replay.rows, players, 'live');
  assert.equal(trace[0].playerId, 'trace-leader');
  assert.equal(trace[1].playerId, 'live-leader');
  assert.equal(leaderboardRating(trace[0], 'trace'), trace[0].rating);
  assert.equal(leaderboardRating(trace[2], 'trace'), undefined);
  assert.equal(JSON.stringify(replay), before);
});

test('invalid Live values remain unranked and never fall back to a Trace score', () => {
  for (const latestLiveRating of [-1, NaN, Infinity, undefined]) {
    assert.equal(leaderboardRating(replay.rows[0], 'live', { id: replay.rows[0].playerId, latestLiveRating }), undefined);
  }
});

test('equal Live ratings have stable alphabetical ordering', () => {
  const equal = players.map(player => ({ ...player, latestLiveRating: 1700 }));
  assert.deepEqual(sortLeaderboardRows([...replay.rows].reverse(), equal, 'live').map(row => row.name),
    players.map(player => player.name).sort((a, b) => a.localeCompare(b)));
});
