import assert from 'node:assert/strict';
import { attackResolutionForTurn } from '../attack-resolution-model.js';
import type { TrackedTurn, TrackerEvent } from '../types.js';

const event = (id: string, kind: TrackerEvent['kind'], text: string): TrackerEvent => ({
  id, kind, text, turnIndex: 57, detail: false,
});

const attackTurn: TrackedTurn = {
  index: 57,
  label: 'Turn 4 · Action 57',
  player: 'isaiahw',
  choiceLabel: "Chose Team Rocket's Honchkrow with Dragapult ex",
  choiceCards: [{ id: 'dragapult', name: 'Dragapult ex', choiceRole: 'action' }],
  events: [
    event('attack', 'attack', 'isaiahw: Dragapult ex used Phantom Dive'),
    event('damage', 'damage', "isaiahw: Phantom Dive dealt 200 damage to Team Rocket's Honchkrow"),
    event('ko', 'knockout', "Team Rocket's Honchkrow was Knocked Out by Dragapult ex"),
    event('prize', 'prize', 'isaiahw took 1 Prize card'),
    event('promotion', 'system', "OrangeManiac: promoted Team Rocket's Honchkrow to the Active Spot"),
  ],
  snapshot: { players: {}, stadium: null },
};

assert.deepEqual(attackResolutionForTurn(attackTurn), {
  attacker: 'isaiahw',
  sourceId: 'dragapult',
  source: 'Dragapult ex',
  attack: 'Phantom Dive',
  hits: [{ target: "Team Rocket's Honchkrow", damage: 200, knockedOut: true }],
  prizeCards: 1,
});

const damageOnly: TrackedTurn = {
  ...attackTurn,
  index: 99,
  player: 'OrangeManiac',
  choiceLabel: 'Attacked with R Command',
  choiceCards: [{ id: 'porygon2', name: "Team Rocket's Porygon2", choiceRole: 'action' }],
  events: [
    event('damage-only', 'damage', 'OrangeManiac: R Command dealt 260 damage to Fezandipiti ex'),
    event('damage-only-ko', 'knockout', "Fezandipiti ex was Knocked Out by Team Rocket's Porygon2"),
    event('damage-only-prizes', 'prize', 'OrangeManiac took 2 Prize cards'),
  ],
};

assert.deepEqual(attackResolutionForTurn(damageOnly), {
  attacker: 'OrangeManiac',
  sourceId: 'porygon2',
  source: "Team Rocket's Porygon2",
  attack: 'R Command',
  hits: [{ target: 'Fezandipiti ex', damage: 260, knockedOut: true }],
  prizeCards: 2,
});

const sameNameDoubleKnockout: TrackedTurn = {
  ...attackTurn,
  events: [
    { ...event('double-attack', 'attack', 'isaiahw: Dragapult ex used Phantom Dive'), sourceEntityId: 'dragapult' },
    { ...event('active-damage', 'damage', "isaiahw: Phantom Dive dealt 200 damage to Team Rocket's Honchkrow"), targetEntityId: 'active-honchkrow' },
    { ...event('active-ko', 'knockout', "Team Rocket's Honchkrow was Knocked Out by Dragapult ex"), targetEntityId: 'active-honchkrow' },
    { ...event('bench-ko', 'knockout', "Team Rocket's Honchkrow was Knocked Out by Dragapult ex"), targetEntityId: 'bench-honchkrow' },
    event('double-prize', 'prize', 'isaiahw took 2 Prize cards'),
  ],
};

assert.deepEqual(attackResolutionForTurn(sameNameDoubleKnockout)?.hits, [
  { targetId: 'active-honchkrow', target: "Team Rocket's Honchkrow", damage: 200, knockedOut: true },
  { targetId: 'bench-honchkrow', target: "Team Rocket's Honchkrow", damage: 0, knockedOut: true },
]);

console.log('attack-resolution-model: attacker, target, damage, knockout, and prize outcomes stay grouped');
