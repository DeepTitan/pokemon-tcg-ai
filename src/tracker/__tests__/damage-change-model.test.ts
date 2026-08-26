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

console.log('damage-change-model: board deltas, removed counters, direct attacks, and both captured counter formats stay visible');
