import assert from 'node:assert/strict';
import test from 'node:test';
import { LEADERBOARD_HREF, leaderboardShareHref, playerProfileHref, playerProfileShareHref, snapshotShareToken } from '../profile-route.js';

const generatedAt = '2026-09-16T12:00:00.000Z';
const newer = '2026-09-16T12:00:00.001Z';

test('share versions stay stable for a snapshot and change when new matches arrive', () => {
  const token = snapshotShareToken(generatedAt)!;
  assert.match(token, /^[A-Za-z0-9_-]{1,64}$/);
  assert.equal(token, Date.parse(generatedAt).toString(36));
  assert.equal(snapshotShareToken(generatedAt), token);
  assert.equal(snapshotShareToken('2026-09-16T07:00:00.000-05:00'), token, 'Equivalent timestamps share one identity');
  assert.notEqual(snapshotShareToken(newer), token);
  assert.equal(leaderboardShareHref(generatedAt), `${LEADERBOARD_HREF}?v=${token}`);
});

test('profile sharing encodes names and versions the copied link without changing navigation', () => {
  const name = 'Eevee +?/# & friends';
  const canonical = playerProfileHref(name);
  const share = playerProfileShareHref(name, generatedAt);
  const parsed = new URL(share, 'https://victoryroad.app');
  assert.equal(parsed.pathname, canonical);
  assert.equal(decodeURIComponent(parsed.pathname.split('/').at(-1)!), name);
  assert.equal(parsed.searchParams.get('v'), snapshotShareToken(generatedAt));
  assert.equal([...parsed.searchParams.keys()].join(','), 'v');
  assert.equal(playerProfileHref(name), canonical);
  assert.equal(canonical.includes('?'), false);
});

test('missing or invalid generation times use clean links instead of invalid versions', () => {
  for (const time of [undefined, '', 'not-a-date']) {
    assert.equal(snapshotShareToken(time), undefined);
    assert.equal(leaderboardShareHref(time), LEADERBOARD_HREF);
    assert.equal(playerProfileShareHref('isaiahw', time), playerProfileHref('isaiahw'));
  }
  assert.equal(snapshotShareToken('1970-01-01T00:00:00Z'), '0');
});
