/**
 * Ability DSL tests — one comment group per real Pokemon ability.
 * Uses real game state from GameEngine + buildCharizardDeck. Each test sets up
 * the board (source Pokemon in play), runs the ability DSL, asserts exact state.
 * No fluff.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  GameState,
  PlayerState,
  PokemonInPlay,
  PokemonCard,
  Card,
  CardType,
  EnergyType,
  GamePhase,
} from '../types.js';
import { EffectExecutor, EffectExecutionContext, EffectDSL } from '../effects.js';
import { GameEngine } from '../game-engine.js';
import { buildCharizardDeck } from '../charizard-deck.js';

// ============================================================================
// HELPERS — real state from Charizard deck
// ============================================================================

const DEFAULT_SEED = 42;

function createRealState(seed: number = DEFAULT_SEED): GameState {
  const deck1 = buildCharizardDeck();
  const deck2 = buildCharizardDeck();
  return GameEngine.createGame(deck1, deck2, seed);
}

function pokemonInPlayFromCard(card: PokemonCard, turnPlayed: number = 0): PokemonInPlay {
  return {
    card,
    currentHp: card.hp,
    attachedEnergy: [],
    statusConditions: [],
    damageCounters: 0,
    attachedTools: [],
    isEvolved: false,
    turnPlayed,
    damageShields: [],
    cannotRetreat: false,
  };
}

function findCardByName(cards: Card[], name: string): Card | undefined {
  return cards.find((c) => c.name === name);
}

function findCardIndexByName(cards: Card[], name: string): number {
  return cards.findIndex((c) => c.name === name);
}

/**
 * Put the given Pokemon (by name) as active for the player. Finds it in deck, hand, or bench;
 * removes from deck/hand or swaps from bench; sets as active. Returns new state.
 */
function putPokemonAsActive(state: GameState, playerIndex: 0 | 1, cardName: string): GameState {
  const player = state.players[playerIndex];
  const players = [...state.players] as [PlayerState, PlayerState];
  let newPlayer = { ...player };

  // Already active
  if (player.active?.card.name === cardName) {
    return state;
  }

  // On bench: swap with active
  const benchIndex = player.bench.findIndex((p) => p.card.name === cardName);
  if (benchIndex >= 0) {
    const newBench = [...player.bench];
    const newActive = newBench[benchIndex];
    newBench[benchIndex] = player.active!;
    newPlayer = { ...player, active: newActive, bench: newBench };
    players[playerIndex] = newPlayer;
    return { ...state, players };
  }

  // In hand or deck: need to remove and create PokemonInPlay
  let card: Card | undefined = findCardByName(player.hand, cardName);
  let fromHand = true;
  if (!card) {
    card = findCardByName(player.deck, cardName);
    fromHand = false;
  }
  if (!card || card.cardType !== CardType.Pokemon) {
    throw new Error(`Card "${cardName}" not found in player ${playerIndex} hand or deck`);
  }

  const pokemonCard = card as PokemonCard;
  const inPlay = pokemonInPlayFromCard(pokemonCard, state.turnNumber);

  if (fromHand) {
    const handIndex = findCardIndexByName(player.hand, cardName);
    const newHand = player.hand.filter((_, i) => i !== handIndex);
    const newBench = player.active && player.bench.length < 5 ? [...player.bench, player.active] : player.bench;
    newPlayer = { ...player, active: inPlay, hand: newHand, bench: newBench };
  } else {
    const deckIndex = findCardIndexByName(player.deck, cardName);
    const newDeck = player.deck.filter((_, i) => i !== deckIndex);
    const newBench = player.active && player.bench.length < 5 ? [...player.bench, player.active] : player.bench;
    newPlayer = { ...player, active: inPlay, deck: newDeck, bench: newBench };
  }
  players[playerIndex] = newPlayer;
  return { ...state, players };
}

export interface AbilityTarget {
  player: 0 | 1;
  zone: 'active' | 'bench';
  benchIndex?: number;
}

function buildAbilityContext(
  state: GameState,
  sourcePokemon: PokemonInPlay,
  playerIndex: 0 | 1,
  abilityTarget?: AbilityTarget
): EffectExecutionContext {
  const defendingPlayer = (1 - playerIndex) as 0 | 1;
  let defendingPokemon = state.players[defendingPlayer].active!;
  if (abilityTarget) {
    if (abilityTarget.zone === 'active') {
      defendingPokemon = state.players[abilityTarget.player].active!;
    } else {
      const bench = state.players[abilityTarget.player].bench;
      const idx = abilityTarget.benchIndex ?? 0;
      defendingPokemon = bench[idx];
    }
  }
  return {
    attackingPlayer: playerIndex,
    defendingPlayer,
    attackingPokemon: sourcePokemon,
    defendingPokemon,
    rng: () => 0.5,
    userChoices: abilityTarget ? { abilityTarget } : undefined,
  };
}

// ============================================================================
// Ability DSL
// ============================================================================

describe('Ability DSL', () => {
  // ---------- Fezandipiti ex — Flip the Script ----------
  // "Once during your turn, if your Active Pokemon was Knocked Out by damage from an opponent's attack during their last turn, you may draw 3 cards."
  it('Flip the Script: hand +3, deck -3', () => {
    const state = createRealState();
    const stateWithFezandipiti = putPokemonAsActive(state, 0, 'Fezandipiti ex');
    const player = stateWithFezandipiti.players[0];
    const handBefore = player.hand.length;
    const deckBefore = player.deck.length;

    const flipTheScriptDSL: EffectDSL[] = [
      { effect: 'draw', player: 'own', count: { type: 'constant', value: 3 } },
    ];
    const context = buildAbilityContext(stateWithFezandipiti, player.active!, 0);
    const after = EffectExecutor.execute(stateWithFezandipiti, flipTheScriptDSL, context);

    assert.equal(after.players[0].hand.length, handBefore + 3);
    assert.equal(after.players[0].deck.length, deckBefore - 3);
  });

  it('Flip the Script: when deck has fewer than 3 cards, draw only what is available', () => {
    const state = createRealState();
    const stateWithFezandipiti = putPokemonAsActive(state, 0, 'Fezandipiti ex');
    stateWithFezandipiti.players[0].deck = stateWithFezandipiti.players[0].deck.slice(0, 2);

    const flipTheScriptDSL: EffectDSL[] = [
      { effect: 'draw', player: 'own', count: { type: 'constant', value: 3 } },
    ];
    const context = buildAbilityContext(stateWithFezandipiti, stateWithFezandipiti.players[0].active!, 0);
    const after = EffectExecutor.execute(stateWithFezandipiti, flipTheScriptDSL, context);

    assert.equal(after.players[0].hand.length, stateWithFezandipiti.players[0].hand.length + 2);
    assert.equal(after.players[0].deck.length, 0);
  });

  // ---------- Dusknoir — Cursed Blast ----------
  // "Put 13 damage counters on 1 of your opponent's Pokemon, then your Active Pokemon is Knocked Out."
  it('Cursed Blast: setHp to 0 on self (single effect)', () => {
    const state = createRealState();
    const stateWithDusknoir = putPokemonAsActive(state, 0, 'Dusknoir');
    const ownActive = stateWithDusknoir.players[0].active!;
    const onlySetHp: EffectDSL[] = [
      { effect: 'setHp', target: { type: 'self' }, amount: { type: 'constant', value: 0 } },
    ];
    const context = buildAbilityContext(stateWithDusknoir, ownActive, 0);
    const after = EffectExecutor.execute(stateWithDusknoir, onlySetHp, context);
    assert.equal(after.players[0].active!.currentHp, 0);
  });

  it('Cursed Blast: setHp to 0 on own active (target type active)', () => {
    const state = createRealState();
    const stateWithDusknoir = putPokemonAsActive(state, 0, 'Dusknoir');
    const setHpActive: EffectDSL[] = [
      { effect: 'setHp', target: { type: 'active', player: 'own' }, amount: { type: 'constant', value: 0 } },
    ];
    const context = buildAbilityContext(stateWithDusknoir, stateWithDusknoir.players[0].active!, 0);
    const after = EffectExecutor.execute(stateWithDusknoir, setHpActive, context);
    assert.equal(after.players[0].active!.currentHp, 0);
  });

  it('Cursed Blast: target takes 130 damage, own active HP 0', () => {
    const state = createRealState();
    const stateWithDusknoir = putPokemonAsActive(state, 0, 'Dusknoir');
    const oppActive = stateWithDusknoir.players[1].active!;
    const oppHpBefore = oppActive.currentHp;

    const cursedBlastDSL: EffectDSL[] = [
      {
        effect: 'sequence',
        effects: [
          { effect: 'damage', target: { type: 'opponent' }, amount: { type: 'constant', value: 130 } },
          { effect: 'setHp', target: { type: 'active', player: 'own' }, amount: { type: 'constant', value: 0 } },
        ],
      },
    ];
    const context = buildAbilityContext(stateWithDusknoir, stateWithDusknoir.players[0].active!, 0, {
      player: 1,
      zone: 'active',
    });
    const after = EffectExecutor.execute(stateWithDusknoir, cursedBlastDSL, context);

    assert.equal(after.players[1].active!.currentHp, Math.max(0, oppHpBefore - 130));
    assert.equal(after.players[0].active!.currentHp, 0);
  });

  // ---------- Pidgeot ex — Quick Search ----------
  // "Once during your turn, you may search your deck for any 1 card, reveal it, and put it into your hand. Then, shuffle your deck."
  it('Quick Search: hand +1, deck -1', () => {
    const state = createRealState();
    const stateWithPidgeot = putPokemonAsActive(state, 0, 'Pidgeot ex');
    const deckBefore = stateWithPidgeot.players[0].deck.length;
    const handBefore = stateWithPidgeot.players[0].hand.length;

    const quickSearchDSL: EffectDSL[] = [
      {
        effect: 'search',
        player: 'own',
        from: 'deck',
        count: { type: 'constant', value: 1 },
        destination: 'hand',
      },
      { effect: 'shuffle', player: 'own', zone: 'deck' },
    ];
    const context = buildAbilityContext(stateWithPidgeot, stateWithPidgeot.players[0].active!, 0);
    const after = EffectExecutor.execute(stateWithPidgeot, quickSearchDSL, context);

    assert.equal(after.players[0].hand.length, handBefore + 1);
    assert.equal(after.players[0].deck.length, deckBefore - 1);
  });

  // ---------- Charizard ex — Infernal Reign (on evolve) ----------
  // "Search your deck for up to 3 basic Fire Energy cards and attach them to your Pokemon in any way."
  it('Infernal Reign: own active gains 3 Fire energy', () => {
    const state = createRealState();
    const stateWithCharizard = putPokemonAsActive(state, 0, 'Charizard ex');
    const ownActive = stateWithCharizard.players[0].active!;
    const energyBefore = ownActive.attachedEnergy.length;

    const infernalReignDSL: EffectDSL[] = [
      {
        effect: 'addEnergy',
        target: { type: 'self' },
        energyType: EnergyType.Fire,
        count: { type: 'constant', value: 3 },
        from: 'create',
      },
    ];
    const context = buildAbilityContext(stateWithCharizard, ownActive, 0);
    const after = EffectExecutor.execute(stateWithCharizard, infernalReignDSL, context);

    const activeAfter = after.players[0].active!;
    assert.equal(activeAfter.attachedEnergy.length, energyBefore + 3);
  });

  // ---------- Noctowl — Jewel Seeker (on evolve) ----------
  // "When this Pokemon evolves, if you have a Tera Pokemon in play, you may search your deck for up to 2 Trainer cards and put them into your hand. Then, shuffle your deck."
  it('Jewel Seeker: deck -2 Trainer, hand +2', () => {
    const state = createRealState();
    const stateWithNoctowl = putPokemonAsActive(state, 0, 'Noctowl');
    const handBefore = stateWithNoctowl.players[0].hand.length;
    const deckBefore = stateWithNoctowl.players[0].deck.length;
    const trainerCountInDeck = stateWithNoctowl.players[0].deck.filter(
      (c) => c.cardType === CardType.Trainer
    ).length;
    assert.ok(trainerCountInDeck >= 2, 'Charizard deck should have at least 2 Trainers in deck for this test');

    const jewelSeekerDSL: EffectDSL[] = [
      {
        effect: 'search',
        player: 'own',
        from: 'deck',
        filter: { filter: 'type', cardType: CardType.Trainer },
        count: { type: 'constant', value: 2 },
        destination: 'hand',
      },
      { effect: 'shuffle', player: 'own', zone: 'deck' },
    ];
    const context = buildAbilityContext(stateWithNoctowl, stateWithNoctowl.players[0].active!, 0);
    const after = EffectExecutor.execute(stateWithNoctowl, jewelSeekerDSL, context);

    assert.equal(after.players[0].hand.length, handBefore + 2);
    assert.equal(after.players[0].deck.length, deckBefore - 2);
  });
});
