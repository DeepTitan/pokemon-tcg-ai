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

const { normalizeSetupReview } = await import('../setup-action-model.js');
const { deriveReviewTurnStatus } = await import('../turn-status-model.js');
const { turnPassForTurn } = await import('../turn-pass-model.js');
const opening = { ...frame, index: 0, events: [{ ...frame.events[0], id: 'start:primary', text: 'Start turn', facts: [] }] };
const placement = { ...frame, index: 1, events: [{ ...frame.events[0], id: 'place:primary', kind: 'pokemon' as const, text: 'JakePTCG: placed a Pokémon', facts: [] }] };
const opponentReady = { ...normalized, index: 4, events: normalized.events.map(event => ({ ...event, actor: 'Opponent' })) };
const gameplay = { ...frame, index: 5, events: [{ ...frame.events[0], id: 'play:primary', kind: 'ability' as const, text: 'JakePTCG: used Run Errand', facts: [] }] };
const sequence = normalizeSetupReview({ turns: [opening, placement, frame, opponentReady, gameplay] });
assert.deepEqual(sequence.turns.map(turn => turn.reviewPhase), ['setup', 'setup', 'setup', 'setup', undefined]);
assert.deepEqual(normalizeSetupReview(sequence), sequence, 'Reprocessing preserves the setup boundary');
assert.equal(normalizeSetupReview({ turns: [gameplay] }).turns[0].reviewPhase, undefined, 'Partial gameplay is never setup');
assert.equal(normalizeSetupReview({ turns: [opening, placement] }).turns[1].reviewPhase, 'setup', 'Live opening prefix is already setup');
assert.equal(turnPassForTurn(sequence.turns[2], ['JakePTCG', 'Opponent']), null);
const status = deriveReviewTurnStatus({ ...sequence, players: ['JakePTCG', 'Opponent'] } as MatchReview, 2, {
  playerNames: ['JakePTCG', 'Opponent'], state: { currentPlayer: 0, stadium: null }, appliedEffects: {},
} as never);
assert.equal(status.currentPlayer, undefined);
assert.equal(status.players.JakePTCG.isSetup, true);
assert.equal(status.players.JakePTCG.isCurrentTurn, false);
assert.equal(status.players.Opponent.isSetup, true);
console.log('setup sequence: live prefix, both confirmations, first gameplay, partial capture, badges and pass cues passed');
