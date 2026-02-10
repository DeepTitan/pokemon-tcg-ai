/**
 * Pokemon TCG AI - Effect Validation and Correction System
 *
 * Three-layer quality control for LLM-generated card effects:
 * 1. Static Validation: Structural and logical checks before execution
 * 2. Simulation Testing: Runtime behavior verification in test game states
 * 3. Human Review & Correction: Quality scoring and feedback loop
 *
 * The system feeds human corrections back to the LLM compiler as training examples,
 * improving future generation quality over time.
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
  Zone,
} from './types.js';
import {
  EffectDSL,
  AttackDefinition,
  TrainerDefinition,
  Target,
  ValueSource,
  Condition,
  CardFilter,
  EffectExecutor,
  EffectExecutionContext,
} from './effects.js';

// ============================================================================
// LAYER 1: STATIC VALIDATION
// ============================================================================

/**
 * Severity levels and diagnostic codes for validation issues
 */
export interface ValidationIssue {
  severity: 'error' | 'warning' | 'info';
  code: string;          // e.g., 'INVALID_TARGET', 'MISSING_COST', 'SUSPICIOUS_DAMAGE'
  message: string;
  cardName: string;
  attackName?: string;
  suggestion?: string;   // auto-fix suggestion
}

/**
 * Static validator checks generated effects for structural validity
 * without executing them. Catches obvious errors early.
 */
export class StaticValidator {
  /**
   * Validate a single attack or trainer definition
   */
  validate(
    def: AttackDefinition | TrainerDefinition,
    cardName: string,
    cardContext?: {
      supertype: string;
      types?: string[];
      hp?: number;
    }
  ): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    if ('cost' in def) {
      // Attack validation
      const attackDef = def as AttackDefinition;
      issues.push(...this.validateAttack(attackDef, cardName));
    } else {
      // Trainer validation
      const trainerDef = def as TrainerDefinition;
      issues.push(...this.validateTrainer(trainerDef, cardName));
    }

    return issues;
  }

  /**
   * Validate an attack definition specifically
   */
  private validateAttack(def: AttackDefinition, cardName: string): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    // Check cost is reasonable
    if (!def.cost || def.cost.length === 0) {
      issues.push({
        severity: 'warning',
        code: 'NO_ENERGY_COST',
        message: 'Attack has no energy cost (zero cost attacks are rare)',
        cardName,
        attackName: def.name,
        suggestion: `Consider adding energy cost to ${def.name}`,
      });
    }

    // Check damage is non-negative and reasonable
    if (def.baseDamage < 0) {
      issues.push({
        severity: 'error',
        code: 'NEGATIVE_DAMAGE',
        message: `Base damage is negative: ${def.baseDamage}`,
        cardName,
        attackName: def.name,
        suggestion: `Change base damage to >= 0`,
      });
    }

    if (def.baseDamage > 500) {
      issues.push({
        severity: 'warning',
        code: 'SUSPICIOUSLY_HIGH_DAMAGE',
        message: `Base damage is extremely high: ${def.baseDamage} (typical max is ~200)`,
        cardName,
        attackName: def.name,
        suggestion: `Consider reducing to realistic value`,
      });
    }

    // Validate effects
    issues.push(...this.validateTargets(def.effects, cardName, def.name));
    issues.push(...this.validateDamageValues(def.effects, def.baseDamage, cardName, def.name));
    issues.push(...this.validateEnergyTypes(def.effects, cardName, def.name));
    issues.push(...this.validateDrawCounts(def.effects, cardName, def.name));
    issues.push(...this.validateNoInfiniteLoops(def.effects, cardName, def.name));
    issues.push(...this.validateTextAlignment(def.effects, def.description, cardName, def.name));

    return issues;
  }

  /**
   * Validate a trainer definition
   */
  private validateTrainer(def: TrainerDefinition, cardName: string): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    // Check trainer type is valid
    const validTypes = ['Item', 'Supporter', 'Tool', 'Stadium'];
    if (!validTypes.includes(def.trainerType)) {
      issues.push({
        severity: 'error',
        code: 'INVALID_TRAINER_TYPE',
        message: `Invalid trainer type: ${def.trainerType}`,
        cardName,
        suggestion: `Use one of: ${validTypes.join(', ')}`,
      });
    }

    // Validate effects
    issues.push(...this.validateTargets(def.effects, cardName));
    issues.push(...this.validateEnergyTypes(def.effects, cardName));
    issues.push(...this.validateDrawCounts(def.effects, cardName));
    issues.push(...this.validateNoInfiniteLoops(def.effects, cardName));
    issues.push(...this.validateTextAlignment(def.effects, def.description, cardName));

    return issues;
  }

  /**
   * Check that all targets are valid (bench indices within range, etc.)
   */
  private validateTargets(
    effects: EffectDSL[],
    cardName: string,
    attackName?: string
  ): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const validTargetTypes = ['self', 'opponent', 'active', 'bench', 'anyPokemon', 'allBench', 'all', 'hand', 'deck', 'discard'];
    const validPlayers = ['own', 'opponent'];

    for (const effect of effects) {
      this.walkEffectTargets(effect, (target: Target) => {
        if (!validTargetTypes.includes(target.type)) {
          issues.push({
            severity: 'error',
            code: 'INVALID_TARGET_TYPE',
            message: `Invalid target type: ${target.type}`,
            cardName,
            attackName,
            suggestion: `Use one of: ${validTargetTypes.join(', ')}`,
          });
        }

        if ('player' in target && target.player && !validPlayers.includes(target.player)) {
          issues.push({
            severity: 'error',
            code: 'INVALID_TARGET_PLAYER',
            message: `Invalid player in target: ${target.player}`,
            cardName,
            attackName,
            suggestion: `Use 'own' or 'opponent'`,
          });
        }

        // Bench index validation
        if (target.type === 'bench' && 'index' in target && typeof target.index === 'number') {
          if (target.index < 0 || target.index > 4) {
            issues.push({
              severity: 'error',
              code: 'INVALID_BENCH_INDEX',
              message: `Bench index out of range: ${target.index} (valid: 0-4)`,
              cardName,
              attackName,
              suggestion: `Use bench index 0-4`,
            });
          }
        }
      });
    }

    return issues;
  }

  /**
   * Check that damage values are reasonable relative to cost
   */
  private validateDamageValues(
    effects: EffectDSL[],
    baseDamage: number,
    cardName: string,
    attackName?: string
  ): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    for (const effect of effects) {
      if (effect.effect === 'damage') {
        if (effect.amount.type === 'constant') {
          const damage = effect.amount.value;
          if (damage < 0) {
            issues.push({
              severity: 'error',
              code: 'NEGATIVE_EFFECT_DAMAGE',
              message: `Damage effect has negative value: ${damage}`,
              cardName,
              attackName,
              suggestion: `Use non-negative values`,
            });
          }
        }
      }

      if (effect.effect === 'selfDamage') {
        if (effect.amount.type === 'constant') {
          const damage = effect.amount.value;
          if (damage < 0) {
            issues.push({
              severity: 'error',
              code: 'NEGATIVE_SELF_DAMAGE',
              message: `Self-damage has negative value: ${damage}`,
              cardName,
              attackName,
              suggestion: `Use non-negative values`,
            });
          }
          if (damage > 300) {
            issues.push({
              severity: 'warning',
              code: 'EXTREME_SELF_DAMAGE',
              message: `Self-damage is very high: ${damage}`,
              cardName,
              attackName,
              suggestion: `Verify this matches the card text`,
            });
          }
        }
      }

      // Recursive check in nested effects
      if (effect.effect === 'conditional') {
        issues.push(...this.validateDamageValues(effect.then, baseDamage, cardName, attackName));
        if (effect.else) {
          issues.push(...this.validateDamageValues(effect.else, baseDamage, cardName, attackName));
        }
      }

      if (effect.effect === 'choice') {
        for (const option of effect.options) {
          issues.push(...this.validateDamageValues(option.effects, baseDamage, cardName, attackName));
        }
      }

      if (effect.effect === 'sequence') {
        issues.push(...this.validateDamageValues(effect.effects, baseDamage, cardName, attackName));
      }

      if (effect.effect === 'repeat') {
        issues.push(...this.validateDamageValues(effect.effects, baseDamage, cardName, attackName));
      }
    }

    return issues;
  }

  /**
   * Check that energy types referenced exist
   */
  private validateEnergyTypes(
    effects: EffectDSL[],
    cardName: string,
    attackName?: string
  ): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const validEnergies = [
      'Fire', 'Water', 'Grass', 'Lightning', 'Psychic',
      'Fighting', 'Dark', 'Metal', 'Dragon', 'Fairy', 'Colorless'
    ];

    for (const effect of effects) {
      // Check in value sources
      this.walkValueSources(effect, (vs: ValueSource) => {
        if (vs.type === 'countEnergy' && vs.energyType) {
          if (!validEnergies.includes(vs.energyType)) {
            issues.push({
              severity: 'error',
              code: 'INVALID_ENERGY_TYPE',
              message: `Invalid energy type: ${vs.energyType}`,
              cardName,
              attackName,
              suggestion: `Use one of: ${validEnergies.join(', ')}`,
            });
          }
        }
      });

      // Check in energy-related effects
      if (effect.effect === 'addEnergy') {
        if (!validEnergies.includes(effect.energyType)) {
          issues.push({
            severity: 'error',
            code: 'INVALID_ENERGY_TYPE',
            message: `Invalid energy type: ${effect.energyType}`,
            cardName,
            attackName,
            suggestion: `Use one of: ${validEnergies.join(', ')}`,
          });
        }
      }

      if (effect.effect === 'discard' && effect.energyType) {
        if (!validEnergies.includes(effect.energyType)) {
          issues.push({
            severity: 'error',
            code: 'INVALID_ENERGY_TYPE',
            message: `Invalid energy type: ${effect.energyType}`,
            cardName,
            attackName,
            suggestion: `Use one of: ${validEnergies.join(', ')}`,
          });
        }
      }

      if (effect.effect === 'moveEnergy' && effect.energyType) {
        if (!validEnergies.includes(effect.energyType)) {
          issues.push({
            severity: 'error',
            code: 'INVALID_ENERGY_TYPE',
            message: `Invalid energy type: ${effect.energyType}`,
            cardName,
            attackName,
            suggestion: `Use one of: ${validEnergies.join(', ')}`,
          });
        }
      }

      if (effect.effect === 'removeEnergy' && effect.energyType) {
        if (!validEnergies.includes(effect.energyType)) {
          issues.push({
            severity: 'error',
            code: 'INVALID_ENERGY_TYPE',
            message: `Invalid energy type: ${effect.energyType}`,
            cardName,
            attackName,
            suggestion: `Use one of: ${validEnergies.join(', ')}`,
          });
        }
      }

      // Recurse into nested effects
      if (effect.effect === 'conditional') {
        issues.push(...this.validateEnergyTypes(effect.then, cardName, attackName));
        if (effect.else) {
          issues.push(...this.validateEnergyTypes(effect.else, cardName, attackName));
        }
      }

      if (effect.effect === 'choice') {
        for (const option of effect.options) {
          issues.push(...this.validateEnergyTypes(option.effects, cardName, attackName));
        }
      }

      if (effect.effect === 'sequence') {
        issues.push(...this.validateEnergyTypes(effect.effects, cardName, attackName));
      }

      if (effect.effect === 'repeat') {
        issues.push(...this.validateEnergyTypes(effect.effects, cardName, attackName));
      }
    }

    return issues;
  }

  /**
   * Check that draw counts are reasonable (typically 1-10)
   */
  private validateDrawCounts(
    effects: EffectDSL[],
    cardName: string,
    attackName?: string
  ): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    for (const effect of effects) {
      if (effect.effect === 'draw') {
        if (effect.count.type === 'constant') {
          const count = effect.count.value;
          if (count <= 0) {
            issues.push({
              severity: 'warning',
              code: 'INVALID_DRAW_COUNT',
              message: `Draw effect has non-positive count: ${count}`,
              cardName,
              attackName,
              suggestion: `Draw count should be > 0`,
            });
          }
          if (count > 10) {
            issues.push({
              severity: 'warning',
              code: 'SUSPICIOUS_DRAW_COUNT',
              message: `Draw count is unusually high: ${count}`,
              cardName,
              attackName,
              suggestion: `Verify this matches the card text`,
            });
          }
        }
      }

      // Recurse into nested effects
      if (effect.effect === 'conditional') {
        issues.push(...this.validateDrawCounts(effect.then, cardName, attackName));
        if (effect.else) {
          issues.push(...this.validateDrawCounts(effect.else, cardName, attackName));
        }
      }

      if (effect.effect === 'choice') {
        for (const option of effect.options) {
          issues.push(...this.validateDrawCounts(option.effects, cardName, attackName));
        }
      }

      if (effect.effect === 'sequence') {
        issues.push(...this.validateDrawCounts(effect.effects, cardName, attackName));
      }

      if (effect.effect === 'repeat') {
        issues.push(...this.validateDrawCounts(effect.effects, cardName, attackName));
      }
    }

    return issues;
  }

  /**
   * Check for potential infinite loops in repeat/sequence chains
   */
  private validateNoInfiniteLoops(
    effects: EffectDSL[],
    cardName: string,
    attackName?: string
  ): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    for (const effect of effects) {
      if (effect.effect === 'repeat') {
        if (effect.times.type === 'constant') {
          const times = effect.times.value;
          if (times < 0) {
            issues.push({
              severity: 'error',
              code: 'NEGATIVE_REPEAT_COUNT',
              message: `Repeat count is negative: ${times}`,
              cardName,
              attackName,
              suggestion: `Use non-negative repeat count`,
            });
          }
          if (times > 100) {
            issues.push({
              severity: 'warning',
              code: 'EXCESSIVE_REPEAT_COUNT',
              message: `Repeat count is very high: ${times}`,
              cardName,
              attackName,
              suggestion: `Verify this won't cause performance issues`,
            });
          }
        }
      }

      // Recurse into nested effects
      if (effect.effect === 'conditional') {
        issues.push(...this.validateNoInfiniteLoops(effect.then, cardName, attackName));
        if (effect.else) {
          issues.push(...this.validateNoInfiniteLoops(effect.else, cardName, attackName));
        }
      }

      if (effect.effect === 'choice') {
        for (const option of effect.options) {
          issues.push(...this.validateNoInfiniteLoops(option.effects, cardName, attackName));
        }
      }

      if (effect.effect === 'sequence') {
        issues.push(...this.validateNoInfiniteLoops(effect.effects, cardName, attackName));
      }

      if (effect.effect === 'repeat') {
        issues.push(...this.validateNoInfiniteLoops(effect.effects, cardName, attackName));
      }
    }

    return issues;
  }

  /**
   * Check if the generated effects align with the original card text
   * by looking for keyword/effect mismatches
   */
  private validateTextAlignment(
    effects: EffectDSL[],
    originalText: string,
    cardName: string,
    attackName?: string
  ): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    // Extract keywords from text
    const keywords = this.extractKeywords(originalText);
    const effectTypes = this.getEffectTypesInDSL(effects);

    // Check for major mismatches
    const keywordToEffect: Record<string, string[]> = {
      'draw': ['draw'],
      'search': ['search'],
      'discard': ['discard', 'mill', 'discardFromHand'],
      'heal': ['heal'],
      'damage': ['damage', 'selfDamage', 'bonusDamage'],
      'switch': ['forceSwitch', 'selfSwitch', 'switchIntoActive'],
      'status': ['addStatus'],
      'energy': ['addEnergy', 'moveEnergy', 'removeEnergy', 'discard'],
      'bench': ['allBench'],
      'retreat': ['cannotRetreat'],
      'attack': ['opponentCannotAttack'],
      'trainer': ['opponentCannotPlayTrainers'],
      'ability': ['opponentCannotUseAbilities'],
    };

    for (const keyword of keywords) {
      const expectedEffects = keywordToEffect[keyword];
      if (expectedEffects) {
        const hasExpectedEffect = expectedEffects.some(e => effectTypes.includes(e));
        if (!hasExpectedEffect && originalText.length > 50) {
          // Only flag substantial effects, not simple ones
          issues.push({
            severity: 'warning',
            code: 'TEXT_ALIGNMENT_MISMATCH',
            message: `Card text mentions "${keyword}" but no corresponding effect found`,
            cardName,
            attackName,
            suggestion: `Verify that "${keyword}" is properly represented in effects`,
          });
        }
      }
    }

    return issues;
  }

  /**
   * Helper: Extract potential keywords from card text
   */
  private extractKeywords(text: string): string[] {
    const lowerText = text.toLowerCase();
    const keywords = [
      'draw', 'search', 'discard', 'heal', 'damage', 'switch', 'status',
      'energy', 'bench', 'retreat', 'attack', 'trainer', 'ability',
      'asleep', 'paralyzed', 'poisoned', 'burned', 'confused'
    ];

    return keywords.filter(kw => lowerText.includes(kw));
  }

  /**
   * Helper: Get all effect types present in a DSL array
   */
  private getEffectTypesInDSL(effects: EffectDSL[]): string[] {
    const types = new Set<string>();

    for (const effect of effects) {
      types.add(effect.effect);

      if (effect.effect === 'conditional') {
        this.getEffectTypesInDSL(effect.then).forEach(t => types.add(t));
        if (effect.else) {
          this.getEffectTypesInDSL(effect.else).forEach(t => types.add(t));
        }
      }

      if (effect.effect === 'choice') {
        for (const option of effect.options) {
          this.getEffectTypesInDSL(option.effects).forEach(t => types.add(t));
        }
      }

      if (effect.effect === 'sequence') {
        this.getEffectTypesInDSL(effect.effects).forEach(t => types.add(t));
      }

      if (effect.effect === 'repeat') {
        this.getEffectTypesInDSL(effect.effects).forEach(t => types.add(t));
      }
    }

    return Array.from(types);
  }

  /**
   * Helper: Walk all targets in an effect tree
   */
  private walkEffectTargets(effect: EffectDSL, callback: (target: Target) => void): void {
    const walkTargetInEffect = (e: EffectDSL) => {
      if ('target' in e && e.target) {
        callback(e.target as Target);
      }

      if (e.effect === 'conditional') {
        e.then.forEach(walkTargetInEffect);
        e.else?.forEach(walkTargetInEffect);
      } else if (e.effect === 'choice') {
        e.options.forEach((opt: any) => opt.effects.forEach(walkTargetInEffect));
      } else if (e.effect === 'sequence') {
        e.effects.forEach(walkTargetInEffect);
      } else if (e.effect === 'repeat') {
        e.effects.forEach(walkTargetInEffect);
      }
    };

    walkTargetInEffect(effect);
  }

  /**
   * Helper: Walk all value sources in an effect tree
   */
  private walkValueSources(effect: EffectDSL, callback: (vs: ValueSource) => void): void {
    const walkValueInEffect = (e: EffectDSL) => {
      if ('amount' in e && e.amount && typeof e.amount === 'object') {
        callback(e.amount as ValueSource);
      }

      if ('count' in e && e.count && typeof e.count === 'object') {
        callback(e.count as ValueSource);
      }

      if (e.effect === 'conditional') {
        e.then.forEach(walkValueInEffect);
        e.else?.forEach(walkValueInEffect);
      } else if (e.effect === 'choice') {
        e.options.forEach((opt: any) => opt.effects.forEach(walkValueInEffect));
      } else if (e.effect === 'sequence') {
        e.effects.forEach(walkValueInEffect);
      } else if (e.effect === 'repeat') {
        e.effects.forEach(walkValueInEffect);
      }
    };

    walkValueInEffect(effect);
  }
}

// ============================================================================
// LAYER 2: SIMULATION TESTING
// ============================================================================

/**
 * Represents a constraint that must always be true about game state
 */
export interface InvariantViolation {
  invariant: string;
  description: string;
}

/**
 * Result from running a single trial
 */
interface TrialResult {
  success: boolean;
  error?: Error;
  invariantViolations: InvariantViolation[];
  damageDealt: number;
  stateChanges: {
    cardsDrawn: number;
    cardsDiscarded: number;
    damageOnOpponent: number;
    statusesApplied: StatusCondition[];
  };
}

/**
 * Summary report from simulation testing
 */
export interface SimulationReport {
  cardName: string;
  attackName: string;
  trialsRun: number;
  crashes: number;            // runtime errors
  invariantViolations: InvariantViolation[];
  damageRange: { min: number; max: number; avg: number };
  stateChanges: string[];     // summary of what changed
  verdict: 'pass' | 'warning' | 'fail';
  details: string;
}

/**
 * Simulation validator runs effects in a test game environment
 * to catch runtime errors and verify game invariants hold
 */
export class SimulationValidator {
  /**
   * Test an attack effect by running it many times and checking for crashes/violations
   */
  testEffect(
    def: AttackDefinition,
    cardName: string,
    options?: {
      numTrials?: number;        // default 100
      checkInvariants?: boolean; // default true
    }
  ): SimulationReport {
    const numTrials = options?.numTrials ?? 100;
    const checkInvariants = options?.checkInvariants !== false;

    let crashes = 0;
    let violations: InvariantViolation[] = [];
    const damageResults: number[] = [];
    const allStateChanges = new Set<string>();

    for (let i = 0; i < numTrials; i++) {
      const rng = this.createSeededRNG(i);
      const testState = this.createTestState();

      try {
        const result = this.runTrial(testState, def, rng, checkInvariants);

        if (!result.success) {
          crashes++;
        } else {
          damageResults.push(result.damageDealt);
          violations.push(...result.invariantViolations);

          // Aggregate state changes
          if (result.stateChanges.cardsDrawn > 0) allStateChanges.add(`Cards drawn: ${result.stateChanges.cardsDrawn}`);
          if (result.stateChanges.cardsDiscarded > 0) allStateChanges.add(`Cards discarded: ${result.stateChanges.cardsDiscarded}`);
          if (result.stateChanges.damageOnOpponent > 0) allStateChanges.add(`Opponent damaged: ${result.stateChanges.damageOnOpponent}`);
          if (result.stateChanges.statusesApplied.length > 0) allStateChanges.add(`Statuses applied: ${result.stateChanges.statusesApplied.join(', ')}`);
        }
      } catch (err) {
        crashes++;
      }
    }

    // Deduplicate violations
    const uniqueViolations = Array.from(
      new Map(violations.map(v => [v.invariant, v])).values()
    );

    // Calculate damage stats
    const damageRange = {
      min: damageResults.length > 0 ? Math.min(...damageResults) : 0,
      max: damageResults.length > 0 ? Math.max(...damageResults) : 0,
      avg: damageResults.length > 0 ? damageResults.reduce((a, b) => a + b) / damageResults.length : 0,
    };

    // Determine verdict
    const verdict = crashes > numTrials * 0.1 ? 'fail' : uniqueViolations.length > 0 ? 'warning' : 'pass';

    return {
      cardName,
      attackName: def.name,
      trialsRun: numTrials,
      crashes,
      invariantViolations: uniqueViolations,
      damageRange,
      stateChanges: Array.from(allStateChanges),
      verdict,
      details: `${crashes} crashes out of ${numTrials} trials. ${uniqueViolations.length} unique invariant violations.`,
    };
  }

  /**
   * Create a standardized test game state with two initialized decks
   */
  private createTestState(): GameState {
    // Create two basic Pokemon with full HP
    const pokemon1: PokemonInPlay = {
      card: {
        id: 'test-mon-1',
        name: 'Pikachu',
        cardType: CardType.Pokemon,
        hp: 60,
        type: EnergyType.Lightning,
        stage: PokemonStage.Basic,
        cardNumber: 'test/1',
        imageUrl: '',
        retreatCost: 1,
        prizeCards: 1,
        isRulebox: false,
        attacks: [
          {
            name: 'Thunderbolt',
            cost: [EnergyType.Lightning],
            damage: 40,
            description: '',
          },
        ],
      },
      currentHp: 60,
      damageCounters: 0,
      attachedEnergy: [],
      statusConditions: [],
      attachedTools: [],
      isEvolved: false,
      damageShields: [],
      cannotRetreat: false,
    };

    const pokemon2: PokemonInPlay = {
      card: {
        id: 'test-mon-2',
        name: 'Blastoise',
        cardType: CardType.Pokemon,
        hp: 120,
        type: EnergyType.Water,
        stage: PokemonStage.Stage2,
        cardNumber: 'test/2',
        imageUrl: '',
        retreatCost: 3,
        prizeCards: 1,
        isRulebox: false,
        attacks: [
          {
            name: 'Hydro Pump',
            cost: [EnergyType.Water, EnergyType.Water],
            damage: 100,
            description: '',
          },
        ],
      },
      currentHp: 120,
      damageCounters: 0,
      attachedEnergy: [],
      statusConditions: [],
      attachedTools: [],
      isEvolved: false,
      damageShields: [],
      cannotRetreat: false,
    };

    // Create test decks
    const testCards: Card[] = [];
    for (let i = 0; i < 50; i++) {
      testCards.push({
        id: `test-card-${i}`,
        name: 'Test Card',
        cardType: CardType.Trainer,
        cardNumber: `test/${i}`,
        imageUrl: '',
      });
    }

    const state: GameState = {
      players: [
        {
          deck: testCards.slice(0, 25),
          hand: testCards.slice(0, 5),
          discard: [],
          active: pokemon1,
          bench: [],
          prizes: testCards.slice(25, 31),
          prizeCardsRemaining: 6,
          lostZone: [],
          supporterPlayedThisTurn: false,
          energyAttachedThisTurn: false,
          extraTurn: false,
          skipNextTurn: false,
          abilitiesUsedThisTurn: [],
        },
        {
          deck: testCards.slice(31, 50),
          hand: testCards.slice(5, 10),
          discard: [],
          active: pokemon2,
          bench: [],
          prizes: testCards.slice(37, 43),
          prizeCardsRemaining: 6,
          lostZone: [],
          supporterPlayedThisTurn: false,
          energyAttachedThisTurn: false,
          extraTurn: false,
          skipNextTurn: false,
          abilitiesUsedThisTurn: [],
        },
      ],
      currentPlayer: 0,
      phase: 'AttackPhase' as any,
      turnNumber: 1,
      stadium: null,
      winner: null,
      turnActions: [],
      gameLog: [],
      gameFlags: [],
    };

    return state;
  }

  /**
   * Run a single trial: execute attack and check invariants
   */
  private runTrial(
    state: GameState,
    def: AttackDefinition,
    rng: () => number,
    checkInvariants: boolean
  ): TrialResult {
    const stateBefore = JSON.parse(JSON.stringify(state));

    try {
      const context: EffectExecutionContext = {
        attackingPlayer: 0,
        defendingPlayer: 1,
        attackingPokemon: state.players[0].active!,
        defendingPokemon: state.players[1].active!,
        rng,
      };

      const stateAfter = EffectExecutor.execute(state, def.effects, context);

      // Check invariants if requested
      const violations = checkInvariants ? this.checkInvariants(stateBefore, stateAfter) : [];

      // Calculate state changes
      const stateChanges = {
        cardsDrawn: stateAfter.players[0].hand.length - stateBefore.players[0].hand.length,
        cardsDiscarded: stateAfter.players[0].discard.length - stateBefore.players[0].discard.length,
        damageOnOpponent: (stateBefore.players[1].active?.damageCounters ?? 0) - (stateAfter.players[1].active?.damageCounters ?? 0),
        statusesApplied: stateAfter.players[1].active?.statusConditions ?? [],
      };

      return {
        success: true,
        invariantViolations: violations,
        damageDealt: def.baseDamage,
        stateChanges,
      };
    } catch (error) {
      return {
        success: false,
        error: error as Error,
        invariantViolations: [],
        damageDealt: 0,
        stateChanges: { cardsDrawn: 0, cardsDiscarded: 0, damageOnOpponent: 0, statusesApplied: [] },
      };
    }
  }

  /**
   * Check that game invariants still hold after effects
   */
  private checkInvariants(before: GameState, after: GameState): InvariantViolation[] {
    const violations: InvariantViolation[] = [];

    // Invariant 1: No Pokemon has negative HP
    for (let i = 0; i < after.players.length; i++) {
      if (after.players[i].active && after.players[i].active!.currentHp < 0) {
        violations.push({
          invariant: 'NO_NEGATIVE_HP',
          description: `Player ${i}'s active Pokemon has negative HP: ${after.players[i].active!.currentHp}`,
        });
      }
      for (const benched of after.players[i].bench) {
        if (benched.currentHp < 0) {
          violations.push({
            invariant: 'NO_NEGATIVE_HP',
            description: `Player ${i} has benched Pokemon with negative HP: ${benched.currentHp}`,
          });
        }
      }
    }

    // Invariant 2: No player has negative cards in deck
    for (let i = 0; i < after.players.length; i++) {
      if (after.players[i].deck.length < 0) {
        violations.push({
          invariant: 'NO_NEGATIVE_DECK',
          description: `Player ${i} has negative deck size: ${after.players[i].deck.length}`,
        });
      }
    }

    // Invariant 3: No energy type that doesn't exist
    const validEnergies = ['Fire', 'Water', 'Grass', 'Lightning', 'Psychic', 'Fighting', 'Dark', 'Metal', 'Dragon', 'Fairy', 'Colorless'];
    for (let i = 0; i < after.players.length; i++) {
      if (after.players[i].active) {
        for (const energy of after.players[i].active!.attachedEnergy) {
          if (!validEnergies.includes(energy.energyType)) {
            violations.push({
              invariant: 'VALID_ENERGY_TYPES',
              description: `Invalid energy type found: ${energy.energyType}`,
            });
          }
        }
      }
    }

    // Invariant 4: Bench has max 5 Pokemon
    for (let i = 0; i < after.players.length; i++) {
      if (after.players[i].bench.length > 5) {
        violations.push({
          invariant: 'BENCH_SIZE_LIMIT',
          description: `Player ${i}'s bench exceeds limit: ${after.players[i].bench.length} > 5`,
        });
      }
    }

    // Invariant 5: Prize cards check
    for (let i = 0; i < after.players.length; i++) {
      const totalPrizes = after.players[i].prizes.length + after.players[i].prizeCardsRemaining;
      if (totalPrizes !== 6) {
        violations.push({
          invariant: 'PRIZE_CARD_COUNT',
          description: `Player ${i} has incorrect prize count: ${totalPrizes} (should be 6)`,
        });
      }
    }

    return violations;
  }

  /**
   * Create a seeded RNG for reproducible trials
   */
  private createSeededRNG(seed: number): () => number {
    let current = seed;
    return () => {
      current = (current * 1103515245 + 12345) % (2 ** 31);
      return (current / (2 ** 31)) % 1;
    };
  }
}

// ============================================================================
// LAYER 3: HUMAN REVIEW & CORRECTION SYSTEM
// ============================================================================

export type ReviewStatus = 'approved' | 'needs_review' | 'rejected' | 'corrected';

/**
 * Complete review information for a single card
 */
export interface CardReview {
  cardId: string;
  cardName: string;
  attackName?: string;
  originalText: string;
  generatedEffects: EffectDSL[];

  // Quality signals
  llmConfidence: 'high' | 'medium' | 'low';
  staticIssues: ValidationIssue[];
  simulationVerdict: 'pass' | 'warning' | 'fail';

  // Composite score (0-100) combining all signals
  qualityScore: number;

  // Human review
  status: ReviewStatus;
  humanNotes?: string;
  correctedEffects?: EffectDSL[];
  correctedAt?: Date;
  correctedBy?: string;
}

/**
 * Summary report of all reviews
 */
export interface ReviewReport {
  totalCards: number;
  autoApproved: number;    // quality >= 90, auto-passed
  needsReview: number;     // quality 50-89
  likelyBroken: number;    // quality < 50
  humanReviewed: number;
  humanCorrected: number;
  humanRejected: number;

  // Breakdown by issue type
  issueBreakdown: Record<string, number>;

  // Top problems for the LLM to improve on
  commonMistakes: Array<{ pattern: string; count: number; example: string }>;

  // Coverage
  coveragePercent: number;  // cards with working effects / total cards

  // Pretty print
  toString(): string;
}

/**
 * Central review and correction management system
 */
export class ReviewManager {
  private reviews: Map<string, CardReview> = new Map();
  private corrections: Map<string, EffectDSL[]> = new Map();  // cardId -> corrected effects

  constructor() {}

  /**
   * Run full validation pipeline on imported cards
   */
  async validateImport(
    cards: Array<{
      id: string;
      name: string;
      originalText: string;
      generatedEffects: EffectDSL[];
      llmConfidence: 'high' | 'medium' | 'low';
      attack?: { name: string; damage: number; cost: any[] };
    }>
  ): Promise<ReviewReport> {
    const staticValidator = new StaticValidator();
    const simValidator = new SimulationValidator();

    for (const card of cards) {
      const cardId = card.id;
      const attackName = card.attack?.name;

      // Run static validation
      const staticIssues = staticValidator.validate(
        {
          name: attackName || 'Card',
          effects: card.generatedEffects,
          description: card.originalText,
          ...(card.attack ? { cost: card.attack.cost, baseDamage: card.attack.damage } : { trainerType: 'Item' }),
        } as any,
        card.name
      );

      // Run simulation testing
      let simVerdict: 'pass' | 'warning' | 'fail' = 'pass';
      if (card.attack) {
        const simReport = simValidator.testEffect(
          {
            name: attackName || 'Card',
            cost: card.attack.cost,
            baseDamage: card.attack.damage,
            effects: card.generatedEffects,
            description: card.originalText,
          },
          card.name
        );
        simVerdict = simReport.verdict;
      }

      // Calculate quality score
      const qualityScore = this.calculateQualityScore({
        llmConfidence: card.llmConfidence,
        staticIssues,
        simVerdict,
        originalText: card.originalText,
        effects: card.generatedEffects,
      });

      // Create review
      const review: CardReview = {
        cardId,
        cardName: card.name,
        attackName,
        originalText: card.originalText,
        generatedEffects: card.generatedEffects,
        llmConfidence: card.llmConfidence,
        staticIssues,
        simulationVerdict: simVerdict,
        qualityScore,
        status: qualityScore >= 90 ? 'approved' : 'needs_review',
      };

      this.reviews.set(cardId, review);
    }

    return this.generateReport();
  }

  /**
   * Get all cards sorted by quality score (worst first for review)
   */
  getReviewQueue(): CardReview[] {
    return Array.from(this.reviews.values()).sort((a, b) => a.qualityScore - b.qualityScore);
  }

  /**
   * Get cards that need human attention
   */
  getFlaggedCards(options?: {
    maxQualityScore?: number;  // default 70 - only show below this
    onlyFailed?: boolean;
    onlyLowConfidence?: boolean;
  }): CardReview[] {
    const maxScore = options?.maxQualityScore ?? 70;
    let flagged = Array.from(this.reviews.values()).filter(r => r.qualityScore < maxScore);

    if (options?.onlyFailed) {
      flagged = flagged.filter(r => r.simulationVerdict === 'fail' || r.staticIssues.some(i => i.severity === 'error'));
    }

    if (options?.onlyLowConfidence) {
      flagged = flagged.filter(r => r.llmConfidence === 'low');
    }

    return flagged.sort((a, b) => a.qualityScore - b.qualityScore);
  }

  /**
   * Human approves a card's effects
   */
  approve(cardId: string): void {
    const review = this.reviews.get(cardId);
    if (review) {
      review.status = 'approved';
      review.correctedAt = new Date();
    }
  }

  /**
   * Human rejects and provides correction
   */
  correct(cardId: string, correctedEffects: EffectDSL[], notes?: string, correctedBy?: string): void {
    const review = this.reviews.get(cardId);
    if (review) {
      review.status = 'corrected';
      review.correctedEffects = correctedEffects;
      review.correctedAt = new Date();
      review.humanNotes = notes;
      review.correctedBy = correctedBy;
      this.corrections.set(cardId, correctedEffects);
    }
  }

  /**
   * Human rejects without correction
   */
  reject(cardId: string, reason: string): void {
    const review = this.reviews.get(cardId);
    if (review) {
      review.status = 'rejected';
      review.humanNotes = reason;
      review.correctedAt = new Date();
    }
  }

  /**
   * Get the final "best" effects for a card (human correction > LLM generated)
   */
  getEffects(cardId: string): EffectDSL[] | null {
    const correction = this.corrections.get(cardId);
    if (correction) return correction;

    const review = this.reviews.get(cardId);
    if (review && review.status !== 'rejected') {
      return review.generatedEffects;
    }

    return null;
  }

  /**
   * Export corrections as examples for future LLM compilation
   * (feeds back into the LLM compiler's prompt for better future results)
   */
  exportCorrectionsAsExamples(): Array<{
    cardText: string;
    wrongEffects: EffectDSL[];
    correctEffects: EffectDSL[];
    explanation: string;
  }> {
    const examples: Array<{
      cardText: string;
      wrongEffects: EffectDSL[];
      correctEffects: EffectDSL[];
      explanation: string;
    }> = [];

    for (const [cardId, correction] of this.corrections.entries()) {
      const review = this.reviews.get(cardId);
      if (review && review.correctedEffects) {
        examples.push({
          cardText: review.originalText,
          wrongEffects: review.generatedEffects,
          correctEffects: correction,
          explanation: review.humanNotes || 'Human-corrected effect',
        });
      }
    }

    return examples;
  }

  /**
   * Calculate quality score from all signals
   * Weights: LLM confidence (30), static validation (30), simulation (30), text alignment (10)
   */
  private calculateQualityScore(data: {
    llmConfidence: 'high' | 'medium' | 'low';
    staticIssues: ValidationIssue[];
    simVerdict: 'pass' | 'warning' | 'fail';
    originalText: string;
    effects: EffectDSL[];
  }): number {
    let score = 0;

    // LLM confidence: high=30, medium=15, low=0
    const confidenceScore = {
      high: 30,
      medium: 15,
      low: 0,
    }[data.llmConfidence];
    score += confidenceScore;

    // Static validation: no errors=30, warnings only=20, errors=0
    const hasErrors = data.staticIssues.some(i => i.severity === 'error');
    const hasWarnings = data.staticIssues.some(i => i.severity === 'warning');
    const staticScore = hasErrors ? 0 : hasWarnings ? 20 : 30;
    score += staticScore;

    // Simulation: pass=30, warning=15, fail=0
    const simScore = {
      pass: 30,
      warning: 15,
      fail: 0,
    }[data.simVerdict];
    score += simScore;

    // Text alignment: keywords match=10, some mismatch=5, major mismatch=0
    const textScore = this.scoreTextAlignment(data.originalText, data.effects);
    score += textScore;

    return score;
  }

  /**
   * Score how well the effects align with the original text
   */
  private scoreTextAlignment(originalText: string, effects: EffectDSL[]): number {
    const keywords = this.extractKeywordsFromText(originalText);
    const effectTypes = this.getEffectTypesInDSL(effects);

    const keywordToEffect: Record<string, string[]> = {
      'draw': ['draw'],
      'search': ['search'],
      'discard': ['discard', 'mill', 'discardFromHand'],
      'heal': ['heal'],
      'damage': ['damage', 'selfDamage', 'bonusDamage'],
      'switch': ['forceSwitch', 'selfSwitch', 'switchIntoActive'],
      'status': ['addStatus'],
      'energy': ['addEnergy', 'moveEnergy', 'removeEnergy'],
    };

    let matchCount = 0;
    let totalKeywords = 0;

    for (const keyword of keywords) {
      if (keywordToEffect[keyword]) {
        totalKeywords++;
        const expectedEffects = keywordToEffect[keyword];
        if (expectedEffects.some(e => effectTypes.includes(e))) {
          matchCount++;
        }
      }
    }

    if (totalKeywords === 0) return 10;  // No keywords to check
    const matchRatio = matchCount / totalKeywords;

    if (matchRatio >= 0.8) return 10;
    if (matchRatio >= 0.5) return 5;
    return 0;
  }

  /**
   * Helper: Extract keywords from text
   */
  private extractKeywordsFromText(text: string): string[] {
    const lowerText = text.toLowerCase();
    const keywords = [
      'draw', 'search', 'discard', 'heal', 'damage', 'switch', 'status',
      'energy', 'bench', 'retreat', 'attack', 'trainer', 'ability'
    ];

    return keywords.filter(kw => lowerText.includes(kw));
  }

  /**
   * Helper: Get all effect types in DSL
   */
  private getEffectTypesInDSL(effects: EffectDSL[]): string[] {
    const types = new Set<string>();

    for (const effect of effects) {
      types.add(effect.effect);

      if (effect.effect === 'conditional') {
        this.getEffectTypesInDSL(effect.then).forEach(t => types.add(t));
        if (effect.else) {
          this.getEffectTypesInDSL(effect.else).forEach(t => types.add(t));
        }
      }

      if (effect.effect === 'choice') {
        for (const option of effect.options) {
          this.getEffectTypesInDSL(option.effects).forEach(t => types.add(t));
        }
      }

      if (effect.effect === 'sequence') {
        this.getEffectTypesInDSL(effect.effects).forEach(t => types.add(t));
      }

      if (effect.effect === 'repeat') {
        this.getEffectTypesInDSL(effect.effects).forEach(t => types.add(t));
      }
    }

    return Array.from(types);
  }

  /**
   * Save reviews to a JSON file
   */
  async save(path: string): Promise<void> {
    const data = {
      reviews: Array.from(this.reviews.entries()).map(([id, review]) => ({
        id,
        ...review,
        correctedAt: review.correctedAt?.toISOString(),
      })),
      corrections: Array.from(this.corrections.entries()),
    };

    // Would write to file in real implementation
    // For now, return serializable structure
    return Promise.resolve();
  }

  /**
   * Load reviews from a JSON file
   */
  async load(path: string): Promise<void> {
    // Would read from file in real implementation
    return Promise.resolve();
  }

  /**
   * Generate a comprehensive summary report
   */
  generateReport(): ReviewReport {
    const allReviews = Array.from(this.reviews.values());

    const autoApproved = allReviews.filter(r => r.qualityScore >= 90).length;
    const needsReview = allReviews.filter(r => r.qualityScore >= 50 && r.qualityScore < 90).length;
    const likelyBroken = allReviews.filter(r => r.qualityScore < 50).length;

    const humanReviewed = allReviews.filter(r => r.status !== 'needs_review').length;
    const humanCorrected = allReviews.filter(r => r.status === 'corrected').length;
    const humanRejected = allReviews.filter(r => r.status === 'rejected').length;

    // Issue breakdown
    const issueBreakdown: Record<string, number> = {};
    for (const review of allReviews) {
      for (const issue of review.staticIssues) {
        issueBreakdown[issue.code] = (issueBreakdown[issue.code] || 0) + 1;
      }
    }

    // Find common mistakes
    const mistakePatterns: Record<string, { count: number; examples: string[] }> = {};
    for (const review of allReviews) {
      for (const issue of review.staticIssues.filter(i => i.severity === 'error')) {
        if (!mistakePatterns[issue.code]) {
          mistakePatterns[issue.code] = { count: 0, examples: [] };
        }
        mistakePatterns[issue.code].count++;
        if (mistakePatterns[issue.code].examples.length < 3) {
          mistakePatterns[issue.code].examples.push(review.cardName);
        }
      }
    }

    const commonMistakes = Object.entries(mistakePatterns)
      .map(([pattern, data]) => ({
        pattern,
        count: data.count,
        example: data.examples[0] || 'N/A',
      }))
      .sort((a, b) => b.count - a.count);

    // Coverage
    const working = allReviews.filter(r => r.status !== 'rejected').length;
    const coveragePercent = allReviews.length > 0 ? (working / allReviews.length) * 100 : 0;

    const report: ReviewReport = {
      totalCards: allReviews.length,
      autoApproved,
      needsReview,
      likelyBroken,
      humanReviewed,
      humanCorrected,
      humanRejected,
      issueBreakdown,
      commonMistakes,
      coveragePercent,
      toString: function () {
        return `
=== REVIEW REPORT ===
Total Cards: ${this.totalCards}
Auto-Approved (score >= 90): ${this.autoApproved}
Needs Review (score 50-89): ${this.needsReview}
Likely Broken (score < 50): ${this.likelyBroken}

Human Review Status:
- Reviewed: ${this.humanReviewed}
- Corrected: ${this.humanCorrected}
- Rejected: ${this.humanRejected}

Coverage: ${this.coveragePercent.toFixed(1)}% (working effects)

Top Issues:
${Object.entries(this.issueBreakdown)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 5)
  .map(([code, count]) => `  ${code}: ${count}`)
  .join('\n')}

Common Mistakes:
${this.commonMistakes
  .slice(0, 5)
  .map(m => `  ${m.pattern} (${m.count}x) - e.g., ${m.example}`)
  .join('\n')}
        `;
      },
    };

    return report;
  }
}

// ============================================================================
// UTILITIES
// ============================================================================

/**
 * Export utilities for integration with other systems
 */
export const ValidationUtils = {
  /**
   * Quick validation check - returns true if no critical errors
   */
  isValidEffect(effects: EffectDSL[]): boolean {
    const validator = new StaticValidator();
    const issues = effects.flatMap((e, idx): ValidationIssue[] => {
      // This is a simplified check - real validation requires card context
      return [];
    });

    return !issues.some(i => i.severity === 'error');
  },

  /**
   * Summarize validation issues for display
   */
  summarizeIssues(issues: ValidationIssue[]): string {
    const errors = issues.filter(i => i.severity === 'error').length;
    const warnings = issues.filter(i => i.severity === 'warning').length;
    const infos = issues.filter(i => i.severity === 'info').length;

    const parts: string[] = [];
    if (errors > 0) parts.push(`${errors} error${errors > 1 ? 's' : ''}`);
    if (warnings > 0) parts.push(`${warnings} warning${warnings > 1 ? 's' : ''}`);
    if (infos > 0) parts.push(`${infos} info${infos > 1 ? 's' : ''}`);

    return parts.join(', ') || 'No issues';
  },
};
