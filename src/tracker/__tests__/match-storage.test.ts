import assert from 'node:assert/strict';
import { capturedAtIso, collectCardSourceIds, matchSummaryFromReview, operationKey, REDUCER_VERSION } from '../match-storage.js';
import type { CapturedOperation, MatchReview } from '../types.js';

const operation = {
  receivedAt: '1.000Z', socketHost: 'local', globalMessageType: 'PlayerMessage', gameId: 'game-1',
  messageType: 1, matchId: 'match-1', accountId: 'local', operationId: 'operation-1', messageIndex: 7,
  operation: { cardSourceID: 'SET_001', nested: [{ cardSourceId: 'SET_002' }, { cardSourceID: 'SET_001' }] },
} satisfies CapturedOperation;

assert.deepEqual([...collectCardSourceIds(operation.operation)].sort(), ['set_001', 'set_002']);
assert.deepEqual(
  [...collectCardSourceIds({ cardId: 'SET_003', canonical: { reviewSourceId: 'SET_004' } })].sort(),
  ['set_003', 'set_004'],
);
assert.equal(operationKey(operation), 'match-1:7:1.000Z:PlayerMessage:operation-1');
assert.equal(capturedAtIso('1787301501.649Z'), '2026-08-21T08:38:21.649Z');

const review = {
  id: 'live-match-1', importedAt: '2026-08-21T00:00:00.000Z', source: 'live-network', players: ['A', 'B'],
  localPlayer: 'A', opponent: 'B', winner: 'A', rawLog: '', turns: [{
    index: 0, label: 'Capture baseline', events: [], snapshot: { players: {}, stadium: null },
  }],
} satisfies MatchReview;
const summary = matchSummaryFromReview(review, 12);
assert.equal(summary.turnCount, 1);
assert.equal(summary.operationCount, 12);
assert.equal(summary.reducerVersion, REDUCER_VERSION);
assert.equal(summary.finalSnapshot?.stadium, null);

console.log('match-storage: summaries, operation keys, and card batching helpers verified');
