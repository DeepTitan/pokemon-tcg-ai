import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DECK_FREQUENCY_BASELINE } from '../deck-frequency-baseline.js';
import { identifyDeck } from '../deck-identity.js';
import { archiveMatchup } from '../archive-summary-model.js';
import { matchSummaryFromReview } from '../match-storage.js';
import type { CapturedDecklist, CardInfo, MatchReview, MatchSummary } from '../types.js';

const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/deck-identity-corpus.json', import.meta.url), 'utf8'));
const catalog = new Map<string, CardInfo>(fixture.cards.map((c: CardInfo) => [c.id, c]));
const deck = (cards: CapturedDecklist['cards']): CapturedDecklist =>
  ({ playerName: 'You', playerId: 'p1', source: 'match-start', total: 60, cards });
for (const c of fixture.cases) {
  const list = deck(c.cards);
  const result = identifyDeck(list, catalog);
  assert.equal(result.card?.name, c.expected, c.id);
  assert.equal(result.confidence, 'recognized', c.id);
  assert.equal(Boolean(result.tieBreak), c.frequencyTieBreak, c.id);
  assert.deepEqual(result.unresolvedCardIds, []);
  assert.ok(list.cards.some(e => e.cardId === result.card!.cardId));
  assert.deepEqual(identifyDeck(deck([...c.cards].reverse()), new Map([...catalog].reverse())), result,
    'Inventory and catalog ordering must not change the icon or ranking');
  const summary = { localPlayer: 'You', opponent: 'Them', decklists: [list] } as MatchSummary;
  assert.equal(archiveMatchup(summary, catalog).localCard?.name, c.expected, 'No final board is required');
  assert.equal(archiveMatchup(summary, catalog).opponentCard, undefined, 'Never reuse the other player’s list');
}
assert.equal(identifyDeck(undefined, catalog).confidence, 'unavailable');
const first = deck(fixture.cases[0].cards);
assert.equal(identifyDeck({ ...first, total: 59 }, catalog).confidence, 'unavailable');
assert.equal(identifyDeck(deck(first.cards.slice(1)), catalog).confidence, 'unavailable');
assert.equal(identifyDeck(deck([{ cardId: 'same', count: 30 }, { cardId: 'SAME', count: 30 }]), catalog).confidence, 'unavailable');
assert.equal(identifyDeck(first, new Map()).confidence, 'incomplete');
assert.equal(identifyDeck(first, new Map()).card, undefined);

// Preserve uncertainty when even one catalog entry is missing, including an unseen potential centerpiece.
const partial = new Map(catalog); partial.delete(first.cards[0].cardId);
assert.equal(identifyDeck(first, partial).confidence, 'incomplete');

// An unseen species still has an honest deterministic fallback; do not pretend a high count is a recognized signature.
const unseen = new Map<string, CardInfo>([
  ['new', { id: 'new', name: 'Future Pokémon', category: 1, hp: 200 }],
  ['energy', { id: 'energy', name: 'Basic Energy', category: 3 }],
]);
assert.equal(identifyDeck(deck([{ cardId: 'new', count: 4 }, { cardId: 'energy', count: 56 }]), unseen).confidence, 'fallback');

// Same-name cards with different attacks are not cosmetic variants and cannot add to a signature threshold.
const dragapult = fixture.cards.find((c: CardInfo) => c.name === 'Dragapult ex');
const dreepy = fixture.cards.find((c: CardInfo) => c.name === 'Dreepy');
const drakloak = fixture.cards.find((c: CardInfo) => c.name === 'Drakloak');
const variantCatalog = new Map<string, CardInfo>([...unseen,
  ['pult', { ...dragapult, id: 'pult' }], ['pult2', { ...dragapult, id: 'pult2', actions: [] }],
  ['dreepy', { ...dreepy, id: 'dreepy' }], ['drakloak', { ...drakloak, id: 'drakloak' }],
]);
const split = deck([{ cardId: 'pult', count: 1 }, { cardId: 'pult2', count: 1 }, { cardId: 'dreepy', count: 4 },
  { cardId: 'drakloak', count: 4 }, { cardId: 'energy', count: 50 }]);
assert.equal(identifyDeck(split, variantCatalog).confidence, 'fallback');
variantCatalog.set('pult2', { ...dragapult, id: 'pult2' });
assert.equal(identifyDeck(split, variantCatalog).confidence, 'recognized', 'Cosmetic prints must combine');

const review = { id: 'test', source: 'live-network', localPlayer: 'You', opponent: 'Them',
  importedAt: '', players: ['You', 'Them'], turns: [], rawLog: '', decklists: [first] } satisfies MatchReview;
const summary = matchSummaryFromReview(review);
assert.deepEqual(summary.decklists, [first]);
const misleadingBoard = { players: { You: { name: 'You', active: { id: 'noise', name: 'Future Pokémon', cardId: 'new',
  damage: 0, maxHp: 999, energies: [], evolutionStack: [] }, bench: [], handCount: 0, knownHand: [], discard: [], prizesTaken: 6 } }, stadium: null };
assert.equal(archiveMatchup({ ...summary, finalSnapshot: misleadingBoard }, catalog).localCard?.name, fixture.cases[0].expected,
  'Final-game state must not override a captured decklist');
console.log(`deck-identity: ${fixture.cases.length} reviewed full lists (${fixture.completeDeckSides} recorded sides), ordering, variants, missing data, storage and board independence verified`);

// The empirical distribution actually decides the tie, without an Elgyem or HP bonus.
const controlCase = fixture.cases.find((c: any) => c.expected === 'Elgyem');
const controlList = deck(controlCase.cards);
const reverseControl = { version: 'test-reversed', deckCount: 100,
  deckOccurrences: { elgyem: 20, 'wellspring mask ogerpon ex': 1 } };
assert.equal(identifyDeck(controlList, catalog, reverseControl).card?.name, 'Wellspring Mask Ogerpon ex');
const waterCase = fixture.cases.find((c: any) => c.expected === 'Mega Starmie ex');
assert.equal(identifyDeck(deck(waterCase.cards), catalog, { version: 'test', deckCount: 100,
  deckOccurrences: { 'mega starmie ex': 20, 'mega froslass ex': 1 } }).card?.name, 'Mega Froslass ex');
const uncertainFrequencies: Array<Record<string, number>> = [
  { elgyem: 2, 'wellspring mask ogerpon ex': 2 }, { elgyem: 2 }, { elgyem: 0, 'wellspring mask ogerpon ex': 2 },
];
for (const deckOccurrences of uncertainFrequencies) {
  const result = identifyDeck(controlList, catalog, { version: 'test', deckCount: 100, deckOccurrences });
  assert.equal(result.tieBreak, undefined, 'Equal, missing and unobserved frequencies do not resolve a tie');
  assert.equal(result.confidence, 'ambiguous');
}
const rareSupport = { ...DECK_FREQUENCY_BASELINE,
  deckOccurrences: { ...DECK_FREQUENCY_BASELINE.deckOccurrences, jynx: 1, 'mega kangaskhan ex': 1 } };
assert.equal(identifyDeck(controlList, catalog, rareSupport).card?.name, 'Elgyem', 'Rare support/tech cards cannot win the centerpiece tie');
const darkraiCase = fixture.cases.find((c: any) => c.expected === 'Mega Darkrai ex');
assert.equal(identifyDeck(deck(darkraiCase.cards), catalog, { version: 'test', deckCount: 100,
  deckOccurrences: { 'mega darkrai ex': 100, "n's zoroark ex": 1 } }).card?.name, 'Mega Darkrai ex',
  'Rarity cannot override a clear difference in core deck investment');

// Verify generated prevalence from deck presence, not copies, cosmetic prints, or catalog frequency.
const expectedCounts = new Map<string, number>();
for (const c of fixture.cases) {
  const names = new Set<string>(c.cards.map((e: any) => catalog.get(e.cardId)!).filter((card: CardInfo) => card.category === 1)
    .map((card: CardInfo) => card.name.normalize('NFKC').replace(/[’‘]/g, "'").trim().toLowerCase()));
  for (const name of names) expectedCounts.set(name, (expectedCounts.get(name) || 0) + c.occurrences);
}
assert.equal(DECK_FREQUENCY_BASELINE.deckCount, fixture.completeDeckSides);
assert.deepEqual(Object.fromEntries(expectedCounts), DECK_FREQUENCY_BASELINE.deckOccurrences);
console.log('deck-frequency: measured prevalence, reversible tie decisions, rare-tech exclusion and missing/equal frequency safeguards verified');
