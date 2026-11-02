import assert from 'node:assert/strict';
import { cardInfoToEngineCard, cardSourceIdFromReviewCard, hiddenReviewCard } from '../card-adapter.js';
import { deriveReviewPrizeKnowledge } from '../review-prize-knowledge.js';
import type { MatchReview, TrackedTurn } from '../types.js';

const card = (id: string, source = 'test_a') => cardInfoToEngineCard(undefined, id, source, source);
const physical = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
function reviewFixture(): MatchReview {
  const outside = Array.from({ length: 54 }, (_, i) => card(`outside-${i}`));
  const prizes = Array.from({ length: 6 }, (_, i) => hiddenReviewCard(physical(i)));
  const player = { deck: outside.slice(0, 45), hand: outside.slice(45, 52), discard: outside.slice(52),
    prizes, lostZone: [], active: null, bench: [] };
  const board = { name: 'You', deckCount: 45, handCount: 7, prizesTaken: 0, active: null, bench: [] };
  const initial = { index: 0, label: 'Turn 1', events: [], snapshot: { players: { You: board }, stadium: null },
    canonical: { playerNames: ['You', 'Opponent'], localPlayerIndex: 0, selections: [], appliedEffects: {},
      state: { players: [player, structuredClone(player)], currentPlayer: 0, stadium: null },
      visibility: Object.fromEntries([...outside.map(c => [c.id, 'known']), ...prizes.map(c => [c.id, 'hidden'])]) } } as unknown as TrackedTurn;
  return { id: 'match-a', importedAt: '', source: 'live-network', players: ['You', 'Opponent'],
    localPlayer: 'You', opponent: 'Opponent', rawLog: '', decklists: [{ playerName: 'You', playerId: 'local',
      source: 'match-start', total: 60, cards: [{ cardId: 'test_a', count: 56 }, { cardId: 'test_b', count: 4 }] }],
    turns: [initial] };
}
function appendGap(review: MatchReview) {
  const next = structuredClone(review.turns.at(-1)!);
  next.index = review.turns.length;
  next.canonical!.state.players[0].discard.pop();
  review.turns.push(next);
  return next;
}
const derive = (review: MatchReview, index = review.turns.length - 1) => deriveReviewPrizeKnowledge(review, index, new Map())!;
const ids = (review: MatchReview, index?: number) => derive(review, index).cards.map(cardSourceIdFromReviewCard).sort();

const review = reviewFixture();
appendGap(review);
const untouched = JSON.stringify(review);
assert.equal(derive(review).kind, 'remembered', 'A missing unrelated card does not erase established prizes');
assert.deepEqual(ids(review), ids(review, 0));
assert.equal(derive(review).note, derive(review, 0).note, 'Incomplete frames use the normal prize display');
assert.equal(JSON.stringify(review), untouched);

const placeholders = reviewFixture();
placeholders.turns[0].canonical!.state.players[0].prizes.forEach((c, i) => { c.id = `hidden-zone:20:${i}`; });
appendGap(placeholders);
assert.equal(derive(placeholders).kind, 'remembered', 'Known prize contents survive a missing non-prize card with synthetic slots');
assert.deepEqual(ids(placeholders), ids(placeholders, 0));

// Prize taking, same-count exchanges, malformed frames, contradictory identity
// evidence and a gap that later reuses the old IDs all invalidate continuity.
for (const change of [
  (r: MatchReview) => { r.turns[1].canonical!.state.players[0].prizes.pop(); r.turns[1].snapshot.players.You.prizesTaken = 1; },
  r => { r.turns[1].canonical!.state.players[0].prizes[0] = hiddenReviewCard(physical(9)); },
  r => { r.turns[1].snapshot.players.You.prizesTaken = 1; },
  r => { r.turns[1].snapshot.players.You.prizesKnown = false; },
  r => { r.turns[1].canonical!.state.players[0].hand[0] = card(physical(0)); },
  r => { r.turns[1].canonical!.state.players[0].prizes[0] = card(physical(0), 'foreign'); r.turns[1].canonical!.visibility[physical(0)] = 'known'; },
  r => { r.turns[1].canonical!.state.players[0].prizes[1] = hiddenReviewCard(physical(0)); },
] satisfies ((r: MatchReview) => void)[]) {
  const changed = reviewFixture(); appendGap(changed); change(changed);
  assert.equal(derive(changed).kind, 'unavailable');
}
const broken = reviewFixture(); appendGap(broken);
const final = structuredClone(broken.turns[1]); final.index = 2;
delete broken.turns[1].canonical; broken.turns.push(final);
assert.equal(derive(broken).kind, 'unavailable', 'Do not bridge a frame without prize evidence');

const exchanged = reviewFixture();
appendGap(exchanged).canonical!.state.players[0].prizes[0] = hiddenReviewCard(physical(9));
const reverted = structuredClone(exchanged.turns[1]); reverted.index = 2;
reverted.canonical!.state.players[0].prizes[0] = hiddenReviewCard(physical(0)); exchanged.turns.push(reverted);
assert.equal(derive(exchanged).kind, 'unavailable', 'Every intervening frame must preserve prize identities');

const fresh = reviewFixture();
const taken = structuredClone(fresh.turns[0]); taken.index = 1;
taken.canonical!.state.players[0].prizes.pop(); taken.snapshot.players.You.prizesTaken = 1;
taken.canonical!.state.players[0].hand.push(card('taken-prize', 'test_b')); taken.snapshot.players.You.handCount++;
taken.canonical!.visibility['taken-prize'] = 'known'; fresh.turns.push(taken);
assert.equal(derive(fresh).kind, 'inferred');
assert.deepEqual(ids(fresh), ['test_a', 'test_a', 'test_b', 'test_b', 'test_b']);
appendGap(fresh);
assert.equal(derive(fresh).kind, 'remembered');
assert.equal(derive(fresh).cards.length, 5, 'Re-anchor on verified post-prize state');

const swapped = reviewFixture();
const swap = structuredClone(swapped.turns[0]); swap.index = 1;
swap.canonical!.state.players[0].hand[0] = card('swap', 'test_b'); swap.canonical!.visibility.swap = 'known';
swapped.turns.push(swap);
assert.deepEqual(ids(swapped), ['test_a', 'test_a', 'test_a', 'test_b', 'test_b', 'test_b']);

const beforeSearch = reviewFixture();
const known = structuredClone(beforeSearch.turns[0]); known.index = 1;
beforeSearch.turns[0].canonical!.state.players[0].deck = beforeSearch.turns[0].canonical!.state.players[0].deck.map(c => hiddenReviewCard(c.id));
beforeSearch.turns.push(known); appendGap(beforeSearch);
for (const index of [0, 1, 2, 0, 2, 1, 0]) {
  assert.equal(derive(beforeSearch, index).kind, ['unavailable', 'inferred', 'remembered'][index]);
  if (index === 0) assert.ok(derive(beforeSearch, index).cards.every(card => !cardSourceIdFromReviewCard(card)), 'Rewind never sees future knowledge');
}
const otherMatch = reviewFixture(); otherMatch.id = 'match-b'; otherMatch.decklists = [];
assert.equal(derive(otherMatch).kind, 'unavailable', 'No state leaks between matches');
otherMatch.localPlayer = 'Opponent';
assert.equal(derive(otherMatch), undefined, 'Never use a different player’s private accounting');
assert.equal(deriveReviewPrizeKnowledge(review, -1, new Map()), undefined);
assert.equal(deriveReviewPrizeKnowledge(review, 999, new Map()), undefined);

console.log('review-prize-knowledge: incomplete frames, physical continuity, synthetic slots, prize taking/exchanges, privacy and rewind verified');

const takingDuringGap = reviewFixture();
const gapTake = appendGap(takingDuringGap);
gapTake.canonical!.state.players[0].prizes.pop(); gapTake.snapshot.players.You.prizesTaken++;
gapTake.canonical!.state.players[0].hand.push(card('new-prize', 'test_b')); gapTake.snapshot.players.You.handCount++;
gapTake.canonical!.visibility['new-prize'] = 'known';
assert.equal(derive(takingDuringGap).kind, 'remembered');
assert.deepEqual(ids(takingDuringGap), ['test_a', 'test_a', 'test_b', 'test_b', 'test_b'], 'Subtract an identified taken prize during an unrelated data gap');
const slotMismatch = structuredClone(placeholders);
slotMismatch.turns[1].canonical!.state.players[0].prizes.push(hiddenReviewCard('extra-slot'));
assert.equal(derive(slotMismatch).cards.length, 6, 'Incomplete synthetic slot counts do not overwrite established prize contents');
const exchangeDuringGap = structuredClone(placeholders);
exchangeDuringGap.turns[1].events = [{ id: 'swap-prizes', kind: 'trainer', text: 'You exchanged a Prize card with your hand.', turnIndex: 1, detail: false }];
assert.equal(derive(exchangeDuringGap).kind, 'unavailable', 'Explicit prize exchanges invalidate cached contents');
const selectedPrize = structuredClone(placeholders);
selectedPrize.turns[1].canonical!.selections = [{ id: 'prize-choice', completed: true, sourceZonePositions: [19], selectedOptionIds: ['a'] } as any];
assert.equal(derive(selectedPrize).kind, 'unavailable', 'A completed prize exchange selection is a boundary even without descriptive text');
const finished = structuredClone(placeholders);
finished.turns[1].snapshot.players.You.prizesTaken = 6;
assert.equal(derive(finished).cards.length, 0, 'Zero remaining prizes never shows a stale list');

const attachmentGap = reviewFixture();
const initial = attachmentGap.turns[0];
const [pokemon, energy] = initial.canonical!.state.players[0].hand.splice(0, 2);
initial.snapshot.players.You.handCount -= 2;
initial.canonical!.state.players[0].active = { card: pokemon, attachedEnergy: [], attachedTools: [] } as any;
initial.snapshot.players.You.active = { id: pokemon.id, cardId: sourceId(pokemon), name: pokemon.name,
  energyCards: [{ id: energy.id, cardId: sourceId(energy), name: energy.name }] } as any;
function sourceId(card: ReturnType<typeof cardInfoToEngineCard>) { return cardSourceIdFromReviewCard(card)!; }
assert.equal(derive(attachmentGap).kind, 'inferred');
const missingMetadata = appendGap(attachmentGap);
delete missingMetadata.snapshot.players.You.active!.energyCards![0].cardId;
assert.equal(derive(attachmentGap).kind, 'remembered', 'Losing attachment metadata later must not blank known prizes');
assert.deepEqual(ids(attachmentGap), ids(attachmentGap, 0));
