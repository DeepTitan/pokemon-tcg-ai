/**
 * Shared test helpers for Charizard deck tests.
 * Used by abilities.test.ts, trainers.test.ts, and attacks.test.ts.
 */

import {
  GameState,
  PlayerState,
  PokemonInPlay,
  PokemonCard,
  Card,
  CardType,
  EnergyType,
  EnergyCard,
  EnergySubtype,
  GamePhase,
  StatusCondition,
} from '../types.js';
import { EffectExecutor, EffectExecutionContext, EffectDSL } from '../effects.js';
import { GameEngine } from '../game-engine.js';
import { buildCharizardDeck } from '../charizard-deck.js';

export const DEFAULT_SEED = 42;

export function createRealState(seed: number = DEFAULT_SEED): GameState {
  const deck1 = buildCharizardDeck();
  const deck2 = buildCharizardDeck();
  return GameEngine.createGame(deck1, deck2, seed);
}

export function pokemonInPlayFromCard(card: PokemonCard, turnPlayed: number = 0): PokemonInPlay {
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

export function findCardByName(cards: Card[], name: string): Card | undefined {
  return cards.find((c) => c.name === name);
}

export function findCardIndexByName(cards: Card[], name: string): number {
  return cards.findIndex((c) => c.name === name);
}

/**
 * Put the given Pokemon (by name) as active for the player. Finds it in deck, hand, or bench;
 * removes from deck/hand or swaps from bench; sets as active. Returns new state.
 */
export function putPokemonAsActive(state: GameState, playerIndex: 0 | 1, cardName: string): GameState {
  const player = state.players[playerIndex];
  const players = [...state.players] as [PlayerState, PlayerState];
  let newPlayer = { ...player };

  if (player.active?.card.name === cardName) {
    return state;
  }

  const benchIndex = player.bench.findIndex((p) => p.card.name === cardName);
  if (benchIndex >= 0) {
    const newBench = [...player.bench];
    const newActive = newBench[benchIndex];
    newBench[benchIndex] = player.active!;
    newPlayer = { ...player, active: newActive, bench: newBench };
    players[playerIndex] = newPlayer;
    return { ...state, players };
  }

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

export function buildAbilityContext(
  state: GameState,
  sourcePokemon: PokemonInPlay,
  playerIndex: 0 | 1,
  abilityTarget?: { player: 0 | 1; zone: 'active' | 'bench'; benchIndex?: number }
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

/**
 * Advance state to MainPhase for the given player so trainers can be played.
 */
export function setupMainPhase(state: GameState, playerIndex: 0 | 1): GameState {
  let s = { ...state, currentPlayer: playerIndex, phase: GamePhase.MainPhase };
  s.players[playerIndex] = {
    ...s.players[playerIndex],
    supporterPlayedThisTurn: false,
    energyAttachedThisTurn: false,
    abilitiesUsedThisTurn: [],
  };
  return s;
}

/**
 * Make a basic energy card for testing.
 */
export function makeEnergy(energyType: EnergyType, id: string = 'test-energy'): EnergyCard {
  return {
    id,
    name: `${energyType} Energy`,
    cardType: CardType.Energy,
    imageUrl: '',
    cardNumber: '',
    energySubtype: EnergySubtype.Basic,
    energyType,
    provides: [energyType],
  };
}
