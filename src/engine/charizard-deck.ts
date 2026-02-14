/**
 * Pokemon TCG AI - Competitive Charizard ex Deck
 *
 * Complete 60-card deck definition using the Effect DSL.
 * All 30 unique cards with precise card specifications from Pokemon TCG database.
 *
 * Deck Strategy:
 * - Focus on getting Charizard ex into play quickly via evolution lines
 * - Charizard ex's Burning Darkness attack scales with opponent's prizes taken
 * - Support Pokemon (Pidgeot ex, Terapagos ex) provide consistency and bench pressure
 * - Trainer suite provides search, switching, and disruption
 */

import {
  PokemonCard,
  TrainerCard,
  EnergyCard,
  Card,
  CardType,
  EnergyType,
  EnergySubtype,
  TrainerType,
  PokemonStage,
  PokemonInPlay,
  GameState,
  Attack,
  Ability,
  AbilityTarget,
} from './types.js';

import {
  EffectDSL,
  Target,
  ValueSource,
  CardFilter,
  Condition,
} from './effects.js';

// ============================================================================
// TYPE HELPERS
// ============================================================================

interface CardDefinition {
  pokemon?: PokemonCard;
  trainer?: TrainerCard;
  energy?: EnergyCard;
}

// ============================================================================
// POKEMON CARDS (15 total)
// ============================================================================

// Charizard Evolution Line (4 cards)
const HOOTHOOT: PokemonCard = {
  id: 'hoothoot-scr-114',
  name: 'Hoothoot',
  cardType: CardType.Pokemon,
  cardNumber: 'SCR 114',
  imageUrl: 'https://images.pokemontcg.io/sv7/114.png',
  hp: 60,
  stage: PokemonStage.Basic,
  type: EnergyType.Colorless,
  weakness: EnergyType.Lightning,
  resistance: EnergyType.Fighting,
  resistanceValue: -30,
  retreatCost: 1,
  prizeCards: 1,
  isRulebox: false,
  attacks: [
    {
      name: 'Peck',
      cost: [EnergyType.Colorless],
      damage: 20,
      description: 'Deal 20 damage.',
    },
  ],
};

const NOCTOWL: PokemonCard = {
  id: 'noctowl-scr-115',
  name: 'Noctowl',
  cardType: CardType.Pokemon,
  cardNumber: 'SCR 115',
  imageUrl: 'https://images.pokemontcg.io/sv7/115.png',
  hp: 100,
  stage: PokemonStage.Stage1,
  type: EnergyType.Colorless,
  weakness: EnergyType.Lightning,
  resistance: EnergyType.Fighting,
  resistanceValue: -30,
  retreatCost: 1,
  evolvesFrom: 'Hoothoot',
  prizeCards: 1,
  isRulebox: false,
  ability: {
    name: 'Jewel Seeker',
    type: 'ability',
    trigger: 'onEvolve',
    description:
      'When this Pokemon evolves, if you have a Tera Pokemon in play, you may search your deck for up to 2 Trainer cards and put them into your hand. Then, shuffle your deck.',
    effects: [
      {
        effect: 'conditional',
        condition: { check: 'hasPokemonInPlay', player: 'own', filter: { filter: 'name', name: 'Terapagos' } },
        then: [
          { effect: 'search', player: 'own', from: 'deck', filter: { filter: 'type', cardType: CardType.Trainer }, count: { type: 'constant', value: 2 }, destination: 'hand' },
          { effect: 'shuffle', player: 'own', zone: 'deck' },
        ],
      },
    ],
  },
  attacks: [
    {
      name: 'Speed Wing',
      cost: [EnergyType.Colorless, EnergyType.Colorless],
      damage: 60,
      description: 'Deal 60 damage.',
    },
  ],
};

const CHARMANDER_PAF: PokemonCard = {
  id: 'charmander-paf-7',
  name: 'Charmander',
  cardType: CardType.Pokemon,
  cardNumber: 'PAF 7',
  imageUrl: 'https://images.pokemontcg.io/sv4pt5/7.png',
  hp: 70,
  stage: PokemonStage.Basic,
  type: EnergyType.Fire,
  weakness: EnergyType.Water,
  retreatCost: 1,
  prizeCards: 1,
  isRulebox: false,
  attacks: [
    {
      name: 'Flare',
      cost: [EnergyType.Fire],
      damage: 20,
      description: 'Deal 20 damage.',
    },
  ],
};

const CHARMANDER_PFL: PokemonCard = {
  id: 'charmander-pfl-11',
  name: 'Charmander',
  cardType: CardType.Pokemon,
  cardNumber: 'MEW 4',
  imageUrl: 'https://images.pokemontcg.io/sv3pt5/4.png', // 151 set Charmander
  hp: 70,
  stage: PokemonStage.Basic,
  type: EnergyType.Fire,
  weakness: EnergyType.Water,
  retreatCost: 2,
  prizeCards: 1,
  isRulebox: false,
  attacks: [
    {
      name: 'Ember',
      cost: [EnergyType.Fire, EnergyType.Colorless],
      damage: 40,
      description: 'Discard 1 Fire Energy from this Pokemon.',
    },
  ],
};

const CHARMELEON: PokemonCard = {
  id: 'charmeleon-pfl-12',
  name: 'Charmeleon',
  cardType: CardType.Pokemon,
  cardNumber: 'MEW 5',
  imageUrl: 'https://images.pokemontcg.io/sv3pt5/5.png', // 151 set Charmeleon
  hp: 90,
  stage: PokemonStage.Stage1,
  type: EnergyType.Fire,
  weakness: EnergyType.Water,
  retreatCost: 2,
  evolvesFrom: 'Charmander',
  prizeCards: 1,
  isRulebox: false,
  attacks: [
    {
      name: 'Slash',
      cost: [EnergyType.Fire, EnergyType.Colorless],
      damage: 40,
      description: 'Deal 40 damage.',
    },
  ],
};

const CHARIZARD_EX: PokemonCard = {
  id: 'charizard-ex-obf-125',
  name: 'Charizard ex',
  cardType: CardType.Pokemon,
  cardNumber: 'OBF 125',
  imageUrl: 'https://images.pokemontcg.io/sv3/125.png',
  hp: 330,
  stage: PokemonStage.ex,
  type: EnergyType.Fire,
  weakness: EnergyType.Grass,
  retreatCost: 2,
  evolvesFrom: 'Charmeleon',
  prizeCards: 2,
  isRulebox: true,
  ability: {
    name: 'Infernal Reign',
    type: 'ability',
    trigger: 'onEvolve',
    description:
      'When this Pokemon evolves, search your deck for up to 3 basic Fire Energy cards and attach them to your Pokemon in any way you like. Then, shuffle your deck.',
    effects: [
      { effect: 'searchAndAttach', player: 'own', from: 'deck', filter: { filter: 'energyType', energyType: EnergyType.Fire, energySubtype: EnergySubtype.Basic }, count: { type: 'constant', value: 3 } },
      { effect: 'shuffle', player: 'own', zone: 'deck' },
    ],
  },
  attacks: [
    {
      name: 'Burning Darkness',
      cost: [EnergyType.Fire, EnergyType.Fire],
      damage: 180,
      description: 'This attack does 30 more damage for each Prize card your opponent has taken.',
      effects: [
        {
          effect: 'bonusDamage',
          amount: { type: 'constant', value: 30 },
          perUnit: { type: 'constant', value: 1 },
          countTarget: { type: 'hand', player: 'opponent' },
          countProperty: 'prizesTaken',
        } as EffectDSL,
      ],
    },
  ],
};

// Ghost Evolution Line (3 cards)
const DUSKULL: PokemonCard = {
  id: 'duskull-pre-35',
  name: 'Duskull',
  cardType: CardType.Pokemon,
  cardNumber: 'PRE 35',
  imageUrl: 'https://images.pokemontcg.io/sv8pt5/35.png',
  hp: 60,
  stage: PokemonStage.Basic,
  type: EnergyType.Psychic,
  weakness: EnergyType.Dark,
  resistance: EnergyType.Fighting,
  resistanceValue: -30,
  retreatCost: 1,
  prizeCards: 1,
  isRulebox: false,
  attacks: [
    {
      name: 'Mumble',
      cost: [EnergyType.Psychic, EnergyType.Psychic],
      damage: 30,
      description: 'Deal 30 damage.',
    },
  ],
};

const DUSCLOPS: PokemonCard = {
  id: 'dusclops-pre-36',
  name: 'Dusclops',
  cardType: CardType.Pokemon,
  cardNumber: 'PRE 36',
  imageUrl: 'https://images.pokemontcg.io/sv8pt5/36.png',
  hp: 90,
  stage: PokemonStage.Stage1,
  type: EnergyType.Psychic,
  weakness: EnergyType.Dark,
  resistance: EnergyType.Fighting,
  resistanceValue: -30,
  retreatCost: 2,
  evolvesFrom: 'Duskull',
  prizeCards: 1,
  isRulebox: false,
  attacks: [
    {
      name: 'Headbutt',
      cost: [EnergyType.Colorless, EnergyType.Colorless],
      damage: 30,
      description: 'Deal 30 damage.',
    },
  ],
};

const DUSKNOIR: PokemonCard = {
  id: 'dusknoir-pre-37',
  name: 'Dusknoir',
  cardType: CardType.Pokemon,
  cardNumber: 'PRE 37',
  imageUrl: 'https://images.pokemontcg.io/sv8pt5/37.png',
  hp: 160,
  stage: PokemonStage.Stage2,
  type: EnergyType.Psychic,
  weakness: EnergyType.Dark,
  resistance: EnergyType.Fighting,
  resistanceValue: -30,
  retreatCost: 3,
  evolvesFrom: 'Dusclops',
  prizeCards: 1,
  isRulebox: false,
  ability: {
    name: 'Cursed Blast',
    type: 'ability',
    trigger: 'oncePerTurn',
    description:
      'Once during your turn, you may put 13 damage counters on 1 of your opponent\'s Pokemon, then your Active Pokemon is Knocked Out.',
    effects: [
      { effect: 'sequence', effects: [
        { effect: 'damage', target: { type: 'opponent' }, amount: { type: 'constant', value: 130 } },
        { effect: 'setHp', target: { type: 'active', player: 'own' }, amount: { type: 'constant', value: 0 } },
      ]},
    ],
    getTargets: (state: GameState, _pokemon: PokemonInPlay, playerIndex: number) => {
      const opp = (1 - playerIndex) as 0 | 1;
      const targets: AbilityTarget[] = [];
      if (state.players[opp].active) targets.push({ player: opp, zone: 'active' });
      state.players[opp].bench.forEach((_, i) => targets.push({ player: opp, zone: 'bench', benchIndex: i }));
      return targets;
    },
  },
  attacks: [
    {
      name: 'Shadow Bind',
      cost: [EnergyType.Psychic, EnergyType.Psychic, EnergyType.Colorless],
      damage: 150,
      description: 'During your opponent\'s next turn, the Defending Pokemon cannot retreat.',
      effects: [
        {
          effect: 'cannotRetreat',
          target: { type: 'opponent' },
          duration: 'nextTurn',
        } as EffectDSL,
      ],
    },
  ],
};

// Support Pokemon (4 cards)
const FAN_ROTOM: PokemonCard = {
  id: 'fan-rotom-scr-118',
  name: 'Fan Rotom',
  cardType: CardType.Pokemon,
  cardNumber: 'SCR 118',
  imageUrl: 'https://images.pokemontcg.io/sv7/118.png',
  hp: 70,
  stage: PokemonStage.Basic,
  type: EnergyType.Colorless,
  weakness: EnergyType.Lightning,
  resistance: EnergyType.Fighting,
  resistanceValue: -30,
  retreatCost: 1,
  prizeCards: 1,
  isRulebox: false,
  ability: {
    name: 'Fan Call',
    type: 'ability',
    trigger: 'oncePerTurn',
    description:
      'Once during your first turn, you may search your deck for up to 3 Colorless Pokemon with 100 HP or less, reveal them, and put them into your hand. Then, shuffle your deck.',
    abilityCondition: { check: 'turnNumber', comparison: '<=', value: 2 },
    effects: [
      { effect: 'search', player: 'own', from: 'deck', filter: { filter: 'and', filters: [{ filter: 'type', cardType: CardType.Pokemon }, { filter: 'hpBelow', maxHp: 100 }, { filter: 'pokemonType', energyType: EnergyType.Colorless }] }, count: { type: 'constant', value: 3 }, destination: 'hand' },
      { effect: 'shuffle', player: 'own', zone: 'deck' },
    ],
  },
  attacks: [
    {
      name: 'Assault Landing',
      cost: [EnergyType.Colorless],
      damage: 70,
      description: 'This attack does nothing if your opponent has no Stadium in play.',
    },
  ],
};

const TERAPAGOS_EX: PokemonCard = {
  id: 'terapagos-ex-scr-128',
  name: 'Terapagos ex',
  cardType: CardType.Pokemon,
  cardNumber: 'SCR 128',
  imageUrl: 'https://images.pokemontcg.io/sv7/128.png',
  hp: 230,
  stage: PokemonStage.Basic,
  type: EnergyType.Colorless,
  weakness: EnergyType.Fighting,
  retreatCost: 2,
  prizeCards: 2,
  isRulebox: true,
  isTera: true,
  attacks: [
    {
      name: 'Unified Beatdown',
      cost: [EnergyType.Colorless, EnergyType.Colorless],
      damage: 0,
      description: 'This attack does 30 damage for each Benched Pokemon you have. (This attack can\'t be used if you went second and it\'s your first turn.)',
      effects: [
        {
          effect: 'bonusDamage',
          amount: { type: 'constant', value: 30 },
          perUnit: { type: 'constant', value: 1 },
          countTarget: { type: 'bench', player: 'own' },
          countProperty: 'benchCount',
        } as EffectDSL,
      ],
    },
    {
      name: 'Crown Opal',
      cost: [EnergyType.Grass, EnergyType.Water, EnergyType.Lightning],
      damage: 180,
      description: 'During your opponent\'s next turn, prevent all damage done to this Pokemon by attacks from Basic Pokemon that aren\'t Colorless.',
      effects: [
        {
          effect: 'preventDamage',
          target: { type: 'self' },
          amount: 'all',
          duration: 'nextTurn',
        } as EffectDSL,
      ],
    },
  ],
};

const PIDGEY: PokemonCard = {
  id: 'pidgey-obf-162',
  name: 'Pidgey',
  cardType: CardType.Pokemon,
  cardNumber: 'OBF 162',
  imageUrl: 'https://images.pokemontcg.io/sv3/162.png',
  hp: 60,
  stage: PokemonStage.Basic,
  type: EnergyType.Colorless,
  weakness: EnergyType.Lightning,
  resistance: EnergyType.Fighting,
  resistanceValue: -30,
  retreatCost: 1,
  prizeCards: 1,
  isRulebox: false,
  attacks: [
    {
      name: 'Flap',
      cost: [EnergyType.Colorless],
      damage: 20,
      description: 'Deal 20 damage.',
    },
  ],
};

const PIDGEOTTO: PokemonCard = {
  id: 'pidgeotto-mew-17',
  name: 'Pidgeotto',
  cardType: CardType.Pokemon,
  cardNumber: 'MEW 17',
  imageUrl: 'https://images.pokemontcg.io/sv3pt5/17.png',
  hp: 80,
  stage: PokemonStage.Stage1,
  type: EnergyType.Colorless,
  weakness: EnergyType.Lightning,
  resistance: EnergyType.Fighting,
  resistanceValue: -30,
  retreatCost: 1,
  evolvesFrom: 'Pidgey',
  prizeCards: 1,
  isRulebox: false,
  attacks: [
    {
      name: 'Gust',
      cost: [EnergyType.Colorless, EnergyType.Colorless],
      damage: 30,
      description: 'Deal 30 damage.',
    },
  ],
};

const PIDGEOT_EX: PokemonCard = {
  id: 'pidgeot-ex-obf-164',
  name: 'Pidgeot ex',
  cardType: CardType.Pokemon,
  cardNumber: 'OBF 164',
  imageUrl: 'https://images.pokemontcg.io/sv3/164.png',
  hp: 280,
  stage: PokemonStage.Stage2,
  type: EnergyType.Colorless,
  weakness: EnergyType.Lightning,
  resistance: EnergyType.Fighting,
  resistanceValue: -30,
  retreatCost: 0,
  evolvesFrom: 'Pidgeotto',
  prizeCards: 2,
  isRulebox: true,
  ability: {
    name: 'Quick Search',
    type: 'ability',
    trigger: 'oncePerTurn',
    description:
      'Once during your turn, you may search your deck for any 1 card, reveal it, and put it into your hand. Then, shuffle your deck.',
    effects: [
      { effect: 'search', player: 'own', from: 'deck', count: { type: 'constant', value: 1 }, destination: 'hand' },
      { effect: 'shuffle', player: 'own', zone: 'deck' },
    ],
  },
  attacks: [
    {
      name: 'Blustering Gale',
      cost: [EnergyType.Colorless, EnergyType.Colorless, EnergyType.Colorless],
      damage: 0,
      description: 'This attack does 120 damage to 1 of your opponent\'s Benched Pokemon.',
      effects: [
        {
          effect: 'damage',
          target: { type: 'anyPokemon', player: 'opponent' },
          amount: { type: 'constant', value: 120 },
        } as EffectDSL,
      ],
    },
  ],
};

const KLEFKI: PokemonCard = {
  id: 'klefki-svi-96',
  name: 'Klefki',
  cardType: CardType.Pokemon,
  cardNumber: 'SVI 96',
  imageUrl: 'https://images.pokemontcg.io/sv1/96.png',
  hp: 70,
  stage: PokemonStage.Basic,
  type: EnergyType.Psychic,
  weakness: EnergyType.Metal,
  retreatCost: 1,
  prizeCards: 1,
  isRulebox: false,
  ability: {
    name: 'Mischievous Lock',
    type: 'pokebody',
    trigger: 'passive',
    description:
      'As long as this Pokemon is your Active Pokemon, the Abilities of all Basic Pokemon (both yours and your opponent\'s) except Mischievous Lock are nullified.',
    effects: [{ effect: 'noop' }],
  },
  attacks: [
    {
      name: 'Joust',
      cost: [EnergyType.Colorless],
      damage: 10,
      description: 'Discard any number of Trainer cards from your opponent\'s Active Pokemon. Then, this attack does 10 damage.',
    },
  ],
};

const FEZANDIPITI_EX: PokemonCard = {
  id: 'fezandipiti-ex-sfa-38',
  name: 'Fezandipiti ex',
  cardType: CardType.Pokemon,
  cardNumber: 'SFA 38',
  imageUrl: 'https://images.pokemontcg.io/sv6pt5/38.png',
  hp: 210,
  stage: PokemonStage.Basic,
  type: EnergyType.Dark,
  weakness: EnergyType.Fighting,
  retreatCost: 1,
  prizeCards: 2,
  isRulebox: true,
  ability: {
    name: 'Flip the Script',
    type: 'ability',
    trigger: 'oncePerTurn',
    description:
      'Once during your turn, if your Active Pokemon was Knocked Out by damage from an opponent\'s attack during their last turn, you may draw 3 cards. (You can\'t use more than 1 Flip the Script Ability during your turn.)',
    abilityCondition: { check: 'hasGameFlag', flag: 'activeKnockedOut-{player}', player: 'own' },
    effects: [
      { effect: 'draw', player: 'own', count: { type: 'constant', value: 3 } },
    ],
  },
  attacks: [
    {
      name: 'Cruel Arrow',
      cost: [EnergyType.Colorless, EnergyType.Colorless, EnergyType.Colorless],
      damage: 0,
      description: 'This attack does 100 damage to 1 of your opponent\'s Pokemon.',
      effects: [
        { effect: 'damage', target: { type: 'anyPokemon', player: 'opponent' }, amount: { type: 'constant', value: 100 } },
      ],
    },
  ],
};

// ============================================================================
// TRAINER CARDS (13 total)
// ============================================================================

const DAWN: TrainerCard = {
  id: 'dawn-pfl-87',
  name: 'Dawn',
  cardType: CardType.Trainer,
  cardNumber: 'PFL 87',
  imageUrl: 'https://images.pokemontcg.io/me2/87_hires.png',
  trainerType: TrainerType.Supporter,
  effects: [
    { effect: 'search', player: 'own', from: 'deck', filter: { filter: 'stage', stage: PokemonStage.Basic }, count: { type: 'constant', value: 1 }, destination: 'hand' },
    { effect: 'search', player: 'own', from: 'deck', filter: { filter: 'stage', stage: PokemonStage.Stage1 }, count: { type: 'constant', value: 1 }, destination: 'hand' },
    { effect: 'search', player: 'own', from: 'deck', filter: { filter: 'or', filters: [{ filter: 'stage', stage: PokemonStage.Stage2 }, { filter: 'stage', stage: PokemonStage.ex }] }, count: { type: 'constant', value: 1 }, destination: 'hand' },
    { effect: 'shuffle', player: 'own', zone: 'deck' },
  ],
};

const IONO: TrainerCard = {
  id: 'iono-pal-185',
  name: 'Iono',
  cardType: CardType.Trainer,
  cardNumber: 'PAL 185',
  imageUrl: 'https://images.pokemontcg.io/sv2/185.png',
  trainerType: TrainerType.Supporter,
  effects: [
    { effect: 'shuffleHandIntoDeck', player: 'own' },
    { effect: 'draw', player: 'own', count: { type: 'countPrizeCards', player: 'own' } },
    { effect: 'shuffleHandIntoDeck', player: 'opponent' },
    { effect: 'draw', player: 'opponent', count: { type: 'countPrizeCards', player: 'opponent' } },
  ],
};

const BOSSS_ORDERS: TrainerCard = {
  id: 'bosss-orders-meg-114',
  name: 'Boss\'s Orders',
  cardType: CardType.Trainer,
  cardNumber: 'PAL 172',
  imageUrl: 'https://images.pokemontcg.io/sv2/172.png',
  trainerType: TrainerType.Supporter,
  effects: [
    { effect: 'forceSwitch', player: 'opponent' },
  ],
};

const BRIAR: TrainerCard = {
  id: 'briar-scr-132',
  name: 'Briar',
  cardType: CardType.Trainer,
  cardNumber: 'SCR 132',
  imageUrl: 'https://images.pokemontcg.io/sv7/132.png',
  trainerType: TrainerType.Supporter,
  playCondition: { check: 'prizeCount', player: 'opponent', comparison: '==', value: 2 },
  effects: [
    { effect: 'addGameFlag', flag: 'briarExtraPrize', duration: 'nextTurn' },
  ],
};

const BUDDY_BUDDY_POFFIN: TrainerCard = {
  id: 'buddy-buddy-poffin-tef-144',
  name: 'Buddy-Buddy Poffin',
  cardType: CardType.Trainer,
  cardNumber: 'TEF 144',
  imageUrl: 'https://images.pokemontcg.io/sv5/144.png',
  trainerType: TrainerType.Item,
  effects: [
    { effect: 'search', player: 'own', from: 'deck', filter: { filter: 'and', filters: [{ filter: 'isBasic' }, { filter: 'hpBelow', maxHp: 70 }] }, count: { type: 'constant', value: 2 }, destination: 'bench' },
    { effect: 'shuffle', player: 'own', zone: 'deck' },
  ],
};

const RARE_CANDY: TrainerCard = {
  id: 'rare-candy-meg-125',
  name: 'Rare Candy',
  cardType: CardType.Trainer,
  cardNumber: 'SVI 191',
  imageUrl: 'https://images.pokemontcg.io/sv1/191.png', // Scarlet & Violet Rare Candy
  trainerType: TrainerType.Item,
  effects: [
    { effect: 'rareCandy' },
  ],
};

const NEST_BALL: TrainerCard = {
  id: 'nest-ball-svi-181',
  name: 'Nest Ball',
  cardType: CardType.Trainer,
  cardNumber: 'SVI 181',
  imageUrl: 'https://images.pokemontcg.io/sv1/181.png',
  trainerType: TrainerType.Item,
  effects: [
    { effect: 'search', player: 'own', from: 'deck', filter: { filter: 'isBasic' }, count: { type: 'constant', value: 1 }, destination: 'bench' },
    { effect: 'shuffle', player: 'own', zone: 'deck' },
  ],
};

const PRIME_CATCHER: TrainerCard = {
  id: 'prime-catcher-tef-157',
  name: 'Prime Catcher',
  cardType: CardType.Trainer,
  cardNumber: 'TEF 157',
  imageUrl: 'https://images.pokemontcg.io/sv5/157.png',
  trainerType: TrainerType.Item,
  effects: [
    { effect: 'forceSwitch', player: 'opponent' },
  ],
};

const SUPER_ROD: TrainerCard = {
  id: 'super-rod-pal-188',
  name: 'Super Rod',
  cardType: CardType.Trainer,
  cardNumber: 'PAL 188',
  imageUrl: 'https://images.pokemontcg.io/sv2/188.png',
  trainerType: TrainerType.Item,
  effects: [
    { effect: 'search', player: 'own', from: 'discard', filter: { filter: 'or', filters: [{ filter: 'type', cardType: CardType.Pokemon }, { filter: 'basicEnergy' }] }, count: { type: 'constant', value: 3 }, destination: 'deck' },
    { effect: 'shuffle', player: 'own', zone: 'deck' },
  ],
};

const NIGHT_STRETCHER: TrainerCard = {
  id: 'night-stretcher-sfa-61',
  name: 'Night Stretcher',
  cardType: CardType.Trainer,
  cardNumber: 'SFA 61',
  imageUrl: 'https://images.pokemontcg.io/sv6pt5/61.png',
  trainerType: TrainerType.Item,
  effects: [
    { effect: 'search', player: 'own', from: 'discard', filter: { filter: 'or', filters: [{ filter: 'type', cardType: CardType.Pokemon }, { filter: 'basicEnergy' }] }, count: { type: 'constant', value: 1 }, destination: 'hand' },
  ],
};

const ULTRA_BALL: TrainerCard = {
  id: 'ultra-ball-meg-131',
  name: 'Ultra Ball',
  cardType: CardType.Trainer,
  cardNumber: 'SVI 196',
  imageUrl: 'https://images.pokemontcg.io/sv1/196.png',
  trainerType: TrainerType.Item,
  effects: [
    { effect: 'discardFromHand', player: 'own', count: { type: 'constant', value: 2 } },
    { effect: 'search', player: 'own', from: 'deck', filter: { filter: 'type', cardType: CardType.Pokemon }, count: { type: 'constant', value: 1 }, destination: 'hand' },
    { effect: 'shuffle', player: 'own', zone: 'deck' },
  ],
};

const AREA_ZERO_UNDERDEPTHS: TrainerCard = {
  id: 'area-zero-underdepths-scr-131',
  name: 'Area Zero Underdepths',
  cardType: CardType.Trainer,
  cardNumber: 'SCR 131',
  imageUrl: 'https://images.pokemontcg.io/sv7/131.png',
  trainerType: TrainerType.Stadium,
  effects: [
    { effect: 'noop' },
  ],
};

// ============================================================================
// ENERGY CARDS (2 types, 4 Fire + 4 Colorless = 8 total)
// ============================================================================

const FIRE_ENERGY: EnergyCard = {
  id: 'fire-energy-basic',
  name: 'Fire Energy',
  cardType: CardType.Energy,
  cardNumber: 'ENERGY',
  imageUrl: 'https://images.pokemontcg.io/sve/2.png',
  energySubtype: EnergySubtype.Basic,
  energyType: EnergyType.Fire,
  provides: [EnergyType.Fire],
};

const JET_ENERGY: EnergyCard = {
  id: 'jet-energy-pal-190',
  name: 'Jet Energy',
  cardType: CardType.Energy,
  cardNumber: 'PAL 190',
  imageUrl: 'https://images.pokemontcg.io/sv2/190.png',
  energySubtype: EnergySubtype.Special,
  energyType: EnergyType.Colorless,
  provides: [EnergyType.Colorless],
};

// ============================================================================
// DECK DEFINITION (60 CARDS)
// ============================================================================

export const CHARIZARD_DECK_CARDS: Map<string, CardDefinition> = new Map([
  // Pokemon (15 unique, 20 copies)
  ['hoothoot-scr-114', { pokemon: HOOTHOOT }],
  ['noctowl-scr-115', { pokemon: NOCTOWL }],
  ['charmander-paf-7', { pokemon: CHARMANDER_PAF }],
  ['charmander-pfl-11', { pokemon: CHARMANDER_PFL }],
  ['charmeleon-pfl-12', { pokemon: CHARMELEON }],
  ['charizard-ex-obf-125', { pokemon: CHARIZARD_EX }],
  ['duskull-pre-35', { pokemon: DUSKULL }],
  ['dusclops-pre-36', { pokemon: DUSCLOPS }],
  ['dusknoir-pre-37', { pokemon: DUSKNOIR }],
  ['fan-rotom-scr-118', { pokemon: FAN_ROTOM }],
  ['terapagos-ex-scr-128', { pokemon: TERAPAGOS_EX }],
  ['pidgey-obf-162', { pokemon: PIDGEY }],
  ['pidgeotto-mew-17', { pokemon: PIDGEOTTO }],
  ['pidgeot-ex-obf-164', { pokemon: PIDGEOT_EX }],
  ['klefki-svi-96', { pokemon: KLEFKI }],
  ['fezandipiti-ex-sfa-38', { pokemon: FEZANDIPITI_EX }],

  // Trainers (13 unique, 19 copies)
  ['dawn-pfl-87', { trainer: DAWN }],
  ['iono-pal-185', { trainer: IONO }],
  ['bosss-orders-meg-114', { trainer: BOSSS_ORDERS }],
  ['briar-scr-132', { trainer: BRIAR }],
  ['buddy-buddy-poffin-tef-144', { trainer: BUDDY_BUDDY_POFFIN }],
  ['rare-candy-meg-125', { trainer: RARE_CANDY }],
  ['nest-ball-svi-181', { trainer: NEST_BALL }],
  ['prime-catcher-tef-157', { trainer: PRIME_CATCHER }],
  ['super-rod-pal-188', { trainer: SUPER_ROD }],
  ['night-stretcher-sfa-61', { trainer: NIGHT_STRETCHER }],
  ['ultra-ball-meg-131', { trainer: ULTRA_BALL }],
  ['area-zero-underdepths-scr-131', { trainer: AREA_ZERO_UNDERDEPTHS }],

  // Energy (2 types, 21 copies)
  ['fire-energy', { energy: FIRE_ENERGY }],
  ['jet-energy-pal-190', { energy: JET_ENERGY }],
]);

/**
 * Build a complete 60-card Charizard ex deck.
 * Deck List:
 * - 1x Hoothoot SCR 114
 * - 1x Noctowl SCR 115
 * - 2x Charmander PAF 7
 * - 2x Charmander PFL 11
 * - 1x Charmeleon PFL 12
 * - 2x Charizard ex OBF 125
 * - 1x Duskull PRE 35
 * - 1x Dusclops PRE 36
 * - 1x Dusknoir PRE 37
 * - 2x Fan Rotom SCR 118
 * - 2x Terapagos ex SCR 128
 * - 2x Pidgey OBF 162
 * - 1x Pidgeotto MEW 17
 * - 1x Pidgeot ex OBF 164
 * - 1x Klefki SVI 96
 * - 1x Fezandipiti ex SFA 38
 * - 2x Dawn PFL 87
 * - 2x Iono PAL 185
 * - 2x Boss's Orders MEG 114
 * - 1x Briar SCR 132
 * - 2x Buddy-Buddy Poffin TEF 144
 * - 3x Rare Candy MEG 125
 * - 3x Nest Ball SVI 181
 * - 1x Prime Catcher TEF 157 (ACE SPEC)
 * - 2x Super Rod PAL 188
 * - 1x Night Stretcher SFA 61
 * - 2x Ultra Ball MEG 131
 * - 1x Area Zero Underdepths SCR 131
 * - 4x Fire Energy
 * - 4x Jet Energy PAL 190
 */
export function buildCharizardDeck(): (PokemonCard | TrainerCard | EnergyCard)[] {
  const deck: (PokemonCard | TrainerCard | EnergyCard)[] = [];

  // Pokemon (26 cards) — matches Limitless tournament list exactly
  deck.push(HOOTHOOT, HOOTHOOT, HOOTHOOT);           // 3x Hoothoot SCR 114
  deck.push(NOCTOWL, NOCTOWL, NOCTOWL);              // 3x Noctowl SCR 115
  deck.push(CHARMANDER_PAF, CHARMANDER_PAF);          // 2x Charmander PAF 7
  deck.push(CHARMANDER_PFL);                          // 1x Charmander PFL 11
  deck.push(CHARMELEON);                              // 1x Charmeleon PFL 12
  deck.push(CHARIZARD_EX, CHARIZARD_EX);              // 2x Charizard ex OBF 125
  deck.push(DUSKULL, DUSKULL);                        // 2x Duskull PRE 35
  deck.push(DUSCLOPS);                                // 1x Dusclops PRE 36
  deck.push(DUSKNOIR);                                // 1x Dusknoir PRE 37
  deck.push(FAN_ROTOM, FAN_ROTOM);                    // 2x Fan Rotom SCR 118
  deck.push(TERAPAGOS_EX, TERAPAGOS_EX);              // 2x Terapagos ex SCR 128
  deck.push(PIDGEY);                                  // 1x Pidgey OBF 162
  deck.push(PIDGEOTTO);                               // 1x Pidgeotto MEW 17
  deck.push(PIDGEOT_EX, PIDGEOT_EX);                  // 2x Pidgeot ex OBF 164
  deck.push(KLEFKI);                                  // 1x Klefki SVI 96
  deck.push(FEZANDIPITI_EX);                          // 1x Fezandipiti ex SFA 38

  // Trainers (27 cards)
  deck.push(DAWN, DAWN, DAWN, DAWN);                  // 4x Dawn PFL 87
  deck.push(IONO, IONO);                              // 2x Iono PAL 185
  deck.push(BOSSS_ORDERS, BOSSS_ORDERS);              // 2x Boss's Orders MEG 114
  deck.push(BRIAR);                                   // 1x Briar SCR 132
  deck.push(BUDDY_BUDDY_POFFIN, BUDDY_BUDDY_POFFIN,
            BUDDY_BUDDY_POFFIN, BUDDY_BUDDY_POFFIN);  // 4x Buddy-Buddy Poffin TEF 144
  deck.push(RARE_CANDY, RARE_CANDY,
            RARE_CANDY, RARE_CANDY);                   // 4x Rare Candy MEG 125
  deck.push(NEST_BALL, NEST_BALL,
            NEST_BALL, NEST_BALL);                     // 4x Nest Ball SVI 181
  deck.push(PRIME_CATCHER);                           // 1x Prime Catcher TEF 157
  deck.push(SUPER_ROD);                               // 1x Super Rod PAL 188
  deck.push(NIGHT_STRETCHER);                         // 1x Night Stretcher SFA 61
  deck.push(ULTRA_BALL);                              // 1x Ultra Ball MEG 131
  deck.push(AREA_ZERO_UNDERDEPTHS,
            AREA_ZERO_UNDERDEPTHS);                    // 2x Area Zero Underdepths SCR 131

  // Energy (7 cards)
  deck.push(
    FIRE_ENERGY, FIRE_ENERGY, FIRE_ENERGY,
    FIRE_ENERGY, FIRE_ENERGY,                          // 5x Fire Energy MEE 2
    JET_ENERGY, JET_ENERGY,                            // 2x Jet Energy PAL 190
  );

  return deck;
}

/**
 * Parse Limitless TCG deck format and convert to card array.
 *
 * Example input format:
 * Pokemon: 15
 * 1 Hoothoot SCR 114
 * 1 Noctowl SCR 115
 * ...
 * Trainers: 19
 * 2 Dawn PFL 87
 * ...
 * Energy: 21
 * 4 Fire Energy
 * 4 Jet Energy PAL 190
 */
export function parseLimitlessDeck(
  deckText: string,
  cardDatabase: Map<string, CardDefinition>
): (PokemonCard | TrainerCard | EnergyCard)[] {
  const deck: (PokemonCard | TrainerCard | EnergyCard)[] = [];
  const lines = deckText.split('\n').map((l) => l.trim());

  for (const line of lines) {
    if (!line || line.includes(':') || line.toLowerCase() === 'pokemon' || line.toLowerCase() === 'trainers' || line.toLowerCase() === 'energy') {
      continue;
    }

    // Parse "2 Card Name SET 123" format
    const match = line.match(/^(\d+)\s+(.+?)(?:\s+([A-Z0-9]+)\s+(\d+))?$/);
    if (!match) continue;

    const count = parseInt(match[1], 10);
    const cardName = match[2].trim();
    const setCode = match[3];
    const cardNum = match[4];

    // Build card key from name + set code
    let cardKey = `${cardName.toLowerCase()}-${setCode ? setCode.toLowerCase() : 'basic'}${cardNum ? '-' + cardNum : ''}`;

    // Find card in database
    let found = false;
    for (const [key, definition] of cardDatabase) {
      if (key.includes(cardName.toLowerCase())) {
        const card = definition.pokemon || definition.trainer || definition.energy;
        if (card) {
          for (let i = 0; i < count; i++) {
            deck.push(card);
          }
          found = true;
          break;
        }
      }
    }

    if (!found) {
      console.warn(`Card not found: ${cardName} ${setCode} ${cardNum}`);
    }
  }

  return deck;
}

export default {
  CHARIZARD_DECK_CARDS,
  buildCharizardDeck,
  parseLimitlessDeck,
};
