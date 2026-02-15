/**
 * Pokemon TCG AI - Effect Primitives DSL System
 *
 * This file defines a composable domain-specific language (DSL) for expressing Pokemon card effects.
 * Instead of writing bespoke effect functions for each card, we define attacks and trainers as
 * compositions of atomic effect primitives that the EffectExecutor interprets.
 *
 * Architecture:
 * 1. Target selectors (who the effect applies to)
 * 2. Value sources (where numbers come from - constants, coin flips, card counts)
 * 3. Effect primitives (atomic operations)
 * 4. Conditions (when effects apply)
 * 5. Card filters (for searching/selecting specific cards)
 * 6. EffectExecutor (interprets and executes the DSL)
 * 7. Example card definitions
 */

import {
  GameState,
  PokemonInPlay,
  PlayerState,
  Card,
  PokemonCard,
  TrainerCard,
  EnergyCard,
  EnergyType,
  CardType,
  StatusCondition,
  PokemonStage,
  TrainerType,
  DamageShield,
  GameFlag,
  EnergySubtype,
  AbilityTarget,
  PendingChoiceOption,
} from './types.js';

// ============================================================================
// TARGET SELECTORS
// ============================================================================

/**
 * Target selectors identify which Pokemon/cards an effect applies to.
 * Can be single Pokemon, groups of Pokemon, or player-wide selections.
 */
export type Target =
  | { type: 'self' }                                    // attacking Pokemon
  | { type: 'opponent' }                                // defending Pokemon
  | { type: 'active'; player: 'own' | 'opponent' }     // active Pokemon of a player
  | { type: 'bench'; player: 'own' | 'opponent'; index?: number }  // specific bench slot or any bench
  | { type: 'anyPokemon'; player: 'own' | 'opponent' } // let player choose one
  | { type: 'allBench'; player: 'own' | 'opponent' }   // all bench Pokemon
  | { type: 'all'; player: 'own' | 'opponent' }        // all Pokemon (active + bench)
  | { type: 'hand'; player: 'own' | 'opponent' }       // player's hand (for card effects)
  | { type: 'deck'; player: 'own' | 'opponent' }       // player's deck
  | { type: 'discard'; player: 'own' | 'opponent' };   // player's discard pile

// ============================================================================
// VALUE SOURCES
// ============================================================================

/**
 * Value sources allow effects to use dynamic values calculated from game state.
 * Examples: coin flips, energy counts, prize card counts, etc.
 */
export type ValueSource =
  | { type: 'constant'; value: number }
  | { type: 'countEnergy'; target: Target; energyType?: EnergyType }  // how many energy attached
  | { type: 'countDamage'; target: Target }                           // damage on Pokemon
  | { type: 'countBench'; player: 'own' | 'opponent' }               // bench Pokemon count
  | { type: 'countPrizeCards'; player: 'own' | 'opponent' }          // prizes remaining
  | { type: 'countPrizeTaken'; player: 'own' | 'opponent' }          // prizes taken
  | { type: 'countDiscard'; player: 'own' | 'opponent' }             // discard pile size
  | { type: 'countHand'; player: 'own' | 'opponent' }                // hand size
  | { type: 'countDeck'; player: 'own' | 'opponent' }                // deck size
  | { type: 'coinFlip' }                                              // 0 or 1
  | { type: 'coinFlipUntilTails' }                                    // count heads
  | { type: 'opponentHandSize' }                                      // opponent's visible cards
  | { type: 'countStatus'; target: Target; status: StatusCondition } // Pokemon with status
  | { type: 'maxDamage'; attacker: Target }                          // max damage attacker can do
  | { type: 'retreatCost'; target: Target }                          // Pokemon's retreat cost
  | { type: 'add'; left: ValueSource; right: ValueSource }           // add two values
  | { type: 'multiply'; left: ValueSource; right: ValueSource }      // multiply two values
  | { type: 'min'; left: ValueSource; right: ValueSource }           // min of two values
  | { type: 'max'; left: ValueSource; right: ValueSource };          // max of two values

// ============================================================================
// EFFECT PRIMITIVES
// ============================================================================

/**
 * The core DSL type - a tagged union of all possible effects.
 * Each effect primitive represents an atomic operation on game state.
 */
export type EffectDSL =
  // Damage and Healing
  | { effect: 'damage'; target: Target; amount: ValueSource }
  | { effect: 'heal'; target: Target; amount: ValueSource }
  | { effect: 'setHp'; target: Target; amount: ValueSource }
  | { effect: 'preventDamage'; target: Target; amount: ValueSource | 'all'; duration: 'nextTurn' | 'thisAttack' }
  | { effect: 'selfDamage'; amount: ValueSource }
  | { effect: 'bonusDamage'; amount: ValueSource; perUnit: ValueSource; countTarget: Target; countProperty: 'energy' | 'damage' | 'benchCount' | 'prizesTaken' | 'trainerCount' }

  // Drawing and Searching
  | { effect: 'draw'; player: 'own' | 'opponent'; count: ValueSource }
  | { effect: 'search'; player: 'own' | 'opponent'; from: 'deck' | 'discard'; filter?: CardFilter; count: ValueSource; destination: 'hand' | 'bench' | 'topOfDeck' | 'deck' }
  | { effect: 'mill'; player: 'own' | 'opponent'; count: ValueSource }  // discard from top of deck
  | { effect: 'shuffle'; player: 'own' | 'opponent'; zone: 'deck' | 'hand' }

  // Discard and Removal
  | { effect: 'discard'; target: Target; what: 'energy' | 'tool' | 'card'; count: ValueSource; energyType?: EnergyType }
  | { effect: 'discardHand'; player: 'own' | 'opponent' }
  | { effect: 'bounce'; target: Target; destination: 'hand' | 'deck' | 'lostZone' }  // return to zone
  | { effect: 'discardFromHand'; player: 'own' | 'opponent'; count: ValueSource; filter?: CardFilter }

  // Energy Management
  | { effect: 'moveEnergy'; from: Target; to: Target; count: ValueSource; energyType?: EnergyType }
  | { effect: 'addEnergy'; target: Target; energyType: EnergyType; count: ValueSource; from: 'deck' | 'discard' | 'create' }
  | { effect: 'removeEnergy'; target: Target; energyType?: EnergyType; count: ValueSource }

  // Status Effects
  | { effect: 'addStatus'; target: Target; status: StatusCondition }
  | { effect: 'removeStatus'; target: Target; status?: StatusCondition }  // undefined = all

  // Pokemon Switching and Movement
  | { effect: 'forceSwitch'; player: 'own' | 'opponent'; chosenBench?: number }
  | { effect: 'selfSwitch' }  // player switches own active with bench
  | { effect: 'switchIntoActive'; player: 'own' | 'opponent'; pokemon: PokemonInPlay }

  // Transformation and Copying
  | { effect: 'copyAttack'; target: Target }
  | { effect: 'transformInto'; target: Target; pokemon: PokemonCard }

  // Special Game Rules
  | { effect: 'extraTurn' }
  | { effect: 'skipNextTurn'; player: 'own' | 'opponent' }
  | { effect: 'opponentCannotAttack'; duration: 'nextTurn' }
  | { effect: 'opponentCannotPlayTrainers'; duration: 'nextTurn' | 'thisAttack' }
  | { effect: 'opponentCannotUseAbilities'; duration: 'nextTurn' | 'thisAttack' }
  | { effect: 'cannotRetreat'; target: Target; duration: 'nextTurn' | 'thisAttack' }

  // Card Revelation and Looking
  | { effect: 'lookAtCards'; player: 'own' | 'opponent'; from: 'deck' | 'prizes'; count: ValueSource }
  | { effect: 'revealCards'; player: 'own' | 'opponent'; from: 'hand' | 'deck'; count: ValueSource }

  // Multi-step Effects
  | { effect: 'searchAndAttach'; player: 'own' | 'opponent'; from: 'deck' | 'discard'; filter: CardFilter; count: ValueSource }

  // Hand/Deck Management
  | { effect: 'shuffleHandIntoDeck'; player: 'own' | 'opponent' }

  // Game Flags
  | { effect: 'addGameFlag'; flag: string; duration: 'nextTurn' | 'thisAttack' }

  // Evolution
  | { effect: 'rareCandy' }  // Skip Stage 1 evolution: evolve Basic directly to Stage 2

  // Control Flow
  | { effect: 'conditional'; condition: Condition; then: EffectDSL[]; else?: EffectDSL[] }
  | { effect: 'choice'; options: { label?: string; effects: EffectDSL[] }[] }  // player chooses one path
  | { effect: 'sequence'; effects: EffectDSL[] }  // do all in order (usually implicit)
  | { effect: 'repeat'; times: ValueSource; effects: EffectDSL[] }
  | { effect: 'noop' };  // no effect

// ============================================================================
// CONDITIONS
// ============================================================================

/**
 * Conditions determine when effects apply.
 * Used in conditional effects and for ability triggers.
 */
export type Condition =
  | { check: 'coinFlip' }  // 50/50 chance
  | { check: 'coinFlipHeads'; flips: ValueSource }  // "if you flip X heads"
  | { check: 'energyAttached'; target: Target; energyType?: EnergyType; comparison: '>=' | '<=' | '=='; value: number }
  | { check: 'statusCondition'; target: Target; status: StatusCondition }
  | { check: 'benchCount'; player: 'own' | 'opponent'; comparison: '>=' | '<=' | '=='; value: number }
  | { check: 'prizeCount'; player: 'own' | 'opponent'; comparison: '>=' | '<=' | '=='; value: number }
  | { check: 'opponentHasInHand'; cardType?: CardType; trainerType?: TrainerType }
  | { check: 'cardsInZone'; player: 'own' | 'opponent'; zone: 'hand' | 'deck' | 'discard'; comparison: '>=' | '<=' | '=='; value: number }
  | { check: 'damageOnPokemon'; target: Target; comparison: '>=' | '<=' | '=='; value: number }
  | { check: 'hasAbility'; target: Target }
  | { check: 'isRuleBox'; target: Target }
  | { check: 'hasPokemonInPlay'; player: 'own' | 'opponent'; filter: CardFilter }
  | { check: 'turnNumber'; comparison: '>=' | '<=' | '=='; value: number }
  | { check: 'hasGameFlag'; flag: string; player: 'own' | 'opponent' }
  | { check: 'and'; conditions: Condition[] }
  | { check: 'or'; conditions: Condition[] };

// ============================================================================
// CARD FILTERS
// ============================================================================

/**
 * Card filters specify which cards match selection criteria.
 * Used for searching, discarding, and other card-selection effects.
 */
export type CardFilter =
  | { filter: 'type'; cardType: CardType }
  | { filter: 'trainerType'; trainerType: TrainerType }
  | { filter: 'energyType'; energyType: EnergyType; energySubtype?: EnergySubtype }
  | { filter: 'pokemonType'; energyType: EnergyType }
  | { filter: 'stage'; stage: PokemonStage }
  | { filter: 'name'; name: string }
  | { filter: 'hasAbility' }
  | { filter: 'isBasic' }
  | { filter: 'evolvesFrom'; name: string }
  | { filter: 'isRuleBox' }
  | { filter: 'hpBelow'; maxHp: number }
  | { filter: 'hpAbove'; minHp: number }
  | { filter: 'basicEnergy' }
  | { filter: 'and'; filters: CardFilter[] }
  | { filter: 'or'; filters: CardFilter[] }
  | { filter: 'not'; inner: CardFilter };

// ============================================================================
// ATTACK AND TRAINER DEFINITIONS
// ============================================================================

/**
 * Complete attack definition combining energy cost, damage, and effects.
 */
export interface AttackDefinition {
  name: string;
  cost: EnergyType[];
  baseDamage: number;
  effects: EffectDSL[];
  description: string;  // original card text
}

/**
 * Complete trainer card definition with effects.
 */
export interface TrainerDefinition {
  name: string;
  trainerType: TrainerType;
  effects: EffectDSL[];
  description: string;
}

// ============================================================================
// EFFECT CONTEXT
// ============================================================================

/**
 * Context passed to effect executor for resolving relative targets and RNG.
 */
export interface EffectExecutionContext {
  attackingPlayer: 0 | 1;
  defendingPlayer: 0 | 1;
  attackingPokemon: PokemonInPlay;
  defendingPokemon: PokemonInPlay;
  rng: () => number;  // seeded RNG returning [0, 1)
  userChoices?: Record<string, any>;  // for choice effects
  sourceCardName?: string;  // name of the card that triggered these effects (for PendingChoice logging)
}

// ============================================================================
// EFFECT EXECUTOR
// ============================================================================

/**
 * Executes EffectDSL objects against game state.
 * Handles all primitive operations: damage, drawing, searching, etc.
 */
export class EffectExecutor {
  /**
   * Execute an array of effects in sequence, modifying game state.
   */
  static execute(
    state: GameState,
    effects: EffectDSL[],
    context: EffectExecutionContext
  ): GameState {
    let newState = this.cloneGameState(state);

    for (let i = 0; i < effects.length; i++) {
      newState = this.executeEffect(newState, effects[i], context);

      // If a pending choice was created, store remaining effects and stop execution.
      // The game engine will resume these effects via resumeEffects() after the choice resolves.
      if (newState.pendingChoice) {
        if (newState.pendingChoice.remainingEffects.length === 0) {
          newState.pendingChoice = {
            ...newState.pendingChoice,
            remainingEffects: effects.slice(i + 1),
          };
        }
        return newState;
      }
    }

    return newState;
  }

  /**
   * Execute an ability's DSL effects with proper context setup.
   * Bridges between engine's ability invocation and DSL execution.
   */
  static executeAbility(
    state: GameState,
    effects: EffectDSL[],
    sourcePokemon: PokemonInPlay,
    playerIndex: 0 | 1,
    abilityTarget?: AbilityTarget
  ): GameState {
    const defendingPlayer = (1 - playerIndex) as 0 | 1;
    let defendingPokemon = state.players[defendingPlayer].active;
    if (abilityTarget) {
      if (abilityTarget.zone === 'active') {
        defendingPokemon = state.players[abilityTarget.player].active;
      } else {
        defendingPokemon = state.players[abilityTarget.player].bench[abilityTarget.benchIndex ?? 0];
      }
    }
    // Use a dummy defending pokemon if none exists (e.g. opponent has no active)
    if (!defendingPokemon) {
      defendingPokemon = sourcePokemon;
    }
    const context: EffectExecutionContext = {
      attackingPlayer: playerIndex,
      defendingPlayer,
      attackingPokemon: sourcePokemon,
      defendingPokemon,
      rng: () => Math.random(),
      userChoices: abilityTarget ? { abilityTarget } : undefined,
    };
    return this.execute(state, effects, context);
  }

  /**
   * Execute a trainer card's DSL effects with proper context setup.
   * Bridges between engine's trainer invocation and DSL execution.
   */
  static executeTrainer(
    state: GameState,
    effects: EffectDSL[],
    playerIndex: 0 | 1,
    sourceCardName?: string
  ): GameState {
    const defendingPlayer = (1 - playerIndex) as 0 | 1;
    const attackingPokemon = state.players[playerIndex].active;
    const defendingPokemon = state.players[defendingPlayer].active;
    // Use dummy pokemon if no active (trainers don't always need them)
    const dummyPokemon: PokemonInPlay = {
      card: { id: 'dummy', name: 'Dummy', cardType: CardType.Pokemon, imageUrl: '', cardNumber: '', hp: 1, stage: PokemonStage.Basic, type: EnergyType.Colorless, retreatCost: 0, attacks: [], prizeCards: 1, isRulebox: false } as any,
      currentHp: 1, attachedEnergy: [], statusConditions: [], damageCounters: 0, attachedTools: [], isEvolved: false, turnPlayed: 0, damageShields: [], cannotRetreat: false,
    };
    const context: EffectExecutionContext = {
      attackingPlayer: playerIndex,
      defendingPlayer,
      attackingPokemon: attackingPokemon || dummyPokemon,
      defendingPokemon: defendingPokemon || dummyPokemon,
      rng: () => Math.random(),
      sourceCardName,
    };
    return this.execute(state, effects, context);
  }

  /**
   * Execute an attack's DSL effects with proper context setup.
   * Bridges between engine's attack invocation and DSL execution.
   */
  static executeAttack(
    state: GameState,
    effects: EffectDSL[],
    attacker: PokemonInPlay,
    defender: PokemonInPlay,
    playerIndex: 0 | 1
  ): GameState {
    const defendingPlayer = (1 - playerIndex) as 0 | 1;
    const context: EffectExecutionContext = {
      attackingPlayer: playerIndex,
      defendingPlayer,
      attackingPokemon: attacker,
      defendingPokemon: defender,
      rng: () => Math.random(),
    };
    return this.execute(state, effects, context);
  }

  /**
   * Execute a single effect, returning modified game state.
   */
  private static executeEffect(
    state: GameState,
    effect: EffectDSL,
    context: EffectExecutionContext
  ): GameState {
    switch (effect.effect) {
      // ---- Damage and Healing ----
      case 'damage': {
        const targets = this.resolveTarget(state, effect.target, context);
        const amount = this.resolveValue(state, effect.amount, context);
        return this.applyDamage(state, targets, amount);
      }

      case 'heal': {
        const targets = this.resolveTarget(state, effect.target, context);
        const amount = this.resolveValue(state, effect.amount, context);
        return this.applyHeal(state, targets, amount);
      }

      case 'setHp': {
        const targets = this.resolveTarget(state, effect.target, context);
        const amount = this.resolveValue(state, effect.amount, context);
        return this.applySetHp(state, targets, amount);
      }

      case 'preventDamage': {
        const targets = this.resolveTarget(state, effect.target, context);
        const amount = effect.amount === 'all' ? Infinity : this.resolveValue(state, effect.amount, context);
        return this.addDamageShield(state, targets, amount, effect.duration);
      }

      case 'selfDamage': {
        const amount = this.resolveValue(state, effect.amount, context);
        return this.applyDamage(state, [context.attackingPokemon], amount);
      }

      case 'bonusDamage': {
        const baseAmount = this.resolveValue(state, effect.amount, context);
        const perUnit = this.resolveValue(state, effect.perUnit, context);

        let countValue = 0;
        if (effect.countProperty === 'energy') {
          countValue = this.countEnergyOnTarget(state, effect.countTarget);
        } else if (effect.countProperty === 'damage') {
          const targets = this.resolveTarget(state, effect.countTarget, context);
          countValue = targets.reduce((sum, t) => sum + t.card.hp - t.currentHp, 0);
        } else if (effect.countProperty === 'benchCount') {
          const player = effect.countTarget.type === 'bench' ? (effect.countTarget.player === 'own' ? context.attackingPlayer : context.defendingPlayer) : 0;
          countValue = state.players[player].bench.length;
        } else if (effect.countProperty === 'prizesTaken') {
          const player = effect.countTarget.type === 'hand' ? (effect.countTarget.player === 'own' ? context.attackingPlayer : context.defendingPlayer) : 0;
          countValue = 6 - state.players[player].prizeCardsRemaining;
        } else if (effect.countProperty === 'trainerCount') {
          // Count trainer cards in the target zone (typically opponent's hand for Poltergeist)
          if (effect.countTarget.type === 'hand') {
            const player = effect.countTarget.player === 'own' ? context.attackingPlayer : context.defendingPlayer;
            countValue = state.players[player].hand.filter((c: Card) => c.cardType === CardType.Trainer).length;
          }
        }

        const totalDamage = baseAmount + (perUnit * countValue);
        return this.applyDamage(state, [context.defendingPokemon], totalDamage);
      }

      // ---- Drawing and Searching ----
      case 'draw': {
        const player = effect.player === 'own' ? context.attackingPlayer : context.defendingPlayer;
        const count = this.resolveValue(state, effect.count, context);
        return this.drawCards(state, player, count);
      }

      case 'search': {
        const player = effect.player === 'own' ? context.attackingPlayer : context.defendingPlayer;
        const from = effect.from;
        const count = this.resolveValue(state, effect.count, context);

        // Collect ALL matching cards from the zone
        const zone = from === 'deck' ? state.players[player].deck : state.players[player].discard;
        const allMatching: Card[] = [];
        for (const card of zone) {
          if (!effect.filter || this.matchesFilter(card, effect.filter)) {
            allMatching.push(card);
          }
        }

        // 0 matches → nothing to select
        if (allMatching.length === 0) {
          return state;
        }

        // matches ≤ count → auto-select all (no choice needed)
        if (allMatching.length <= count) {
          return this.searchCards(state, player, from, effect.filter, count, effect.destination);
        }

        // matches > count → create PendingChoice with ALL matching options
        // No deduplication — player might want multiple copies (e.g., 2 Hoothoots via Poffin)
        const options: PendingChoiceOption[] = allMatching.map(card => ({
          id: card.id,
          label: card.name,
          card,
        }));

        const dest = effect.destination === 'topOfDeck' ? 'deck' : effect.destination;
        const newState = this.cloneGameState(state);
        newState.pendingChoice = {
          choiceType: 'searchCard',
          playerIndex: player,
          options,
          selectionsRemaining: count,
          destination: dest as 'hand' | 'bench' | 'deck' | 'discard' | 'active',
          sourceZone: from,
          selectedSoFar: [],
          remainingEffects: [], // will be filled by execute() loop
          effectContext: { attackingPlayer: context.attackingPlayer, defendingPlayer: context.defendingPlayer },
          sourceCardName: context.sourceCardName || 'Trainer',
          canSkip: true, // "up to N" — player can stop early
        };

        return newState;
      }

      case 'mill': {
        const player = effect.player === 'own' ? context.attackingPlayer : context.defendingPlayer;
        const count = this.resolveValue(state, effect.count, context);
        return this.millCards(state, player, count);
      }

      case 'shuffle': {
        const player = effect.player === 'own' ? context.attackingPlayer : context.defendingPlayer;
        const zone = effect.zone;
        return this.shuffleZone(state, player, zone);
      }

      // ---- Discard and Removal ----
      case 'discard': {
        const targets = this.resolveTarget(state, effect.target, context);
        const count = this.resolveValue(state, effect.count, context);

        if (effect.what === 'energy') {
          return this.discardEnergyFromPokemon(state, targets, count, effect.energyType);
        } else if (effect.what === 'tool') {
          return this.discardToolsFromPokemon(state, targets, count);
        } else {
          return this.discardCardsFromPokemon(state, targets, count);
        }
      }

      case 'discardHand': {
        const player = effect.player === 'own' ? context.attackingPlayer : context.defendingPlayer;
        return this.discardEntireHand(state, player);
      }

      case 'bounce': {
        const targets = this.resolveTarget(state, effect.target, context);
        return this.bounceCards(state, targets, effect.destination);
      }

      case 'discardFromHand': {
        const player = effect.player === 'own' ? context.attackingPlayer : context.defendingPlayer;
        const count = this.resolveValue(state, effect.count, context);

        // Collect all matching cards in hand
        const handCards = state.players[player].hand;
        const matching: Card[] = [];
        for (const card of handCards) {
          if (!effect.filter || this.matchesFilter(card, effect.filter)) {
            matching.push(card);
          }
        }

        // 0 matches → nothing to discard
        if (matching.length === 0) {
          return state;
        }

        // matches ≤ count → auto-discard all (no choice needed)
        if (matching.length <= count) {
          return this.discardFromPlayerHand(state, player, count, effect.filter);
        }

        // matches > count → create PendingChoice for player to pick what to discard
        const options: PendingChoiceOption[] = matching.map(card => ({
          id: card.id,
          label: card.name,
          card,
        }));

        const newState = this.cloneGameState(state);
        newState.pendingChoice = {
          choiceType: 'discardCard',
          playerIndex: player,
          options,
          selectionsRemaining: count,
          destination: 'discard',
          sourceZone: 'hand',
          selectedSoFar: [],
          remainingEffects: [], // will be filled by execute() loop
          effectContext: { attackingPlayer: context.attackingPlayer, defendingPlayer: context.defendingPlayer },
          sourceCardName: context.sourceCardName || 'Trainer',
          canSkip: false, // must discard exactly N
        };

        return newState;
      }

      // ---- Energy Management ----
      case 'moveEnergy': {
        const fromTargets = this.resolveTarget(state, effect.from, context);
        const toTargets = this.resolveTarget(state, effect.to, context);
        const count = this.resolveValue(state, effect.count, context);
        return this.moveEnergy(state, fromTargets, toTargets, count, effect.energyType);
      }

      case 'addEnergy': {
        const targets = this.resolveTarget(state, effect.target, context);
        const count = this.resolveValue(state, effect.count, context);
        return this.addEnergyToTarget(state, targets, effect.energyType, count, effect.from, context.attackingPlayer);
      }

      case 'removeEnergy': {
        const targets = this.resolveTarget(state, effect.target, context);
        const count = this.resolveValue(state, effect.count, context);
        return this.removeEnergyFromTarget(state, targets, count, effect.energyType);
      }

      // ---- Status Effects ----
      case 'addStatus': {
        const targets = this.resolveTarget(state, effect.target, context);
        return this.addStatusCondition(state, targets, effect.status);
      }

      case 'removeStatus': {
        const targets = this.resolveTarget(state, effect.target, context);
        return this.removeStatusCondition(state, targets, effect.status);
      }

      // ---- Pokemon Switching ----
      case 'forceSwitch': {
        const switchPlayer = effect.player === 'own' ? context.attackingPlayer : context.defendingPlayer;
        const switchPlayerState = state.players[switchPlayer];

        // No bench Pokemon → nothing to switch
        if (!switchPlayerState.active || switchPlayerState.bench.length === 0) {
          return state;
        }

        // Exactly 1 bench Pokemon → auto-select (no choice needed)
        if (switchPlayerState.bench.length === 1) {
          return this.switchActivePokemon(state, switchPlayer, 0);
        }

        // 2+ bench Pokemon → create PendingChoice for the current player to pick
        const options: PendingChoiceOption[] = switchPlayerState.bench.map((pokemon, idx) => ({
          id: `bench-${idx}`,
          label: pokemon.card.name,
          benchIndex: idx,
        }));

        const newState = this.cloneGameState(state);
        newState.pendingChoice = {
          choiceType: 'switchTarget',
          playerIndex: context.attackingPlayer, // current player picks the target
          options,
          selectionsRemaining: 1,
          destination: 'active',
          sourceZone: 'bench',
          selectedSoFar: [],
          remainingEffects: [], // will be filled by execute() loop
          effectContext: { attackingPlayer: context.attackingPlayer, defendingPlayer: context.defendingPlayer },
          sourceCardName: context.sourceCardName || 'Trainer',
          canSkip: false,
          switchPlayerIndex: switchPlayer, // whose bench is being switched
        };

        return newState;
      }

      case 'selfSwitch': {
        return this.switchActivePokemon(state, context.attackingPlayer);
      }

      case 'switchIntoActive': {
        const player = this.getPlayerOf(state, effect.pokemon);
        return this.putPokemonIntoActive(state, player, effect.pokemon);
      }

      // ---- Transformation ----
      case 'copyAttack': {
        // This typically requires user interaction to choose attack
        // For now, just return state (would be handled by game engine)
        return state;
      }

      case 'transformInto': {
        // Similar to above - requires game engine support
        return state;
      }

      // ---- Special Game Rules ----
      case 'extraTurn': {
        return this.grantExtraTurn(state, context.attackingPlayer);
      }

      case 'skipNextTurn': {
        const player = effect.player === 'own' ? context.attackingPlayer : context.defendingPlayer;
        return this.skipNextTurn(state, player);
      }

      case 'opponentCannotAttack': {
        return this.addGameFlag(state, 'opponentSkipAttack', effect.duration);
      }

      case 'opponentCannotPlayTrainers': {
        return this.addGameFlag(state, 'opponentSkipTrainers', effect.duration);
      }

      case 'opponentCannotUseAbilities': {
        return this.addGameFlag(state, 'opponentSkipAbilities', effect.duration);
      }

      case 'cannotRetreat': {
        const targets = this.resolveTarget(state, effect.target, context);
        return this.preventRetreat(state, targets, effect.duration);
      }

      // ---- Card Revelation ----
      case 'lookAtCards': {
        const player = effect.player === 'own' ? context.attackingPlayer : context.defendingPlayer;
        const count = this.resolveValue(state, effect.count, context);
        // This is informational - returns same state but could trigger UI to show cards
        return state;
      }

      case 'revealCards': {
        const player = effect.player === 'own' ? context.attackingPlayer : context.defendingPlayer;
        const count = this.resolveValue(state, effect.count, context);
        // Informational effect
        return state;
      }

      // ---- Hand/Deck Management ----
      case 'shuffleHandIntoDeck': {
        const player = effect.player === 'own' ? context.attackingPlayer : context.defendingPlayer;
        return this.shuffleHandIntoDeck(state, player);
      }

      // ---- Game Flags ----
      case 'addGameFlag': {
        return this.addGameFlag(state, effect.flag, effect.duration);
      }

      // ---- Evolution ----
      case 'rareCandy': {
        return this.handleRareCandy(state, context);
      }

      // ---- Control Flow ----
      case 'conditional': {
        const condition = this.checkCondition(state, effect.condition, context);
        const effects = condition ? effect.then : (effect.else || []);
        return this.execute(state, effects, context);
      }

      case 'choice': {
        // In practice, the game engine handles user choice
        // Execute the first option by default, or user-selected option
        const selectedIndex = (context.userChoices?.choiceIndex || 0) as number;
        const selected = effect.options[Math.min(selectedIndex, effect.options.length - 1)];
        return this.execute(state, selected.effects, context);
      }

      case 'sequence': {
        return this.execute(state, effect.effects, context);
      }

      case 'repeat': {
        let newState = state;
        const times = this.resolveValue(state, effect.times, context);
        for (let i = 0; i < times; i++) {
          newState = this.execute(newState, effect.effects, context);
        }
        return newState;
      }

      case 'searchAndAttach': {
        const playerIdx = effect.player === 'own' ? context.attackingPlayer : context.defendingPlayer;
        const count = this.resolveValue(state, effect.count, context);
        const newState = this.cloneGameState(state);
        const playerState = newState.players[playerIdx];
        const zone = effect.from === 'deck' ? playerState.deck : playerState.discard;
        const found: Card[] = [];
        for (let i = zone.length - 1; i >= 0 && found.length < count; i--) {
          if (this.matchesFilter(zone[i], effect.filter)) {
            found.push(zone[i]);
            zone.splice(i, 1);
          }
        }
        if (found.length > 0) {
          newState.pendingAttachments = { cards: found, playerIndex: playerIdx };
        }
        return newState;
      }

      case 'noop': {
        return state;
      }

      default:
        return state;
    }
  }

  /**
   * Resolve a value source to an actual number based on game state.
   */
  static resolveValue(
    state: GameState,
    value: ValueSource,
    context: EffectExecutionContext
  ): number {
    switch (value.type) {
      case 'constant':
        return value.value;

      case 'countEnergy': {
        const targets = this.resolveTarget(state, value.target, context);
        let count = 0;
        for (const target of targets) {
          if (value.energyType) {
            count += target.attachedEnergy.filter((e: EnergyCard) => e.energyType === value.energyType).length;
          } else {
            count += target.attachedEnergy.length;
          }
        }
        return count;
      }

      case 'countDamage': {
        const targets = this.resolveTarget(state, value.target, context);
        let count = 0;
        for (const target of targets) {
          count += target.card.hp - target.currentHp;
        }
        return count;
      }

      case 'countBench': {
        const player = value.player === 'own' ? context.attackingPlayer : context.defendingPlayer;
        return state.players[player].bench.length;
      }

      case 'countPrizeCards': {
        const player = value.player === 'own' ? context.attackingPlayer : context.defendingPlayer;
        return state.players[player].prizeCardsRemaining;
      }

      case 'countPrizeTaken': {
        const player = value.player === 'own' ? context.attackingPlayer : context.defendingPlayer;
        return 6 - state.players[player].prizeCardsRemaining;
      }

      case 'countDiscard': {
        const player = value.player === 'own' ? context.attackingPlayer : context.defendingPlayer;
        return state.players[player].discard.length;
      }

      case 'countHand': {
        const player = value.player === 'own' ? context.attackingPlayer : context.defendingPlayer;
        return state.players[player].hand.length;
      }

      case 'countDeck': {
        const player = value.player === 'own' ? context.attackingPlayer : context.defendingPlayer;
        return state.players[player].deck.length;
      }

      case 'coinFlip':
        return context.rng() < 0.5 ? 0 : 1;

      case 'coinFlipUntilTails': {
        let flips = 0;
        while (context.rng() < 0.5) flips++;
        return flips;
      }

      case 'opponentHandSize': {
        const opponent = context.attackingPlayer === 0 ? 1 : 0;
        return state.players[opponent].hand.length;
      }

      case 'countStatus': {
        const targets = this.resolveTarget(state, value.target, context);
        return targets.filter(t => t.statusConditions.includes(value.status)).length;
      }

      case 'maxDamage': {
        const targets = this.resolveTarget(state, value.attacker, context);
        let max = 0;
        for (const target of targets) {
          for (const attack of target.card.attacks) {
            max = Math.max(max, attack.damage);
          }
        }
        return max;
      }

      case 'retreatCost': {
        const targets = this.resolveTarget(state, value.target, context);
        return targets.length > 0 ? targets[0].card.retreatCost : 0;
      }

      case 'add': {
        const left = this.resolveValue(state, value.left, context);
        const right = this.resolveValue(state, value.right, context);
        return left + right;
      }

      case 'multiply': {
        const left = this.resolveValue(state, value.left, context);
        const right = this.resolveValue(state, value.right, context);
        return left * right;
      }

      case 'min': {
        const left = this.resolveValue(state, value.left, context);
        const right = this.resolveValue(state, value.right, context);
        return Math.min(left, right);
      }

      case 'max': {
        const left = this.resolveValue(state, value.left, context);
        const right = this.resolveValue(state, value.right, context);
        return Math.max(left, right);
      }

      default:
        return 0;
    }
  }

  /**
   * Resolve a target selector to the Pokemon it affects.
   */
  static resolveTarget(
    state: GameState,
    target: Target,
    context: EffectExecutionContext
  ): PokemonInPlay[] {
    switch (target.type) {
      case 'self':
        return [context.attackingPokemon];

      case 'opponent': {
        const abilityTarget = context.userChoices?.abilityTarget as
          | { player: 0 | 1; zone: 'active' | 'bench'; benchIndex?: number }
          | undefined;
        if (abilityTarget) {
          const player = abilityTarget.player;
          if (abilityTarget.zone === 'active') {
            const active = state.players[player].active;
            return active ? [active] : [];
          }
          const bench = state.players[player].bench;
          const idx = abilityTarget.benchIndex ?? 0;
          return bench[idx] ? [bench[idx]] : [];
        }
        return [context.defendingPokemon];
      }

      case 'active': {
        const player = target.player === 'own' ? context.attackingPlayer : context.defendingPlayer;
        const active = state.players[player].active;
        return active ? [active] : [];
      }

      case 'bench': {
        const player = target.player === 'own' ? context.attackingPlayer : context.defendingPlayer;
        const bench = state.players[player].bench;
        if (target.index !== undefined) {
          return target.index < bench.length ? [bench[target.index]] : [];
        }
        return bench;
      }

      case 'anyPokemon': {
        const player = target.player === 'own' ? context.attackingPlayer : context.defendingPlayer;
        const all: PokemonInPlay[] = [];
        if (state.players[player].active) {
          all.push(state.players[player].active);
        }
        all.push(...state.players[player].bench);
        return all;
      }

      case 'allBench': {
        const player = target.player === 'own' ? context.attackingPlayer : context.defendingPlayer;
        return state.players[player].bench;
      }

      case 'all': {
        const player = target.player === 'own' ? context.attackingPlayer : context.defendingPlayer;
        const all: PokemonInPlay[] = [];
        if (state.players[player].active) {
          all.push(state.players[player].active);
        }
        all.push(...state.players[player].bench);
        return all;
      }

      default:
        return [];
    }
  }

  /**
   * Evaluate a condition against current game state.
   */
  static checkCondition(
    state: GameState,
    condition: Condition,
    context: EffectExecutionContext
  ): boolean {
    switch (condition.check) {
      case 'coinFlip':
        return context.rng() < 0.5;

      case 'coinFlipHeads': {
        const flips = this.resolveValue(state, condition.flips, context);
        let heads = 0;
        for (let i = 0; i < flips; i++) {
          if (context.rng() < 0.5) heads++;
        }
        return heads > 0;
      }

      case 'energyAttached': {
        const targets = this.resolveTarget(state, condition.target, context);
        for (const target of targets) {
          let count = 0;
          if (condition.energyType) {
            count = target.attachedEnergy.filter((e: EnergyCard) => e.energyType === condition.energyType).length;
          } else {
            count = target.attachedEnergy.length;
          }
          if (this.compareValues(count, condition.value, condition.comparison)) {
            return true;
          }
        }
        return false;
      }

      case 'statusCondition': {
        const targets = this.resolveTarget(state, condition.target, context);
        return targets.some(t => t.statusConditions.includes(condition.status));
      }

      case 'benchCount': {
        const player = condition.player === 'own' ? context.attackingPlayer : context.defendingPlayer;
        const count = state.players[player].bench.length;
        return this.compareValues(count, condition.value, condition.comparison);
      }

      case 'prizeCount': {
        const player = condition.player === 'own' ? context.attackingPlayer : context.defendingPlayer;
        const count = state.players[player].prizeCardsRemaining;
        return this.compareValues(count, condition.value, condition.comparison);
      }

      case 'cardsInZone': {
        const player = condition.player === 'own' ? context.attackingPlayer : context.defendingPlayer;
        const zone = condition.zone;
        let count = 0;
        if (zone === 'hand') count = state.players[player].hand.length;
        else if (zone === 'deck') count = state.players[player].deck.length;
        else if (zone === 'discard') count = state.players[player].discard.length;
        return this.compareValues(count, condition.value, condition.comparison);
      }

      case 'damageOnPokemon': {
        const targets = this.resolveTarget(state, condition.target, context);
        for (const target of targets) {
          const damage = target.card.hp - target.currentHp;
          if (this.compareValues(damage, condition.value, condition.comparison)) {
            return true;
          }
        }
        return false;
      }

      case 'hasAbility': {
        const targets = this.resolveTarget(state, condition.target, context);
        return targets.some(t => t.card.ability !== undefined);
      }

      case 'isRuleBox': {
        const targets = this.resolveTarget(state, condition.target, context);
        return targets.some(t => t.card.isRulebox);
      }

      case 'hasPokemonInPlay': {
        const playerIdx = condition.player === 'own' ? context.attackingPlayer : context.defendingPlayer;
        const playerState = state.players[playerIdx];
        const allInPlay: PokemonInPlay[] = [];
        if (playerState.active) allInPlay.push(playerState.active);
        allInPlay.push(...playerState.bench);
        return allInPlay.some(p => this.matchesFilter(p.card, condition.filter));
      }

      case 'turnNumber':
        return this.compareValues(state.turnNumber, condition.value, condition.comparison);

      case 'hasGameFlag': {
        const flagPlayer = condition.player === 'own' ? context.attackingPlayer : context.defendingPlayer;
        const flagName = condition.flag.replace('{player}', `p${flagPlayer}`);
        return state.gameFlags.some(f => f.flag === flagName);
      }

      case 'and':
        return condition.conditions.every(c => this.checkCondition(state, c, context));

      case 'or':
        return condition.conditions.some(c => this.checkCondition(state, c, context));

      default:
        return false;
    }
  }

  /**
   * Check if a card matches a filter.
   */
  static matchesFilter(card: Card, filter: CardFilter): boolean {
    switch (filter.filter) {
      case 'type':
        return card.cardType === filter.cardType;

      case 'trainerType':
        return card.cardType === CardType.Trainer && (card as TrainerCard).trainerType === filter.trainerType;

      case 'energyType':
        if (card.cardType !== CardType.Energy) return false;
        if ((card as EnergyCard).energyType !== filter.energyType) return false;
        if (filter.energySubtype && (card as EnergyCard).energySubtype !== filter.energySubtype) return false;
        return true;

      case 'pokemonType':
        return card.cardType === CardType.Pokemon && (card as PokemonCard).type === filter.energyType;

      case 'stage':
        return card.cardType === CardType.Pokemon && (card as PokemonCard).stage === filter.stage;

      case 'name':
        return card.name.includes(filter.name);

      case 'hasAbility':
        return card.cardType === CardType.Pokemon && (card as PokemonCard).ability !== undefined;

      case 'isBasic':
        return card.cardType === CardType.Pokemon && (card as PokemonCard).stage === PokemonStage.Basic;

      case 'evolvesFrom':
        return card.cardType === CardType.Pokemon && (card as PokemonCard).evolvesFrom === filter.name;

      case 'isRuleBox':
        return card.cardType === CardType.Pokemon && (card as PokemonCard).isRulebox;

      case 'hpBelow':
        return card.cardType === CardType.Pokemon && (card as PokemonCard).hp <= filter.maxHp;

      case 'hpAbove':
        return card.cardType === CardType.Pokemon && (card as PokemonCard).hp >= filter.minHp;

      case 'basicEnergy':
        return card.cardType === CardType.Energy && (card as EnergyCard).energySubtype === EnergySubtype.Basic;

      case 'and':
        return filter.filters.every(f => this.matchesFilter(card, f));

      case 'or':
        return filter.filters.some(f => this.matchesFilter(card, f));

      case 'not':
        return !this.matchesFilter(card, filter.inner);

      default:
        return true;
    }
  }

  // ============================================================================
  // HELPER METHODS - Game State Modification
  // ============================================================================

  private static clonePokemonInPlay(pokemon: PokemonInPlay): PokemonInPlay {
    return {
      ...pokemon,
      attachedEnergy: [...pokemon.attachedEnergy],
      statusConditions: [...pokemon.statusConditions],
      attachedTools: [...pokemon.attachedTools],
      damageShields: pokemon.damageShields.map(s => ({ ...s })),
      // card is immutable — keep the same reference to preserve functions (getTargets, abilityCondition, etc.)
      // previousStage is also an immutable snapshot — keep reference
    };
  }

  private static clonePlayerState(player: PlayerState): PlayerState {
    return {
      ...player,
      deck: [...player.deck],
      hand: [...player.hand],
      active: player.active ? this.clonePokemonInPlay(player.active) : null,
      bench: player.bench.map(p => this.clonePokemonInPlay(p)),
      prizes: [...player.prizes],
      discard: [...player.discard],
      lostZone: [...player.lostZone],
      abilitiesUsedThisTurn: [...player.abilitiesUsedThisTurn],
    };
  }

  private static cloneGameState(state: GameState): GameState {
    return {
      ...state,
      players: [this.clonePlayerState(state.players[0]), this.clonePlayerState(state.players[1])],
      turnActions: [...state.turnActions],
      gameLog: [...state.gameLog],
      gameFlags: state.gameFlags.map(f => ({ ...f })),
      pendingAttachments: state.pendingAttachments ? {
        ...state.pendingAttachments,
        cards: [...state.pendingAttachments.cards],
      } : undefined,
      pendingChoice: state.pendingChoice ? {
        ...state.pendingChoice,
        options: state.pendingChoice.options.map(o => ({ ...o })),
        selectedSoFar: [...state.pendingChoice.selectedSoFar],
        remainingEffects: [...state.pendingChoice.remainingEffects],
      } : undefined,
    };
  }

  private static clonePokemon(pokemon: PokemonInPlay): PokemonInPlay {
    return this.clonePokemonInPlay(pokemon);
  }

  private static applyDamage(state: GameState, targets: PokemonInPlay[], amount: number): GameState {
    const newState = this.cloneGameState(state);
    for (const target of targets) {
      const pokemon = this.findPokemonInState(newState, target.card.id);
      if (pokemon) {
        pokemon.currentHp = Math.max(0, pokemon.currentHp - amount);
      }
    }
    return newState;
  }

  private static applyHeal(state: GameState, targets: PokemonInPlay[], amount: number): GameState {
    const newState = this.cloneGameState(state);
    for (const target of targets) {
      const pokemon = this.findPokemonInState(newState, target.card.id);
      if (pokemon) {
        pokemon.currentHp = Math.min(pokemon.card.hp, pokemon.currentHp + amount);
      }
    }
    return newState;
  }

  private static applySetHp(
    state: GameState,
    targets: PokemonInPlay[],
    amount: number
  ): GameState {
    const newState = this.cloneGameState(state);
    for (const target of targets) {
      const pokemon = this.findPokemonInState(newState, target.card.id);
      if (pokemon) {
        pokemon.currentHp = Math.max(0, Math.min(pokemon.card.hp, amount));
      }
    }
    return newState;
  }

  private static addDamageShield(
    state: GameState,
    targets: PokemonInPlay[],
    amount: number,
    duration: string
  ): GameState {
    const newState = this.cloneGameState(state);

    for (const target of targets) {
      const pokemon = this.findPokemonInState(newState, target.card.id);
      if (pokemon) {
        const shield: DamageShield = {
          amount,
          duration: duration as 'nextTurn' | 'thisAttack',
          createdOnTurn: state.turnNumber,
        };
        pokemon.damageShields.push(shield);
      }
    }

    return newState;
  }

  private static drawCards(state: GameState, player: 0 | 1, count: number): GameState {
    const newState = this.cloneGameState(state);
    const playerState = newState.players[player];

    for (let i = 0; i < count && playerState.deck.length > 0; i++) {
      const card = playerState.deck.shift();
      if (card) playerState.hand.push(card);
    }

    return newState;
  }

  private static searchCards(
    state: GameState,
    player: 0 | 1,
    from: 'deck' | 'discard',
    filter: CardFilter | undefined,
    count: number,
    destination: string
  ): GameState {
    const newState = this.cloneGameState(state);
    const playerState = newState.players[player];
    const zone = from === 'deck' ? playerState.deck : playerState.discard;

    const matching: Card[] = [];
    for (let i = zone.length - 1; i >= 0 && matching.length < count; i--) {
      const card = zone[i];
      if (!filter || this.matchesFilter(card, filter)) {
        matching.push(card);
        zone.splice(i, 1);
      }
    }

    if (destination === 'hand') {
      playerState.hand.push(...matching);
    } else if (destination === 'topOfDeck') {
      playerState.deck.push(...matching);
    } else if (destination === 'bench') {
      for (const card of matching) {
        if (card.cardType === CardType.Pokemon && playerState.bench.length < 5) {
          const pokemon = card as PokemonCard;
          playerState.bench.push({
            card: pokemon,
            currentHp: pokemon.hp,
            attachedEnergy: [],
            statusConditions: [],
            damageCounters: 0,
            attachedTools: [],
            isEvolved: false,
            turnPlayed: state.turnNumber,
            damageShields: [],
            cannotRetreat: false,
          });
        }
      }
    } else if (destination === 'deck') {
      playerState.deck.push(...matching);
    }

    // Log what was found
    if (matching.length > 0) {
      const names = matching.map(c => c.name).join(', ');
      const destLabel = destination === 'hand' ? 'hand' : destination === 'bench' ? 'bench' : 'deck';
      newState.gameLog = [...newState.gameLog, `Searched ${from} and found ${names} → ${destLabel}.`];
    }

    return newState;
  }

  private static millCards(state: GameState, player: 0 | 1, count: number): GameState {
    const newState = this.cloneGameState(state);
    const playerState = newState.players[player];

    for (let i = 0; i < count && playerState.deck.length > 0; i++) {
      const card = playerState.deck.shift();
      if (card) playerState.discard.push(card);
    }

    return newState;
  }

  private static shuffleZone(state: GameState, player: 0 | 1, zone: 'deck' | 'hand'): GameState {
    const newState = this.cloneGameState(state);
    const playerState = newState.players[player];
    const target = zone === 'deck' ? playerState.deck : playerState.hand;

    // Fisher-Yates shuffle
    for (let i = target.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [target[i], target[j]] = [target[j], target[i]];
    }

    return newState;
  }

  private static discardEnergyFromPokemon(
    state: GameState,
    targets: PokemonInPlay[],
    count: number,
    energyType?: EnergyType
  ): GameState {
    const newState = this.cloneGameState(state);

    for (const target of targets) {
      const pokemon = this.findPokemonInState(newState, target.card.id);
      if (!pokemon) continue;

      let discarded = 0;
      for (let i = pokemon.attachedEnergy.length - 1; i >= 0 && discarded < count; i--) {
        const energy = pokemon.attachedEnergy[i];
        if (!energyType || energy.energyType === energyType) {
          pokemon.attachedEnergy.splice(i, 1);
          discarded++;
        }
      }
    }

    return newState;
  }

  private static discardToolsFromPokemon(
    state: GameState,
    targets: PokemonInPlay[],
    count: number
  ): GameState {
    const newState = this.cloneGameState(state);

    for (const target of targets) {
      const pokemon = this.findPokemonInState(newState, target.card.id);
      if (pokemon && pokemon.attachedTools.length > 0) {
        pokemon.attachedTools.splice(0, Math.min(count, pokemon.attachedTools.length));
      }
    }

    return newState;
  }

  private static discardCardsFromPokemon(
    state: GameState,
    targets: PokemonInPlay[],
    count: number
  ): GameState {
    // Generic discard - similar to energy
    return this.discardEnergyFromPokemon(state, targets, count);
  }

  private static shuffleHandIntoDeck(state: GameState, player: 0 | 1): GameState {
    const newState = this.cloneGameState(state);
    const playerState = newState.players[player];
    playerState.deck.push(...playerState.hand);
    playerState.hand = [];
    // Fisher-Yates shuffle
    for (let i = playerState.deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [playerState.deck[i], playerState.deck[j]] = [playerState.deck[j], playerState.deck[i]];
    }
    return newState;
  }

  private static discardEntireHand(state: GameState, player: 0 | 1): GameState {
    const newState = this.cloneGameState(state);
    const playerState = newState.players[player];
    playerState.discard.push(...playerState.hand);
    playerState.hand = [];
    return newState;
  }

  private static bounceCards(state: GameState, targets: PokemonInPlay[], destination: string): GameState {
    // Return Pokemon to hand/deck/lost zone
    // This requires more complex state tracking
    return state;
  }

  private static discardFromPlayerHand(
    state: GameState,
    player: 0 | 1,
    count: number,
    filter?: CardFilter
  ): GameState {
    const newState = this.cloneGameState(state);
    const playerState = newState.players[player];

    let discarded = 0;
    for (let i = playerState.hand.length - 1; i >= 0 && discarded < count; i--) {
      const card = playerState.hand[i];
      if (!filter || this.matchesFilter(card, filter)) {
        playerState.discard.push(card);
        playerState.hand.splice(i, 1);
        discarded++;
      }
    }

    return newState;
  }

  private static moveEnergy(
    state: GameState,
    fromTargets: PokemonInPlay[],
    toTargets: PokemonInPlay[],
    count: number,
    energyType?: EnergyType
  ): GameState {
    const newState = this.cloneGameState(state);
    let moved = 0;

    for (const fromTarget of fromTargets) {
      const fromPokemon = this.findPokemonInState(newState, fromTarget.card.id);
      if (!fromPokemon) continue;

      for (let i = fromPokemon.attachedEnergy.length - 1; i >= 0 && moved < count; i--) {
        const energy = fromPokemon.attachedEnergy[i];
        if (!energyType || energy.energyType === energyType) {
          fromPokemon.attachedEnergy.splice(i, 1);

          // Add to first target
          if (toTargets.length > 0) {
            const toTarget = toTargets[0];
            const toPokemon = this.findPokemonInState(newState, toTarget.card.id);
            if (toPokemon) {
              toPokemon.attachedEnergy.push(energy);
            }
          }

          moved++;
        }
      }
    }

    return newState;
  }

  private static addEnergyToTarget(
    state: GameState,
    targets: PokemonInPlay[],
    energyType: EnergyType,
    count: number,
    from: 'deck' | 'discard' | 'create',
    playerIndex: 0 | 1
  ): GameState {
    const newState = this.cloneGameState(state);

    for (const target of targets) {
      const pokemon = this.findPokemonInState(newState, target.card.id);
      if (!pokemon) continue;

      for (let i = 0; i < count; i++) {
        if (from === 'create') {
          const energy: EnergyCard = {
            id: `energy-${Date.now()}-${i}`,
            name: `${energyType} Energy`,
            cardType: CardType.Energy,
            imageUrl: '',
            cardNumber: '',
            energySubtype: EnergySubtype.Basic,
            energyType,
            provides: [energyType],
          };
          pokemon.attachedEnergy.push(energy);
        } else {
          const playerState = newState.players[playerIndex];
          const zone = from === 'deck' ? playerState.deck : playerState.discard;
          const idx = zone.findIndex(c =>
            c.cardType === CardType.Energy && (c as EnergyCard).energyType === energyType
          );
          if (idx >= 0) {
            const [card] = zone.splice(idx, 1);
            pokemon.attachedEnergy.push(card as EnergyCard);
          }
        }
      }
    }

    return newState;
  }

  private static removeEnergyFromTarget(
    state: GameState,
    targets: PokemonInPlay[],
    count: number,
    energyType?: EnergyType
  ): GameState {
    return this.discardEnergyFromPokemon(state, targets, count, energyType);
  }

  private static addStatusCondition(
    state: GameState,
    targets: PokemonInPlay[],
    status: StatusCondition
  ): GameState {
    const newState = this.cloneGameState(state);

    for (const target of targets) {
      const pokemon = this.findPokemonInState(newState, target.card.id);
      if (pokemon && !pokemon.statusConditions.includes(status)) {
        pokemon.statusConditions.push(status);
      }
    }

    return newState;
  }

  private static removeStatusCondition(
    state: GameState,
    targets: PokemonInPlay[],
    status?: StatusCondition
  ): GameState {
    const newState = this.cloneGameState(state);

    for (const target of targets) {
      const pokemon = this.findPokemonInState(newState, target.card.id);
      if (!pokemon) continue;

      if (status) {
        pokemon.statusConditions = pokemon.statusConditions.filter((s: StatusCondition) => s !== status);
      } else {
        pokemon.statusConditions = [];
      }
    }

    return newState;
  }

  private static switchActivePokemon(state: GameState, player: 0 | 1, benchIndex?: number): GameState {
    const newState = this.cloneGameState(state);
    const playerState = newState.players[player];

    if (!playerState.active || playerState.bench.length === 0) {
      return newState;
    }

    const newActive = playerState.bench[benchIndex ?? 0];
    if (!newActive) return newState;

    const oldActiveName = playerState.active.card.name;
    const newActiveName = newActive.card.name;
    playerState.bench[benchIndex ?? 0] = playerState.active;
    playerState.active = newActive;

    newState.gameLog = [...newState.gameLog, `Switched ${oldActiveName} to bench, ${newActiveName} now active.`];

    return newState;
  }

  private static putPokemonIntoActive(
    state: GameState,
    player: 0 | 1,
    pokemon: PokemonInPlay
  ): GameState {
    const newState = this.cloneGameState(state);
    const playerState = newState.players[player];

    if (playerState.active) {
      playerState.bench.push(playerState.active);
    }

    playerState.active = pokemon;

    return newState;
  }

  private static grantExtraTurn(state: GameState, player: 0 | 1): GameState {
    const newState = this.cloneGameState(state);
    newState.players[player].extraTurn = true;
    newState.gameLog = [
      ...newState.gameLog,
      `Player ${player} will take an extra turn.`,
    ];
    return newState;
  }

  private static skipNextTurn(state: GameState, player: 0 | 1): GameState {
    const newState = this.cloneGameState(state);
    newState.players[player].skipNextTurn = true;
    newState.gameLog = [
      ...newState.gameLog,
      `Player ${player}'s next turn will be skipped.`,
    ];
    return newState;
  }

  private static addGameFlag(state: GameState, flag: string, duration: string): GameState {
    const newState = this.cloneGameState(state);
    const gameFlag: GameFlag = {
      flag,
      duration: duration as 'nextTurn' | 'thisAttack',
      setOnTurn: state.turnNumber,
      setByPlayer: state.currentPlayer,
    };
    newState.gameFlags.push(gameFlag);
    newState.gameLog = [
      ...newState.gameLog,
      `Game flag set: ${flag} (duration: ${duration}).`,
    ];
    return newState;
  }

  /**
   * Handle Rare Candy: find all valid (Stage2-in-hand, Basic-in-play) pairs.
   * Walks evolution chains via evolvesFrom fields — no hardcoded card names.
   * If 0 valid → return state. If 1 → auto-evolve. If 2+ → create PendingChoice.
   */
  private static handleRareCandy(state: GameState, context: EffectExecutionContext): GameState {
    if (state.turnNumber <= 1) return state; // Can't evolve turn 1

    const playerIdx = context.attackingPlayer;
    const player = state.players[playerIdx];

    // Find all Stage2/ex cards in hand that evolve from a Stage1
    const stage2InHand = player.hand.filter(c =>
      c.cardType === CardType.Pokemon && (
        (c as PokemonCard).stage === PokemonStage.Stage2 ||
        ((c as PokemonCard).stage === PokemonStage.ex && (c as PokemonCard).evolvesFrom)
      )
    ) as PokemonCard[];

    if (stage2InHand.length === 0) return state;

    // Collect all Pokemon cards from ALL zones to look up Stage1 evolvesFrom
    const allCards: Card[] = [
      ...player.deck, ...player.hand, ...player.discard,
      ...(player.active ? [player.active.card] : []),
      ...player.bench.map(p => p.card),
    ];

    // Collect all Basics in play that can be evolved (not placed this turn, not already evolved)
    const basicsInPlay: { pokemon: PokemonInPlay; zone: 'active' | 'bench'; benchIndex: number }[] = [];
    if (player.active && player.active.card.stage === PokemonStage.Basic &&
        !player.active.isEvolved && player.active.turnPlayed !== state.turnNumber) {
      basicsInPlay.push({ pokemon: player.active, zone: 'active', benchIndex: -1 });
    }
    player.bench.forEach((p, i) => {
      if (p.card.stage === PokemonStage.Basic && !p.isEvolved && p.turnPlayed !== state.turnNumber) {
        basicsInPlay.push({ pokemon: p, zone: 'bench', benchIndex: i });
      }
    });

    if (basicsInPlay.length === 0) return state;

    // Build valid (Stage2, target) pairs
    interface EvolvePair {
      stage2: PokemonCard;
      target: { pokemon: PokemonInPlay; zone: 'active' | 'bench'; benchIndex: number };
      basicName: string;
    }
    const validPairs: EvolvePair[] = [];

    for (const stage2 of stage2InHand) {
      const stage1Name = stage2.evolvesFrom;
      if (!stage1Name) continue;

      // Find the Stage1 card to get what Basic it evolves from
      const stage1Card = allCards.find(c =>
        c.cardType === CardType.Pokemon &&
        c.name === stage1Name &&
        (c as PokemonCard).evolvesFrom
      ) as PokemonCard | undefined;

      if (!stage1Card || !stage1Card.evolvesFrom) continue;
      const basicName = stage1Card.evolvesFrom;

      // Find matching Basics in play
      for (const basic of basicsInPlay) {
        if (basic.pokemon.card.name === basicName) {
          validPairs.push({ stage2, target: basic, basicName });
        }
      }
    }

    if (validPairs.length === 0) return state;

    // Exactly 1 valid pair → auto-evolve
    if (validPairs.length === 1) {
      return this.executeRareCandyEvolve(state, playerIdx, validPairs[0].stage2, validPairs[0].target, validPairs[0].basicName);
    }

    // Multiple valid pairs → create PendingChoice with evolveTarget type
    const options: PendingChoiceOption[] = validPairs.map((pair, idx) => ({
      id: `evolve-${idx}-${pair.stage2.id}-${pair.target.zone}-${pair.target.benchIndex}`,
      label: `${pair.stage2.name} → ${pair.target.pokemon.card.name} (${pair.target.zone})`,
      card: pair.stage2,
      benchIndex: pair.target.benchIndex,
      zone: pair.target.zone,
    }));

    const newState = this.cloneGameState(state);
    newState.pendingChoice = {
      choiceType: 'evolveTarget',
      playerIndex: playerIdx,
      options,
      selectionsRemaining: 1,
      destination: 'active', // not really used for evolve, but needed by type
      sourceZone: 'hand',
      selectedSoFar: [],
      remainingEffects: [],
      effectContext: { attackingPlayer: context.attackingPlayer, defendingPlayer: context.defendingPlayer },
      sourceCardName: context.sourceCardName || 'Rare Candy',
      canSkip: false,
    };

    return newState;
  }

  /**
   * Execute a Rare Candy evolution: remove Stage2 from hand, evolve Basic, trigger onEvolve.
   */
  private static executeRareCandyEvolve(
    state: GameState,
    playerIdx: 0 | 1,
    stage2: PokemonCard,
    target: { pokemon: PokemonInPlay; zone: 'active' | 'bench'; benchIndex: number },
    basicName: string
  ): GameState {
    const newState = this.cloneGameState(state);
    const player = newState.players[playerIdx];

    // Remove Stage2 from hand
    const handIdx = player.hand.findIndex(c => c.id === stage2.id);
    if (handIdx < 0) return state;
    player.hand.splice(handIdx, 1);

    // Build evolved Pokemon
    const evolved: PokemonInPlay = {
      ...target.pokemon,
      card: stage2,
      currentHp: Math.min(target.pokemon.currentHp + (stage2.hp - target.pokemon.card.hp), stage2.hp),
      isEvolved: true,
      previousStage: target.pokemon,
      statusConditions: [],
      cannotRetreat: false,
    };

    // Place evolved Pokemon
    if (target.zone === 'active') {
      player.active = evolved;
    } else {
      player.bench[target.benchIndex] = evolved;
    }

    newState.gameLog = [...newState.gameLog, `Rare Candy evolves ${basicName} directly to ${stage2.name}!`];

    // Trigger onEvolve ability
    let result: GameState = newState;
    if (stage2.ability && stage2.ability.trigger === 'onEvolve') {
      result = { ...result, gameLog: [...result.gameLog, `${stage2.name}'s ${stage2.ability.name} activates!`] };
      result = EffectExecutor.executeAbility(result, stage2.ability.effects, evolved, playerIdx);
    }

    return result;
  }

  private static preventRetreat(
    state: GameState,
    targets: PokemonInPlay[],
    duration: string
  ): GameState {
    const newState = this.cloneGameState(state);

    for (const target of targets) {
      const pokemon = this.findPokemonInState(newState, target.card.id);
      if (pokemon) {
        pokemon.cannotRetreat = true;
      }
    }

    newState.gameLog = [
      ...newState.gameLog,
      `Target Pokemon cannot retreat (duration: ${duration}).`,
    ];

    return newState;
  }

  private static countEnergyOnTarget(state: GameState, target: Target): number {
    // Count energy on resolved targets using a dummy context for resolution
    // For bonusDamage calls, we resolve directly based on target type
    if (target.type === 'self' || target.type === 'opponent') {
      // These need context — handled by the bonusDamage case in executeEffect
      return 0;
    }

    if (target.type === 'active') {
      const playerIndex = target.player === 'own' ? state.currentPlayer : (state.currentPlayer === 0 ? 1 : 0);
      const active = state.players[playerIndex].active;
      return active ? active.attachedEnergy.length : 0;
    }

    if (target.type === 'allBench' || target.type === 'bench') {
      const playerIndex = target.player === 'own' ? state.currentPlayer : (state.currentPlayer === 0 ? 1 : 0);
      return state.players[playerIndex].bench.reduce(
        (sum: number, p: PokemonInPlay) => sum + p.attachedEnergy.length, 0
      );
    }

    if (target.type === 'all') {
      const playerIndex = target.player === 'own' ? state.currentPlayer : (state.currentPlayer === 0 ? 1 : 0);
      const player = state.players[playerIndex];
      let count = player.active ? player.active.attachedEnergy.length : 0;
      count += player.bench.reduce((sum: number, p: PokemonInPlay) => sum + p.attachedEnergy.length, 0);
      return count;
    }

    return 0;
  }

  private static compareValues(actual: number, expected: number, comparison: string): boolean {
    switch (comparison) {
      case '>=':
        return actual >= expected;
      case '<=':
        return actual <= expected;
      case '==':
        return actual === expected;
      default:
        return false;
    }
  }

  private static findPokemonInState(
    state: GameState,
    cardId: string
  ): PokemonInPlay | null {
    for (const player of state.players) {
      if (player.active?.card.id === cardId) return player.active;
      const bench = player.bench.find((p: PokemonInPlay) => p.card.id === cardId);
      if (bench) return bench;
    }
    return null;
  }

  private static getPlayerOf(state: GameState, pokemon: PokemonInPlay): 0 | 1 {
    if (state.players[0].active?.card.id === pokemon.card.id) return 0;
    if (state.players[1].active?.card.id === pokemon.card.id) return 1;
    for (let i = 0; i < 2; i++) {
      if (state.players[i].bench.some((p: PokemonInPlay) => p.card.id === pokemon.card.id)) return i as 0 | 1;
    }
    return 0;
  }
}

// ============================================================================
// EXAMPLE CARD DEFINITIONS
// ============================================================================

/**
 * Example 1: Charizard ex - Burning Dark
 * "This attack does 30 more damage for each Prize card your opponent has taken."
 */
export const charizardExBurningDark: AttackDefinition = {
  name: 'Burning Dark',
  cost: [EnergyType.Fire, EnergyType.Dark],
  baseDamage: 180,
  description: 'This attack does 30 more damage for each Prize card your opponent has taken.',
  effects: [
    {
      effect: 'bonusDamage',
      amount: { type: 'constant', value: 30 },
      perUnit: { type: 'constant', value: 1 },
      countTarget: { type: 'hand', player: 'opponent' },
      countProperty: 'prizesTaken',
    },
  ],
};

/**
 * Example 2: Lugia VSTAR - Star Requiem
 * "This attack does 30 damage to each of your opponent's Benched Pokemon."
 */
export const lugiaVSTARStarRequiem: AttackDefinition = {
  name: 'Star Requiem',
  cost: [EnergyType.Colorless, EnergyType.Colorless, EnergyType.Colorless, EnergyType.Colorless],
  baseDamage: 210,
  description: 'This attack does 30 damage to each of your opponent\'s Benched Pokemon.',
  effects: [
    {
      effect: 'damage',
      target: { type: 'allBench', player: 'opponent' },
      amount: { type: 'constant', value: 30 },
    },
  ],
};

/**
 * Example 3: Miraidon ex - Photon Blaster
 * "This attack does 10 more damage for each Lightning Energy attached to this Pokemon."
 */
export const miraidonExPhotonBlaster: AttackDefinition = {
  name: 'Photon Blaster',
  cost: [EnergyType.Lightning, EnergyType.Colorless],
  baseDamage: 120,
  description: 'This attack does 10 more damage for each Lightning Energy attached to this Pokemon.',
  effects: [
    {
      effect: 'bonusDamage',
      amount: { type: 'constant', value: 10 },
      perUnit: { type: 'constant', value: 1 },
      countTarget: { type: 'self' },
      countProperty: 'energy',
    },
  ],
};

/**
 * Example 4: Professor's Research (Trainer - Supporter)
 * "Each player discards their hand and draws 7 cards."
 */
export const professorsResearch: TrainerDefinition = {
  name: "Professor's Research",
  trainerType: TrainerType.Supporter,
  description: "Each player discards their hand and draws 7 cards.",
  effects: [
    {
      effect: 'sequence',
      effects: [
        {
          effect: 'discardHand',
          player: 'own',
        },
        {
          effect: 'draw',
          player: 'own',
          count: { type: 'constant', value: 7 },
        },
        {
          effect: 'discardHand',
          player: 'opponent',
        },
        {
          effect: 'draw',
          player: 'opponent',
          count: { type: 'constant', value: 7 },
        },
      ],
    },
  ],
};

/**
 * Example 5: Ultra Ball (Trainer - Item)
 * "Discard 2 cards from your hand. Search your deck for a Pokemon, reveal it, and put it into your hand.
 *  Then, shuffle your deck."
 */
export const ultraBall: TrainerDefinition = {
  name: 'Ultra Ball',
  trainerType: TrainerType.Item,
  description:
    'Discard 2 cards from your hand. Search your deck for a Pokemon, reveal it, and put it into your hand. Then, shuffle your deck.',
  effects: [
    {
      effect: 'discardFromHand',
      player: 'own',
      count: { type: 'constant', value: 2 },
    },
    {
      effect: 'search',
      player: 'own',
      from: 'deck',
      filter: { filter: 'type', cardType: CardType.Pokemon },
      count: { type: 'constant', value: 1 },
      destination: 'hand',
    },
    {
      effect: 'shuffle',
      player: 'own',
      zone: 'deck',
    },
  ],
};

/**
 * Example 6: Boss's Orders (Trainer - Supporter)
 * "Your opponent switches their Active Pokemon with 1 of their Benched Pokemon."
 */
export const bossesOrders: TrainerDefinition = {
  name: "Boss's Orders",
  trainerType: TrainerType.Supporter,
  description:
    'Your opponent switches their Active Pokemon with 1 of their Benched Pokemon.',
  effects: [
    {
      effect: 'forceSwitch',
      player: 'opponent',
    },
  ],
};

/**
 * Example 7: Serperior - Seed Succession (conditional attack)
 * "If this Pokemon is on your Bench, this attack does nothing. Search your deck for up to 3 Grass Energy
 *  and attach them to this Pokemon. Then, shuffle your deck."
 */
export const serperiorSeedSuccession: AttackDefinition = {
  name: 'Seed Succession',
  cost: [EnergyType.Grass],
  baseDamage: 0,
  description:
    'If this Pokemon is on your Bench, this attack does nothing. Search your deck for up to 3 Grass Energy and attach them to this Pokemon. Then, shuffle your deck.',
  effects: [
    {
      effect: 'addEnergy',
      target: { type: 'self' },
      energyType: EnergyType.Grass,
      count: { type: 'constant', value: 3 },
      from: 'deck',
    },
    {
      effect: 'shuffle',
      player: 'own',
      zone: 'deck',
    },
  ],
};

/**
 * Example 8: Gengar ex - Poltergeist
 * "Your opponent reveals their hand. This attack does 30 damage for each Trainer card revealed this way."
 */
export const gengarExPoltergeist: AttackDefinition = {
  name: 'Poltergeist',
  cost: [EnergyType.Psychic, EnergyType.Dark],
  baseDamage: 60,
  description:
    'Your opponent reveals their hand. This attack does 30 damage for each Trainer card revealed this way.',
  effects: [
    {
      effect: 'revealCards',
      player: 'opponent',
      from: 'hand',
      count: { type: 'opponentHandSize' },
    },
    {
      effect: 'bonusDamage',
      amount: { type: 'constant', value: 30 },
      perUnit: { type: 'constant', value: 1 },
      countTarget: { type: 'hand', player: 'opponent' },
      countProperty: 'trainerCount',
    },
  ],
};

/**
 * Example 9: Ancient Roar (Pokemon ability-style effect on Trainer)
 * Conditional: if benched, does nothing. Otherwise, does damage based on bench.
 */
export const pokemonStatusAbilityExample: TrainerDefinition = {
  name: 'Bench Power',
  trainerType: TrainerType.Item,
  description:
    'Discard 1 Energy from your active Pokemon. This attack does 20 damage for each of your Benched Pokemon.',
  effects: [
    {
      effect: 'discard',
      target: { type: 'active', player: 'own' },
      what: 'energy',
      count: { type: 'constant', value: 1 },
    },
    {
      effect: 'bonusDamage',
      amount: { type: 'constant', value: 20 },
      perUnit: { type: 'constant', value: 1 },
      countTarget: { type: 'allBench', player: 'own' },
      countProperty: 'benchCount',
    },
  ],
};

/**
 * Example 10: Zap Cannon (complex attack with choice)
 * "Flip a coin. If heads, this attack does 110 more damage. If tails, this Pokemon does 20 damage to itself."
 */
export const zapCannonExample: AttackDefinition = {
  name: 'Zap Cannon',
  cost: [EnergyType.Lightning, EnergyType.Lightning],
  baseDamage: 100,
  description:
    'Flip a coin. If heads, this attack does 110 more damage. If tails, this Pokemon does 20 damage to itself.',
  effects: [
    {
      effect: 'conditional',
      condition: { check: 'coinFlip' },
      then: [
        {
          effect: 'damage',
          target: { type: 'opponent' },
          amount: { type: 'constant', value: 110 },
        },
      ],
      else: [
        {
          effect: 'selfDamage',
          amount: { type: 'constant', value: 20 },
        },
      ],
    },
  ],
};

// ============================================================================
// End of effect definitions
// ============================================================================
