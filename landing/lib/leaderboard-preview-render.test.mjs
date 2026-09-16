import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { getLeaderboardPreviewData, getPlayerPreviewData, PlayerPreviewNotFoundError } from './generated/leaderboard-social-preview.mjs';
import { leaderboardPreviewSvg, renderLeaderboardPreview } from './leaderboard-preview-render.mjs';

const match = (id, day, winner = 'a', extra = {}) => ({
  id, playedAt: `2026-09-${String(day).padStart(2, '0')}T12:00:00Z`, confirmed: true,
  playerIds: ['a', 'b'], outcome: { type: 'win', winnerId: winner }, liveRatings: { a: 1880, b: 1900 },
  history: { players: {
    a: { pokemon: { name: 'Dragapult ex', cardId: 'sv6_130', artCardId: 'sv6_130' }, prizesTaken: 6 },
    b: { pokemon: { name: "N's Zoroark ex", cardId: 'sv9_185', artCardId: 'me2-5_286' }, prizesTaken: 2 },
  } }, ...extra,
});
const snapshot = () => ({
  generatedAt: '2026-09-16T12:00:00Z',
  players: [
    { id: 'a', name: 'isaiahw', traceStatus: 'trace-user' },
    { id: 'b', name: 'Spysimon', traceStatus: 'opponent-only' },
    { id: 'c', name: 'NewPlayer', traceStatus: 'trace-user' },
  ], matches: [match('one', 14), match('two', 15, 'b')],
});
const markup = svg => svg.replace(/href="data:[^"]+"/g, 'href="embedded-image"');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

test('leaderboard follows current shared ratings, registered population and screenshot colors', async () => {
  const data = snapshot(), before = structuredClone(data);
  const svg = markup(leaderboardPreviewSvg(data));
  const rated = getLeaderboardPreviewData(data).registeredRows.find(row => row.playerId === 'a');
  for (const label of ['Trace', 'Leaderboard', 'Trace rating', 'isaiahw', 'NewPlayer', '2 Trace players', '1W  1L', '50%', Math.round(rated.rating).toLocaleString('en-US')]) assert.ok(svg.includes(label), label);
  assert.doesNotMatch(svg, /Spysimon|Provisional|>1500<|>1,500</);
  assert.match(svg, /#f5cf68/);
  assert.doesNotMatch(svg, /#d3d6d8/, 'An unrated player does not receive a medal row');
  assert.deepEqual(data, before);
  const png = await renderLeaderboardPreview(data);
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  assert.equal(png.readUInt32BE(16), 1200); assert.equal(png.readUInt32BE(20), 630);
});

test('new ranked result updates both PNGs and player history without a deployment', async () => {
  const previous = snapshot(), next = structuredClone(previous);
  // Keep generatedAt unchanged: differences must come from the result itself.
  next.matches.push(match('three', 16));
  for (const player of [undefined, 'a']) assert.notEqual(digest(await renderLeaderboardPreview(previous, player)), digest(await renderLeaderboardPreview(next, player)));
  const svg = markup(leaderboardPreviewSvg(next, 'a'));
  const current = getPlayerPreviewData(next, 'a');
  assert.ok(svg.includes(`${current.row.wins}W  ${current.row.losses}L`));
  assert.ok(svg.includes(`+${current.updates.find(update => update.playerId === 'a' && update.matchId === 'three').adjustment.toFixed(1)}`));
  assert.match(svg, /Sep 16, 7:00 AM/);
});

test('player table preserves perspective, real Pokémon, prizes and replay-approved deltas', () => {
  const data = snapshot(), svg = markup(leaderboardPreviewSvg(data, 'b'));
  assert.match(svg, /All-player rank #\d+ · Not registered/);
  assert.match(svg, /N&apos;s Zoroark<\/text><text[^>]+>ex</); assert.match(svg, /Dragapult ex/);
  assert.match(svg, />2 – 6</);
  assert.match(svg, />1,880</);
  assert.equal((svg.match(/href="embedded-image"/g) ?? []).length, 5, 'Mascot and both Pokémon in two match rows');
  assert.ok(svg.indexOf('Sep 15, 7:00 AM') < svg.indexOf('Sep 14, 7:00 AM'));
});

test('missing Elo, unconfirmed matches and duplicate captures do not create history rows', () => {
  const data = snapshot();
  const baseline = markup(leaderboardPreviewSvg(data, 'a'));
  data.matches.push(match('missing', 16, 'a', { liveRatings: undefined }), match('pending', 16, 'a', { confirmed: false }), structuredClone(data.matches[0]));
  assert.equal(markup(leaderboardPreviewSvg(data, 'a')), baseline);
});

test('empty histories, missing art and long hostile text stay readable and cannot load paths', async () => {
  const data = snapshot();
  assert.match(markup(leaderboardPreviewSvg(data, 'c')), /No matches counted toward this rating yet\./);
  assert.doesNotMatch(markup(leaderboardPreviewSvg(data, 'c')), /#undefined|NaN|>1,500</);
  data.players[0].name = '<&MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM';
  data.matches[0].history.players.a.pokemon = { name: '<script>Oops & more</script>', cardId: '../../secret', artCardId: 'https://evil.test/image.png' };
  data.matches[1].history.players.b = {};
  const svg = markup(leaderboardPreviewSvg(data, 'a'));
  assert.match(svg, /&lt;&amp;M+…/); assert.doesNotMatch(svg, /<script>|evil\.test|\.\.\/secret|NaN/);
  assert.match(svg, /Not recorded/); assert.match(svg, /6 – —/);
  assert.ok((await renderLeaderboardPreview(data, 'a')).length > 1000);
  assert.throws(() => leaderboardPreviewSvg(data, 'missing-player'), PlayerPreviewNotFoundError);
});

test('empty leaderboard has a defined image and no fictional rated players', async () => {
  const data = { generatedAt: 'invalid', players: [], matches: [] };
  assert.match(markup(leaderboardPreviewSvg(data)), /No Trace players yet\./);
  assert.doesNotMatch(markup(leaderboardPreviewSvg(data)), /Invalid Date|NaN|Updated/);
  assert.ok((await renderLeaderboardPreview(data)).length > 1000);
});

test('publication timestamps and private fields do not influence the thumbnail', async () => {
  const data = snapshot(), repeated = structuredClone(data);
  repeated.generatedAt = '2026-09-17T12:00:00Z';
  repeated.rawLog = 'private raw log'; repeated.deviceId = 'private device';
  assert.equal(digest(await renderLeaderboardPreview(data)), digest(await renderLeaderboardPreview(repeated)));
  assert.equal(digest(await renderLeaderboardPreview(data, 'a')), digest(await renderLeaderboardPreview(repeated, 'a')));
});
