/**
 * Pokemon TCG AI Game Engine - Core Game Logic
 *
 * This is the heart of the system. It implements:
 * - Complete Pokemon TCG Standard format rules
 * - Deterministic, stateless game logic (immutable pattern)
 * - Turn structure and phase management
 * - Action validation and execution
 * - Damage calculation with weakness/resistance
 * - Prize card management and win conditions
 * - Determinization for imperfect information AI
 *
 * All methods are pure functions: GameState -> GameState (or similar).
 * No mutable state. All operations create new copies.
 */

import {
  Card,
  CardType,
  EnergyType,
  EnergyCard,
  EnergySubtype,
  GamePhase,
  GameState,
  GameFlag,
  PlayerState,
  PokemonCard,
  PokemonInPlay,
  PokemonStage,
  StatusCondition,
  TrainerCard,
  TrainerType,
  Action,
  ActionType,
  Attack,
  GameConfig,
  AnyCard,
  EncodedGameState,
  Zone,
  PendingChoice,
} from './types.js';
import { EffectExecutor, EffectDSL, Condition } from './effects.js';

// ============================================================================
// SEEDED RANDOM NUMBER GENERATOR
// ============================================================================

/**
 * Xorshift64* PRNG for deterministic randomization.
 * Provides reproducible shuffle and coin flips given a seed.
 * Uses bitwise operations for speed.
 */
class SeededRandom {
  private state: bigint;

  constructor(seed: number = Date.now()) {
    // Mix seed to avoid short period with small seeds
    this.state = BigInt(seed || 1) ^ BigInt(0x9e3779b97f4a7c15);
  }

  /**
   * Generate next random number in [0, 1).
   */
  next(): number {
    let x = this.state;
    x ^= x >> BigInt(12);
    x ^= x << BigInt(25);
    x ^= x >> BigInt(27);
    this.state = x;
    return Number(x & BigInt(0xffffff)) / 0x1000000;
  }

  /**
   * Fisher-Yates shuffle in-place.
   * Mutates array; use on copies only.
   */
  shuffle<T>(array: T[]): T[] {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }

  /**
   * Coin flip: true with 50% probability.
   */
  coinFlip(): boolean {
    return this.next() < 0.5;
  }

  /**
   * Weighted coin flip: true with given probability.
   */
  weightedFlip(probability: number): boolean {
    return this.next() < probability;
  }
}

// ============================================================================
// GAME ENGINE CLASS
// ============================================================================

export class GameEngine {
  // Default game configuration matching Pokemon TCG standard format
  private static readonly DEFAULT_CONFIG: GameConfig = {
    deckSize: 60,
    maxBench: 5,
    prizeCount: 6,
  };

  /**
   * Create a new game with two decks.
   * Handles shuffling, mulligan, and setup phase.
   *
   * @param deck1 Player 0's deck (60 cards)
   * @param deck2 Player 1's deck (60 cards)
   * @param seed Random seed for reproducibility
   * @returns Initial game state after setup
   */
  static createGame(deck1: Card[], deck2: Card[], seed: number = 0): GameState {
    const rng = new SeededRandom(seed);

    // Clone decks with unique card IDs per player, then shuffle.
    // Cards with the same base id (e.g. multiple copies of Fire Energy) get a
    // copy index appended so every card in the game has a unique id.
    const prefixIds = (cards: Card[], prefix: string): Card[] => {
      const idCounts = new Map<string, number>();
      return cards.map(c => {
        const count = idCounts.get(c.id) || 0;
        idCounts.set(c.id, count + 1);
        return { ...c, id: `${prefix}-${c.id}-${count}` };
      });
    };
    const shuffledDeck1 = rng.shuffle(prefixIds(deck1, 'p0'));
    const shuffledDeck2 = rng.shuffle(prefixIds(deck2, 'p1'));

    // Initialize player states
    const player0: PlayerState = {
      deck: shuffledDeck1.slice(13), // After drawing 7 hand + 6 prizes = 13 cards
      hand: shuffledDeck1.slice(0, 7),
      active: null,
      bench: [],
      prizes: shuffledDeck1.slice(7, 13), // Cards 7-12 (6 prizes)
      discard: [],
      lostZone: [],
      supporterPlayedThisTurn: false,
      energyAttachedThisTurn: false,
      prizeCardsRemaining: 6,
      extraTurn: false,
      skipNextTurn: false,
      abilitiesUsedThisTurn: [],
    };

    const player1: PlayerState = {
      deck: shuffledDeck2.slice(13),
      hand: shuffledDeck2.slice(0, 7),
      active: null,
      bench: [],
      prizes: shuffledDeck2.slice(7, 13),
      discard: [],
      lostZone: [],
      supporterPlayedThisTurn: false,
      energyAttachedThisTurn: false,
      prizeCardsRemaining: 6,
      extraTurn: false,
      skipNextTurn: false,
      abilitiesUsedThisTurn: [],
    };

    // Create base game state
    let state: GameState = {
      players: [player0, player1],
      currentPlayer: rng.coinFlip() ? 0 : 1,
      turnNumber: 1,
      phase: GamePhase.Setup,
      stadium: null,
      winner: null,
      turnActions: [],
      gameLog: [],
      gameFlags: [],
    };

    // Run setup phase for both players (mulligan, place Pokemon)
    state = this.setupPhase(state, rng);

    return state;
  }

  /**
   * Setup phase: mulligan rules and place initial Pokemon.
   * Private method as part of game creation.
   */
  private static setupPhase(state: GameState, rng: SeededRandom): GameState {
    // Mulligan logic: if hand has no Basic Pokemon, shuffle back and redraw
    for (const playerIndex of [0, 1] as const) {
      let player = state.players[playerIndex];

      // Keep mulliganing until we have a Basic Pokemon
      while (!this.hasBasicPokemon(player.hand)) {
        // Shuffle hand back into deck
        player = {
          ...player,
          deck: rng.shuffle([...player.deck, ...player.hand]),
          hand: [],
        };
        // Draw 7 new cards
        const drawn = player.deck.slice(0, 7);
        player = {
          ...player,
          deck: player.deck.slice(7),
          hand: drawn,
        };
        state.players[playerIndex] = player;
      }

      // Place one Basic Pokemon as Active (face-down, so we don't see it)
      const basicPokemon = this.findFirstBasicPokemon(player.hand);
      if (basicPokemon) {
        const basicIndex = player.hand.indexOf(basicPokemon);
        const pokemonInPlay = this.createPokemonInPlay(basicPokemon as PokemonCard);
        player = {
          ...player,
          active: pokemonInPlay,
          hand: player.hand.filter((_, i) => i !== basicIndex),
        };
      }

      // Place up to 5 Basic Pokemon on Bench
      const bench: PokemonInPlay[] = [];
      const remainingHand = [...player.hand];
      for (let i = 0; i < 5; i++) {
        const basic = this.findFirstBasicPokemon(remainingHand);
        if (!basic) break;
        bench.push(this.createPokemonInPlay(basic as PokemonCard));
        remainingHand.splice(remainingHand.indexOf(basic), 1);
      }

      state.players[playerIndex] = {
        ...player,
        bench,
        hand: remainingHand,
      };
    }

    // Determine who goes first (already done during createGame coin flip)
    // First player cannot attack on their first turn (handled in phase logic)
    state = {
      ...state,
      phase: GamePhase.DrawPhase,
      gameLog: [...state.gameLog, `Setup complete. Player ${state.currentPlayer} goes first.`],
    };

    return state;
  }

  /**
   * Start of turn: draw a card.
   * If deck is empty, that player loses immediately (deck-out).
   */
  static startTurn(state: GameState): GameState {
    const player = state.players[state.currentPlayer];

    // Check if player can draw
    if (player.deck.length === 0) {
      // Deck-out loss
      const winner = state.currentPlayer === 0 ? 1 : 0;
      return {
        ...state,
        winner,
        phase: GamePhase.GameOver,
        gameLog: [...state.gameLog, `Player ${state.currentPlayer} cannot draw. Player ${winner} wins!`],
      };
    }

    // Draw one card
    const newHand = [...player.hand, player.deck[0]];
    const newDeck = player.deck.slice(1);

    const newState = {
      ...state,
      players: [
        state.currentPlayer === 0
          ? { ...player, hand: newHand, deck: newDeck }
          : state.players[0],
        state.currentPlayer === 1
          ? { ...player, hand: newHand, deck: newDeck }
          : state.players[1],
      ] as [PlayerState, PlayerState],
      phase: GamePhase.MainPhase,
      turnActions: [],
      gameLog: [...state.gameLog, `Player ${state.currentPlayer} draws a card.`],
    };

    return newState;
  }

  /**
   * End turn: apply between-turn effects.
   * - Poison damage (10 per poison counter)
   * - Burn damage (20 if coin flip tails)
   * - Status conditions persist
   * Then switch to next player.
   */
  static endTurn(state: GameState): GameState {
    let newState = { ...state };

    // Apply between-turn effects to both players' Active Pokemon
    for (const playerIndex of [0, 1] as const) {
      const pokemon = newState.players[playerIndex].active;
      if (!pokemon) continue;

      // Poison: 10 damage per poison counter
      if (pokemon.statusConditions.includes(StatusCondition.Poisoned)) {
        newState = this.applyDamage(
          newState,
          { player: playerIndex, zone: 'active' },
          10
        );
      }

      // Burn: flip coin for 20 damage (use deterministic seed based on turn + player)
      if (pokemon.statusConditions.includes(StatusCondition.Burned)) {
        if (new SeededRandom(newState.turnNumber * 31 + playerIndex * 7 + 13).coinFlip()) {
          newState = this.applyDamage(
            newState,
            { player: playerIndex, zone: 'active' },
            20
          );
        }
      }
    }

    // Check for knockouts from between-turn damage
    newState = this.checkKnockouts(newState);

    // Determine next player, respecting extra turns and skip turns
    const currentPlayer = newState.currentPlayer;
    let nextPlayer: 0 | 1;

    if (newState.players[currentPlayer].extraTurn) {
      // Extra turn: same player goes again
      nextPlayer = currentPlayer;
      newState.players[currentPlayer] = {
        ...newState.players[currentPlayer],
        extraTurn: false,
      };
    } else {
      nextPlayer = currentPlayer === 0 ? 1 : 0;
    }

    // Check if the next player's turn should be skipped
    if (newState.players[nextPlayer].skipNextTurn) {
      newState.players[nextPlayer] = {
        ...newState.players[nextPlayer],
        skipNextTurn: false,
      };
      // Skip to the player after that
      nextPlayer = nextPlayer === 0 ? 1 : 0;
    }

    const nextTurnNumber = newState.turnNumber + 1;

    // Expire game flags from previous turn
    const currentTurn = newState.turnNumber;
    const remainingFlags = newState.gameFlags.filter(f => {
      if (f.duration === 'thisAttack') return false; // always expire after the attack
      if (f.duration === 'nextTurn' && f.setOnTurn < currentTurn) return false;
      return true;
    });

    // Expire damage shields on all Pokemon
    for (const player of newState.players) {
      const allPokemon = player.active ? [player.active, ...player.bench] : [...player.bench];
      for (const pokemon of allPokemon) {
        if (pokemon.damageShields.length > 0) {
          pokemon.damageShields = pokemon.damageShields.filter(s => {
            if (s.duration === 'thisAttack') return false;
            if (s.duration === 'nextTurn' && s.createdOnTurn < currentTurn) return false;
            return true;
          });
        }
        // Reset per-turn flags at end of turn
        pokemon.cannotRetreat = false;
        pokemon.isEvolved = false;
      }
    }

    newState = {
      ...newState,
      currentPlayer: nextPlayer,
      turnNumber: nextTurnNumber,
      phase: GamePhase.DrawPhase,
      gameFlags: remainingFlags,
      players: [
        { ...newState.players[0], supporterPlayedThisTurn: false, energyAttachedThisTurn: false, abilitiesUsedThisTurn: [] as string[] },
        { ...newState.players[1], supporterPlayedThisTurn: false, energyAttachedThisTurn: false, abilitiesUsedThisTurn: [] as string[] },
      ] as [PlayerState, PlayerState],
    };

    return newState;
  }

  /**
   * Get all legal actions for current player.
   * PERFORMANCE CRITICAL: called millions of times during MCTS.
   * Must be fast and allocation-efficient.
   */
  static getLegalActions(state: GameState): Action[] {
    const actions: Action[] = [];
    const player = state.players[state.currentPlayer];

    // Only generate actions if game is ongoing
    if (state.winner !== null) return actions;

    // If pending choice exists (search, discard, switch, evolve), only offer ChooseCard actions
    if (state.pendingChoice && state.pendingChoice.options.length > 0) {
      const choice = state.pendingChoice;
      for (const option of choice.options) {
        actions.push({
          type: ActionType.ChooseCard,
          player: choice.playerIndex,
          payload: { choiceId: option.id, label: option.label },
        });
      }
      if (choice.canSkip) {
        actions.push({
          type: ActionType.ChooseCard,
          player: choice.playerIndex,
          payload: { choiceId: 'skip', label: 'Done' },
        });
      }
      return actions;
    }

    // If pending attachments exist (from searchAndAttach), only offer target selection
    if (state.pendingAttachments && state.pendingAttachments.cards.length > 0) {
      const pendingPlayer = state.players[state.pendingAttachments.playerIndex];
      if (pendingPlayer.active) {
        actions.push({
          type: ActionType.SelectTarget,
          player: state.pendingAttachments.playerIndex,
          payload: { zone: 'active' },
        });
      }
      pendingPlayer.bench.forEach((_, i) => {
        actions.push({
          type: ActionType.SelectTarget,
          player: state.pendingAttachments!.playerIndex,
          payload: { zone: 'bench', benchIndex: i },
        });
      });
      return actions;
    }

    // Phase-dependent action generation
    if (state.phase === GamePhase.DrawPhase) {
      // Must transition to MainPhase after draw (already handled by startTurn)
      // No actions in draw phase
      return actions;
    }

    if (state.phase === GamePhase.MainPhase) {
      // Play Pokemon to bench (as many times as desired)
      for (let i = 0; i < player.hand.length; i++) {
        const card = player.hand[i];
        if (card.cardType === CardType.Pokemon) {
          const pokemon = card as PokemonCard;
          if (pokemon.stage === PokemonStage.Basic && player.bench.length < 5) {
            actions.push({
              type: ActionType.PlayPokemon,
              player: state.currentPlayer,
              payload: { handIndex: i },
            });
          } else if (
            pokemon.stage !== PokemonStage.Basic &&
            this.canEvolve(state, i, player)
          ) {
            // Evolution actions
            const target = this.findEvolutionTarget(player, pokemon);
            if (target) {
              if (target === player.active) {
                actions.push({
                  type: ActionType.PlayPokemon,
                  player: state.currentPlayer,
                  payload: { handIndex: i, targetZone: 'active' },
                });
              } else {
                const benchIndex = player.bench.indexOf(target);
                if (benchIndex >= 0) {
                  actions.push({
                    type: ActionType.PlayPokemon,
                    player: state.currentPlayer,
                    payload: { handIndex: i, targetZone: 'bench', benchIndex },
                  });
                }
              }
            }
          }
        }
      }

      // Attach one Energy card (once per turn)
      if (!player.energyAttachedThisTurn) {
        for (let i = 0; i < player.hand.length; i++) {
          const card = player.hand[i];
          if (card.cardType === CardType.Energy) {
            if (player.active) {
              actions.push({
                type: ActionType.AttachEnergy,
                player: state.currentPlayer,
                payload: { handIndex: i, target: 'active' },
              });
            }
            for (let j = 0; j < player.bench.length; j++) {
              actions.push({
                type: ActionType.AttachEnergy,
                player: state.currentPlayer,
                payload: { handIndex: i, target: 'bench', benchIndex: j },
              });
            }
          }
        }
      }

      // Play Trainer cards
      for (let i = 0; i < player.hand.length; i++) {
        const card = player.hand[i];
        if (card.cardType === CardType.Trainer) {
          const trainer = card as TrainerCard;
          if (trainer.trainerType === TrainerType.Item) {
            actions.push({
              type: ActionType.PlayTrainer,
              player: state.currentPlayer,
              payload: { handIndex: i },
            });
          } else if (trainer.trainerType === TrainerType.Supporter && !player.supporterPlayedThisTurn) {
            // Check play condition (e.g., Briar requires opponent to have exactly 2 prizes)
            if (trainer.playCondition) {
              const cp = state.currentPlayer as 0 | 1;
              const op = (1 - cp) as 0 | 1;
              const dummyPokemon = player.active || { card: {} as PokemonCard, currentHp: 0, attachedEnergy: [], statusConditions: [], damageCounters: 0, attachedTools: [], isEvolved: false, turnPlayed: 0, damageShields: [], cannotRetreat: false };
              const ctx = {
                attackingPlayer: cp,
                defendingPlayer: op,
                attackingPokemon: dummyPokemon,
                defendingPokemon: (state.players[op].active || dummyPokemon),
                rng: () => 0,
              };
              if (!EffectExecutor.checkCondition(state, trainer.playCondition, ctx)) {
                continue; // play condition not met — skip this card
              }
            }
            actions.push({
              type: ActionType.PlayTrainer,
              player: state.currentPlayer,
              payload: { handIndex: i },
            });
          } else if (trainer.trainerType === TrainerType.Stadium && (!state.stadium || state.stadium.name !== trainer.name)) {
            actions.push({
              type: ActionType.PlayTrainer,
              player: state.currentPlayer,
              payload: { handIndex: i },
            });
          }
        }
      }

      // Use abilities (once per turn)
      const allInPlay: { pokemon: PokemonInPlay; zone: 'active' | 'bench'; index?: number }[] = [];
      if (player.active) allInPlay.push({ pokemon: player.active, zone: 'active' });
      player.bench.forEach((p, i) => allInPlay.push({ pokemon: p, zone: 'bench', index: i }));

      for (const { pokemon, zone, index } of allInPlay) {
        if (pokemon.card.ability && pokemon.card.ability.trigger === 'oncePerTurn') {
          if (!player.abilitiesUsedThisTurn.includes(pokemon.card.ability.name) && !this.isAbilityBlocked(state, pokemon)) {
            // Check abilityCondition if present (e.g. Fan Call's first-turn restriction)
            if (pokemon.card.ability.abilityCondition) {
              const dummyContext = {
                attackingPlayer: state.currentPlayer as 0 | 1,
                defendingPlayer: (1 - state.currentPlayer) as 0 | 1,
                attackingPokemon: pokemon,
                defendingPokemon: state.players[(1 - state.currentPlayer) as 0 | 1].active!,
                rng: () => 0.5,
              };
              if (!EffectExecutor.checkCondition(state, pokemon.card.ability.abilityCondition, dummyContext)) {
                continue; // Condition not met — skip this ability
              }
            }
            actions.push({
              type: ActionType.UseAbility,
              player: state.currentPlayer,
              payload: { zone, benchIndex: index, abilityName: pokemon.card.ability.name },
            });
          }
        }
      }

      // Retreat Active Pokemon
      if (player.active && player.bench.length > 0) {
        if (this.canRetreat(state)) {
          for (let i = 0; i < player.bench.length; i++) {
            actions.push({
              type: ActionType.Retreat,
              player: state.currentPlayer,
              payload: { benchIndex: i },
            });
          }
        }
      }

      // Pass (end main phase, go to attack phase)
      actions.push({
        type: ActionType.Pass,
        player: state.currentPlayer,
        payload: {},
      });
    }

    if (state.phase === GamePhase.AttackPhase) {
      // Can only attack if we have an Active Pokemon with energy
      if (player.active) {
        for (let i = 0; i < player.active.card.attacks.length; i++) {
          if (this.canAttack(state, i)) {
            actions.push({
              type: ActionType.Attack,
              player: state.currentPlayer,
              payload: { attackIndex: i },
            });
          }
        }
      }

      // Can always pass (end turn)
      actions.push({
        type: ActionType.Pass,
        player: state.currentPlayer,
        payload: {},
      });
    }

    return actions;
  }

  /**
   * Apply an action to the game state.
   * Returns new game state reflecting the action's effects.
   * Validates action before applying.
   */
  static applyAction(state: GameState, action: Action): GameState {
    // Verify it's the correct player's action
    if (action.player !== state.currentPlayer) {
      return state; // Invalid action, ignore
    }

    const actions = this.getLegalActions(state);
    const isLegal = actions.some(a =>
      a.type === action.type &&
      JSON.stringify(a.payload) === JSON.stringify(action.payload)
    );

    if (!isLegal) return state; // Invalid action, ignore

    let newState = {
      ...state,
      turnActions: [...state.turnActions, action],
    };

    switch (action.type) {
      case ActionType.PlayPokemon:
        newState = this.playPokemonToBench(newState, action.payload.handIndex);
        break;
      case ActionType.AttachEnergy:
        newState = this.attachEnergy(newState, action.payload.handIndex, action.payload.target, action.payload.benchIndex);
        break;
      case ActionType.PlayTrainer:
        newState = this.playTrainer(newState, action.payload.handIndex);
        break;
      case ActionType.UseAbility:
        newState = this.useAbility(newState, action.payload.zone, action.payload.benchIndex);
        break;
      case ActionType.Attack:
        newState = this.attack(newState, action.payload.attackIndex);
        break;
      case ActionType.Retreat:
        newState = this.retreat(newState, action.payload.benchIndex);
        break;
      case ActionType.SelectTarget: {
        if (!newState.pendingAttachments || newState.pendingAttachments.cards.length === 0) break;
        const { cards, playerIndex } = newState.pendingAttachments;
        const card = cards[0];
        const remaining = cards.slice(1);
        const targetPlayer = newState.players[playerIndex];
        const targetPokemon = action.payload.zone === 'active'
          ? targetPlayer.active
          : targetPlayer.bench[action.payload.benchIndex];
        if (targetPokemon && card.cardType === CardType.Energy) {
          targetPokemon.attachedEnergy.push(card as EnergyCard);
          newState = {
            ...newState,
            pendingAttachments: remaining.length > 0 ? { cards: remaining, playerIndex } : undefined,
            gameLog: [...newState.gameLog, `Energy attached to ${targetPokemon.card.name}.`],
          };
        }
        break;
      }
      case ActionType.ChooseCard: {
        if (!newState.pendingChoice) break;
        newState = this.resolveChoice(newState, action.payload.choiceId);
        break;
      }
      case ActionType.Pass:
        // Transition phase
        if (newState.phase === GamePhase.MainPhase) {
          newState = { ...newState, phase: GamePhase.AttackPhase };
        } else if (newState.phase === GamePhase.AttackPhase) {
          newState = this.endTurn(newState);
        }
        break;
    }

    // Check win conditions after action
    newState = this.checkWinConditions(newState);

    return newState;
  }

  /**
   * Play a Basic Pokemon or Evolution to bench.
   */
  private static playPokemonToBench(state: GameState, handIndex: number): GameState {
    const player = state.players[state.currentPlayer];
    const card = player.hand[handIndex];

    if (!card || card.cardType !== CardType.Pokemon) return state;

    const pokemon = card as PokemonCard;
    const pokemonInPlay = this.createPokemonInPlay(pokemon, state.turnNumber);

    if (pokemon.stage === PokemonStage.Basic) {
      // Place Basic on bench (or active if empty)
      if (!player.active) {
        return {
          ...state,
          players: [
            state.currentPlayer === 0
              ? { ...player, active: pokemonInPlay, hand: player.hand.filter((_, i) => i !== handIndex) }
              : state.players[0],
            state.currentPlayer === 1
              ? { ...player, active: pokemonInPlay, hand: player.hand.filter((_, i) => i !== handIndex) }
              : state.players[1],
          ] as [PlayerState, PlayerState],
          gameLog: [...state.gameLog, `Player ${state.currentPlayer} places ${pokemon.name} as Active.`],
        };
      } else if (player.bench.length < 5) {
        return {
          ...state,
          players: [
            state.currentPlayer === 0
              ? {
                  ...player,
                  bench: [...player.bench, pokemonInPlay],
                  hand: player.hand.filter((_, i) => i !== handIndex),
                }
              : state.players[0],
            state.currentPlayer === 1
              ? {
                  ...player,
                  bench: [...player.bench, pokemonInPlay],
                  hand: player.hand.filter((_, i) => i !== handIndex),
                }
              : state.players[1],
          ] as [PlayerState, PlayerState],
          gameLog: [...state.gameLog, `Player ${state.currentPlayer} places ${pokemon.name} on bench.`],
        };
      }
    } else {
      // Evolution: find target and evolve
      const target = this.findEvolutionTarget(player, pokemon);
      if (target) {
        // Evolution heals status conditions and preserves energy/damage
        const evolved: PokemonInPlay = {
          ...target,
          card: pokemon,
          currentHp: target.currentHp + (pokemon.hp - target.card.hp), // gain HP from evolution
          isEvolved: true,
          previousStage: target,
          statusConditions: [], // evolution cures all status
          cannotRetreat: false,
        };
        // Cap HP at max
        evolved.currentHp = Math.min(evolved.currentHp, pokemon.hp);

        let newState: GameState;
        if (target === player.active) {
          newState = {
            ...state,
            players: [
              state.currentPlayer === 0
                ? { ...player, active: evolved, hand: player.hand.filter((_, i) => i !== handIndex) }
                : state.players[0],
              state.currentPlayer === 1
                ? { ...player, active: evolved, hand: player.hand.filter((_, i) => i !== handIndex) }
                : state.players[1],
            ] as [PlayerState, PlayerState],
            gameLog: [...state.gameLog, `Player ${state.currentPlayer} evolves Active Pokemon to ${pokemon.name}.`],
          };
        } else {
          const benchIdx = player.bench.indexOf(target);
          if (benchIdx >= 0) {
            const newBench = [...player.bench];
            newBench[benchIdx] = evolved;
            newState = {
              ...state,
              players: [
                state.currentPlayer === 0
                  ? { ...player, bench: newBench, hand: player.hand.filter((_, i) => i !== handIndex) }
                  : state.players[0],
                state.currentPlayer === 1
                  ? { ...player, bench: newBench, hand: player.hand.filter((_, i) => i !== handIndex) }
                  : state.players[1],
              ] as [PlayerState, PlayerState],
              gameLog: [...state.gameLog, `Player ${state.currentPlayer} evolves bench Pokemon to ${pokemon.name}.`],
            };
          } else {
            return state;
          }
        }

        // Trigger on-evolve abilities
        if (pokemon.ability && pokemon.ability.trigger === 'onEvolve' && !this.isAbilityBlocked(newState, evolved)) {
          newState = {
            ...newState,
            gameLog: [...newState.gameLog, `${pokemon.name}'s ${pokemon.ability.name} activates!`],
          };
          newState = EffectExecutor.executeAbility(newState, pokemon.ability.effects, evolved, state.currentPlayer as 0 | 1);
        }

        return newState;
      }
    }

    return state;
  }

  /**
   * Attach one Energy card to a Pokemon.
   */
  private static attachEnergy(
    state: GameState,
    handIndex: number,
    target: 'active' | 'bench',
    benchIndex?: number
  ): GameState {
    const player = state.players[state.currentPlayer];
    const card = player.hand[handIndex];

    if (!card || card.cardType !== CardType.Energy) return state;

    const energy = card as EnergyCard;
    const targetPokemon = target === 'active' ? player.active : player.bench[benchIndex!];

    if (!targetPokemon) return state;

    const newPokemon = {
      ...targetPokemon,
      attachedEnergy: [...targetPokemon.attachedEnergy, energy],
    };

    const newHand = player.hand.filter((_, i) => i !== handIndex);
    const newPlayer = {
      ...player,
      hand: newHand,
      energyAttachedThisTurn: true,
    };

    let newPlayers: [PlayerState, PlayerState];
    if (state.currentPlayer === 0) {
      const active = target === 'active' ? newPokemon : newPlayer.active;
      const bench = target === 'active' ? newPlayer.bench : newPlayer.bench.map((p, i) => i === benchIndex ? newPokemon : p);
      newPlayers = [{ ...newPlayer, active, bench }, state.players[1]];
    } else {
      const active = target === 'active' ? newPokemon : newPlayer.active;
      const bench = target === 'active' ? newPlayer.bench : newPlayer.bench.map((p, i) => i === benchIndex ? newPokemon : p);
      newPlayers = [state.players[0], { ...newPlayer, active, bench }];
    }

    return {
      ...state,
      players: newPlayers,
      gameLog: [...state.gameLog, `Player ${state.currentPlayer} attaches ${energy.energyType} Energy.`],
    };
  }

  /**
   * Play a Trainer card.
   */
  private static playTrainer(state: GameState, handIndex: number): GameState {
    const player = state.players[state.currentPlayer];
    const card = player.hand[handIndex];

    if (!card || card.cardType !== CardType.Trainer) return state;

    const trainer = card as TrainerCard;
    let newState = {
      ...state,
      gameLog: [...state.gameLog, `Player ${state.currentPlayer} plays ${trainer.name}.`],
    };

    // Update player flags
    let newPlayer = { ...player, hand: player.hand.filter((_, i) => i !== handIndex) };

    if (trainer.trainerType === TrainerType.Supporter) {
      newPlayer = { ...newPlayer, supporterPlayedThisTurn: true };
    }

    if (trainer.trainerType === TrainerType.Stadium) {
      // If there's already a stadium in play, discard it to its owner's discard
      if (newState.stadium) {
        const oldStadium = newState.stadium;
        // Stadium is shared — discard to current player's pile (the one replacing it)
        newPlayer = { ...newPlayer, discard: [...newPlayer.discard, oldStadium] };
      }
      newState = { ...newState, stadium: trainer };
      // Stadium stays on the field, not in discard
    } else {
      // Non-stadium trainers go to discard after use
      newPlayer = { ...newPlayer, discard: [...newPlayer.discard, trainer] };
    }

    newState.players[state.currentPlayer] = newPlayer;

    // Apply trainer effect: DSL takes priority, fallback to legacy function
    if (trainer.effects) {
      newState = EffectExecutor.executeTrainer(newState, trainer.effects, state.currentPlayer as 0 | 1, trainer.name);
    } else if (trainer.effect) {
      newState = trainer.effect(newState, state.currentPlayer);
    }

    return newState;
  }

  /**
   * Attack with Active Pokemon's attack at index.
   */
  private static attack(state: GameState, attackIndex: number): GameState {
    const attacker = state.players[state.currentPlayer].active;
    if (!attacker || !attacker.card.attacks[attackIndex]) return state;

    const attack = attacker.card.attacks[attackIndex];
    const opponent = state.players[state.currentPlayer === 0 ? 1 : 0];
    const defender = opponent.active;

    if (!defender) return state; // No one to attack

    // Calculate damage
    let damage = attack.damage;
    damage = this.applyWeakness(damage, attacker, defender);
    damage = this.applyResistance(damage, attacker, defender);

    let newState = {
      ...state,
      gameLog: [
        ...state.gameLog,
        `Player ${state.currentPlayer} uses ${attack.name} for ${damage} damage.`,
      ],
    };

    // Apply damage
    newState = this.applyDamage(
      newState,
      { player: state.currentPlayer === 0 ? 1 : 0, zone: 'active' },
      damage
    );

    // Apply attack effect: DSL takes priority, fallback to legacy function
    if (attack.effects) {
      newState = EffectExecutor.executeAttack(newState, attack.effects, attacker, defender, state.currentPlayer as 0 | 1);
    } else if (attack.effect) {
      newState = attack.effect(newState, attacker, defender);
    }

    // Check for knockouts
    newState = this.checkKnockouts(newState);

    // Move to between turns
    newState = { ...newState, phase: GamePhase.BetweenTurns };

    return newState;
  }

  /**
   * Retreat Active Pokemon with a Bench Pokemon.
   * Cost: discard Energy equal to retreat cost.
   */
  private static retreat(state: GameState, benchIndex: number): GameState {
    const player = state.players[state.currentPlayer];
    const active = player.active;
    const benched = player.bench[benchIndex];

    if (!active || !benched) return state;

    const retreatCost = active.card.retreatCost;
    if (active.attachedEnergy.length < retreatCost) {
      return state; // Can't pay retreat cost
    }

    // Discard energy equal to retreat cost
    const energyToDiscard = active.attachedEnergy.slice(0, retreatCost);
    const remainingEnergy = active.attachedEnergy.slice(retreatCost);

    const newActive = { ...benched };
    const newBench = player.bench.map((p, i) => (i === benchIndex ? { ...active, attachedEnergy: remainingEnergy } : p));

    const newPlayer = { ...player, active: newActive, bench: newBench, discard: [...player.discard, ...energyToDiscard] };
    const newPlayers = [
      state.currentPlayer === 0 ? newPlayer : state.players[0],
      state.currentPlayer === 1 ? newPlayer : state.players[1],
    ] as [PlayerState, PlayerState];

    return {
      ...state,
      players: newPlayers,
      gameLog: [...state.gameLog, `Player ${state.currentPlayer} retreats to ${benched.card.name}.`],
    };
  }

  /**
   * Check if a Pokemon's ability is blocked by a passive ability (e.g. Mischievous Lock).
   */
  private static isAbilityBlocked(state: GameState, pokemon: PokemonInPlay): boolean {
    for (let p = 0; p < 2; p++) {
      const active = state.players[p].active;
      if (active?.card.ability?.name === 'Mischievous Lock' && active.card.ability.trigger === 'passive') {
        if (pokemon.card.stage === PokemonStage.Basic && pokemon.card.ability?.name !== 'Mischievous Lock') {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Use a Pokemon's ability.
   */
  private static useAbility(state: GameState, zone: 'active' | 'bench', benchIndex?: number): GameState {
    const player = state.players[state.currentPlayer];
    const pokemon = zone === 'active' ? player.active : player.bench[benchIndex!];
    if (!pokemon || !pokemon.card.ability) return state;

    const ability = pokemon.card.ability;
    if (ability.trigger !== 'oncePerTurn') return state;
    if (player.abilitiesUsedThisTurn.includes(ability.name)) return state;
    if (this.isAbilityBlocked(state, pokemon)) return state;

    // Mark ability as used
    let newState = {
      ...state,
      gameLog: [...state.gameLog, `Player ${state.currentPlayer} uses ${pokemon.card.name}'s ${ability.name}.`],
    };
    const newPlayer = {
      ...newState.players[state.currentPlayer],
      abilitiesUsedThisTurn: [...player.abilitiesUsedThisTurn, ability.name],
    };
    newState.players[state.currentPlayer] = newPlayer;

    // Execute ability effect via DSL
    newState = EffectExecutor.executeAbility(newState, ability.effects, pokemon, state.currentPlayer as 0 | 1);

    // Check for knockouts (some abilities cause self-KO like Dusknoir)
    newState = this.checkKnockouts(newState);

    return newState;
  }

  /**
   * Apply damage to a Pokemon.
   * Damage is final; doesn't trigger knockout yet (that's in checkKnockouts).
   */
  private static applyDamage(
    state: GameState,
    target: { player: 0 | 1; zone: 'active' | 'bench'; index?: number },
    amount: number
  ): GameState {
    const player = state.players[target.player];
    const pokemon = target.zone === 'active' ? player.active : player.bench[target.index!];

    if (!pokemon) return state;

    // Apply damage shields
    let remainingDamage = amount;
    const remainingShields = [...pokemon.damageShields];
    for (let i = remainingShields.length - 1; i >= 0 && remainingDamage > 0; i--) {
      const shield = remainingShields[i];
      if (shield.amount === Infinity) {
        remainingDamage = 0;
        remainingShields.splice(i, 1); // consumed
      } else if (shield.amount >= remainingDamage) {
        remainingShields[i] = { ...shield, amount: shield.amount - remainingDamage };
        remainingDamage = 0;
      } else {
        remainingDamage -= shield.amount;
        remainingShields.splice(i, 1); // consumed
      }
    }

    const newPokemon = {
      ...pokemon,
      currentHp: Math.max(0, pokemon.currentHp - remainingDamage),
      damageCounters: pokemon.damageCounters + remainingDamage,
      damageShields: remainingShields,
    };

    let newPlayer = { ...player };
    if (target.zone === 'active') {
      newPlayer = { ...newPlayer, active: newPokemon };
    } else {
      newPlayer = {
        ...newPlayer,
        bench: newPlayer.bench.map((p, i) => (i === target.index ? newPokemon : p)),
      };
    }

    const newPlayers = [
      target.player === 0 ? newPlayer : state.players[0],
      target.player === 1 ? newPlayer : state.players[1],
    ] as [PlayerState, PlayerState];

    return { ...state, players: newPlayers };
  }

  /**
   * Check for knocked out Pokemon and handle prize card taking.
   * Automatically promotes a new Active Pokemon if defending player's Active is KO'd.
   */
  private static checkKnockouts(state: GameState): GameState {
    let newState = { ...state };

    // Check each player's Active Pokemon
    for (const playerIndex of [0, 1] as const) {
      const player = newState.players[playerIndex];
      if (player.active && player.active.currentHp <= 0) {
        const opponentIndex = playerIndex === 0 ? 1 : 0;

        // Current Pokemon is KO'd
        // Opponent takes prize cards (move from prizes to hand)
        let prizeCount = player.active.card.prizeCards;

        // Briar: +1 extra prize if opponent's Tera Pokemon KO'd the active via attack
        const briarFlagIndex = newState.gameFlags.findIndex(
          f => f.flag === 'briarExtraPrize' && f.setByPlayer === opponentIndex
        );
        if (briarFlagIndex >= 0) {
          const opponentActive = newState.players[opponentIndex].active;
          if (opponentActive && opponentActive.card.isTera) {
            prizeCount += 1;
            newState.gameLog = [
              ...newState.gameLog,
              `Briar's effect: Player ${opponentIndex} takes 1 extra prize card!`,
            ];
            // Consume the flag (single use per KO)
            newState = {
              ...newState,
              gameFlags: newState.gameFlags.filter((_, i) => i !== briarFlagIndex),
            };
          }
        }

        const opponent = newState.players[opponentIndex];
        const prizesToTake = Math.min(prizeCount, opponent.prizes.length);
        const takenPrizes = opponent.prizes.slice(0, prizesToTake);
        const newOpponent = {
          ...opponent,
          prizes: opponent.prizes.slice(prizesToTake),
          hand: [...opponent.hand, ...takenPrizes],
          prizeCardsRemaining: Math.max(0, opponent.prizeCardsRemaining - prizeCount),
        };

        // Move KO'd Pokemon, its attached energy/tools, and previous stage Pokemon cards to discard.
        // Energy/tools belong to the top-level evolved Pokemon (shared reference with previousStage),
        // so we only collect the Pokemon card itself from each previousStage to avoid duplicates.
        const collectPreviousPokemonCards = (pokemon: PokemonInPlay): Card[] => {
          const cards: Card[] = [pokemon.card]; // only the Pokemon card, not energy/tools
          if (pokemon.previousStage) {
            cards.push(...collectPreviousPokemonCards(pokemon.previousStage));
          }
          return cards;
        };
        const koDiscards: Card[] = [
          player.active.card,
          ...player.active.attachedEnergy,
          ...player.active.attachedTools,
        ];
        if (player.active.previousStage) {
          koDiscards.push(...collectPreviousPokemonCards(player.active.previousStage));
        }
        let newPlayer: PlayerState = {
          ...player,
          discard: [...player.discard, ...koDiscards],
          active: null,
        };

        // Promoting: take next Pokemon from bench
        if (newPlayer.bench.length > 0) {
          const newActive = newPlayer.bench[0];
          newPlayer = {
            ...newPlayer,
            active: newActive,
            bench: newPlayer.bench.slice(1),
          };
        }

        newState.players[playerIndex] = newPlayer;
        newState.players[opponentIndex] = newOpponent;

        newState.gameLog = [
          ...newState.gameLog,
          `Player ${playerIndex}'s ${player.active.card.name} is knocked out. Player ${opponentIndex} takes ${prizeCount} prize card(s).`,
        ];

        // Track that this player's active was KO'd (for Flip the Script etc.)
        newState.gameFlags = [
          ...newState.gameFlags,
          {
            flag: `activeKnockedOut-p${playerIndex}`,
            duration: 'nextTurn' as const,
            setOnTurn: newState.turnNumber,
            setByPlayer: opponentIndex,
          },
        ];
      }
    }

    return newState;
  }

  /**
   * Check win conditions.
   */
  private static checkWinConditions(state: GameState): GameState {
    if (state.winner !== null) return state;

    // Win condition 1: took all 6 prizes
    for (const playerIndex of [0, 1] as const) {
      if (state.players[playerIndex].prizeCardsRemaining <= 0) {
        return {
          ...state,
          winner: playerIndex as 0 | 1,
          phase: GamePhase.GameOver,
          gameLog: [...state.gameLog, `Player ${playerIndex} wins by taking all prize cards!`],
        };
      }
    }

    // Win condition 2: opponent has no Pokemon in play
    for (const playerIndex of [0, 1] as const) {
      const opponentIndex = playerIndex === 0 ? 1 : 0;
      const opponent = state.players[opponentIndex];
      if (!opponent.active && opponent.bench.length === 0) {
        return {
          ...state,
          winner: playerIndex as 0 | 1,
          phase: GamePhase.GameOver,
          gameLog: [...state.gameLog, `Player ${playerIndex} wins! Opponent has no Pokemon.`],
        };
      }
    }

    return state;
  }

  /**
   * Check if game is over.
   */
  static isGameOver(state: GameState): boolean {
    return state.winner !== null;
  }

  /**
   * Get winner if game is over.
   */
  static getWinner(state: GameState): 0 | 1 | null {
    return state.winner;
  }

  // ============================================================================
  // PENDING CHOICE RESOLUTION
  // ============================================================================

  /**
   * Resolve a ChooseCard action against the current pendingChoice.
   * Moves the selected card/target, decrements selectionsRemaining,
   * and resumes remaining effects when all picks are done.
   */
  private static resolveChoice(state: GameState, choiceId: string): GameState {
    const choice = state.pendingChoice;
    if (!choice) return state;

    let newState = { ...state };

    // Handle "skip" (done choosing early for "up to N" effects)
    if (choiceId === 'skip') {
      newState = { ...newState, pendingChoice: undefined };
      newState = this.resumeEffects(newState, choice);
      return newState;
    }

    const selectedOption = choice.options.find(o => o.id === choiceId);
    if (!selectedOption) return state;

    // Handle switch target choice
    if (choice.choiceType === 'switchTarget' && selectedOption.benchIndex !== undefined) {
      const switchPlayer = choice.switchPlayerIndex ?? choice.playerIndex;
      const playerState = newState.players[switchPlayer];
      if (playerState.active && playerState.bench.length > 0) {
        const benchIdx = selectedOption.benchIndex;
        const newActive = playerState.bench[benchIdx];
        if (newActive) {
          const oldActiveName = playerState.active.card.name;
          const newActiveName = newActive.card.name;
          const newBench = [...playerState.bench];
          newBench[benchIdx] = playerState.active;
          const updatedPlayer = { ...playerState, active: newActive, bench: newBench };
          const players = [...newState.players] as [PlayerState, PlayerState];
          players[switchPlayer] = updatedPlayer;
          newState = {
            ...newState,
            players,
            pendingChoice: undefined,
            gameLog: [...newState.gameLog, `Switched ${oldActiveName} to bench, ${newActiveName} now active.`],
          };
        }
      }
      newState = this.resumeEffects(newState, choice);
      return newState;
    }

    // Handle evolve target choice (Rare Candy)
    if (choice.choiceType === 'evolveTarget' && selectedOption.card) {
      const stage2 = selectedOption.card as PokemonCard;
      const targetZone = selectedOption.zone || 'active';
      const targetBenchIdx = selectedOption.benchIndex ?? -1;
      const playerIdx = choice.playerIndex;
      const playerState = newState.players[playerIdx];

      // Find the target Pokemon
      let targetPokemon: PokemonInPlay | undefined;
      if (targetZone === 'active') {
        targetPokemon = playerState.active || undefined;
      } else if (targetBenchIdx >= 0 && targetBenchIdx < playerState.bench.length) {
        targetPokemon = playerState.bench[targetBenchIdx];
      }

      if (targetPokemon) {
        const basicName = targetPokemon.card.name;

        // Use EffectExecutor.executeRareCandyEvolve via the public executeTrainer path
        // But since it's a private method, we'll do the evolution inline here
        const players = [...newState.players] as [PlayerState, PlayerState];
        const player = { ...players[playerIdx] };

        // Remove Stage2 from hand
        const handIdx = player.hand.findIndex(c => c.id === stage2.id);
        if (handIdx >= 0) {
          player.hand = [...player.hand.slice(0, handIdx), ...player.hand.slice(handIdx + 1)];

          // Build evolved Pokemon
          const evolved: PokemonInPlay = {
            ...targetPokemon,
            card: stage2,
            currentHp: Math.min(targetPokemon.currentHp + (stage2.hp - targetPokemon.card.hp), stage2.hp),
            isEvolved: true,
            previousStage: targetPokemon,
            statusConditions: [],
            cannotRetreat: false,
          };

          // Place evolved Pokemon
          if (targetZone === 'active') {
            player.active = evolved;
          } else {
            const newBench = [...player.bench];
            newBench[targetBenchIdx] = evolved;
            player.bench = newBench;
          }

          players[playerIdx] = player;
          newState = {
            ...newState,
            players,
            pendingChoice: undefined,
            gameLog: [...newState.gameLog, `Rare Candy evolves ${basicName} directly to ${stage2.name}!`],
          };

          // Trigger onEvolve ability
          if (stage2.ability && stage2.ability.trigger === 'onEvolve') {
            newState = { ...newState, gameLog: [...newState.gameLog, `${stage2.name}'s ${stage2.ability.name} activates!`] };
            newState = EffectExecutor.executeAbility(newState, stage2.ability.effects, evolved, playerIdx);
          }
        }
      }

      newState = this.resumeEffects(newState, choice);
      return newState;
    }

    // Handle card selection (search, discard)
    if (selectedOption.card) {
      const card = selectedOption.card;
      const playerIdx = choice.playerIndex;
      const players = [...newState.players] as [PlayerState, PlayerState];
      const player = { ...players[playerIdx] };

      // Remove card from source zone
      if (choice.sourceZone === 'deck') {
        const idx = player.deck.findIndex(c => c.id === card.id);
        if (idx >= 0) player.deck = [...player.deck.slice(0, idx), ...player.deck.slice(idx + 1)];
      } else if (choice.sourceZone === 'discard') {
        const idx = player.discard.findIndex(c => c.id === card.id);
        if (idx >= 0) player.discard = [...player.discard.slice(0, idx), ...player.discard.slice(idx + 1)];
      } else if (choice.sourceZone === 'hand') {
        const idx = player.hand.findIndex(c => c.id === card.id);
        if (idx >= 0) player.hand = [...player.hand.slice(0, idx), ...player.hand.slice(idx + 1)];
      }

      // Add card to destination
      if (choice.destination === 'hand') {
        player.hand = [...player.hand, card];
      } else if (choice.destination === 'bench') {
        if (card.cardType === CardType.Pokemon && player.bench.length < 5) {
          const pokemon = card as PokemonCard;
          player.bench = [...player.bench, {
            card: pokemon,
            currentHp: pokemon.hp,
            attachedEnergy: [],
            statusConditions: [],
            damageCounters: 0,
            attachedTools: [],
            isEvolved: false,
            turnPlayed: newState.turnNumber,
            damageShields: [],
            cannotRetreat: false,
          }];
        }
      } else if (choice.destination === 'deck') {
        player.deck = [...player.deck, card];
      } else if (choice.destination === 'discard') {
        player.discard = [...player.discard, card];
      }

      players[playerIdx] = player;
      newState = {
        ...newState,
        players,
        gameLog: [...newState.gameLog, `${choice.sourceCardName}: ${choice.choiceType === 'discardCard' ? 'discarded' : 'searched for'} ${card.name}.`],
      };
    }

    // Track the selection and decrement remaining
    const selectedSoFar = [...choice.selectedSoFar, ...(selectedOption.card ? [selectedOption.card] : [])];
    const remaining = choice.selectionsRemaining - 1;

    if (remaining > 0) {
      // More selections needed — remove the chosen option by ID (each card has unique ID)
      const newOptions = choice.options.filter(o => o.id !== choiceId);
      newState = {
        ...newState,
        pendingChoice: {
          ...choice,
          selectionsRemaining: remaining,
          selectedSoFar,
          options: newOptions,
        },
      };
    } else {
      // All selections made — clear pendingChoice and resume remaining effects
      newState = { ...newState, pendingChoice: undefined };
      newState = this.resumeEffects(newState, { ...choice, selectedSoFar });
    }

    return newState;
  }

  /**
   * Resume remaining DSL effects after a pendingChoice is fully resolved.
   * Reconstructs the EffectExecutionContext and re-enters EffectExecutor.execute().
   * The remaining effects may create another pendingChoice (e.g., Dawn's 3 searches).
   */
  private static resumeEffects(state: GameState, choice: PendingChoice): GameState {
    if (choice.remainingEffects.length === 0) return state;

    return EffectExecutor.executeTrainer(
      state,
      choice.remainingEffects,
      choice.effectContext.attackingPlayer,
      choice.sourceCardName
    );
  }

  /**
   * Can this Pokemon attack?
   * Must have required energy attached.
   */
  private static canAttack(state: GameState, attackIndex: number): boolean {
    const pokemon = state.players[state.currentPlayer].active;
    if (!pokemon || !pokemon.card.attacks[attackIndex]) return false;

    const attack = pokemon.card.attacks[attackIndex];
    const attached = pokemon.attachedEnergy;

    // Check if we have required energy
    const requiredEnergy = [...attack.cost];
    for (const attached_energy of attached) {
      const idx = requiredEnergy.indexOf(attached_energy.energyType);
      if (idx >= 0) {
        requiredEnergy.splice(idx, 1);
      } else {
        // Try colorless
        const colorlessIdx = requiredEnergy.indexOf(EnergyType.Colorless);
        if (colorlessIdx >= 0) {
          requiredEnergy.splice(colorlessIdx, 1);
        }
      }
    }

    return requiredEnergy.length === 0;
  }

  /**
   * Can we retreat? Must have bench Pokemon and enough energy.
   */
  private static canRetreat(state: GameState): boolean {
    const pokemon = state.players[state.currentPlayer].active;
    if (!pokemon) return false;
    if (pokemon.cannotRetreat) return false;
    return pokemon.attachedEnergy.length >= pokemon.card.retreatCost;
  }

  /**
   * Can we evolve a Pokemon in hand?
   * Must be on bench/active, not on first turn, not first turn played.
   */
  private static canEvolve(state: GameState, handIndex: number, player: PlayerState): boolean {
    const card = player.hand[handIndex];
    if (!card || card.cardType !== CardType.Pokemon) return false;

    const pokemon = card as PokemonCard;
    if (pokemon.stage === PokemonStage.Basic) return false;

    // Cannot evolve on first turn of the game
    if (state.turnNumber <= 1) {
      return false;
    }

    // Find evolution target (must not have been played or evolved this turn)
    const target = this.findEvolutionTarget(player, pokemon, state.turnNumber);
    return target !== null;
  }

  /**
   * Find if a Pokemon in play can be evolved with the given card.
   */
  private static findEvolutionTarget(
    player: PlayerState,
    evolutionCard: PokemonCard,
    currentTurn?: number
  ): PokemonInPlay | null {
    const evolvesFrom = evolutionCard.evolvesFrom;
    if (!evolvesFrom) return null;

    const canTarget = (p: PokemonInPlay) => {
      if (p.card.name !== evolvesFrom) return false;
      // Can't evolve a Pokemon that was played or already evolved this turn
      if (currentTurn !== undefined && (p.turnPlayed === currentTurn || p.isEvolved)) return false;
      return true;
    };

    // Check Active
    if (player.active && canTarget(player.active)) {
      return player.active;
    }

    // Check Bench
    return player.bench.find(canTarget) || null;
  }

  /**
   * Find first Basic Pokemon in array of cards.
   */
  private static findFirstBasicPokemon(cards: Card[]): Card | null {
    return cards.find(
      c => c.cardType === CardType.Pokemon && (c as PokemonCard).stage === PokemonStage.Basic
    ) || null;
  }

  /**
   * Check if hand has at least one Basic Pokemon (for mulligan).
   */
  private static hasBasicPokemon(cards: Card[]): boolean {
    return cards.some(
      c => c.cardType === CardType.Pokemon && (c as PokemonCard).stage === PokemonStage.Basic
    );
  }

  /**
   * Create a PokemonInPlay from a card.
   */
  private static createPokemonInPlay(card: PokemonCard, turnPlayed: number = 0): PokemonInPlay {
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

  /**
   * Apply weakness (2x in modern format).
   * Weakness is determined by the attacking Pokemon's TYPE, not the attack's energy cost.
   */
  private static applyWeakness(damage: number, attacker: PokemonInPlay, defender: PokemonInPlay): number {
    if (!defender.card.weakness) return damage;

    if (attacker.card.type === defender.card.weakness) {
      return damage * 2;
    }

    return damage;
  }

  /**
   * Apply resistance (-30 in standard, configurable).
   * Resistance is determined by the attacking Pokemon's TYPE, not the attack's energy cost.
   */
  private static applyResistance(damage: number, attacker: PokemonInPlay, defender: PokemonInPlay): number {
    if (!defender.card.resistance) return damage;

    if (attacker.card.type === defender.card.resistance) {
      const reduction = defender.card.resistanceValue || 20;
      return Math.max(0, damage - reduction);
    }

    return damage;
  }

  /**
   * Determinize: shuffle unknown cards for a given perspective.
   * Used for ISMCTS and perfect information algorithms.
   *
   * From perspective player's view:
   * - Own hand, active, bench, prizes: all known
   * - Own deck: known count, cards unknown (shuffle them)
   * - Opponent hand: unknown count, cards unknown (shuffle from remaining)
   * - Opponent deck: known count, cards unknown
   * - Opponent active, bench, prizes: known (face-up)
   */
  static determinize(state: GameState, perspective: 0 | 1, seed: number = 0): GameState {
    const rng = new SeededRandom(seed);

    // Collect all cards not visible to perspective player
    const visibleCards = new Set<string>();

    // Add visible cards from perspective player
    const perspectivePlayer = state.players[perspective];
    for (const card of perspectivePlayer.hand) {
      visibleCards.add(card.id);
    }
    if (perspectivePlayer.active) {
      visibleCards.add(perspectivePlayer.active.card.id);
    }
    for (const p of perspectivePlayer.bench) {
      visibleCards.add(p.card.id);
    }
    for (const card of perspectivePlayer.discard) {
      visibleCards.add(card.id);
    }
    for (const card of perspectivePlayer.prizes) {
      visibleCards.add(card.id);
    }

    // Add visible cards from opponent
    const opponent = state.players[perspective === 0 ? 1 : 0];
    if (opponent.active) {
      visibleCards.add(opponent.active.card.id);
    }
    for (const p of opponent.bench) {
      visibleCards.add(p.card.id);
    }
    for (const card of opponent.discard) {
      visibleCards.add(card.id);
    }

    // Collect cards that could be in hidden zones
    const unknownCards = [
      ...perspectivePlayer.deck,
      ...opponent.hand,
      ...opponent.deck,
      ...opponent.prizes,
    ].filter(c => !visibleCards.has(c.id));

    // Shuffle unknown cards
    const shuffled = rng.shuffle([...unknownCards]);

    // Redistribute shuffled cards back
    let shuffledIndex = 0;

    const newPerspectivePlayer = { ...perspectivePlayer };
    const newDeckSize = perspectivePlayer.deck.length;
    newPerspectivePlayer.deck = shuffled.slice(shuffledIndex, shuffledIndex + newDeckSize);
    shuffledIndex += newDeckSize;

    const newOpponent = { ...opponent };
    const opponentHandSize = opponent.hand.length;
    newOpponent.hand = shuffled.slice(shuffledIndex, shuffledIndex + opponentHandSize);
    shuffledIndex += opponentHandSize;

    const opponentDeckSize = opponent.deck.length;
    newOpponent.deck = shuffled.slice(shuffledIndex, shuffledIndex + opponentDeckSize);
    shuffledIndex += opponentDeckSize;

    const opponentPrizeSize = opponent.prizes.length;
    newOpponent.prizes = shuffled.slice(shuffledIndex, shuffledIndex + opponentPrizeSize);

    const newPlayers = [
      perspective === 0 ? newPerspectivePlayer : newOpponent,
      perspective === 1 ? newPerspectivePlayer : newOpponent,
    ] as [PlayerState, PlayerState];

    return { ...state, players: newPlayers };
  }

  /**
   * Clone game state deeply.
   * Used for immutable updates.
   */
  static cloneState(state: GameState): GameState {
    return {
      ...state,
      players: state.players.map(p => ({
        ...p,
        deck: [...p.deck],
        hand: [...p.hand],
        bench: p.bench.map(pokemon => ({
          ...pokemon,
          attachedEnergy: [...pokemon.attachedEnergy],
          statusConditions: [...pokemon.statusConditions],
          attachedTools: [...pokemon.attachedTools],
          damageShields: pokemon.damageShields.map(s => ({ ...s })),
        })),
        discard: [...p.discard],
        lostZone: [...p.lostZone],
      })) as [PlayerState, PlayerState],
      turnActions: [...state.turnActions],
      gameLog: [...state.gameLog],
      gameFlags: state.gameFlags.map(f => ({ ...f })),
    };
  }

  /**
   * Encode game state for neural network.
   * Produces a 431-element Float32Array following the spec in types.ts.
   *
   * Takes perspective of one player; encodes visible info plus uncertainty bounds.
   */
  static encodeState(state: GameState, perspective: 0 | 1): EncodedGameState {
    const buffer = new Float32Array(431);
    const perspectivePlayer = state.players[perspective];
    const opponent = state.players[perspective === 0 ? 1 : 0];

    let idx = 0;

    // ========== PLAYER 0 (PERSPECTIVE) - ACTIVE POKEMON (0-31) ==========
    const activeCard = perspectivePlayer.active?.card;
    const activeMaxHp = perspectivePlayer.active?.card.hp || 1;

    if (perspectivePlayer.active) {
      // HP ratio by type (Fire, Water, Grass, Lightning, Psychic)
      buffer[idx++] = perspectivePlayer.active.currentHp / activeMaxHp;
      buffer[idx++] = perspectivePlayer.active.currentHp / activeMaxHp;
      buffer[idx++] = perspectivePlayer.active.currentHp / activeMaxHp;
      buffer[idx++] = perspectivePlayer.active.currentHp / activeMaxHp;
      buffer[idx++] = perspectivePlayer.active.currentHp / activeMaxHp;

      // HP ratio by type (Fighting, Dark, Metal, Dragon, Fairy)
      buffer[idx++] = perspectivePlayer.active.currentHp / activeMaxHp;
      buffer[idx++] = perspectivePlayer.active.currentHp / activeMaxHp;
      buffer[idx++] = perspectivePlayer.active.currentHp / activeMaxHp;
      buffer[idx++] = perspectivePlayer.active.currentHp / activeMaxHp;
      buffer[idx++] = perspectivePlayer.active.currentHp / activeMaxHp;

      // Energy counts by type
      const energyCounts = this.countEnergyByType(perspectivePlayer.active.attachedEnergy);
      buffer[idx++] = Math.min(energyCounts[EnergyType.Colorless], 10) / 10;
      for (const etype of Object.values(EnergyType)) {
        if (etype !== EnergyType.Colorless) {
          buffer[idx++] = Math.min(energyCounts[etype] || 0, 10) / 10;
        }
      }

      // Status conditions (bitmask)
      let statusMask = 0;
      if (perspectivePlayer.active.statusConditions.includes(StatusCondition.Poisoned)) statusMask |= 1;
      if (perspectivePlayer.active.statusConditions.includes(StatusCondition.Burned)) statusMask |= 2;
      if (perspectivePlayer.active.statusConditions.includes(StatusCondition.Asleep)) statusMask |= 4;
      if (perspectivePlayer.active.statusConditions.includes(StatusCondition.Confused)) statusMask |= 8;
      if (perspectivePlayer.active.statusConditions.includes(StatusCondition.Paralyzed)) statusMask |= 16;
      buffer[idx++] = statusMask / 31; // Normalize to [0,1]

      // Prize cards value (1, 2, or 3)
      buffer[idx++] = (perspectivePlayer.active.card.prizeCards) / 3;

      // Max attack damage (placeholder; simplified)
      const maxDamage = Math.max(
        0,
        ...perspectivePlayer.active.card.attacks.map(a => a.damage)
      );
      buffer[idx++] = Math.min(maxDamage, 300) / 300;

      // Is rulebox
      buffer[idx++] = perspectivePlayer.active.card.isRulebox ? 1 : 0;

      // Current HP ratio
      buffer[idx++] = perspectivePlayer.active.currentHp / activeMaxHp;

      // Tools
      buffer[idx++] = perspectivePlayer.active.attachedTools.length;

      // Reserved
      buffer[idx++] = 0;
      buffer[idx++] = 0;
    } else {
      idx += 32; // Skip if no active
    }

    // ========== BENCH POKEMON (32-192) ==========
    for (let i = 0; i < 5; i++) {
      const benchPokemon = perspectivePlayer.bench[i];
      if (benchPokemon) {
        const benchMaxHp = benchPokemon.card.hp;
        buffer[idx++] = benchPokemon.currentHp / benchMaxHp;
        // Simplified: just replicate HP for all energy types
        for (let j = 1; j < 10; j++) buffer[idx++] = benchPokemon.currentHp / benchMaxHp;

        const benchEnergy = this.countEnergyByType(benchPokemon.attachedEnergy);
        buffer[idx++] = Math.min(benchEnergy[EnergyType.Colorless], 10) / 10;
        for (const etype of Object.values(EnergyType)) {
          if (etype !== EnergyType.Colorless) {
            buffer[idx++] = Math.min(benchEnergy[etype] || 0, 10) / 10;
          }
        }

        let statusMask = 0;
        if (benchPokemon.statusConditions.includes(StatusCondition.Poisoned)) statusMask |= 1;
        if (benchPokemon.statusConditions.includes(StatusCondition.Burned)) statusMask |= 2;
        buffer[idx++] = statusMask / 31;

        buffer[idx++] = benchPokemon.card.prizeCards / 3;
        const benchMaxDamage = Math.max(0, ...benchPokemon.card.attacks.map(a => a.damage));
        buffer[idx++] = Math.min(benchMaxDamage, 300) / 300;
        buffer[idx++] = benchPokemon.card.isRulebox ? 1 : 0;
        buffer[idx++] = benchPokemon.currentHp / benchMaxHp;
        buffer[idx++] = benchPokemon.attachedTools.length;
        buffer[idx++] = 0;
        buffer[idx++] = 0;
      } else {
        idx += 32; // Skip unused bench slots
      }
    }

    // ========== HAND & RESOURCES (192-220) ==========
    const pokemonInHand = perspectivePlayer.hand.filter(c => c.cardType === CardType.Pokemon).length;
    const trainerInHand = perspectivePlayer.hand.filter(c => c.cardType === CardType.Trainer).length;
    const energyInHand = perspectivePlayer.hand.filter(c => c.cardType === CardType.Energy).length;
    const supporterInHand = perspectivePlayer.hand.filter(
      c => c.cardType === CardType.Trainer && (c as TrainerCard).trainerType === TrainerType.Supporter
    ).length;
    const itemInHand = perspectivePlayer.hand.filter(
      c => c.cardType === CardType.Trainer && (c as TrainerCard).trainerType === TrainerType.Item
    ).length;
    const toolInHand = perspectivePlayer.hand.filter(
      c => c.cardType === CardType.Trainer && (c as TrainerCard).trainerType === TrainerType.Tool
    ).length;
    const stadiumInHand = perspectivePlayer.hand.filter(
      c => c.cardType === CardType.Trainer && (c as TrainerCard).trainerType === TrainerType.Stadium
    ).length;

    buffer[idx++] = Math.min(pokemonInHand, 20) / 20;
    buffer[idx++] = Math.min(trainerInHand, 20) / 20;
    buffer[idx++] = Math.min(energyInHand, 20) / 20;
    buffer[idx++] = Math.min(supporterInHand, 20) / 20;
    buffer[idx++] = Math.min(itemInHand, 20) / 20;
    buffer[idx++] = Math.min(toolInHand, 20) / 20;
    buffer[idx++] = Math.min(stadiumInHand, 20) / 20;

    const handEnergyTypes = new Set<EnergyType>();
    for (const card of perspectivePlayer.hand) {
      if (card.cardType === CardType.Energy) {
        handEnergyTypes.add((card as EnergyCard).energyType);
      }
    }
    buffer[idx++] = handEnergyTypes.size / 11;

    // Energy counts by type in hand
    const handEnergyCounts = this.countEnergyByType(
      perspectivePlayer.hand.filter(c => c.cardType === CardType.Energy) as EnergyCard[]
    );
    for (const etype of Object.values(EnergyType)) {
      buffer[idx++] = Math.min(handEnergyCounts[etype] || 0, 10) / 10;
    }

    buffer[idx++] = Math.min(perspectivePlayer.deck.length, 20) / 20;
    buffer[idx++] = Math.min(perspectivePlayer.discard.length, 20) / 20;
    buffer[idx++] = perspectivePlayer.prizeCardsRemaining / 6;
    buffer[idx++] = perspectivePlayer.supporterPlayedThisTurn ? 1 : 0;
    buffer[idx++] = perspectivePlayer.energyAttachedThisTurn ? 1 : 0;

    // Reserved
    buffer[idx++] = 0;
    buffer[idx++] = 0;
    buffer[idx++] = 0;
    buffer[idx++] = 0;

    // ========== OPPONENT - KNOWN INFORMATION (220-380) ==========
    // Active Pokemon features
    const oppActiveCard = opponent.active?.card;
    const oppActiveMaxHp = opponent.active?.card.hp || 1;

    if (opponent.active) {
      buffer[idx++] = opponent.active.currentHp / oppActiveMaxHp;
      for (let i = 1; i < 10; i++) buffer[idx++] = opponent.active.currentHp / oppActiveMaxHp;

      const oppEnergy = this.countEnergyByType(opponent.active.attachedEnergy);
      buffer[idx++] = Math.min(oppEnergy[EnergyType.Colorless], 10) / 10;
      for (const etype of Object.values(EnergyType)) {
        if (etype !== EnergyType.Colorless) {
          buffer[idx++] = Math.min(oppEnergy[etype] || 0, 10) / 10;
        }
      }

      let oppStatus = 0;
      if (opponent.active.statusConditions.includes(StatusCondition.Poisoned)) oppStatus |= 1;
      if (opponent.active.statusConditions.includes(StatusCondition.Burned)) oppStatus |= 2;
      buffer[idx++] = oppStatus / 31;

      buffer[idx++] = opponent.active.card.prizeCards / 3;
      const oppMaxDmg = Math.max(0, ...opponent.active.card.attacks.map(a => a.damage));
      buffer[idx++] = Math.min(oppMaxDmg, 300) / 300;
      buffer[idx++] = opponent.active.card.isRulebox ? 1 : 0;
      buffer[idx++] = opponent.active.currentHp / oppActiveMaxHp;
      buffer[idx++] = opponent.active.attachedTools.length;
      buffer[idx++] = 0;
      buffer[idx++] = 0;
    } else {
      idx += 32;
    }

    // Bench Pokemon
    for (let i = 0; i < 5; i++) {
      const benchPokemon = opponent.bench[i];
      if (benchPokemon) {
        const bMaxHp = benchPokemon.card.hp;
        buffer[idx++] = benchPokemon.currentHp / bMaxHp;
        for (let j = 1; j < 10; j++) buffer[idx++] = benchPokemon.currentHp / bMaxHp;

        const bEnergy = this.countEnergyByType(benchPokemon.attachedEnergy);
        buffer[idx++] = Math.min(bEnergy[EnergyType.Colorless], 10) / 10;
        for (const etype of Object.values(EnergyType)) {
          if (etype !== EnergyType.Colorless) {
            buffer[idx++] = Math.min(bEnergy[etype] || 0, 10) / 10;
          }
        }

        let bStatus = 0;
        buffer[idx++] = bStatus / 31;
        buffer[idx++] = benchPokemon.card.prizeCards / 3;
        const bMaxDmg = Math.max(0, ...benchPokemon.card.attacks.map(a => a.damage));
        buffer[idx++] = Math.min(bMaxDmg, 300) / 300;
        buffer[idx++] = benchPokemon.card.isRulebox ? 1 : 0;
        buffer[idx++] = benchPokemon.currentHp / bMaxHp;
        buffer[idx++] = benchPokemon.attachedTools.length;
        buffer[idx++] = 0;
        buffer[idx++] = 0;
      } else {
        idx += 32;
      }
    }

    // ========== GAME STATE (423-430) ==========
    buffer[idx++] = state.currentPlayer; // 0 or 1
    buffer[idx++] = Math.min(state.turnNumber, 30) / 30;
    buffer[idx++] = this.encodePhase(state.phase) / 5;
    buffer[idx++] = 0; // who started first (simplified; not tracked currently)
    buffer[idx++] = state.stadium ? 1 : 0;

    // Reserved
    buffer[idx++] = 0;
    buffer[idx++] = 0;
    buffer[idx++] = 0;

    return {
      buffer,
      timestamp: Date.now(),
      turnNumber: state.turnNumber,
      perspectivePlayer: perspective,
    };
  }

  /**
   * Helper: count energy by type.
   */
  private static countEnergyByType(energies: EnergyCard[]): Record<EnergyType, number> {
    const counts: Record<EnergyType, number> = {} as any;
    for (const etype of Object.values(EnergyType)) {
      counts[etype] = 0;
    }
    for (const energy of energies) {
      // Count each energy card once by its primary type.
      // For special energy that provides multiple types, count each provided type.
      // Use provides[] as the source of truth (it includes the primary type).
      for (const provides of energy.provides) {
        counts[provides]++;
      }
    }
    return counts;
  }

  /**
   * Helper: encode phase as number.
   */
  private static encodePhase(phase: GamePhase): number {
    const mapping: Record<GamePhase, number> = {
      [GamePhase.Setup]: 0,
      [GamePhase.DrawPhase]: 1,
      [GamePhase.MainPhase]: 2,
      [GamePhase.AttackPhase]: 3,
      [GamePhase.BetweenTurns]: 4,
      [GamePhase.GameOver]: 5,
    };
    return mapping[phase] || 0;
  }

  /**
   * State to string for debugging.
   */
  static stateToString(state: GameState): string {
    const p0 = state.players[0];
    const p1 = state.players[1];

    return `
=== GAME STATE ===
Turn: ${state.turnNumber} | Phase: ${state.phase} | Current: P${state.currentPlayer}
Winner: ${state.winner !== null ? `P${state.winner}` : 'None'}

PLAYER 0:
  Active: ${p0.active?.card.name || 'None'} (${p0.active?.currentHp}/${p0.active?.card.hp})
  Bench: ${p0.bench.map(p => p.card.name).join(', ') || 'Empty'}
  Hand: ${p0.hand.length} cards
  Deck: ${p0.deck.length} | Discard: ${p0.discard.length} | Prizes: ${p0.prizeCardsRemaining}

PLAYER 1:
  Active: ${p1.active?.card.name || 'None'} (${p1.active?.currentHp}/${p1.active?.card.hp})
  Bench: ${p1.bench.map(p => p.card.name).join(', ') || 'Empty'}
  Hand: ${p1.hand.length} cards
  Deck: ${p1.deck.length} | Discard: ${p1.discard.length} | Prizes: ${p1.prizeCardsRemaining}

Stadium: ${state.stadium?.name || 'None'}
    `.trim();
  }
}
