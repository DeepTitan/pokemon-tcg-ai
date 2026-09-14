import assert from 'node:assert/strict';
import { cardInfoToEngineCard, cardSourceIdFromReviewCard, hiddenReviewCard } from '../card-adapter.js';
import { derivePrizeKnowledge } from '../prize-knowledge-model.js';
import type { Card, PlayerState, PokemonInPlay } from '../../engine/types.js';
import type { CapturedDecklist, ReviewCardVisibility, TrackedPlayerBoard } from '../types.js';

const makeCard = (id: string, source = 'test_a') => cardInfoToEngineCard(undefined, id, source, source);
const deck: CapturedDecklist = { playerId: 'local', playerName: 'You', source: 'match-start', total: 60,
  cards: [{ cardId: 'test_a', count: 56 }, { cardId: 'test_b', count: 4 }] };
function fixture() {
  const cards = Array.from({ length: 54 }, (_, i) => makeCard(`card-${i}`));
  const player = { deck: cards.slice(0, 45), hand: cards.slice(45, 52), discard: cards.slice(52),
    lostZone: [], prizes: Array.from({ length: 6 }, (_, i) => hiddenReviewCard(`prize-${i}`)),
    bench: [], active: null } as unknown as PlayerState;
  const board = { name: 'You', handCount: 7, deckCount: 45, deckCountKnown: true, prizesTaken: 0 } as TrackedPlayerBoard;
  return { deck, player, board, local: true, visibility: Object.fromEntries([...cards.map(c => [c.id, 'known']),
    ...player.prizes.map(c => [c.id, 'hidden'])]) as Record<string, ReviewCardVisibility>,
    catalog: new Map(), stadium: null as Card | null, stadiumOwner: undefined as string | undefined };
}
const ids = (cards: Card[]) => cards.map(c => cardSourceIdFromReviewCard(c)).sort();
const input = fixture();
const untouched = JSON.stringify(input);
assert.equal(derivePrizeKnowledge(input).kind, 'inferred');
assert.deepEqual(ids(derivePrizeKnowledge(input).cards), ['test_a', 'test_a', 'test_b', 'test_b', 'test_b', 'test_b']);
assert.match(derivePrizeKnowledge(input).note, /positions unknown/);
assert.equal(JSON.stringify(input), untouched, 'Do not inject inferred identities into canonical state or mutate history');
assert.ok(derivePrizeKnowledge(input).cards.every(c => c.id.startsWith('inferred-prize:')), 'No association with real prize slots');

for (const change of [
  (x: ReturnType<typeof fixture>) => { x.local = false; },
  x => { x.deck = undefined as any; },
  x => { x.board.deckCountKnown = false; },
  x => { x.board.handCount++; },
  x => { x.board.prizesTaken++; },
  x => { x.player.deck[0] = hiddenReviewCard('unseen'); },
  x => { x.visibility[x.player.deck[0].id] = 'hidden'; },
  x => { delete x.visibility[x.player.deck[0].id]; },
  x => { x.player.deck.pop(); },
  x => { x.player.discard.push(makeCard('extra')); },
  x => { x.player.deck[0] = makeCard('not-in-list', 'test_foreign'); },
  x => { x.player.prizes[0] = makeCard('prize-0', 'test_foreign'); x.visibility['prize-0'] = 'known'; },
  x => { x.player.prizes[0] = hiddenReviewCard(x.player.hand[0].id); },
] satisfies ((x: ReturnType<typeof fixture>) => void)[]) {
  const x = fixture(); change(x);
  assert.equal(derivePrizeKnowledge(x).kind, 'unavailable');
}

// A restricted/top-N search cannot resolve the rest of the hidden deck.
const partial = fixture();
partial.player.deck = partial.player.deck.map((c, i) => i < 5 ? c : hiddenReviewCard(c.id));
assert.equal(derivePrizeKnowledge(partial).kind, 'unavailable');
assert.equal(derivePrizeKnowledge(input).kind, 'inferred');
assert.equal(derivePrizeKnowledge(partial).kind, 'unavailable', 'Scrubbing backwards must not leak later search knowledge');

const take = fixture();
take.player.prizes.pop(); take.board.prizesTaken++;
const taken = makeCard('taken-prize', 'test_b');
take.player.hand.push(taken); take.board.handCount++; take.visibility[taken.id] = 'known';
assert.deepEqual(ids(derivePrizeKnowledge(take).cards), ['test_a', 'test_a', 'test_b', 'test_b', 'test_b']);
const swapped = fixture();
const returned = makeCard('returned-a', 'test_b');
swapped.player.hand[0] = returned; swapped.visibility[returned.id] = 'known';
assert.deepEqual(ids(derivePrizeKnowledge(swapped).cards), ['test_a', 'test_a', 'test_a', 'test_b', 'test_b', 'test_b'], 'Prize exchange updates composition, not an old cached guess');
const shuffle = fixture();
shuffle.player.deck.push(...shuffle.player.hand.splice(0, 2));
shuffle.board.handCount -= 2; shuffle.board.deckCount! += 2;
assert.deepEqual(ids(derivePrizeKnowledge(shuffle).cards), ids(derivePrizeKnowledge(input).cards));

const zones = fixture();
const [basic, evolution, energy, tool, lost, stadium] = zones.player.deck.splice(0, 6);
zones.board.deckCount! -= 6;
zones.player.active = { card: evolution, attachedEnergy: [energy], attachedTools: [tool],
  previousStage: { card: basic, attachedEnergy: [energy], attachedTools: [] } } as PokemonInPlay;
zones.player.lostZone.push(lost);
zones.stadium = stadium; zones.stadiumOwner = 'You';
assert.deepEqual(ids(derivePrizeKnowledge(zones).cards), ids(derivePrizeKnowledge(input).cards), 'Count all physical cards once, including repeated evolution attachments');
zones.stadiumOwner = undefined;
assert.equal(derivePrizeKnowledge(zones).kind, 'unavailable');
const otherStadium = fixture();
otherStadium.stadium = makeCard('opponent-stadium', 'foreign'); otherStadium.stadiumOwner = 'Opponent';
assert.equal(derivePrizeKnowledge(otherStadium).kind, 'inferred');
const revealed = fixture();
revealed.player.prizes[0] = makeCard('prize-0', 'test_b'); revealed.visibility['prize-0'] = 'known';
assert.deepEqual(ids(derivePrizeKnowledge(revealed).cards), ids(derivePrizeKnowledge(input).cards));
assert.equal(revealed.visibility['prize-1'], 'hidden');
const conflicting = fixture();
conflicting.player.discard.push(makeCard(conflicting.player.deck[0].id, 'test_b'));
assert.equal(derivePrizeKnowledge(conflicting).kind, 'unavailable');
const invalidDeck = fixture();
invalidDeck.deck = { ...deck, cards: [{cardId:'TEST_A',count:28},{cardId:'test_a',count:28},{cardId:'test_b',count:4}] };
assert.equal(derivePrizeKnowledge(invalidDeck).kind, 'unavailable');
const allRevealed = fixture();
allRevealed.player.prizes = Array.from({length:6},(_,i)=>makeCard(`prize-${i}`, i < 2 ? 'test_a' : 'test_b'));
allRevealed.player.prizes.forEach(c => { allRevealed.visibility[c.id] = 'known'; });
assert.equal(derivePrizeKnowledge({...allRevealed,deck:undefined}).kind, 'revealed', 'Keep directly observed identities independent of inference');
console.log('prize-knowledge: complete accounting, duplicates, attachments, evolution, stadium ownership, partial searches, prizes taken, swaps, shuffle, privacy and rewind verified');
