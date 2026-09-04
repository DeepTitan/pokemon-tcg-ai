import assert from 'node:assert/strict';
import { competitiveRatingResult, formatSignedRatingChange, ratingFieldsForReview } from '../rating-model.js';

// Consecutive ranked matches captured from TCG Live. These assert the game's
// signed rounding behavior as well as its 25-point Elo step.
assert.deepEqual(competitiveRatingResult(1753, 1755, false), { change: -13, ratingAfter: 1740 });
assert.deepEqual(competitiveRatingResult(1684, 1770, true), { change: 15, ratingAfter: 1699 });
assert.deepEqual(competitiveRatingResult(1714, 1669, true), { change: 10, ratingAfter: 1724 });
assert.deepEqual(competitiveRatingResult(1736, 1716, false), { change: -14, ratingAfter: 1722 });

assert.deepEqual(ratingFieldsForReview({
  winner: 'pikapenguin25',
  localPlayer: 'isaiahw',
  localRating: 1753,
  opponentRating: 1755,
}), {
  localRating: 1753,
  opponentRating: 1755,
  ratingChange: -13,
  ratingAfter: 1740,
});
assert.equal(formatSignedRatingChange(-13), '−13');
assert.equal(formatSignedRatingChange(12), '+12');

console.log('rating-model: TCG Live Elo changes and display copy verified');
