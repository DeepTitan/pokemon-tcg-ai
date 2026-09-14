import assert from 'node:assert/strict';
import { damageChangesForTurn } from '../damage-change-model.js';
import type { TrackedPlayerBoard, TrackedPokemon, TrackedTurn } from '../types.js';

const pokemon = (id: string, name: string, damage: number): TrackedPokemon => ({
  id, name, damage, energies: [], evolutionStack: [],
});

const board = (name: string, active: TrackedPokemon | null, bench: TrackedPokemon[]): TrackedPlayerBoard => ({
  name, active, bench, handCount: 0, knownHand: [], discard: [], prizesTaken: 0,
});

const turn = (index: number, local: TrackedPlayerBoard, opponent: TrackedPlayerBoard, events: TrackedTurn['events'] = []): TrackedTurn => ({
  index,
  label: `Action ${index}`,
  events,
  snapshot: { players: { [local.name]: local, [opponent.name]: opponent }, stadium: null },
});

const beforeAdrena = turn(80, board('isaiahw', null, [pokemon('munkidori', 'Munkidori', 20)]), board('opponent', null, [pokemon('honchkrow', "Team Rocket's Honchkrow", 60)]));
const afterAdrena = turn(81, board('isaiahw', null, [pokemon('munkidori', 'Munkidori', 10)]), board('opponent', null, [pokemon('honchkrow', "Team Rocket's Honchkrow", 70)]));
assert.deepEqual(damageChangesForTurn(beforeAdrena, afterAdrena).map(({ pokemonId, before, after, delta, source }) => ({ pokemonId, before, after, delta, source })), [
  { pokemonId: 'munkidori', before: 20, after: 10, delta: -10, source: 'board' },
  { pokemonId: 'honchkrow', before: 60, after: 70, delta: 10, source: 'board' },
]);

const beforePhantomDive = turn(81, board('isaiahw', pokemon('dragapult', 'Dragapult ex', 0), []), board('opponent', pokemon('active-ko', "Team Rocket's Honchkrow", 10), [pokemon('bench-ko', "Team Rocket's Honchkrow", 70)]));
const afterPhantomDive = turn(82, board('isaiahw', pokemon('dragapult', 'Dragapult ex', 0), []), board('opponent', pokemon('active-ko', "Team Rocket's Honchkrow", 10), [pokemon('bench-ko', "Team Rocket's Honchkrow", 70)]), [
  {
    id: 'attack', kind: 'attack', text: 'isaiahw: Dragapult ex used Phantom Dive', turnIndex: 82, detail: false,
    facts: [{ id: 'counter', kind: 'damage', label: 'Damage counters', value: "Team Rocket's Honchkrow: 70 → 130 damage", tone: 'negative' }],
  },
  { id: 'damage', kind: 'damage', text: "isaiahw: Phantom Dive dealt 200 damage to Team Rocket's Honchkrow", targetEntityId: 'active-ko', turnIndex: 82, detail: false },
]);
assert.deepEqual(damageChangesForTurn(beforePhantomDive, afterPhantomDive).map(({ pokemonId, before, after, delta, source }) => ({ pokemonId, before, after, delta, source })), [
  { pokemonId: 'active-ko', before: 10, after: 210, delta: 200, source: 'direct-damage' },
  { pokemonId: 'bench-ko', before: 70, after: 130, delta: 60, source: 'captured-counter' },
]);

const beforeLegacyPhantomDive = turn(58, board('isaiahw', pokemon('dragapult', 'Dragapult ex', 0), []), board('opponent', pokemon('legacy-active-ko', "Team Rocket's Honchkrow", 10), [pokemon('legacy-bench', "Team Rocket's Honchkrow", 0)]));
const afterLegacyPhantomDive = turn(59, board('isaiahw', pokemon('dragapult', 'Dragapult ex', 0), []), board('opponent', pokemon('legacy-active-ko', "Team Rocket's Honchkrow", 10), [pokemon('legacy-bench', "Team Rocket's Honchkrow", 0)]), [
  {
    id: 'attack-legacy', kind: 'attack', text: 'isaiahw: Dragapult ex used Phantom Dive', turnIndex: 59, detail: false,
    facts: [{ id: 'counter-legacy', kind: 'damage', label: 'Damage counters', value: "Team Rocket's Honchkrow: 60 damage marked", tone: 'negative' }],
  },
  { id: 'damage-legacy', kind: 'damage', text: "isaiahw: Phantom Dive dealt 200 damage to Team Rocket's Honchkrow", targetEntityId: 'legacy-active-ko', turnIndex: 59, detail: false },
]);
assert.deepEqual(damageChangesForTurn(beforeLegacyPhantomDive, afterLegacyPhantomDive).map(({ pokemonId, before, after, delta, source }) => ({ pokemonId, before, after, delta, source })), [
  { pokemonId: 'legacy-active-ko', before: 10, after: 210, delta: 200, source: 'direct-damage' },
  { pokemonId: 'legacy-bench', before: 0, after: 60, delta: 60, source: 'captured-counter' },
]);

const poisonFact = { id: 'poison-counter', kind: 'damage' as const, label: 'Damage counters', value: "N's Zoroark ex: 10 damage marked", tone: 'negative' as const };
const afterPoisonTick = turn(66, board('isaiahw', pokemon('shaymin', 'Shaymin', 0), []), board('opponent', pokemon('zoroark', "N's Zoroark ex", 10), []), [
  { id: 'attack', kind: 'attack', text: "opponent: N's Zoroark ex used Night Joker", turnIndex: 66, detail: false, facts: [poisonFact] },
]);
const forcedPromotion = turn(67, board('isaiahw', pokemon('shaymin', 'Shaymin', 0), []), board('opponent', pokemon('zoroark', "N's Zoroark ex", 10), []), [
  { id: 'promotion', kind: 'system', text: 'isaiahw: promoted Shaymin to the Active Spot', turnIndex: 67, detail: false, facts: [poisonFact] },
]);
assert.deepEqual(
  damageChangesForTurn(afterPoisonTick, forcedPromotion),
  [],
  'a forced-promotion frame must not apply the preceding attack frame\'s captured Poison counters a second time',
);

const beforeRuins = turn(73, board('you', null, [pokemon('your-munki', 'Munkidori', 20)]), board('them', pokemon('active-munki', 'Munkidori', 100), []));
const afterRuins = turn(74, board('you', null, [pokemon('your-munki', 'Munkidori', 20)]), board('them', pokemon('active-munki', 'Munkidori', 100), [pokemon('new-munki', 'Munkidori', 20)]), [
  { id: 'bench', kind: 'pokemon', text: 'benched Munkidori', turnIndex: 74, detail: false, facts: [
    { id: 'ruins', kind: 'damage', label: 'Damage counters', value: 'Munkidori: 20 damage marked', tone: 'negative' },
  ] },
]);
assert.deepEqual(damageChangesForTurn(beforeRuins, afterRuins), [], 'Risky Ruins counters on a new copy must not become 120 on the Active copy');
const beforeTotal = turn(1, board('you', pokemon('only', 'Munkidori', 50), []), board('them', null, []));
const afterTotal = turn(2, board('you', pokemon('only', 'Munkidori', 50), []), board('them', null, []), [{
  id: 'total', kind: 'ability', text: 'counter change', turnIndex: 2, detail: false,
  facts: [{ id: 'total-fact', kind: 'damage', label: 'Damage counters', value: 'Munkidori: 70 damage marked', tone: 'negative' }],
}]);
assert.equal(damageChangesForTurn(beforeTotal, afterTotal)[0].after, 70, 'newDC is a total, not additional damage');
console.log('damage-change-model: board deltas, same-name Risky Ruins, absolute counter totals, and staged promotions stay accurate');
