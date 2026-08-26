import assert from 'node:assert/strict';
import { positionChangesForTurn } from '../position-change-model.js';
import type { TrackedPlayerBoard, TrackedPokemon, TrackedTurn } from '../types.js';

const pokemon = (id: string, name: string): TrackedPokemon => ({ id, name, damage: 0, energies: [], evolutionStack: [] });
const board = (name: string, active: TrackedPokemon | null, bench: TrackedPokemon[]): TrackedPlayerBoard => ({
  name, active, bench, handCount: 0, knownHand: [], discard: [], prizesTaken: 0,
});
const turn = (index: number, local: TrackedPlayerBoard, opponent: TrackedPlayerBoard, text: string): TrackedTurn => ({
  index,
  label: `Action ${index}`,
  events: [{ id: `event-${index}`, kind: 'system', text, turnIndex: index, detail: false }],
  snapshot: { players: { [local.name]: local, [opponent.name]: opponent }, stadium: null },
});

const opponentStatic = board('opponent', pokemon('opponent-active', 'Opponent Active'), []);
const dragapult = pokemon('dragapult', 'Dragapult ex');
const munkidori = pokemon('munkidori', 'Munkidori');
const beforeRetreat = turn(90, board('isaiahw', dragapult, [munkidori]), opponentStatic, 'isaiahw used Recon Directive');
const afterRetreat = turn(91, board('isaiahw', munkidori, [dragapult]), opponentStatic, 'isaiahw: retreated Dragapult ex');
assert.deepEqual(positionChangesForTurn(beforeRetreat, afterRetreat).map(({ pokemonId, from, to, cause }) => ({ pokemonId, from, to, cause })), [
  { pokemonId: 'munkidori', from: 'bench', to: 'active', cause: 'retreat' },
  { pokemonId: 'dragapult', from: 'active', to: 'bench', cause: 'retreat' },
]);

const honchkrowA = pokemon('honchkrow-a', "Team Rocket's Honchkrow");
const honchkrowB = pokemon('honchkrow-b', "Team Rocket's Honchkrow");
const beforeBoss = turn(79, board('isaiahw', dragapult, []), board('opponent', honchkrowA, [honchkrowB]), 'isaiahw attached Energy');
const afterBoss = turn(80, board('isaiahw', dragapult, []), board('opponent', honchkrowB, [honchkrowA]), "isaiahw: played Boss's Orders");
assert.deepEqual(positionChangesForTurn(beforeBoss, afterBoss).map(({ pokemonId, from, to, cause }) => ({ pokemonId, from, to, cause })), [
  { pokemonId: 'honchkrow-b', from: 'bench', to: 'active', cause: 'switch' },
  { pokemonId: 'honchkrow-a', from: 'active', to: 'bench', cause: 'switch' },
]);

const promoted = pokemon('promoted', 'Drakloak');
const knockedOut = pokemon('knocked-out', 'Dreepy');
const beforePromotion = turn(12, board('isaiahw', knockedOut, [promoted]), opponentStatic, 'Dreepy was Knocked Out');
const afterPromotion = turn(13, board('isaiahw', promoted, []), opponentStatic, 'isaiahw: promoted Drakloak to the Active Spot');
assert.deepEqual(positionChangesForTurn(beforePromotion, afterPromotion).map(({ pokemonId, from, to, cause }) => ({ pokemonId, from, to, cause })), [
  { pokemonId: 'promoted', from: 'bench', to: 'active', cause: 'promotion' },
]);

console.log('position-change-model: retreats, same-name Boss swaps, and forced promotions remain visible');
