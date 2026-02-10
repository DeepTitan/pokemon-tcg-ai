/**
 * Pokemon TCG AI - Card Database
 *
 * Defines all available cards in the game, organized by type and rarity.
 * Includes Pokemon, Trainer cards, and Energy cards that form the playable card pool.
 * Pre-built starter decks are available for quick game setup.
 */

import {
  Card,
  PokemonCard,
  TrainerCard,
  EnergyCard,
  CardType,
  EnergyType,
  EnergySubtype,
  TrainerType,
  PokemonStage,
  Attack,
  Ability,
} from './types.js';

// ============================================================================
// POKEMON CARDS
// ============================================================================

export const POKEMON_CARDS: PokemonCard[] = [
  // Fire Type Pokemon
  {
    id: 'char-001',
    name: 'Charmander',
    cardType: CardType.Pokemon,
    cardNumber: 'SV01/001',
    imageUrl: 'https://example.com/charmander.png',
    hp: 70,
    stage: PokemonStage.Basic,
    type: EnergyType.Fire,
    weakness: EnergyType.Water,
    retreatCost: 1,
    prizeCards: 1,
    isRulebox: false,
    attacks: [
      {
        name: 'Ember',
        cost: [EnergyType.Fire],
        damage: 30,
        description: 'Deal 30 damage.',
      },
    ],
  },
  {
    id: 'char-002',
    name: 'Charmeleon',
    cardType: CardType.Pokemon,
    cardNumber: 'SV01/002',
    imageUrl: 'https://example.com/charmeleon.png',
    hp: 100,
    stage: PokemonStage.Stage1,
    type: EnergyType.Fire,
    weakness: EnergyType.Water,
    evolvesFrom: 'Charmander',
    retreatCost: 1,
    prizeCards: 1,
    isRulebox: false,
    attacks: [
      {
        name: 'Flamethrower',
        cost: [EnergyType.Fire, EnergyType.Fire],
        damage: 70,
        description: 'Deal 70 damage.',
      },
    ],
  },
  {
    id: 'char-003',
    name: 'Charizard ex',
    cardType: CardType.Pokemon,
    cardNumber: 'SV01/003',
    imageUrl: 'https://example.com/charizard-ex.png',
    hp: 330,
    stage: PokemonStage.ex,
    type: EnergyType.Fire,
    weakness: EnergyType.Water,
    evolvesFrom: 'Charmeleon',
    retreatCost: 2,
    prizeCards: 2,
    isRulebox: true,
    attacks: [
      {
        name: 'Burn Strike',
        cost: [EnergyType.Fire, EnergyType.Fire, EnergyType.Colorless],
        damage: 250,
        description: 'Deal 250 damage.',
      },
    ],
  },

  // Water Type Pokemon
  {
    id: 'squir-001',
    name: 'Squirtle',
    cardType: CardType.Pokemon,
    cardNumber: 'SV01/004',
    imageUrl: 'https://example.com/squirtle.png',
    hp: 60,
    stage: PokemonStage.Basic,
    type: EnergyType.Water,
    weakness: EnergyType.Grass,
    retreatCost: 1,
    prizeCards: 1,
    isRulebox: false,
    attacks: [
      {
        name: 'Water Gun',
        cost: [EnergyType.Water],
        damage: 20,
        description: 'Deal 20 damage.',
      },
    ],
  },
  {
    id: 'squir-002',
    name: 'Wartortle',
    cardType: CardType.Pokemon,
    cardNumber: 'SV01/005',
    imageUrl: 'https://example.com/wartortle.png',
    hp: 80,
    stage: PokemonStage.Stage1,
    type: EnergyType.Water,
    weakness: EnergyType.Grass,
    evolvesFrom: 'Squirtle',
    retreatCost: 1,
    prizeCards: 1,
    isRulebox: false,
    attacks: [
      {
        name: 'Aqua Jet',
        cost: [EnergyType.Water, EnergyType.Water],
        damage: 50,
        description: 'Deal 50 damage.',
      },
    ],
  },
  {
    id: 'squir-003',
    name: 'Blastoise ex',
    cardType: CardType.Pokemon,
    cardNumber: 'SV01/006',
    imageUrl: 'https://example.com/blastoise-ex.png',
    hp: 330,
    stage: PokemonStage.ex,
    type: EnergyType.Water,
    weakness: EnergyType.Grass,
    evolvesFrom: 'Wartortle',
    retreatCost: 2,
    prizeCards: 2,
    isRulebox: true,
    attacks: [
      {
        name: 'Hydro Pump',
        cost: [EnergyType.Water, EnergyType.Water, EnergyType.Colorless],
        damage: 260,
        description: 'Deal 260 damage.',
      },
    ],
  },

  // Grass Type Pokemon
  {
    id: 'bulb-001',
    name: 'Bulbasaur',
    cardType: CardType.Pokemon,
    cardNumber: 'SV01/007',
    imageUrl: 'https://example.com/bulbasaur.png',
    hp: 70,
    stage: PokemonStage.Basic,
    type: EnergyType.Grass,
    weakness: EnergyType.Fire,
    retreatCost: 1,
    prizeCards: 1,
    isRulebox: false,
    attacks: [
      {
        name: 'Vine Whip',
        cost: [EnergyType.Grass],
        damage: 30,
        description: 'Deal 30 damage.',
      },
    ],
  },

  // Lightning Type Pokemon
  {
    id: 'pika-001',
    name: 'Pikachu',
    cardType: CardType.Pokemon,
    cardNumber: 'SV01/008',
    imageUrl: 'https://example.com/pikachu.png',
    hp: 60,
    stage: PokemonStage.Basic,
    type: EnergyType.Lightning,
    weakness: EnergyType.Fighting,
    retreatCost: 1,
    prizeCards: 1,
    isRulebox: false,
    attacks: [
      {
        name: 'Thunder Shock',
        cost: [EnergyType.Lightning, EnergyType.Colorless],
        damage: 40,
        description: 'Deal 40 damage.',
      },
    ],
  },
  {
    id: 'pika-002',
    name: 'Raichu',
    cardType: CardType.Pokemon,
    cardNumber: 'SV01/009',
    imageUrl: 'https://example.com/raichu.png',
    hp: 120,
    stage: PokemonStage.Stage1,
    type: EnergyType.Lightning,
    weakness: EnergyType.Fighting,
    evolvesFrom: 'Pikachu',
    retreatCost: 1,
    prizeCards: 1,
    isRulebox: false,
    attacks: [
      {
        name: 'Thunderbolt',
        cost: [EnergyType.Lightning, EnergyType.Lightning, EnergyType.Lightning],
        damage: 120,
        description: 'Deal 120 damage.',
      },
    ],
  },
  {
    id: 'mira-001',
    name: 'Miraidon ex',
    cardType: CardType.Pokemon,
    cardNumber: 'SV01/010',
    imageUrl: 'https://example.com/miraidon-ex.png',
    hp: 220,
    stage: PokemonStage.ex,
    type: EnergyType.Lightning,
    weakness: EnergyType.Fighting,
    retreatCost: 2,
    prizeCards: 2,
    isRulebox: true,
    attacks: [
      {
        name: 'Plasma Geyser',
        cost: [EnergyType.Lightning, EnergyType.Lightning, EnergyType.Colorless],
        damage: 180,
        description: 'Deal 180 damage.',
      },
    ],
  },

  // Psychic Type Pokemon
  {
    id: 'ralt-001',
    name: 'Ralts',
    cardType: CardType.Pokemon,
    cardNumber: 'SV01/011',
    imageUrl: 'https://example.com/ralts.png',
    hp: 60,
    stage: PokemonStage.Basic,
    type: EnergyType.Psychic,
    weakness: EnergyType.Dark,
    retreatCost: 1,
    prizeCards: 1,
    isRulebox: false,
    attacks: [
      {
        name: 'Psychic Push',
        cost: [EnergyType.Psychic],
        damage: 20,
        description: 'Deal 20 damage.',
      },
    ],
  },
  {
    id: 'gard-001',
    name: 'Gardevoir ex',
    cardType: CardType.Pokemon,
    cardNumber: 'SV01/012',
    imageUrl: 'https://example.com/gardevoir-ex.png',
    hp: 310,
    stage: PokemonStage.ex,
    type: EnergyType.Psychic,
    weakness: EnergyType.Dark,
    evolvesFrom: 'Ralts',
    retreatCost: 2,
    prizeCards: 2,
    isRulebox: true,
    attacks: [
      {
        name: 'Prismatic Burst',
        cost: [EnergyType.Psychic, EnergyType.Psychic, EnergyType.Colorless],
        damage: 240,
        description: 'Deal 240 damage.',
      },
    ],
  },
  {
    id: 'mew-001',
    name: 'Mew ex',
    cardType: CardType.Pokemon,
    cardNumber: 'SV01/013',
    imageUrl: 'https://example.com/mew-ex.png',
    hp: 180,
    stage: PokemonStage.ex,
    type: EnergyType.Psychic,
    weakness: EnergyType.Dark,
    retreatCost: 1,
    prizeCards: 2,
    isRulebox: true,
    attacks: [
      {
        name: 'Psychic Leap',
        cost: [EnergyType.Psychic, EnergyType.Colorless],
        damage: 100,
        description: 'Deal 100 damage.',
      },
    ],
  },

  // Colorless Pokemon
  {
    id: 'bido-001',
    name: 'Bidoof',
    cardType: CardType.Pokemon,
    cardNumber: 'SV01/014',
    imageUrl: 'https://example.com/bidoof.png',
    hp: 60,
    stage: PokemonStage.Basic,
    type: EnergyType.Colorless,
    weakness: EnergyType.Fighting,
    retreatCost: 1,
    prizeCards: 1,
    isRulebox: false,
    attacks: [
      {
        name: 'Tackle',
        cost: [EnergyType.Colorless],
        damage: 20,
        description: 'Deal 20 damage.',
      },
    ],
  },
];

// ============================================================================
// TRAINER CARDS
// ============================================================================

export const TRAINER_CARDS: TrainerCard[] = [
  {
    id: 'train-001',
    name: "Professor's Research",
    cardType: CardType.Trainer,
    cardNumber: 'SV01/015',
    imageUrl: 'https://example.com/professors-research.png',
    trainerType: TrainerType.Supporter,
    effect: (state, player) => {
      const hand = state.players[player].hand;
      // Discard hand and draw 7
      state.players[player].discard.push(...hand);
      state.players[player].hand = [];
      const drawn = Math.min(7, state.players[player].deck.length);
      state.players[player].hand = state.players[player].deck.splice(0, drawn);
      return state;
    },
  },
  {
    id: 'train-002',
    name: "Boss's Orders",
    cardType: CardType.Trainer,
    cardNumber: 'SV01/016',
    imageUrl: 'https://example.com/bosss-orders.png',
    trainerType: TrainerType.Supporter,
    effect: (state, player) => {
      const opponent = player === 0 ? 1 : 0;
      // Switch opponent's active with bench
      if (state.players[opponent].bench.length > 0) {
        const temp = state.players[opponent].active;
        state.players[opponent].active = state.players[opponent].bench[0];
        if (temp) state.players[opponent].bench[0] = temp;
      }
      return state;
    },
  },
  {
    id: 'train-003',
    name: 'Iono',
    cardType: CardType.Trainer,
    cardNumber: 'SV01/017',
    imageUrl: 'https://example.com/iono.png',
    trainerType: TrainerType.Supporter,
    effect: (state, player) => {
      const opponent = player === 0 ? 1 : 0;
      // Both players shuffle hand into deck and draw cards equal to remaining prizes
      for (let p of [player, opponent]) {
        state.players[p].deck.push(...state.players[p].hand);
        state.players[p].hand = [];
        const drawCount = state.players[p].prizeCardsRemaining;
        state.players[p].hand = state.players[p].deck.splice(0, drawCount);
      }
      return state;
    },
  },
  {
    id: 'train-004',
    name: 'Nest Ball',
    cardType: CardType.Trainer,
    cardNumber: 'SV01/018',
    imageUrl: 'https://example.com/nest-ball.png',
    trainerType: TrainerType.Item,
    effect: (state, player) => {
      // Search for Basic Pokemon and put on bench
      const basicPokemon = state.players[player].deck.filter((c) => {
        return (
          c.cardType === CardType.Pokemon &&
          (c as PokemonCard).stage === PokemonStage.Basic &&
          state.players[player].bench.length < 5
        );
      });
      if (basicPokemon.length > 0) {
        const card = basicPokemon[0] as PokemonCard;
        state.players[player].deck = state.players[player].deck.filter(
          (c) => c.id !== card.id
        );
        state.players[player].bench.push({
          card,
          currentHp: card.hp,
          attachedEnergy: [],
          statusConditions: [],
          damageCounters: 0,
          attachedTools: [],
          isEvolved: false,
          damageShields: [],
          cannotRetreat: false,
        });
      }
      return state;
    },
  },
  {
    id: 'train-005',
    name: 'Ultra Ball',
    cardType: CardType.Trainer,
    cardNumber: 'SV01/019',
    imageUrl: 'https://example.com/ultra-ball.png',
    trainerType: TrainerType.Item,
    effect: (state, player) => {
      // Discard 2 cards, search for any Pokemon
      if (state.players[player].hand.length >= 2) {
        state.players[player].hand.splice(0, 2).forEach((c) => {
          state.players[player].discard.push(c);
        });
        const pokemonInDeck = state.players[player].deck.filter(
          (c) => c.cardType === CardType.Pokemon
        );
        if (pokemonInDeck.length > 0) {
          const card = pokemonInDeck[0] as PokemonCard;
          state.players[player].deck = state.players[player].deck.filter(
            (c) => c.id !== card.id
          );
          state.players[player].hand.push(card);
        }
      }
      return state;
    },
  },
  {
    id: 'train-006',
    name: 'Switch',
    cardType: CardType.Trainer,
    cardNumber: 'SV01/020',
    imageUrl: 'https://example.com/switch.png',
    trainerType: TrainerType.Item,
    effect: (state, player) => {
      // Switch your active with bench
      if (
        state.players[player].active &&
        state.players[player].bench.length > 0
      ) {
        const temp = state.players[player].active;
        state.players[player].active = state.players[player].bench[0];
        state.players[player].bench[0] = temp;
      }
      return state;
    },
  },
  {
    id: 'train-007',
    name: 'Rare Candy',
    cardType: CardType.Trainer,
    cardNumber: 'SV01/021',
    imageUrl: 'https://example.com/rare-candy.png',
    trainerType: TrainerType.Item,
    effect: (state, player) => {
      // Evolve Basic directly to Stage 2 (simplified implementation)
      // In real game, this would work with specific Pokemon
      return state;
    },
  },
  {
    id: 'train-008',
    name: 'Battle VIP Pass',
    cardType: CardType.Trainer,
    cardNumber: 'SV01/022',
    imageUrl: 'https://example.com/battle-vip-pass.png',
    trainerType: TrainerType.Item,
    effect: (state, player) => {
      // Search for 2 Basic Pokemon and put on bench (only first turn)
      if (state.turnNumber === 1) {
        const basicPokemon = state.players[player].deck.filter(
          (c) =>
            c.cardType === CardType.Pokemon &&
            (c as PokemonCard).stage === PokemonStage.Basic
        );
        let added = 0;
        for (const card of basicPokemon) {
          if (
            added < 2 &&
            state.players[player].bench.length < 5
          ) {
            state.players[player].deck = state.players[player].deck.filter(
              (c) => c.id !== card.id
            );
            state.players[player].bench.push({
              card: card as PokemonCard,
              currentHp: (card as PokemonCard).hp,
              attachedEnergy: [],
              statusConditions: [],
              damageCounters: 0,
              attachedTools: [],
              isEvolved: false,
              damageShields: [],
              cannotRetreat: false,
            });
            added++;
          }
        }
      }
      return state;
    },
  },
  {
    id: 'train-009',
    name: 'Energy Retrieval',
    cardType: CardType.Trainer,
    cardNumber: 'SV01/023',
    imageUrl: 'https://example.com/energy-retrieval.png',
    trainerType: TrainerType.Item,
    effect: (state, player) => {
      // Get up to 2 basic energy from discard to hand
      const energy = state.players[player].discard.filter(
        (c) => c.cardType === CardType.Energy
      );
      const toAdd = energy.slice(0, 2);
      toAdd.forEach((e) => {
        state.players[player].discard = state.players[player].discard.filter(
          (c) => c.id !== e.id
        );
        state.players[player].hand.push(e);
      });
      return state;
    },
  },
  {
    id: 'train-010',
    name: 'Arven',
    cardType: CardType.Trainer,
    cardNumber: 'SV01/024',
    imageUrl: 'https://example.com/arven.png',
    trainerType: TrainerType.Supporter,
    effect: (state, player) => {
      // Search for 1 Item and 1 Tool from deck
      const items = state.players[player].deck.filter(
        (c) =>
          c.cardType === CardType.Trainer &&
          (c as TrainerCard).trainerType === TrainerType.Item
      );
      const tools = state.players[player].deck.filter(
        (c) =>
          c.cardType === CardType.Trainer &&
          (c as TrainerCard).trainerType === TrainerType.Tool
      );
      if (items.length > 0) {
        state.players[player].deck = state.players[player].deck.filter(
          (c) => c.id !== items[0].id
        );
        state.players[player].hand.push(items[0]);
      }
      if (tools.length > 0) {
        state.players[player].deck = state.players[player].deck.filter(
          (c) => c.id !== tools[0].id
        );
        state.players[player].hand.push(tools[0]);
      }
      return state;
    },
  },
];

// ============================================================================
// ENERGY CARDS
// ============================================================================

export const ENERGY_CARDS: EnergyCard[] = [
  {
    id: 'energy-fire',
    name: 'Fire Energy',
    cardType: CardType.Energy,
    cardNumber: 'SV01/025',
    imageUrl: 'https://example.com/fire-energy.png',
    energySubtype: EnergySubtype.Basic,
    energyType: EnergyType.Fire,
    provides: [EnergyType.Fire],
  },
  {
    id: 'energy-water',
    name: 'Water Energy',
    cardType: CardType.Energy,
    cardNumber: 'SV01/026',
    imageUrl: 'https://example.com/water-energy.png',
    energySubtype: EnergySubtype.Basic,
    energyType: EnergyType.Water,
    provides: [EnergyType.Water],
  },
  {
    id: 'energy-grass',
    name: 'Grass Energy',
    cardType: CardType.Energy,
    cardNumber: 'SV01/027',
    imageUrl: 'https://example.com/grass-energy.png',
    energySubtype: EnergySubtype.Basic,
    energyType: EnergyType.Grass,
    provides: [EnergyType.Grass],
  },
  {
    id: 'energy-lightning',
    name: 'Lightning Energy',
    cardType: CardType.Energy,
    cardNumber: 'SV01/028',
    imageUrl: 'https://example.com/lightning-energy.png',
    energySubtype: EnergySubtype.Basic,
    energyType: EnergyType.Lightning,
    provides: [EnergyType.Lightning],
  },
  {
    id: 'energy-psychic',
    name: 'Psychic Energy',
    cardType: CardType.Energy,
    cardNumber: 'SV01/029',
    imageUrl: 'https://example.com/psychic-energy.png',
    energySubtype: EnergySubtype.Basic,
    energyType: EnergyType.Psychic,
    provides: [EnergyType.Psychic],
  },
  {
    id: 'energy-colorless',
    name: 'Colorless Energy',
    cardType: CardType.Energy,
    cardNumber: 'SV01/030',
    imageUrl: 'https://example.com/colorless-energy.png',
    energySubtype: EnergySubtype.Basic,
    energyType: EnergyType.Colorless,
    provides: [EnergyType.Colorless],
  },
];

// ============================================================================
// DECK BUILDER
// ============================================================================

/**
 * Build a pre-constructed starter deck for a given archetype.
 * Each deck contains exactly 60 cards and is optimized for a specific strategy.
 */
export function buildStarterDeck(archetype: string): Card[] {
  const deck: Card[] = [];

  switch (archetype.toLowerCase()) {
    case 'charizard': {
      // Charizard ex Fire Deck
      // Pokemon (15)
      deck.push(...Array(4).fill(POKEMON_CARDS[0])); // Charmander
      deck.push(...Array(2).fill(POKEMON_CARDS[1])); // Charmeleon
      deck.push(...Array(2).fill(POKEMON_CARDS[2])); // Charizard ex
      deck.push(...Array(2).fill(POKEMON_CARDS[6])); // Pikachu (utility)
      deck.push(...Array(2).fill(POKEMON_CARDS[7])); // Raichu
      deck.push(...Array(1).fill(POKEMON_CARDS[13])); // Bidoof (bench utility)

      // Trainers (12)
      deck.push(...Array(2).fill(TRAINER_CARDS[0])); // Professor's Research
      deck.push(...Array(2).fill(TRAINER_CARDS[1])); // Boss's Orders
      deck.push(...Array(2).fill(TRAINER_CARDS[3])); // Nest Ball
      deck.push(...Array(2).fill(TRAINER_CARDS[4])); // Ultra Ball
      deck.push(...Array(2).fill(TRAINER_CARDS[5])); // Switch
      deck.push(...Array(2).fill(TRAINER_CARDS[8])); // Energy Retrieval

      // Energy (33)
      deck.push(...Array(15).fill(ENERGY_CARDS[0])); // Fire Energy
      deck.push(...Array(10).fill(ENERGY_CARDS[5])); // Colorless Energy
      deck.push(...Array(8).fill(ENERGY_CARDS[3])); // Lightning Energy

      break;
    }

    case 'blastoise': {
      // Blastoise ex Water Deck
      // Pokemon (15)
      deck.push(...Array(4).fill(POKEMON_CARDS[3])); // Squirtle
      deck.push(...Array(2).fill(POKEMON_CARDS[4])); // Wartortle
      deck.push(...Array(2).fill(POKEMON_CARDS[5])); // Blastoise ex
      deck.push(...Array(2).fill(POKEMON_CARDS[6])); // Pikachu
      deck.push(...Array(2).fill(POKEMON_CARDS[7])); // Raichu
      deck.push(...Array(1).fill(POKEMON_CARDS[13])); // Bidoof
      deck.push(...Array(2).fill(POKEMON_CARDS[10])); // Mew ex

      // Trainers (12)
      deck.push(...Array(2).fill(TRAINER_CARDS[0])); // Professor's Research
      deck.push(...Array(2).fill(TRAINER_CARDS[1])); // Boss's Orders
      deck.push(...Array(2).fill(TRAINER_CARDS[3])); // Nest Ball
      deck.push(...Array(2).fill(TRAINER_CARDS[4])); // Ultra Ball
      deck.push(...Array(2).fill(TRAINER_CARDS[5])); // Switch
      deck.push(...Array(2).fill(TRAINER_CARDS[8])); // Energy Retrieval

      // Energy (33)
      deck.push(...Array(15).fill(ENERGY_CARDS[1])); // Water Energy
      deck.push(...Array(10).fill(ENERGY_CARDS[5])); // Colorless Energy
      deck.push(...Array(8).fill(ENERGY_CARDS[3])); // Lightning Energy

      break;
    }

    case 'gardevoir': {
      // Gardevoir ex Psychic Deck
      // Pokemon (15)
      deck.push(...Array(4).fill(POKEMON_CARDS[8])); // Ralts
      deck.push(...Array(2).fill(POKEMON_CARDS[9])); // Gardevoir ex
      deck.push(...Array(2).fill(POKEMON_CARDS[10])); // Mew ex
      deck.push(...Array(2).fill(POKEMON_CARDS[6])); // Pikachu
      deck.push(...Array(2).fill(POKEMON_CARDS[7])); // Raichu
      deck.push(...Array(1).fill(POKEMON_CARDS[13])); // Bidoof

      // Trainers (12)
      deck.push(...Array(2).fill(TRAINER_CARDS[0])); // Professor's Research
      deck.push(...Array(2).fill(TRAINER_CARDS[1])); // Boss's Orders
      deck.push(...Array(2).fill(TRAINER_CARDS[3])); // Nest Ball
      deck.push(...Array(2).fill(TRAINER_CARDS[4])); // Ultra Ball
      deck.push(...Array(2).fill(TRAINER_CARDS[5])); // Switch
      deck.push(...Array(2).fill(TRAINER_CARDS[8])); // Energy Retrieval

      // Energy (33)
      deck.push(...Array(15).fill(ENERGY_CARDS[4])); // Psychic Energy
      deck.push(...Array(10).fill(ENERGY_CARDS[5])); // Colorless Energy
      deck.push(...Array(8).fill(ENERGY_CARDS[3])); // Lightning Energy

      break;
    }

    case 'miraidon': {
      // Miraidon ex Lightning Speed Deck
      // Pokemon (15)
      deck.push(...Array(4).fill(POKEMON_CARDS[6])); // Pikachu
      deck.push(...Array(2).fill(POKEMON_CARDS[7])); // Raichu
      deck.push(...Array(2).fill(POKEMON_CARDS[11])); // Miraidon ex
      deck.push(...Array(2).fill(POKEMON_CARDS[10])); // Mew ex
      deck.push(...Array(2).fill(POKEMON_CARDS[0])); // Charmander
      deck.push(...Array(1).fill(POKEMON_CARDS[13])); // Bidoof

      // Trainers (12)
      deck.push(...Array(2).fill(TRAINER_CARDS[0])); // Professor's Research
      deck.push(...Array(2).fill(TRAINER_CARDS[1])); // Boss's Orders
      deck.push(...Array(2).fill(TRAINER_CARDS[3])); // Nest Ball
      deck.push(...Array(2).fill(TRAINER_CARDS[4])); // Ultra Ball
      deck.push(...Array(2).fill(TRAINER_CARDS[5])); // Switch
      deck.push(...Array(2).fill(TRAINER_CARDS[8])); // Energy Retrieval

      // Energy (33)
      deck.push(...Array(15).fill(ENERGY_CARDS[3])); // Lightning Energy
      deck.push(...Array(10).fill(ENERGY_CARDS[5])); // Colorless Energy
      deck.push(...Array(8).fill(ENERGY_CARDS[0])); // Fire Energy

      break;
    }

    default:
      throw new Error(`Unknown deck archetype: ${archetype}`);
  }

  // Validate deck size
  if (deck.length !== 60) {
    throw new Error(
      `Deck size mismatch for ${archetype}: expected 60, got ${deck.length}`
    );
  }

  return deck;
}

/**
 * Get all available cards in the game.
 */
export function getAllCards(): Card[] {
  return [...POKEMON_CARDS, ...TRAINER_CARDS, ...ENERGY_CARDS];
}
