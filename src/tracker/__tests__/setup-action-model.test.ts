import assert from 'node:assert/strict';
import { normalizeSetupTurn } from '../setup-action-model.js';
import { compactStoredReview } from '../review-memory.js';
import type { MatchReview, TrackedTurn } from '../types.js';
const frame: TrackedTurn = {
  index: 3, label: 'Turn 1 · Action 3', snapshot: { players: {}, stadium: null },
  events: [{ id: 'confirm:primary', turnIndex: 3, actor: 'JakePTCG', kind: 'system', detail: false,
    text: 'JakePTCG: End turn', facts: [
      { id: 'action', kind: 'resolution', label: 'Action', value: 'End turn' },
      { id: 'deal', kind: 'movement', label: 'Cards moved', value: "6 hidden cards: JakePTCG's Deck → JakePTCG's Prize" },
    ] }],
};
const normalized = normalizeSetupTurn(frame);
assert.equal(normalized.events[0].action, 'setup-complete');
assert.equal(normalized.choiceLabel, 'Completed setup');
assert.deepEqual(normalizeSetupTurn(normalized), normalized);
assert.equal(frame.events[0].text, 'JakePTCG: End turn', 'Raw input stays unchanged');
const archive = compactStoredReview({ turns: [frame] } as MatchReview);
assert.equal(archive.turns[0].events[0].action, 'setup-complete');
for (const value of ["1 hidden card: JakePTCG's Deck → JakePTCG's Prize", "6 hidden cards: Opponent's Deck → Opponent's Prize"]) {
  const other = structuredClone(frame);
  other.events[0].facts![1].value = value;
  assert.equal(normalizeSetupTurn(other).events[0].action, 'end-turn');
}
console.log('setup-action-model: legacy repair, idempotence, archive migration, and negative evidence passed');
