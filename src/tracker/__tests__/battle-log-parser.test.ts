import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseBattleLog } from '../battle-log-parser.js';
import { DEMO_BATTLE_LOG } from '../demo-log.js';

const smokeReview = parseBattleLog(DEMO_BATTLE_LOG);
assert.deepEqual(smokeReview.players, ['isaiahw', 'Yo_Allan']);
assert.equal(smokeReview.localPlayer, 'isaiahw');
assert.equal(smokeReview.opponent, 'Yo_Allan');
assert.equal(smokeReview.turns.length, 4);
assert.equal(smokeReview.turns[0].snapshot.players.isaiahw.active?.name, 'Dreepy');
assert.equal(smokeReview.turns.at(-1)!.snapshot.players.isaiahw.active?.name, 'Budew');

const fixture = process.env.TRACE_BATTLE_LOG_FIXTURE;
if (fixture) {
  const review = parseBattleLog(readFileSync(fixture, 'utf8'));

  assert.deepEqual(review.players, ['isaiahw', 'Yo_Allan']);
  assert.equal(review.localPlayer, 'isaiahw');
  assert.equal(review.opponent, 'Yo_Allan');
  assert.equal(review.winner, 'Yo_Allan');
  assert.equal(review.turns.length, 14);

  const setup = review.turns[0].snapshot;
  assert.equal(setup.players.isaiahw.active?.name, 'Dreepy');
  assert.equal(setup.players.Yo_Allan.active?.name, 'Latias ex');

  const firstIsaiahTurn = review.turns[2].snapshot;
  assert.equal(firstIsaiahTurn.players.isaiahw.active?.name, 'Budew');
  assert.equal(firstIsaiahTurn.players.Yo_Allan.active?.name, 'Latias ex');
  assert.equal(firstIsaiahTurn.stadium, 'Risky Ruins');

  const final = review.turns.at(-1)!.snapshot;
  assert.equal(final.winner, 'Yo_Allan');
  assert.equal(final.players.Yo_Allan.prizesTaken, 6);
  assert.equal(final.players.isaiahw.active, null);
}

console.log(`battle-log-parser: portable ${smokeReview.turns.length - 1}-turn reconstruction passed`);
