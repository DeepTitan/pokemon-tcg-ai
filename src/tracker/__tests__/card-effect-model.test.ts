import assert from 'node:assert/strict';
import { cardEffectSummary } from '../card-effect-model.js';
import type { CardInfo, TrackerEvent } from '../types.js';

function event(kind: TrackerEvent['kind'], text: string): TrackerEvent {
  return { id: 'event', turnIndex: 1, kind, text, detail: false };
}

const pokePad: CardInfo = {
  id: 'poke-pad', name: 'Poké Pad', category: 2, format: 'I',
  rulesText: "Search your deck for a Pokémon that doesn't have a Rule Box. (Pokémon {ex} and Pokémon V_atk have Rule Boxes.)",
};
assert.deepEqual(cardEffectSummary(event('trainer', 'Isaiah played Poké Pad'), pokePad), {
  label: 'Item effect', title: 'Poké Pad',
  text: "Search your deck for a Pokémon that doesn't have a Rule Box. (Pokémon ex and Pokémon V have Rule Boxes.)",
});
assert.equal(cardEffectSummary(event('system', 'Isaiah chose Dreepy with Poké Pad'), pokePad)?.label, 'Item effect');

const stadium: CardInfo = {
  id: 'spikemuth', name: 'Spikemuth Gym', category: 2, format: '=A',
  rulesText: "Once during each player's turn, that player may search their deck for a Marnie's Pokémon.",
};
assert.equal(cardEffectSummary(event('stadium', 'Isaiah used Spikemuth Gym'), stadium)?.label, 'Stadium effect');

const tool: CardInfo = { id: 'tool', name: 'Handheld Fan', category: 2, format: '=T', rulesText: 'The attached Pokémon has this effect.' };
assert.equal(cardEffectSummary(event('tool', 'Isaiah attached Handheld Fan'), tool)?.label, 'Pokémon Tool effect');

const pokemon: CardInfo = {
  id: 'pokemon', name: 'Drakloak', category: 1, hp: 90,
  actions: [
    { kind: 'ability', name: 'Recon Directive', text: 'Look at the top 2 cards of your deck.', cost: '', damage: '' },
    { kind: 'attack', name: 'Dragon Headbutt', text: 'This attack has an effect.', cost: 'PR', damage: '70' },
  ],
};
assert.deepEqual(cardEffectSummary(event('ability', 'Isaiah used Recon Directive'), pokemon), {
  label: 'Ability effect', title: 'Recon Directive', text: 'Look at the top 2 cards of your deck.',
});
assert.deepEqual(cardEffectSummary(event('damage', 'Dragon Headbutt dealt 70 damage'), pokemon), {
  label: 'Attack effect', title: 'Dragon Headbutt', text: 'This attack has an effect.',
});

console.log('card-effect-model: card effects are labeled consistently across every action-card type');
