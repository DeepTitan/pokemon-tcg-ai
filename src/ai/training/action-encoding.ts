/**
 * Action Encoding for Neural Network Training
 *
 * Encodes game actions as 54-float feature vectors for the action-scoring network.
 * Each legal action is independently encoded, capturing action type, target, and
 * critically the specific card involved (which drives most scoring decisions).
 *
 * Encoding layout (54 floats):
 *   [0-8]   Action type one-hot (9): PlayPokemon, AttachEnergy, UseAbility, Attack, Retreat, PlayTrainer, Pass, SelectTarget, ChooseCard
 *   [9-15]  Target slot one-hot (7): active, bench0, bench1, bench2, bench3, bench4, none
 *   [16-45] Card name one-hot (30): maps to CARD_NAME_INDEX dictionary
 *   [46-48] Energy type (3): Fire, Colorless/Jet, none
 *   [49-52] Choice context (4): searchCard, discardCard, switchTarget, evolveTarget
 *   [53]    Is evolution (1): boolean flag
 */

import { Action, ActionType, GameState, CardType, EnergyType, Card, PokemonCard } from '../../engine/types.js';

// ============================================================================
// CARD NAME DICTIONARY
// ============================================================================

/**
 * Fixed dictionary of all unique card names in the Charizard deck.
 * Index 29 reserved for unknown/unrecognized cards.
 */
export const CARD_NAMES: string[] = [
  'Hoothoot',          // 0
  'Noctowl',           // 1
  'Charmander',        // 2
  'Charmeleon',        // 3
  'Charizard ex',      // 4
  'Duskull',           // 5
  'Dusclops',          // 6
  'Dusknoir',          // 7
  'Fan Rotom',         // 8
  'Terapagos ex',      // 9
  'Pidgey',            // 10
  'Pidgeotto',         // 11
  'Pidgeot ex',        // 12
  'Klefki',            // 13
  'Fezandipiti ex',    // 14
  'Dawn',              // 15
  'Iono',              // 16
  "Boss's Orders",     // 17
  'Briar',             // 18
  'Buddy-Buddy Poffin',// 19
  'Rare Candy',        // 20
  'Nest Ball',         // 21
  'Prime Catcher',     // 22
  'Super Rod',         // 23
  'Night Stretcher',   // 24
  'Ultra Ball',        // 25
  'Area Zero Underdepths', // 26
  'Fire Energy',       // 27
  'Jet Energy',        // 28
  '<unknown>',         // 29
];

export const CARD_NAME_INDEX: Map<string, number> = new Map(
  CARD_NAMES.map((name, i) => [name, i])
);

/** Number of real card names (excluding <unknown>) */
export const NUM_CARD_NAMES = 29;

/**
 * Maximum copies of each card in the Charizard deck (60 cards total).
 * Used for normalizing discard pile counts in state encoding.
 * Index matches CARD_NAMES order.
 */
export const MAX_CARD_COPIES: number[] = [
  3,  // 0  Hoothoot
  3,  // 1  Noctowl
  3,  // 2  Charmander
  1,  // 3  Charmeleon
  2,  // 4  Charizard ex
  2,  // 5  Duskull
  1,  // 6  Dusclops
  1,  // 7  Dusknoir
  2,  // 8  Fan Rotom
  2,  // 9  Terapagos ex
  1,  // 10 Pidgey
  1,  // 11 Pidgeotto
  2,  // 12 Pidgeot ex
  1,  // 13 Klefki
  1,  // 14 Fezandipiti ex
  4,  // 15 Dawn
  2,  // 16 Iono
  2,  // 17 Boss's Orders
  1,  // 18 Briar
  4,  // 19 Buddy-Buddy Poffin
  4,  // 20 Rare Candy
  4,  // 21 Nest Ball
  1,  // 22 Prime Catcher
  1,  // 23 Super Rod
  1,  // 24 Night Stretcher
  1,  // 25 Ultra Ball
  2,  // 26 Area Zero Underdepths
  5,  // 27 Fire Energy
  2,  // 28 Jet Energy
];

/** Total size of one encoded action */
export const ACTION_ENCODING_SIZE = 54;

// ============================================================================
// ACTION TYPE INDICES
// ============================================================================

const ACTION_TYPE_ORDER: ActionType[] = [
  ActionType.PlayPokemon,   // 0
  ActionType.AttachEnergy,   // 1
  ActionType.UseAbility,     // 2
  ActionType.Attack,         // 3
  ActionType.Retreat,        // 4
  ActionType.PlayTrainer,    // 5
  ActionType.Pass,           // 6
  ActionType.SelectTarget,   // 7
  ActionType.ChooseCard,     // 8
];

const ACTION_TYPE_INDEX: Map<ActionType, number> = new Map(
  ACTION_TYPE_ORDER.map((type, i) => [type, i])
);

// ============================================================================
// ENCODING FUNCTIONS
// ============================================================================

/**
 * Extract the card name associated with an action from the game state.
 */
export function getCardNameFromAction(action: Action, state: GameState): string {
  const player = state.players[action.player];

  switch (action.type) {
    case ActionType.PlayPokemon:
    case ActionType.AttachEnergy:
    case ActionType.PlayTrainer: {
      const handIndex = action.payload.handIndex as number;
      if (handIndex >= 0 && handIndex < player.hand.length) {
        return player.hand[handIndex].name;
      }
      return '<unknown>';
    }

    case ActionType.UseAbility: {
      // Return the Pokemon's name that has the ability
      const zone = action.payload.zone as string;
      if (zone === 'active' && player.active) {
        return player.active.card.name;
      } else if (zone === 'bench') {
        const benchIdx = action.payload.benchIndex as number;
        if (benchIdx >= 0 && benchIdx < player.bench.length) {
          return player.bench[benchIdx].card.name;
        }
      }
      return '<unknown>';
    }

    case ActionType.Attack: {
      // Return the active Pokemon's name
      if (player.active) {
        return player.active.card.name;
      }
      return '<unknown>';
    }

    case ActionType.Retreat: {
      // Return the bench Pokemon being switched to
      const benchIdx = action.payload.benchIndex as number;
      if (benchIdx >= 0 && benchIdx < player.bench.length) {
        return player.bench[benchIdx].card.name;
      }
      return '<unknown>';
    }

    case ActionType.SelectTarget: {
      // For pending attachments — card name is the energy being attached
      if (state.pendingAttachments && state.pendingAttachments.cards.length > 0) {
        return state.pendingAttachments.cards[0].name;
      }
      return '<unknown>';
    }

    case ActionType.ChooseCard: {
      // The label in the payload IS the card name (or a composite label for evolveTarget)
      const label = action.payload.label as string;
      if (label === 'Done') return '<unknown>'; // skip option
      // For evolveTarget, label is like "Charizard ex → Charmander (bench)"
      // Extract the first card name
      if (label.includes(' → ')) {
        return label.split(' → ')[0];
      }
      return label || '<unknown>';
    }

    case ActionType.Pass:
      return '<unknown>';

    default:
      return '<unknown>';
  }
}

/**
 * Encode a single action as a 54-float feature vector.
 */
export function encodeAction(action: Action, state: GameState): Float32Array {
  const buffer = new Float32Array(ACTION_ENCODING_SIZE);

  // [0-8] Action type one-hot
  const typeIdx = ACTION_TYPE_INDEX.get(action.type);
  if (typeIdx !== undefined) {
    buffer[typeIdx] = 1.0;
  }

  // [9-15] Target slot one-hot (active=9, bench0=10, bench1=11, ..., bench4=14, none=15)
  const targetOffset = 9;
  switch (action.type) {
    case ActionType.PlayPokemon: {
      const tz = action.payload.targetZone as string | undefined;
      if (tz === 'active') {
        buffer[targetOffset + 0] = 1.0; // active
      } else if (tz === 'bench') {
        const bi = action.payload.benchIndex as number;
        buffer[targetOffset + 1 + bi] = 1.0; // bench slot
      } else {
        // Basic to bench — no specific target (goes to next open slot)
        buffer[targetOffset + 6] = 1.0; // none
      }
      break;
    }

    case ActionType.AttachEnergy: {
      const target = action.payload.target as string;
      if (target === 'active') {
        buffer[targetOffset + 0] = 1.0;
      } else {
        const bi = action.payload.benchIndex as number;
        buffer[targetOffset + 1 + bi] = 1.0;
      }
      break;
    }

    case ActionType.SelectTarget: {
      const zone = action.payload.zone as string;
      if (zone === 'active') {
        buffer[targetOffset + 0] = 1.0;
      } else {
        const bi = action.payload.benchIndex as number;
        buffer[targetOffset + 1 + bi] = 1.0;
      }
      break;
    }

    case ActionType.UseAbility: {
      const zone = action.payload.zone as string;
      if (zone === 'active') {
        buffer[targetOffset + 0] = 1.0;
      } else {
        const bi = action.payload.benchIndex as number;
        buffer[targetOffset + 1 + bi] = 1.0;
      }
      break;
    }

    case ActionType.Retreat: {
      const bi = action.payload.benchIndex as number;
      buffer[targetOffset + 1 + bi] = 1.0;
      break;
    }

    default:
      buffer[targetOffset + 6] = 1.0; // none
      break;
  }

  // [16-45] Card name one-hot (30 slots)
  const cardNameOffset = 16;
  const cardName = getCardNameFromAction(action, state);
  const nameIdx = CARD_NAME_INDEX.get(cardName) ?? 29; // 29 = unknown
  buffer[cardNameOffset + nameIdx] = 1.0;

  // [46-48] Energy type (3: Fire=0, Colorless/Jet=1, none=2)
  const energyOffset = 46;
  if (action.type === ActionType.AttachEnergy) {
    const player = state.players[action.player];
    const handIndex = action.payload.handIndex as number;
    if (handIndex >= 0 && handIndex < player.hand.length) {
      const card = player.hand[handIndex] as any;
      if (card.energyType === EnergyType.Fire) {
        buffer[energyOffset + 0] = 1.0;
      } else {
        buffer[energyOffset + 1] = 1.0; // Colorless / Jet
      }
    }
  } else if (action.type === ActionType.SelectTarget && state.pendingAttachments) {
    // Energy being attached from pending
    const card = state.pendingAttachments.cards[0] as any;
    if (card && card.energyType === EnergyType.Fire) {
      buffer[energyOffset + 0] = 1.0;
    } else if (card) {
      buffer[energyOffset + 1] = 1.0;
    }
  } else {
    buffer[energyOffset + 2] = 1.0; // none
  }

  // [49-52] Choice context (4: searchCard=0, discardCard=1, switchTarget=2, evolveTarget=3)
  const choiceOffset = 49;
  if (action.type === ActionType.ChooseCard && state.pendingChoice) {
    switch (state.pendingChoice.choiceType) {
      case 'searchCard': buffer[choiceOffset + 0] = 1.0; break;
      case 'discardCard': buffer[choiceOffset + 1] = 1.0; break;
      case 'switchTarget': buffer[choiceOffset + 2] = 1.0; break;
      case 'evolveTarget': buffer[choiceOffset + 3] = 1.0; break;
    }
  }

  // [53] Is evolution
  if (action.type === ActionType.PlayPokemon) {
    const targetZone = action.payload.targetZone as string | undefined;
    if (targetZone) {
      buffer[53] = 1.0; // has targetZone means it's an evolution
    }
  }

  return buffer;
}

/**
 * Encode all legal actions for a given state.
 */
export function encodeAllActions(actions: Action[], state: GameState): Float32Array[] {
  return actions.map(a => encodeAction(a, state));
}
