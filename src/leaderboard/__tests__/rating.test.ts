import assert from 'node:assert/strict';
import { replayRatings, updateGlickoRating, type RatingMatchEvent, type RatingPlayerSeed } from '../rating.js';

function close(actual: number, expected: number, tolerance = 1e-8): void {
  assert.ok(Math.abs(actual - expected) < tolerance, `${actual} differs from ${expected}`);
}

function match(id: string, day: number, winnerId = 'alice'): RatingMatchEvent {
  return {
    id,
    playedAt: new Date(Date.UTC(2026, 0, day)).toISOString(),
    playerIds: ['alice', 'bob'],
    confirmed: true,
    outcome: { type: 'win', winnerId },
    seasonId: 'one',
    phase: 'early',
  };
}

// Glickman's published worked example (before inactivity inflation).
const canonical = updateGlickoRating({ rating: 1500, rd: 200 }, [
  { rating: 1400, rd: 30, score: 1 },
  { rating: 1550, rd: 100, score: 0 },
  { rating: 1700, rd: 300, score: 0 },
]);
close(canonical.rating, 1464.1064627569112);
close(canonical.rd, 151.39890244796933);

const first = match('first', 1);
const symmetric = replayRatings([first]);
const alice = symmetric.rows.find(row => row.playerId === 'alice')!;
const bob = symmetric.rows.find(row => row.playerId === 'bob')!;
close(alice.rating - 1500, 1500 - bob.rating);
close(alice.rd, bob.rd);
assert.equal(alice.wins, 1);
assert.equal(bob.losses, 1);
assert.deepEqual(replayRatings([{ ...first, playerIds: ['bob', 'alice'] }]), symmetric,
  'Participant ordering must not determine the rating update');

const stablePlayer = { rating: 1500, rd: 50 };
const preciseWin = updateGlickoRating(stablePlayer, [{ rating: 1500, rd: 30, score: 1 }]);
const uncertainWin = updateGlickoRating(stablePlayer, [{ rating: 1500, rd: 350, score: 1 }]);
assert.ok(uncertainWin.rating > 1500, 'An uncertain opponent still supplies some information');
assert.ok(uncertainWin.rating < preciseWin.rating, 'An uncertain opponent must influence an established player less');
assert.ok(uncertainWin.rd > preciseWin.rd, 'An uncertain opponent supplies less confidence');

const duplicate = replayRatings([first, { ...first, playerIds: ['bob', 'alice'] }]);
assert.deepEqual(duplicate.rows, symmetric.rows);
assert.equal(duplicate.ratedMatchCount, 1);
assert.equal(duplicate.duplicateMatchCount, 1);
const conflict = replayRatings([first, { ...first, outcome: { type: 'win', winnerId: 'bob' } }]);
assert.equal(conflict.ratedMatchCount, 0);
assert.equal(conflict.rejectedMatches.length, 1);
assert.match(conflict.rejectedMatches[0].reason, /Conflicting/);
assert.deepEqual(conflict, replayRatings([{ ...first, outcome: { type: 'win', winnerId: 'bob' } }, first]));

const oldGames = Array.from({ length: 12 }, (_, i) => match(`old-${i}`, i + 1, i % 3 === 0 ? 'bob' : 'alice'));
const nextSeason = { ...match('new-season', 40), seasonId: 'two' };
const sameSeason = { ...nextSeason, seasonId: 'one' };
assert.deepEqual(replayRatings([...oldGames, nextSeason]), replayRatings([...oldGames, sameSeason]),
  'A season label must never reset the internal mean or uncertainty');
assert.deepEqual(replayRatings([...oldGames, nextSeason]), replayRatings([nextSeason, ...oldGames.reverse()]),
  'Replay must use chronological event order');
const simultaneous = [match('z', 1), match('a', 1, 'bob'), match('m', 1)];
assert.deepEqual(replayRatings(simultaneous), replayRatings([...simultaneous].reverse()),
  'Match IDs break timestamp ties deterministically');

const immediate = replayRatings([first], [], { asOf: first.playedAt });
const idle = replayRatings([first], [], { asOf: match('unused', 101).playedAt });
close(idle.rows[0].rating, immediate.rows[0].rating);
assert.ok(idle.rows[0].rd > immediate.rows[0].rd, 'Inactivity widens uncertainty without resetting the mean');
const frozen = replayRatings([first], [], { asOf: match('unused', 101).playedAt, processVariancePerDay: 0 });
close(frozen.rows[0].rd, immediate.rows[0].rd);
const future = replayRatings([first, match('future', 20)], [], { asOf: first.playedAt });
assert.deepEqual(future.rows, immediate.rows);
assert.match(future.rejectedMatches[0].reason, /evaluation time/);

const invalid = replayRatings([
  match('bad-winner', 1, 'mallory'),
  { ...match('unconfirmed', 2), confirmed: false },
  { ...match('self', 3), playerIds: ['alice', 'alice'] },
  { ...match('bad-date', 4), playedAt: 'yesterday' },
  { ...match('local-time', 4), playedAt: '2026-01-04T00:00:00' },
  { ...match('no-result', 5), outcome: undefined } as unknown as RatingMatchEvent,
], [{ id: 'alice', name: 'Alice' }, { id: 'bob', name: 'Bob' }]);
assert.equal(invalid.ratedMatchCount, 0);
assert.equal(invalid.rejectedMatches.length, 6);
assert.ok(invalid.rows.every(row => row.games === 0 && row.rating === 1500 && row.provisional));
assert.equal(invalid.rows.length, 2, 'Observed players with no rateable games remain visible');
const draw = replayRatings([{ ...first, outcome: { type: 'draw' } }]);
assert.ok(draw.rows.every(row => row.draws === 1 && row.rating === 1500));

const calibratedSeed: RatingPlayerSeed = {
  id: 'alice', name: 'Alice', calibratedPrior: {
    rating: 1800, rd: 200, seasonId: 'one', phase: 'early', calibrationId: 'reviewed-v1',
  },
};
const seeded = replayRatings([first], [calibratedSeed]);
assert.equal(seeded.rows[0].initialization, 'calibrated');
assert.ok(seeded.rows[0].rating > 1800);
const noSeasonMatch = replayRatings([first], [{ ...calibratedSeed,
  calibratedPrior: { ...calibratedSeed.calibratedPrior!, seasonId: 'two' } }]);
close(noSeasonMatch.rows[0].rating, alice.rating);
assert.equal(noSeasonMatch.rows[0].initialization, 'default');
const noPhaseMatch = replayRatings([first], [{ ...calibratedSeed,
  calibratedPrior: { ...calibratedSeed.calibratedPrior!, phase: 'late' } }]);
close(noPhaseMatch.rows[0].rating, alice.rating);
const latePrior = { ...calibratedSeed,
  calibratedPrior: { ...calibratedSeed.calibratedPrior!, seasonId: 'two' } };
const existing = replayRatings([first, nextSeason], [latePrior]);
const unseeded = replayRatings([first, nextSeason], [{ id: 'alice', name: 'Alice' }]);
assert.deepEqual(existing, unseeded, 'An existing identity must never be reinitialized from a new season prior');

const observedOnly = replayRatings([first], [{ id: 'charlie', name: 'Charlie' }]);
assert.equal(observedOnly.rows.at(-1)?.playerId, 'charlie', 'Unrated observations belong after rated players');
const manyDraws = replayRatings(Array.from({ length: 80 }, (_, i) => ({
  ...match(`draw-${i}`, 1), outcome: { type: 'draw' as const },
})), [], { processVariancePerDay: 0 });
assert.ok(manyDraws.rows.every(row => row.games === 80 && row.rd <= 150 && !row.provisional));
assert.ok(replayRatings([first], [], { provisionalGames: 0 }).rows.every(row => row.provisional),
  'High uncertainty alone retains provisional status');
assert.ok(replayRatings([first], [], { provisionalRd: 350 }).rows.every(row => row.provisional),
  'Too few games alone retains provisional status');
assert.throws(() => replayRatings([], [], { processVariancePerDay: -1 }), /configuration/);
assert.throws(() => replayRatings([], [], { initialRd: NaN }), /configuration/);
assert.throws(() => updateGlickoRating({ rating: 1500, rd: 0 }, []), /positive/);

// The explanation ledger must reconstruct the exact unrounded mean, including a
// calibrated first game, while recording both players' simultaneous snapshots.
const ledgerGames = [first, { ...match('drawn', 2), outcome: { type: 'draw' as const } }, match('return', 40, 'bob')];
const ledger = replayRatings(ledgerGames, [calibratedSeed], { asOf: match('evaluated', 100).playedAt });
assert.equal(ledger.updates.length, 2 * ledger.ratedMatchCount);
assert.deepEqual(ledger.updates.map(update => [update.matchId, update.playerId]), [
  ['first', 'alice'], ['first', 'bob'], ['drawn', 'alice'], ['drawn', 'bob'], ['return', 'alice'], ['return', 'bob'],
]);
for (const row of ledger.rows) {
  const history = ledger.updates.filter(update => update.playerId === row.playerId);
  close(history[0].before.rating + history.reduce((sum, update) => sum + update.adjustment, 0), row.rating);
  close(history.at(-1)!.after.rating, row.rating);
  assert.ok(row.rd > history.at(-1)!.after.rd, 'As-of uncertainty growth does not rewrite a match snapshot');
  for (let index = 0; index < history.length; index++) {
    const update = history[index];
    close(update.adjustment, update.after.rating - update.before.rating);
    close(update.adjustment, update.effectiveK * (update.score - update.expectedScore), 1e-10);
    assert.ok(Number.isFinite(update.effectiveK) && update.effectiveK > 0);
    assert.deepEqual(update.after, updateGlickoRating(update.before, [{ ...update.opponentBefore, score: update.score }]));
    if (index > 0) {
      const previous = history[index - 1];
      close(update.before.rating, previous.after.rating);
      const elapsedDays = (Date.parse(update.playedAt) - Date.parse(previous.playedAt)) / 86_400_000;
      close(update.before.rd, Math.min(350, Math.sqrt(previous.after.rd ** 2 + 25 * elapsedDays)));
    }
    const other = ledger.updates.find(candidate => candidate.matchId === update.matchId && candidate.playerId === update.opponentId)!;
    assert.deepEqual(update.opponentBefore, other.before);
    assert.notEqual(update.opponentBefore, other.before, 'Each explanation owns its snapshot');
  }
}
assert.deepEqual(ledger.updates[0].before, { rating: 1800, rd: 200 }, 'First-game explanation starts at its calibrated prior');
assert.deepEqual(ledger.updates[1].opponentBefore, { rating: 1800, rd: 200 });
assert.equal(ledger.updates[2].score, 0.5);
assert.equal(ledger.updates[4].score, 0);
assert.equal(ledger.updates[5].score, 1);
const g = 1 / Math.sqrt(1 + 3 * (Math.log(10) / 400) ** 2 * 350 ** 2 / Math.PI ** 2);
close(ledger.updates[0].expectedScore, 1 / (1 + 10 ** (-g * 300 / 400)), 1e-12);
assert.deepEqual(duplicate.updates, symmetric.updates, 'Duplicate uploads contribute no extra ledger entries');
assert.deepEqual(conflict.updates, [], 'Conflicting IDs never enter the ledger');
assert.deepEqual(invalid.updates, [], 'Unconfirmed or invalid outcomes never enter the ledger');
assert.deepEqual(future.updates, immediate.updates, 'An as-of cutoff excludes future explanations');
assert.deepEqual(draw.updates.map(update => update.adjustment), [0, 0]);
assert.ok(draw.updates.every(update => update.expectedScore === 0.5 && update.effectiveK > 0),
  'A zero-residual draw still has a valid analytic effective K');
const floored = replayRatings([first], [], { initialRd: 30, minRd: 30, processVariancePerDay: 0 });
assert.ok(floored.updates.every(update => update.after.rd === 30));
for (const update of floored.updates) close(update.adjustment, update.effectiveK * (update.score - update.expectedScore), 1e-10);
console.log('rating: canonical Glicko, uncertainty, simultaneous updates, replay, deduplication, season continuity, validation, priors, provisional status, and exact explanation ledger verified');
