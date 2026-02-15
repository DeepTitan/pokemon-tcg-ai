/**
 * Pokemon TCG AI Game Engine - Core Type Definitions
 *
 * This file defines all TypeScript types, enums, and interfaces for the Pokemon Trading Card Game engine.
 * Follows the Pokemon TCG Standard format rules.
 */

// ============================================================================
// ENUMS
// ============================================================================

/**
 * Energy types in Pokemon TCG.
 * Covers the 11 types available in standard format.
 */
export enum EnergyType {
  Fire = 'Fire',
  Water = 'Water',
  Grass = 'Grass',
  Lightning = 'Lightning',
  Psychic = 'Psychic',
  Fighting = 'Fighting',
  Dark = 'Dark',
  Metal = 'Metal',
  Dragon = 'Dragon',
  Fairy = 'Fairy',
  Colorless = 'Colorless',
}

/**
 * Main card types in Pokemon TCG.
 * Pokemon cards, Trainer cards (with subtypes), and Energy cards.
 */
export enum CardType {
  Pokemon = 'Pokemon',
  Trainer = 'Trainer',
  Energy = 'Energy',
}

/**
 * Trainer card subtypes specifying the effect type.
 */
export enum TrainerType {
  Item = 'Item',
  Supporter = 'Supporter',
  Tool = 'Tool',
  Stadium = 'Stadium',
}

/**
 * Energy card subtypes distinguishing basic from special energy.
 */
export enum EnergySubtype {
  Basic = 'Basic',
  Special = 'Special',
}

/**
 * Pokemon evolution stages following standard format.
 * Stage progression: Basic -> Stage1 -> Stage2
 * Alternative lines: Basic -> V/ex -> VSTAR/VMAX
 */
export enum PokemonStage {
  Basic = 'Basic',
  Stage1 = 'Stage1',
  Stage2 = 'Stage2',
  V = 'V',
  VSTAR = 'VSTAR',
  VMAX = 'VMAX',
  ex = 'ex',
}

/**
 * Status conditions that can affect Pokemon in play.
 */
export enum StatusCondition {
  Poisoned = 'Poisoned',
  Burned = 'Burned',
  Asleep = 'Asleep',
  Confused = 'Confused',
  Paralyzed = 'Paralyzed',
}

/**
 * Game zones where cards can be located.
 */
export enum Zone {
  Deck = 'Deck',
  Hand = 'Hand',
  Active = 'Active',
  Bench = 'Bench',
  Discard = 'Discard',
  Prize = 'Prize',
  Stadium = 'Stadium',
  LostZone = 'LostZone',
}

/**
 * Game phases following Pokemon TCG turn structure.
 */
export enum GamePhase {
  Setup = 'Setup',
  DrawPhase = 'DrawPhase',
  MainPhase = 'MainPhase',
  AttackPhase = 'AttackPhase',
  BetweenTurns = 'BetweenTurns',
  GameOver = 'GameOver',
}

/**
 * Action types representing possible player actions.
 */
export enum ActionType {
  PlayPokemon = 'PlayPokemon',
  AttachEnergy = 'AttachEnergy',
  UseAbility = 'UseAbility',
  Attack = 'Attack',
  Retreat = 'Retreat',
  PlayTrainer = 'PlayTrainer',
  Pass = 'Pass',
  SelectTarget = 'SelectTarget',
  ChooseCard = 'ChooseCard',
}

// ============================================================================
// CARD INTERFACES
// ============================================================================

/**
 * Base card interface representing any card in the game.
 */
export interface Card {
  /** Unique identifier for this card instance */
  id: string;
  /** Card name */
  name: string;
  /** Card type: Pokemon, Trainer, or Energy */
  cardType: CardType;
  /** URL to card image for display/debugging */
  imageUrl: string;
  /** Card set and card number (e.g., "SV04.5/102") */
  cardNumber: string;
}

/**
 * Attack definition for Pokemon cards.
 */
export interface Attack {
  /** Attack name */
  name: string;
  /** Energy cost to use this attack (array of energy types) */
  cost: EnergyType[];
  /** Damage this attack deals (may be 0 for non-damage effects) */
  damage: number;
  /** DSL-based effect definition executed by EffectExecutor (preferred over legacy effect) */
  effects?: import('./effects.js').EffectDSL[];
  /** Optional legacy effect function applied when attack resolves. Used when effects DSL is not defined. */
  effect?: (state: GameState, attacker: PokemonInPlay, target: PokemonInPlay) => GameState;
  /** Human-readable description of attack effect */
  description: string;
}

/**
 * Target for an ability effect (e.g. which opponent Pokemon to hit).
 */
export interface AbilityTarget {
  player: 0 | 1;
  zone: 'active' | 'bench';
  benchIndex?: number;
}

/**
 * Ability definition for Pokemon cards.
 * Abilities can be triggered at various times (Ability, Poke-Power, Poke-Body).
 * Effects are defined using the EffectDSL system from effects.ts.
 */
export interface Ability {
  /** Ability name */
  name: string;
  /** Type of ability affecting when it can be used */
  type: 'ability' | 'pokebody' | 'pokepower';
  /** When this ability triggers: 'onEvolve' for evolution triggers, 'oncePerTurn' for active abilities, 'passive' for static effects */
  trigger: 'onEvolve' | 'oncePerTurn' | 'passive';
  /** DSL-based effect definition executed by EffectExecutor */
  effects: import('./effects.js').EffectDSL[];
  /** Human-readable description */
  description: string;
  /** For targeted abilities (e.g. Cursed Blast), returns possible targets */
  getTargets?: (state: GameState, pokemon: PokemonInPlay, playerIndex: number) => AbilityTarget[];
  /** Optional condition checked in getLegalActions before offering this ability.
   *  If set, the ability only appears as a legal action when the condition is met.
   *  E.g. Fan Call: { check: 'turnNumber', comparison: '<=', value: 2 } */
  abilityCondition?: import('./effects.js').Condition;
}

/**
 * Pokemon card definition.
 * Extends Card with Pokemon-specific properties like HP, stage, and attacks.
 */
export interface PokemonCard extends Card {
  cardType: CardType.Pokemon;
  /** Hit points for this Pokemon */
  hp: number;
  /** Evolution stage of this Pokemon */
  stage: PokemonStage;
  /** Pokemon type (determines energy requirements and weakness/resistance) */
  type: EnergyType;
  /** Energy type this Pokemon is weak to (2x damage multiplier) */
  weakness?: EnergyType;
  /** Energy type this Pokemon resists (20 or 30 damage reduction) */
  resistance?: EnergyType;
  /** Resistance reduction (-20, -30) */
  resistanceValue?: number;
  /** Energy cost to retreat this Pokemon */
  retreatCost: number;
  /** List of attacks this Pokemon can perform */
  attacks: Attack[];
  /** Optional ability for this Pokemon */
  ability?: Ability;
  /** Card name of the Pokemon this evolves from (if not Basic) */
  evolvesFrom?: string;
  /** Prize cards taken when this Pokemon is KO'd (1 = regular, 2 = ex/V, 3 = VMAX/VSTAR) */
  prizeCards: 1 | 2 | 3;
  /** Whether this Pokemon is a Rule Box card (ex, V, VMAX, VSTAR) */
  isRulebox: boolean;
  /** Whether this Pokemon has the Tera trait (relevant for Briar extra prize) */
  isTera?: boolean;
}

/**
 * Trainer card definition.
 * Extends Card with Trainer-specific properties and effect handlers.
 */
export interface TrainerCard extends Card {
  cardType: CardType.Trainer;
  /** Subtype of Trainer card (Item, Supporter, Tool, Stadium) */
  trainerType: TrainerType;
  /** DSL-based effect definition executed by EffectExecutor (preferred over legacy effect) */
  effects?: import('./effects.js').EffectDSL[];
  /** Legacy function implementing the Trainer's effect. Used when effects DSL is not defined. */
  effect?: (state: GameState, player: number) => GameState;
  /** Optional DSL condition that must be met for this card to be playable (checked in getLegalActions) */
  playCondition?: import('./effects.js').Condition;
}

/**
 * Energy card definition.
 * Extends Card with energy properties.
 */
export interface EnergyCard extends Card {
  cardType: CardType.Energy;
  /** Subtype of energy (Basic or Special) */
  energySubtype: EnergySubtype;
  /** The main energy type this card provides */
  energyType: EnergyType;
  /** Additional energy types this card provides (for special energy cards) */
  provides: EnergyType[];
}

// ============================================================================
// EFFECT TRACKING INTERFACES
// ============================================================================

/**
 * Damage shield: prevents a certain amount of damage from the next attack.
 * Created by effects like "prevent all damage done to this Pokemon during your opponent's next turn."
 */
export interface DamageShield {
  /** Amount of damage prevented (Infinity for 'all') */
  amount: number;
  /** When the shield expires */
  duration: 'nextTurn' | 'thisAttack';
  /** Turn number when the shield was created (for expiry tracking) */
  createdOnTurn: number;
}

/**
 * Game flag: a temporary rule modification (e.g., "opponent can't attack next turn").
 * Tracked at the game level and checked by the engine during action generation.
 */
export interface GameFlag {
  /** Flag identifier (e.g., 'opponentSkipAttack', 'opponentSkipTrainers', 'opponentSkipAbilities') */
  flag: string;
  /** When the flag expires */
  duration: 'nextTurn' | 'thisAttack';
  /** Turn number when the flag was set (for expiry tracking) */
  setOnTurn: number;
  /** Which player set this flag (the affected player is the opponent of this player) */
  setByPlayer: 0 | 1;
}

// ============================================================================
// GAME STATE INTERFACES
// ============================================================================

/**
 * Pokemon card in play on the board.
 * Tracks the card, HP, energy, status conditions, and tools attached.
 */
export interface PokemonInPlay {
  /** The underlying Pokemon card */
  card: PokemonCard;
  /** Current HP of this Pokemon (decreases with damage) */
  currentHp: number;
  /** Energy cards attached to this Pokemon */
  attachedEnergy: EnergyCard[];
  /** Status conditions affecting this Pokemon */
  statusConditions: StatusCondition[];
  /** Damage counters on this Pokemon (tracked separately for some effects) */
  damageCounters: number;
  /** Tool cards attached to this Pokemon (max 1) */
  attachedTools: TrainerCard[];
  /** Whether this Pokemon has evolved during the current turn (reset at end of turn) */
  isEvolved: boolean;
  /** Turn number when this Pokemon entered play (used to enforce same-turn evolution rules) */
  turnPlayed: number;
  /** Reference to the previous stage Pokemon if evolved */
  previousStage?: PokemonInPlay;
  /** Active damage shields preventing incoming damage */
  damageShields: DamageShield[];
  /** Whether this Pokemon is currently prevented from retreating */
  cannotRetreat: boolean;
}

/**
 * Player state tracking all zones and status for one player.
 */
export interface PlayerState {
  /** Deck: remaining cards to draw from */
  deck: Card[];
  /** Hand: cards player can play from */
  hand: Card[];
  /** Active Pokemon in play */
  active: PokemonInPlay | null;
  /** Bench Pokemon (max 5) */
  bench: PokemonInPlay[];
  /** Prize cards (typically 6, drawn when taking prizes) */
  prizes: Card[];
  /** Discard pile */
  discard: Card[];
  /** Lost Zone (cards cannot be recovered from here) */
  lostZone: Card[];
  /** Whether player has played a Supporter this turn */
  supporterPlayedThisTurn: boolean;
  /** Whether player has attached an Energy card this turn */
  energyAttachedThisTurn: boolean;
  /** Number of prize cards remaining to win the game */
  prizeCardsRemaining: number;
  /** Whether this player gets an extra turn after the current one */
  extraTurn: boolean;
  /** Whether this player's next turn should be skipped */
  skipNextTurn: boolean;
  /** Ability names used this turn (to enforce once-per-turn) */
  abilitiesUsedThisTurn: string[];
}

/**
 * Complete game state for both players.
 * Tracks current phase, whose turn it is, and the game history.
 */
export interface GameState {
  /** Player states for both players [player 0, player 1] */
  players: [PlayerState, PlayerState];
  /** Index of current player (0 or 1) */
  currentPlayer: 0 | 1;
  /** Current game turn number (starting at 1) */
  turnNumber: number;
  /** Current game phase */
  phase: GamePhase;
  /** Active Stadium card in play (affects both players) */
  stadium: TrainerCard | null;
  /** Game winner (0, 1) or null if ongoing */
  winner: 0 | 1 | null;
  /** Actions taken this turn for validation/logging */
  turnActions: Action[];
  /** Game log of significant events for debugging/replay */
  gameLog: string[];
  /** Active game flags (temporary rule modifications like "opponent can't attack") */
  gameFlags: GameFlag[];
  /** Pending energy attachments from abilities like Infernal Reign (player chooses targets) */
  pendingAttachments?: { cards: Card[], playerIndex: 0 | 1 };
  /** Pending choice for card/target selection (searches, force switches, discards, evolves) */
  pendingChoice?: PendingChoice;
}

// ============================================================================
// PENDING CHOICE SYSTEM
// ============================================================================

/**
 * A single option within a pending choice.
 * Represents one card or target the player can select.
 */
export interface PendingChoiceOption {
  /** Unique identifier for this option (card id, "bench-0", or deduped card name) */
  id: string;
  /** Display name for UI/logging */
  label: string;
  /** For card choices: the card being offered */
  card?: Card;
  /** For switch target choices: bench index of the Pokemon */
  benchIndex?: number;
  /** For evolve target choices: zone where the target Pokemon is */
  zone?: 'active' | 'bench';
}

/**
 * Represents a pending choice that must be resolved before the game continues.
 * Created by effects that require player selection (search, discard, force switch, evolve).
 * When present on GameState, getLegalActions generates only ChooseCard actions.
 *
 * Architecture: pause effect → enumerate choices as actions → AI picks → resume.
 * Validated by deckgym-core (Rust), ryuu-play (TS), and sethkarten/tcg (C/Python).
 */
export interface PendingChoice {
  /** What kind of choice this is */
  choiceType: 'searchCard' | 'discardCard' | 'switchTarget' | 'evolveTarget';
  /** Player who must make the choice */
  playerIndex: 0 | 1;
  /** Available options to pick from (deduplicated by card name for searches) */
  options: PendingChoiceOption[];
  /** How many more selections the player needs to make */
  selectionsRemaining: number;
  /** Where the chosen card goes */
  destination: 'hand' | 'bench' | 'deck' | 'discard' | 'active';
  /** Where the card is being chosen from */
  sourceZone: 'deck' | 'discard' | 'hand' | 'bench';
  /** Cards already selected in this multi-pick (for "choose up to N") */
  selectedSoFar: Card[];
  /** Remaining DSL effects to execute after all picks are resolved */
  remainingEffects: import('./effects.js').EffectDSL[];
  /** Minimal context needed to resume effect execution */
  effectContext: { attackingPlayer: 0 | 1; defendingPlayer: 0 | 1 };
  /** Name of the card that created this choice (for logging) */
  sourceCardName: string;
  /** Whether the player can choose to stop picking early ("up to N" effects) */
  canSkip: boolean;
  /** For forceSwitch: whose bench is being switched (may differ from playerIndex) */
  switchPlayerIndex?: 0 | 1;
}

/**
 * Player action representing a move in the game.
 */
export interface Action {
  /** Type of action being taken */
  type: ActionType;
  /** Which player is taking the action (0 or 1) */
  player: 0 | 1;
  /** Action-specific data (varies by action type) */
  payload: Record<string, any>;
}

/**
 * Game configuration defining basic rules.
 */
export interface GameConfig {
  /** Deck size in cards (Pokemon TCG standard: 60) */
  deckSize: number;
  /** Maximum Pokemon allowed on bench (standard: 5) */
  maxBench: number;
  /** Number of prize cards each player starts with (standard: 6) */
  prizeCount: number;
}

// ============================================================================
// NEURAL NETWORK STATE ENCODING
// ============================================================================

/**
 * Encoded game state for neural network input.
 *
 * Converts the game state into a flat Float32Array suitable for neural network processing.
 * This encoding is designed to be normalized and feature-complete.
 *
 * Encoding scheme (indices):
 * ────────────────────────────────────────────────────────────────────────────
 *
 * PLAYER 0 (Current Player) - Active Pokemon Features (0-31):
 *   0-4:    HP ratio per energy type (Fire, Water, Grass, Lightning, Psychic)
 *   5-9:    HP ratio per energy type (Fighting, Dark, Metal, Dragon, Fairy)
 *   10:     Energy count (Colorless)
 *   11-20:  Energy counts per type (Fire, Water, Grass, Lightning, Psychic, Fighting, Dark, Metal, Dragon, Fairy)
 *   21:     Status condition flags (bitmask: poisoned=1, burned=2, asleep=4, confused=8, paralyzed=16)
 *   22:     Prize cards value (1, 2, or 3)
 *   23-26:  Maximum attack damage across all attacks (normalized 0-1)
 *   27:     Is active Pokemon a rule box (0-1)
 *   28:     Current HP ratio (0-1)
 *   29:     Total attached tools count (max 1)
 *   30-31:  [Reserved for future use]
 *
 * PLAYER 0 Bench Pokemon (32-192, 5 Pokemon * 32 features each):
 *   Structure mirrors active pokemon (32 features each)
 *   Unused bench slots filled with zeros
 *
 * PLAYER 0 Hand & Resources (192-220):
 *   192:    Number of Pokemon cards in hand
 *   193:    Number of Trainer cards in hand
 *   194:    Number of Energy cards in hand
 *   195:    Number of Supporter cards in hand (from visible cards)
 *   196:    Number of Item cards in hand
 *   197:    Number of Tool cards in hand
 *   198:    Number of Stadium cards in hand
 *   199:    Available energy types count (cards that can be played)
 *   200-209: Energy card count in hand per type (F, W, G, L, P, F, D, M, D, Fa)
 *   210:    Deck size remaining
 *   211:    Discard pile size
 *   212:    Prize cards remaining
 *   213:    Supporter used this turn (0-1)
 *   214:    Energy attached this turn (0-1)
 *   215-219: [Reserved]
 *
 * PLAYER 1 (Opponent) - Known Information (220-380):
 *   220-251: Active Pokemon features (same as player 0 active, indices 0-31)
 *   252-412: Bench Pokemon features (same as player 0 bench, indices 32-192, 5 * 32)
 *   413-419: Hand summary (card type counts, can only see count, not composition)
 *   420:     Prize cards remaining
 *   421:     Deck size
 *   422:     Discard pile size
 *
 * GAME STATE (412-430):
 *   412:    Current player (0 or 1, as 0-1 float)
 *   413:    Turn number (normalized to typical game length)
 *   414:    Game phase (0-5 mapped to GamePhase enum)
 *   415:    Opponent hand size / 20
 *   416:    Stadium card active (0-1)
 *   417:    Opponent deck size / 60
 *   418:    Opponent discard pile size / 60
 *   419:    Opponent prize cards remaining / 6
 *   420-430: [Reserved/padding]
 *
 * PER-CARD DISCARD TRACKING (431-500):
 *   431-459: Own discard — per-card count/max for 29 unique cards (CARD_NAMES order)
 *   460:     [Reserved]
 *   461-489: Opponent discard — per-card count/max for 29 unique cards
 *   490-500: [Reserved]
 *
 * TOTAL VECTOR SIZE: 501 floats
 *
 * All values are normalized to [0, 1] range where applicable:
 * - HP ratios: currentHp / maxHp
 * - Energy counts: min(count, 10) / 10 to handle variable numbers
 * - Damage: min(damage, 300) / 300 (most attacks deal <= 300 damage)
 * - Card counts: min(count, 20) / 20 for hand, deck, discard
 * - Prize cards: count / 6
 * - Turn number: min(turn, 30) / 30 (most games under 30 turns)
 */
export interface EncodedGameState {
  /** The flat Float32Array encoding the game state (size: 501) */
  buffer: Float32Array;
  /** Metadata: timestamp when encoding was created */
  timestamp: number;
  /** Metadata: game turn number for reference */
  turnNumber: number;
  /** Metadata: which player this encoding is from perspective of (0 or 1) */
  perspectivePlayer: 0 | 1;
}

/**
 * Helper interface for decoding encoded game state back to insights.
 * Used for debugging and analysis.
 */
export interface DecodedGameStateInsights {
  /** Current player's active Pokemon HP ratio */
  playerActiveHpRatio: number;
  /** Opponent's active Pokemon HP ratio (if visible) */
  opponentActiveHpRatio: number;
  /** Current player's prize cards remaining */
  playerPrizesRemaining: number;
  /** Opponent's prize cards remaining */
  opponentPrizesRemaining: number;
  /** Available energy types in current player's hand */
  availableEnergyTypes: EnergyType[];
  /** Total bench Pokemon for current player */
  playerBenchCount: number;
  /** Total bench Pokemon visible for opponent */
  opponentBenchCount: number;
  /** Current game turn */
  turnNumber: number;
}

// ============================================================================
// UTILITY TYPES
// ============================================================================

/**
 * Union type for any card in the game.
 */
export type AnyCard = PokemonCard | TrainerCard | EnergyCard;

/**
 * Tuple type for the two players in a game.
 */
export type Players = [PlayerState, PlayerState];

/**
 * Game result with winner and statistics.
 */
export interface GameResult {
  /** Index of winning player (0 or 1) */
  winner: 0 | 1;
  /** Number of turns played */
  totalTurns: number;
  /** Reason for victory */
  winReason: 'prize-cards' | 'deck-out' | 'no-active-pokemon';
  /** Full game log */
  gameLog: string[];
  /** Final game state */
  finalState: GameState;
}

/**
 * Card effect context for complex effect resolution.
 */
export interface EffectContext {
  /** The game state when effect triggered */
  gameState: GameState;
  /** Player triggering the effect */
  player: number;
  /** Source card of the effect */
  sourceCard: AnyCard;
  /** Target card/zone if applicable */
  targetCard?: AnyCard;
  /** Additional context-specific data */
  metadata?: Record<string, any>;
}

/**
 * Validation result for checking if an action is legal.
 */
export interface ValidationResult {
  /** Whether the action is legal */
  isValid: boolean;
  /** Error message if action is invalid */
  errorMessage?: string;
  /** Specific validation failures if applicable */
  failures?: string[];
}
