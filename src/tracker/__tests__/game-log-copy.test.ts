import assert from 'node:assert/strict';
import { humanizeGameTerms, playerFacingFacts, presentTurnEvents } from '../game-log-copy.js';
import type { ReviewEventFact, ReviewSelection, TrackedTurn, TrackerEvent, TrackerEventKind } from '../types.js';

const emptySnapshot = { players: {}, stadium: null };

function fact(label: string, value: string, index: number): ReviewEventFact {
  return { id: `fact-${index}`, kind: 'system', label, value };
}

function event(id: string, text: string, kind: TrackerEventKind, actor = 'Isaiah', facts: Array<[string, string]> = []): TrackerEvent {
  return { id, turnIndex: 1, actor, text, kind, detail: false, facts: facts.map(([label, value], index) => fact(label, value, index)) };
}

function selection(id: string, kind: ReviewSelection['kind'], zone: number, chosen: string[] = []): ReviewSelection {
  return {
    id,
    kind,
    candidateVisibility: 'captured',
    sourceZonePositions: zone ? [zone] : [],
    allOptionIds: chosen,
    eligibleOptionIds: chosen,
    selectedOptionIds: chosen,
    optionCards: chosen.map((name) => ({ id: name, name } as never)),
    minimum: 0,
    maximum: Math.max(1, chosen.length),
    completed: true,
  };
}

function turn(events: TrackerEvent[], selections: ReviewSelection[] = []): TrackedTurn {
  return {
    index: 1,
    label: 'Turn 1 · Action 1',
    player: 'Isaiah',
    events,
    snapshot: emptySnapshot,
    canonical: { selections } as TrackedTurn['canonical'],
  };
}

assert.equal(humanizeGameTerms('Basic {D} Energy and Telepathic {P} Energy'), 'Basic Darkness Energy and Telepathic Psychic Energy');

const setup = presentTurnEvents(turn([
  event('setup:primary', 'Start turn', 'system', undefined, [['Action', 'Start turn']]),
  event('setup:selection:coin', 'made an unknown selection for cards', 'system'),
]));
assert.deepEqual(setup.map((entry) => entry.text), ['Opening setup completed']);

const activeChoice = presentTurnEvents(turn([
  event('active:primary', 'Isaiah: State update', 'system', 'Isaiah', [
    ['Action', 'State update'], ['Card moved', "Dedenne: Isaiah's Hand → Isaiah's Active"],
  ]),
]));
assert.equal(activeChoice[0].text, 'Isaiah: chose Dedenne as their Active Pokémon');

const sonarSelection = selection('sonar', 'entity', 9, ['Enhanced Hammer']);
const sonar = presentTurnEvents(turn([
  event('sonar:primary', 'Isaiah: used Dedenne', 'pokemon', 'Isaiah', [
    ['Source', 'Dedenne'], ['Attack selected', 'Electromagnetic Sonar'],
  ]),
  event('sonar:selection:sonar', 'Isaiah: chose Enhanced Hammer with Dedenne', 'system', 'Isaiah', [
    ['Source', 'Dedenne'], ['Attack selected', 'Electromagnetic Sonar'],
    ['Card moved', "Enhanced Hammer: Isaiah's Discard → Isaiah's Hand"],
  ]),
], [sonarSelection]));
assert.deepEqual(sonar.map((entry) => entry.text), [
  'Isaiah: Dedenne used Electromagnetic Sonar',
  'Isaiah: put Enhanced Hammer from the discard pile into their hand with Electromagnetic Sonar',
]);
assert.equal(sonar[0].kind, 'attack');

const tradeSelection = selection('trade', 'entity', 11, ["Boss's Orders"]);
const trade = presentTurnEvents(turn([
  event('trade:primary', "Isaiah: N's Zoroark ex used Trade", 'ability', 'Isaiah', [['Source', "N's Zoroark ex"]]),
  event('trade:selection:trade', "Isaiah: chose Boss's Orders with N's Zoroark ex", 'system', 'Isaiah', [
    ['Source', "N's Zoroark ex"], ['Card moved', "Boss's Orders: Isaiah's Hand → Isaiah's Discard"],
  ]),
], [tradeSelection]));
assert.equal(trade[1].text, "Isaiah: discarded Boss's Orders with Trade");

const poffinSelection = selection('poffin', 'entity', 0);
const poffin = presentTurnEvents(turn([
  event('poffin:primary', 'Isaiah: played Buddy-Buddy Poffin', 'trainer', 'Isaiah', [['Source', 'Buddy-Buddy Poffin']]),
  event('poffin:selection:poffin', 'Isaiah: made an entity selection for Buddy-Buddy Poffin', 'system', 'Isaiah', [
    ['Source', 'Buddy-Buddy Poffin'], ['Card moved', "Dreepy: Isaiah's Deck → Isaiah's Bench"],
  ]),
], [poffinSelection]));
assert.equal(poffin[1].text, 'Isaiah: put Dreepy onto the Bench from their deck with Buddy-Buddy Poffin');

const crispinSelection = selection('crispin', 'reparent', 0);
const crispin = presentTurnEvents(turn([
  event('crispin:primary', 'Isaiah: played Crispin', 'trainer', 'Isaiah', [['Source', 'Crispin']]),
  event('crispin:selection:crispin', 'Isaiah: made a reparent selection for Crispin', 'system', 'Isaiah', [
    ['Source', 'Crispin'], ['Attached', 'Basic {R} Energy → Drakloak'],
  ]),
], [crispinSelection]));
assert.equal(crispin[1].text, 'Isaiah: Crispin attached Basic Fire Energy to Drakloak');

const textChoice = selection('confirmation', 'text', 0);
const evolution = presentTurnEvents(turn([
  event('evolve:primary', 'Isaiah: evolved into Kadabra', 'pokemon'),
  event('evolve:selection:confirmation', 'Isaiah: made a text selection for Kadabra', 'system'),
], [textChoice]));
assert.deepEqual(evolution.map((entry) => entry.text), ['Isaiah: evolved into Kadabra']);

const switchChoice = selection('switch', 'entity', 13);
const boss = presentTurnEvents(turn([
  event('boss:primary', "Isaiah: played Boss's Orders", 'trainer', 'Isaiah', [['Source', "Boss's Orders"]]),
  event('boss:selection:switch', "Isaiah: made an entity selection for Boss's Orders", 'system', 'Isaiah', [
    ['Source', "Boss's Orders"], ['Switched', 'Alakazam ↔ Dedenne'],
  ]),
], [switchChoice]));
assert.equal(boss[1].text, "Isaiah: Boss's Orders switched Alakazam with Dedenne");

const ended = presentTurnEvents(turn([
  event('end:primary', 'Isaiah: End turn', 'system', 'Isaiah', [['Action', 'End turn']]),
]));
assert.equal(ended[0].text, 'Isaiah: ended their turn');

const bench = presentTurnEvents(turn([
  event('bench:primary', 'Isaiah: Benched Dunsparce', 'pokemon', 'Isaiah'),
]));
assert.equal(bench[0].text, 'Isaiah: benched Dunsparce');

const retreatSelection = selection('retreat', 'entity', 13);
const retreat = presentTurnEvents(turn([
  event('retreat:primary', 'Isaiah: retreated Dedenne', 'system', 'Isaiah'),
  event('retreat:selection:retreat', 'Isaiah: made an entity selection for cards', 'system', 'Isaiah', [
    ['Action', 'Retreat'], ['Switched', 'Dedenne ↔ Alakazam'],
  ]),
], [retreatSelection]));
assert.deepEqual(retreat.map((entry) => entry.text), ['Isaiah: switched Dedenne with Alakazam while retreating']);

const partialAttack = presentTurnEvents(turn([
  event('attack:primary', 'Isaiah: Dragapult ex used an attack', 'attack', 'Isaiah', [
    ['Source', 'Dragapult ex'], ['Target', 'Alakazam'],
  ]),
]));
assert.equal(partialAttack[0].text, 'Isaiah: Dragapult ex attacked Alakazam');

const cursedBlast = presentTurnEvents(turn([
  event('cursed:primary', 'Isaiah: Dusknoir used Cursed Blast', 'ability', 'Isaiah', [['Source', 'Dusknoir']]),
  event('cursed:ko', 'Dusknoir was Knocked Out by Dusknoir', 'knockout', 'Isaiah'),
]));
assert.equal(cursedBlast[1].text, 'Dusknoir Knocked itself Out with Cursed Blast');

const attackCoin = presentTurnEvents(turn([
  event('coin-attack:primary', 'Isaiah: Mega Kangaskhan ex used Rapid-Fire Combo', 'attack', 'Isaiah', [
    ['Source', 'Mega Kangaskhan ex'], ['Attack selected', 'Rapid-Fire Combo'],
  ]),
  event('coin-attack:coin', 'Isaiah: Mega Kangaskhan ex — Tails', 'coin', 'Isaiah', [
    ['Source', 'Mega Kangaskhan ex'], ['Attack selected', 'Rapid-Fire Combo'], ['Coin flip', 'Tails'],
  ]),
]));
assert.equal(attackCoin[1].text, 'Isaiah: Rapid-Fire Combo coin flip — Tails');

const visibleFacts = playerFacingFacts(event('facts', 'test', 'system', 'Isaiah', [
  ['Operation', '#42'],
  ['Selection type', 'Entity choice · method 1'],
  ['Card moved', "Basic {P} Energy: Isaiah's Deck → Isaiah's Hand"],
  ['Damage counters', 'Alakazam: 20 → 80 damage'],
  ['Attack selected', 'Powerful Hand'],
]));
assert.deepEqual(visibleFacts.map(({ label, value }) => [label, value]), [
  ['Card moved', "Basic Psychic Energy moved from Isaiah's deck to Isaiah's hand"],
  ['Damage counters', 'Alakazam now has 80 damage (was 20)'],
  ['Attack', 'Powerful Hand'],
]);

console.log('game-log-copy: player language, selection outcomes, metadata filtering, and energy names');
