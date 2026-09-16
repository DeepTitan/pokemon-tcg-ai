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
  assert.doesNotMatch(svg, /Few matches|No rating yet|Select a player/);
  assert.match(svg, /No rated matches/, 'The record still explains why an unrated player has no score');
  assert.match(svg, /width="3" height="36" fill="#c79b36"/);
  assert.doesNotMatch(svg, /#bac4d0/, 'An unrated player does not receive a medal');
  assert.doesNotMatch(svg, /#f5cf68|#d3d6d8|#dbb995/, 'Medal colors stay in small rank accents');
  assert.match(svg, /font-family="Roboto, sans-serif"/);
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
  assert.doesNotMatch(svg, /Most recent ranked matches/);
  assert.match(svg, /N&apos;s Zoroark ex/); assert.match(svg, /Dragapult ex/);
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

test('compact profile keeps the latest six games and makes each outcome explicit and high contrast', async () => {
  const data = snapshot();
  data.matches = Array.from({ length: 8 }, (_, i) => match(`game-${i}`, i + 1, i % 2 ? 'a' : 'b'));
  data.matches[7].outcome = { type: 'draw' };
  const svg = markup(leaderboardPreviewSvg(data, 'a'));
  assert.equal((svg.match(/>(WIN|LOSS|DRAW)<\/text>/g) ?? []).length, 6);
  for (const day of [3, 4, 5, 6, 7, 8]) assert.ok(svg.includes(`Sep ${day}, 7:00 AM`));
  assert.doesNotMatch(svg, /Sep [12], 7:00 AM/);
  for (const label of ['WIN', 'LOSS', 'DRAW']) assert.match(svg, new RegExp(`font-weight="700" fill="#ffffff"[^>]*>${label}<`));
  // White outcome text exceeds normal-text AA contrast, even at thumbnail scale.
  for (const color of ['#287247', '#a8443b', '#5c6b7d']) {
    const channels = color.slice(1).match(/../g).map(value => parseInt(value, 16) / 255)
      .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
    const luminance = channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
    assert.ok(1.05 / (luminance + .05) >= 4.5, color);
  }
  const png = await renderLeaderboardPreview(data, 'a');
  assert.equal(png.readUInt32BE(16), 1200); assert.equal(png.readUInt32BE(20), 630);
});

test('record bars use actual wins and losses with neutral space for draws', () => {
  const data = snapshot();
  data.matches.push(match('draw', 16, 'a', { outcome: { type: 'draw' } }));
  const svg = markup(leaderboardPreviewSvg(data));
  assert.match(svg, /width="46\.67" height="4" fill="#287247"/);
  assert.match(svg, /width="46\.67" height="4" fill="#a8443b"/);
  assert.match(svg, /width="140" height="4" fill="#9aa5b2"/);
  assert.match(svg, />1W  1L  1D</);
});
