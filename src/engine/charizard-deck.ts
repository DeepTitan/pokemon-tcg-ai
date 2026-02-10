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
  PlayerState,
  GameState,
  Attack,
  Ability,
} from './types.js';

import {
  EffectDSL,
  Target,
  ValueSource,
  CardFilter,
  Condition,
} from './effects.js';

// ============================================================================
// HELPER FUNCTIONS FOR CARD EFFECTS
// ============================================================================

/** Clone a PokemonInPlay preserving card object references (which have functions) */
function clonePokemon(p: PokemonInPlay): PokemonInPlay {
  return {
    ...p,
    attachedEnergy: [...p.attachedEnergy],
    statusConditions: [...p.statusConditions],
    attachedTools: [...p.attachedTools],
    damageShields: p.damageShields.map(s => ({ ...s })),
    // card keeps its original reference (preserves ability/attack functions)
  };
}

/** Deep clone a player state preserving card function references */
function clonePlayer(state: GameState, playerIndex: number): PlayerState {
  const p = state.players[playerIndex];
  return {
    ...p,
    deck: [...p.deck],
    hand: [...p.hand],
    discard: [...p.discard],
    prizes: [...p.prizes],
    lostZone: [...p.lostZone],
    active: p.active ? clonePokemon(p.active) : null,
    bench: p.bench.map(clonePokemon),
    abilitiesUsedThisTurn: [...p.abilitiesUsedThisTurn],
  };
}

/** Update a player in state immutably */
function updatePlayer(state: GameState, playerIndex: number, player: PlayerState): GameState {
  const players = [...state.players] as [PlayerState, PlayerState];
  players[playerIndex] = player;
  return { ...state, players };
}

/** Shuffle an array in place (Fisher-Yates) */
function shuffleArray<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Search a deck for cards matching a filter, remove them, return [found, remainingDeck] */
function searchDeck(
  deck: Card[],
  filter: (card: Card) => boolean,
  count: number
): [Card[], Card[]] {
  const found: Card[] = [];
  const remaining = [...deck];
  for (let i = remaining.length - 1; i >= 0 && found.length < count; i--) {
    if (filter(remaining[i])) {
      found.push(...remaining.splice(i, 1));
    }
  }
  return [found, remaining];
}

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
    effect: (state, pokemon, playerIndex) => {
      const player = clonePlayer(state, playerIndex);
      // Check for Tera Pokemon in play (Terapagos ex counts)
      const allInPlay = [player.active, ...player.bench].filter(Boolean) as PokemonInPlay[];
      const hasTera = allInPlay.some(p => p.card.name.includes('Terapagos'));
      if (!hasTera) return state;
      // Search deck for up to 2 Trainer cards
      const [found, remaining] = searchDeck(
        player.deck,
        (c) => c.cardType === CardType.Trainer,
        2
      );
      player.deck = shuffleArray(remaining);
      player.hand.push(...found);
      let newState = updatePlayer(state, playerIndex, player);
      if (found.length > 0) {
        newState = { ...newState, gameLog: [...newState.gameLog, `${pokemon.card.name}'s Jewel Seeker finds ${found.length} Trainer card(s).`] };
      }
      return newState;
    },
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
    effect: (state, pokemon, playerIndex) => {
      const player = clonePlayer(state, playerIndex);
      // Search deck for up to 3 basic Fire Energy
      const [found, remaining] = searchDeck(
        player.deck,
        (c) => c.cardType === CardType.Energy && (c as EnergyCard).energyType === EnergyType.Fire && (c as EnergyCard).energySubtype === EnergySubtype.Basic,
        3
      );
      player.deck = shuffleArray(remaining);
      // Distribute energy: prioritize active, then bench Pokemon that need it
      const allInPlay: PokemonInPlay[] = [];
      if (player.active) allInPlay.push(player.active);
      allInPlay.push(...player.bench);
      for (const energy of found) {
        // Prefer Pokemon that need fire energy for attacks
        const target = allInPlay.find(p => p.card.type === EnergyType.Fire) || allInPlay[0];
        if (target) {
          target.attachedEnergy.push(energy as EnergyCard);
        }
      }
      let newState = updatePlayer(state, playerIndex, player);
      if (found.length > 0) {
        newState = { ...newState, gameLog: [...newState.gameLog, `Charizard ex's Infernal Reign attaches ${found.length} Fire Energy!`] };
      }
      return newState;
    },
  },
  attacks: [
    {
      name: 'Burning Darkness',
      cost: [EnergyType.Fire, EnergyType.Fire],
      damage: 180,
      description: 'This attack does 30 more damage for each Prize card your opponent has taken.',
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
      name: 'Ram',
      cost: [EnergyType.Colorless],
      damage: 10,
      description: 'Deal 10 damage.',
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
    effect: (state, _pokemon, playerIndex) => {
      const opponentIndex = playerIndex === 0 ? 1 : 0;
      const player = clonePlayer(state, playerIndex);
      const opponent = clonePlayer(state, opponentIndex);
      // Put 130 damage on opponent's active (13 damage counters = 130 damage)
      if (opponent.active) {
        opponent.active = { ...opponent.active, currentHp: Math.max(0, opponent.active.currentHp - 130) };
      }
      // KO own active Pokemon
      if (player.active) {
        player.active = { ...player.active, currentHp: 0 };
      }
      let newState = { ...state };
      newState.players[playerIndex] = player;
      newState.players[opponentIndex] = opponent;
      newState = { ...newState, gameLog: [...newState.gameLog, `Dusknoir's Cursed Blast places 130 damage on opponent's active!`] };
      return newState;
    },
  },
  attacks: [
    {
      name: 'Shadow Bind',
      cost: [EnergyType.Psychic, EnergyType.Psychic, EnergyType.Colorless],
      damage: 150,
      description: 'During your opponent\'s next turn, the Defending Pokemon cannot retreat.',
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
    trigger: 'onPlay',
    description:
      'When you play this Pokemon from your hand onto your Bench during your first turn, you may search your deck for up to 3 Pokemon with 100 HP or less that are Colorless and put them into your hand. Then, shuffle your deck. (You can\'t use more than 1 Fan Call Ability during your turn.)',
    effect: (state, _pokemon, playerIndex) => {
      // Only works on first turn
      if (state.turnNumber > 2) return state;
      const player = clonePlayer(state, playerIndex);
      const [found, remaining] = searchDeck(
        player.deck,
        (c) => c.cardType === CardType.Pokemon && (c as PokemonCard).hp <= 100 && (c as PokemonCard).type === EnergyType.Colorless,
        3
      );
      player.deck = shuffleArray(remaining);
      player.hand.push(...found);
      let newState = updatePlayer(state, playerIndex, player);
      if (found.length > 0) {
        newState = { ...newState, gameLog: [...newState.gameLog, `Fan Rotom's Fan Call finds ${found.length} Pokemon!`] };
      }
      return newState;
    },
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
  attacks: [
    {
      name: 'Unified Beatdown',
      cost: [EnergyType.Colorless, EnergyType.Colorless],
      damage: 30,
      description: 'This attack does 30 damage for each Benched Pokemon you have. (This attack can\'t be used if you went second and it\'s your first turn.)',
    },
    {
      name: 'Crown Opal',
      cost: [EnergyType.Grass, EnergyType.Water, EnergyType.Lightning],
      damage: 180,
      description: 'During your opponent\'s next turn, prevent all damage done to this Pokemon by attacks from Basic Pokemon that aren\'t Colorless.',
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
    effect: (state, _pokemon, playerIndex) => {
      const player = clonePlayer(state, playerIndex);
      if (player.deck.length === 0) return state;
      // AI heuristic: search for most needed card
      // Priority: energy if active needs it, evolution cards, then trainers
      let foundIndex = -1;
      const active = player.active;
      // 1. Look for fire energy if active needs it
      if (active && active.card.type === EnergyType.Fire) {
        foundIndex = player.deck.findIndex(c => c.cardType === CardType.Energy && (c as EnergyCard).energyType === EnergyType.Fire);
      }
      // 2. Look for Rare Candy or evolution cards
      if (foundIndex < 0) {
        foundIndex = player.deck.findIndex(c => c.cardType === CardType.Trainer && c.name === 'Rare Candy');
      }
      // 3. Look for any Supporter
      if (foundIndex < 0) {
        foundIndex = player.deck.findIndex(c => c.cardType === CardType.Trainer && (c as TrainerCard).trainerType === TrainerType.Supporter);
      }
      // 4. Just take the first card
      if (foundIndex < 0) foundIndex = 0;
      const found = player.deck.splice(foundIndex, 1);
      player.deck = shuffleArray(player.deck);
      player.hand.push(...found);
      let newState = updatePlayer(state, playerIndex, player);
      newState = { ...newState, gameLog: [...newState.gameLog, `Pidgeot ex's Quick Search finds ${found[0]?.name || 'a card'}.`] };
      return newState;
    },
  },
  attacks: [
    {
      name: 'Blustering Gale',
      cost: [EnergyType.Colorless, EnergyType.Colorless, EnergyType.Colorless],
      damage: 120,
      description: 'This attack does 120 damage to 1 of your opponent\'s Benched Pokemon.',
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
    effect: (state, _pokemon, _playerIndex) => {
      // Passive ability - checked during ability resolution
      return state;
    },
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
    effect: (state, _pokemon, playerIndex) => {
      // Simplified: draw 3 cards (condition check would need KO tracking)
      const player = clonePlayer(state, playerIndex);
      const drawn = player.deck.splice(0, Math.min(3, player.deck.length));
      player.hand.push(...drawn);
      let newState = updatePlayer(state, playerIndex, player);
      newState = { ...newState, gameLog: [...newState.gameLog, `Fezandipiti ex's Flip the Script draws ${drawn.length} cards.`] };
      return newState;
    },
  },
  attacks: [
    {
      name: 'Cruel Arrow',
      cost: [EnergyType.Colorless, EnergyType.Colorless, EnergyType.Colorless],
      damage: 0,
      description: 'This attack does 100 damage to 1 of your opponent\'s Pokemon.',
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
  imageUrl: 'https://images.pokemontcg.io/dp5/79.png', // Dawn Stadium placeholder (Dawn Supporter not in API yet)
  trainerType: TrainerType.Supporter,
  effect: (state, playerIndex) => {
    const player = clonePlayer(state, playerIndex);
    // Search deck for 1 Basic, 1 Stage 1, 1 Stage 2
    const [basics, deck1] = searchDeck(player.deck, (c) => c.cardType === CardType.Pokemon && (c as PokemonCard).stage === PokemonStage.Basic, 1);
    const [stage1s, deck2] = searchDeck(deck1, (c) => c.cardType === CardType.Pokemon && (c as PokemonCard).stage === PokemonStage.Stage1, 1);
    const [stage2s, deck3] = searchDeck(deck2, (c) => c.cardType === CardType.Pokemon && ((c as PokemonCard).stage === PokemonStage.Stage2 || (c as PokemonCard).stage === PokemonStage.ex), 1);
    player.deck = shuffleArray(deck3);
    const found = [...basics, ...stage1s, ...stage2s];
    player.hand.push(...found);
    let newState = updatePlayer(state, playerIndex, player);
    if (found.length > 0) {
      newState = { ...newState, gameLog: [...newState.gameLog, `Dawn searches for ${found.map(c => c.name).join(', ')}.`] };
    }
    return newState;
  },
};

const IONO: TrainerCard = {
  id: 'iono-pal-185',
  name: 'Iono',
  cardType: CardType.Trainer,
  cardNumber: 'PAL 185',
  imageUrl: 'https://images.pokemontcg.io/sv2/185.png',
  trainerType: TrainerType.Supporter,
  effect: (state, playerIndex) => {
    const opponentIndex = playerIndex === 0 ? 1 : 0;
    const player = clonePlayer(state, playerIndex);
    const opponent = clonePlayer(state, opponentIndex);
    // Both players shuffle hand into deck, then draw cards equal to remaining prizes
    player.deck.push(...player.hand);
    player.hand = [];
    player.deck = shuffleArray(player.deck);
    const playerDraw = Math.min(player.prizeCardsRemaining, player.deck.length);
    player.hand = player.deck.splice(0, playerDraw);

    opponent.deck.push(...opponent.hand);
    opponent.hand = [];
    opponent.deck = shuffleArray(opponent.deck);
    const opponentDraw = Math.min(opponent.prizeCardsRemaining, opponent.deck.length);
    opponent.hand = opponent.deck.splice(0, opponentDraw);

    let newState = { ...state };
    newState.players[playerIndex] = player;
    newState.players[opponentIndex] = opponent;
    newState = { ...newState, gameLog: [...newState.gameLog, `Iono! Both players shuffle hands and draw by prizes. P${playerIndex} draws ${playerDraw}, P${opponentIndex} draws ${opponentDraw}.`] };
    return newState;
  },
};

const BOSSS_ORDERS: TrainerCard = {
  id: 'bosss-orders-meg-114',
  name: 'Boss\'s Orders',
  cardType: CardType.Trainer,
  cardNumber: 'PAL 172',
  imageUrl: 'https://images.pokemontcg.io/sv2/172.png', // Paldea Evolved Boss's Orders
  trainerType: TrainerType.Supporter,
  effect: (state, playerIndex) => {
    const opponentIndex = playerIndex === 0 ? 1 : 0;
    const opponent = clonePlayer(state, opponentIndex);
    if (!opponent.active || opponent.bench.length === 0) return state;
    // AI heuristic: pull weakest bench Pokemon to active (easiest KO)
    let bestIdx = 0;
    let lowestHp = Infinity;
    for (let i = 0; i < opponent.bench.length; i++) {
      if (opponent.bench[i].currentHp < lowestHp) {
        lowestHp = opponent.bench[i].currentHp;
        bestIdx = i;
      }
    }
    const oldActive = opponent.active;
    opponent.active = opponent.bench[bestIdx];
    opponent.bench[bestIdx] = oldActive;
    let newState = updatePlayer(state, opponentIndex, opponent);
    newState = { ...newState, gameLog: [...newState.gameLog, `Boss's Orders forces ${opponent.active.card.name} to the active spot!`] };
    return newState;
  },
};

const BRIAR: TrainerCard = {
  id: 'briar-scr-132',
  name: 'Briar',
  cardType: CardType.Trainer,
  cardNumber: 'SCR 132',
  imageUrl: 'https://images.pokemontcg.io/sv7/132.png',
  trainerType: TrainerType.Supporter,
  effect: (state, _playerIndex) => {
    // Briar sets a flag: next KO by Tera Pokemon gives +1 prize
    // Simplified: just add a game flag (actual prize bonus would need more tracking)
    return {
      ...state,
      gameFlags: [...state.gameFlags, {
        flag: 'briarExtraPrize',
        duration: 'nextTurn' as const,
        setOnTurn: state.turnNumber,
        setByPlayer: state.currentPlayer,
      }],
      gameLog: [...state.gameLog, 'Briar is in effect! Next Tera Pokemon KO grants an extra prize.'],
    };
  },
};

const BUDDY_BUDDY_POFFIN: TrainerCard = {
  id: 'buddy-buddy-poffin-tef-144',
  name: 'Buddy-Buddy Poffin',
  cardType: CardType.Trainer,
  cardNumber: 'TEF 144',
  imageUrl: 'https://images.pokemontcg.io/sv5/144.png',
  trainerType: TrainerType.Item,
  effect: (state, playerIndex) => {
    const player = clonePlayer(state, playerIndex);
    const benchSpace = 5 - player.bench.length;
    if (benchSpace <= 0) return state;
    // Search deck for up to 2 Basic Pokemon with 70 HP or less
    const [found, remaining] = searchDeck(
      player.deck,
      (c) => c.cardType === CardType.Pokemon && (c as PokemonCard).stage === PokemonStage.Basic && (c as PokemonCard).hp <= 70,
      Math.min(2, benchSpace)
    );
    player.deck = shuffleArray(remaining);
    // Place found Pokemon on bench
    for (const card of found) {
      const pokemon = card as PokemonCard;
      player.bench.push({
        card: pokemon,
        currentHp: pokemon.hp,
        attachedEnergy: [],
        statusConditions: [],
        damageCounters: 0,
        attachedTools: [],
        isEvolved: false,
        damageShields: [],
        cannotRetreat: false,
      });
    }
    let newState = updatePlayer(state, playerIndex, player);
    if (found.length > 0) {
      newState = { ...newState, gameLog: [...newState.gameLog, `Buddy-Buddy Poffin finds ${found.map(c => c.name).join(', ')} and puts them on bench!`] };
    }
    return newState;
  },
};

const RARE_CANDY: TrainerCard = {
  id: 'rare-candy-meg-125',
  name: 'Rare Candy',
  cardType: CardType.Trainer,
  cardNumber: 'SVI 191',
  imageUrl: 'https://images.pokemontcg.io/sv1/191.png', // Scarlet & Violet Rare Candy
  trainerType: TrainerType.Item,
  effect: (state, playerIndex) => {
    if (state.turnNumber <= 1) return state; // Can't evolve turn 1
    const player = clonePlayer(state, playerIndex);
    // Find a Stage 2 (or ex that evolves from Stage 1) in hand
    const stage2InHand = player.hand.filter(c =>
      c.cardType === CardType.Pokemon && (
        (c as PokemonCard).stage === PokemonStage.Stage2 ||
        ((c as PokemonCard).stage === PokemonStage.ex && (c as PokemonCard).evolvesFrom)
      )
    ) as PokemonCard[];
    for (const stage2 of stage2InHand) {
      // Find the Stage 1 it evolves from
      const stage1Name = stage2.evolvesFrom;
      if (!stage1Name) continue;
      // Find what Basic the Stage 1 evolves from (check card database)
      // For Charizard ex: evolvesFrom Charmeleon, which evolvesFrom Charmander
      // For Pidgeot ex: evolvesFrom Pidgeotto, which evolvesFrom Pidgey
      // For Dusknoir: evolvesFrom Dusclops, which evolvesFrom Duskull
      // We need to find a Basic Pokemon in play that matches the evolution chain
      const allInPlay: { pokemon: PokemonInPlay; zone: 'active' | 'bench'; index: number }[] = [];
      if (player.active && player.active.card.stage === PokemonStage.Basic && !player.active.isEvolved) {
        allInPlay.push({ pokemon: player.active, zone: 'active', index: -1 });
      }
      player.bench.forEach((p, i) => {
        if (p.card.stage === PokemonStage.Basic && !p.isEvolved) {
          allInPlay.push({ pokemon: p, zone: 'bench', index: i });
        }
      });
      // Check if any Basic in play is part of the evolution chain
      // The chain is: Basic -> Stage1 (stage1Name) -> Stage2 (stage2)
      // We need to know what the Stage1 evolves from
      const stage1Cards = [CHARMELEON, DUSCLOPS, PIDGEOTTO];
      const stage1Card = stage1Cards.find(s1 => s1.name === stage1Name);
      if (!stage1Card || !stage1Card.evolvesFrom) continue;
      const basicName = stage1Card.evolvesFrom;
      const target = allInPlay.find(p => p.pokemon.card.name === basicName);
      if (!target) continue;
      // Evolve! Remove stage2 from hand, evolve basic to stage2
      const handIdx = player.hand.indexOf(stage2);
      if (handIdx < 0) continue;
      player.hand.splice(handIdx, 1);
      const evolved: PokemonInPlay = {
        ...target.pokemon,
        card: stage2,
        currentHp: target.pokemon.currentHp + (stage2.hp - target.pokemon.card.hp),
        isEvolved: true,
        previousStage: target.pokemon,
        statusConditions: [],
        cannotRetreat: false,
      };
      evolved.currentHp = Math.min(evolved.currentHp, stage2.hp);
      if (target.zone === 'active') {
        player.active = evolved;
      } else {
        player.bench[target.index] = evolved;
      }
      let newState = updatePlayer(state, playerIndex, player);
      newState = { ...newState, gameLog: [...newState.gameLog, `Rare Candy evolves ${basicName} directly to ${stage2.name}!`] };
      // Trigger on-evolve ability
      if (stage2.ability && stage2.ability.trigger === 'onEvolve') {
        newState = { ...newState, gameLog: [...newState.gameLog, `${stage2.name}'s ${stage2.ability.name} activates!`] };
        newState = stage2.ability.effect(newState, evolved, playerIndex);
      }
      return newState;
    }
    return state; // No valid target found
  },
};

const NEST_BALL: TrainerCard = {
  id: 'nest-ball-svi-181',
  name: 'Nest Ball',
  cardType: CardType.Trainer,
  cardNumber: 'SVI 181',
  imageUrl: 'https://images.pokemontcg.io/sv1/181.png',
  trainerType: TrainerType.Item,
  effect: (state, playerIndex) => {
    const player = clonePlayer(state, playerIndex);
    if (player.bench.length >= 5) return state;
    // Search deck for 1 Basic Pokemon, put on bench
    const [found, remaining] = searchDeck(
      player.deck,
      (c) => c.cardType === CardType.Pokemon && (c as PokemonCard).stage === PokemonStage.Basic,
      1
    );
    player.deck = shuffleArray(remaining);
    for (const card of found) {
      const pokemon = card as PokemonCard;
      player.bench.push({
        card: pokemon,
        currentHp: pokemon.hp,
        attachedEnergy: [],
        statusConditions: [],
        damageCounters: 0,
        attachedTools: [],
        isEvolved: false,
        damageShields: [],
        cannotRetreat: false,
      });
    }
    let newState = updatePlayer(state, playerIndex, player);
    if (found.length > 0) {
      newState = { ...newState, gameLog: [...newState.gameLog, `Nest Ball finds ${found[0].name} and puts it on bench.`] };
    }
    return newState;
  },
};

const PRIME_CATCHER: TrainerCard = {
  id: 'prime-catcher-tef-157',
  name: 'Prime Catcher',
  cardType: CardType.Trainer,
  cardNumber: 'TEF 157',
  imageUrl: 'https://images.pokemontcg.io/sv5/157.png',
  trainerType: TrainerType.Item,
  effect: (state, playerIndex) => {
    const opponentIndex = playerIndex === 0 ? 1 : 0;
    const opponent = clonePlayer(state, opponentIndex);
    if (!opponent.active || opponent.bench.length === 0) return state;
    // AI: pull weakest bench Pokemon to active
    let bestIdx = 0;
    let lowestHp = Infinity;
    for (let i = 0; i < opponent.bench.length; i++) {
      if (opponent.bench[i].currentHp < lowestHp) {
        lowestHp = opponent.bench[i].currentHp;
        bestIdx = i;
      }
    }
    const oldActive = opponent.active;
    opponent.active = opponent.bench[bestIdx];
    opponent.bench[bestIdx] = oldActive;
    let newState = updatePlayer(state, opponentIndex, opponent);
    newState = { ...newState, gameLog: [...newState.gameLog, `Prime Catcher forces ${opponent.active.card.name} to the active spot!`] };
    return newState;
  },
};

const SUPER_ROD: TrainerCard = {
  id: 'super-rod-pal-188',
  name: 'Super Rod',
  cardType: CardType.Trainer,
  cardNumber: 'PAL 188',
  imageUrl: 'https://images.pokemontcg.io/sv2/188.png',
  trainerType: TrainerType.Item,
  effect: (state, playerIndex) => {
    const player = clonePlayer(state, playerIndex);
    // Recover up to 3 Pokemon and/or basic Energy from discard into deck
    const recovered: Card[] = [];
    const newDiscard = [...player.discard];
    let count = 0;
    for (let i = newDiscard.length - 1; i >= 0 && count < 3; i--) {
      const card = newDiscard[i];
      if (card.cardType === CardType.Pokemon || (card.cardType === CardType.Energy && (card as EnergyCard).energySubtype === EnergySubtype.Basic)) {
        recovered.push(...newDiscard.splice(i, 1));
        count++;
      }
    }
    player.discard = newDiscard;
    player.deck.push(...recovered);
    player.deck = shuffleArray(player.deck);
    let newState = updatePlayer(state, playerIndex, player);
    if (recovered.length > 0) {
      newState = { ...newState, gameLog: [...newState.gameLog, `Super Rod recovers ${recovered.map(c => c.name).join(', ')} into deck.`] };
    }
    return newState;
  },
};

const NIGHT_STRETCHER: TrainerCard = {
  id: 'night-stretcher-sfa-61',
  name: 'Night Stretcher',
  cardType: CardType.Trainer,
  cardNumber: 'SFA 61',
  imageUrl: 'https://images.pokemontcg.io/sv6pt5/61.png',
  trainerType: TrainerType.Item,
  effect: (state, playerIndex) => {
    const player = clonePlayer(state, playerIndex);
    // Recover 1 Pokemon or 1 basic Energy from discard to hand
    const idx = player.discard.findIndex(c =>
      c.cardType === CardType.Pokemon ||
      (c.cardType === CardType.Energy && (c as EnergyCard).energySubtype === EnergySubtype.Basic)
    );
    if (idx < 0) return state;
    const recovered = player.discard.splice(idx, 1);
    player.hand.push(...recovered);
    let newState = updatePlayer(state, playerIndex, player);
    newState = { ...newState, gameLog: [...newState.gameLog, `Night Stretcher recovers ${recovered[0].name} to hand.`] };
    return newState;
  },
};

const ULTRA_BALL: TrainerCard = {
  id: 'ultra-ball-meg-131',
  name: 'Ultra Ball',
  cardType: CardType.Trainer,
  cardNumber: 'SVI 196',
  imageUrl: 'https://images.pokemontcg.io/sv1/196.png', // Scarlet & Violet Ultra Ball
  trainerType: TrainerType.Item,
  effect: (state, playerIndex) => {
    const player = clonePlayer(state, playerIndex);
    // Cost: discard 2 cards from hand
    if (player.hand.length < 2) return state;
    // AI: discard least useful cards (energy dupes, extra trainers)
    // Simple heuristic: discard last 2 non-Pokemon cards, or last 2 cards
    let discarded = 0;
    for (let i = player.hand.length - 1; i >= 0 && discarded < 2; i--) {
      if (player.hand[i].cardType !== CardType.Pokemon) {
        player.discard.push(...player.hand.splice(i, 1));
        discarded++;
      }
    }
    // If we couldn't discard 2 non-Pokemon, discard any remaining
    for (let i = player.hand.length - 1; i >= 0 && discarded < 2; i--) {
      player.discard.push(...player.hand.splice(i, 1));
      discarded++;
    }
    // Search deck for any 1 Pokemon
    const [found, remaining] = searchDeck(
      player.deck,
      (c) => c.cardType === CardType.Pokemon,
      1
    );
    player.deck = shuffleArray(remaining);
    player.hand.push(...found);
    let newState = updatePlayer(state, playerIndex, player);
    if (found.length > 0) {
      newState = { ...newState, gameLog: [...newState.gameLog, `Ultra Ball discards 2 cards, searches for ${found[0].name}.`] };
    }
    return newState;
  },
};

const AREA_ZERO_UNDERDEPTHS: TrainerCard = {
  id: 'area-zero-underdepths-scr-131',
  name: 'Area Zero Underdepths',
  cardType: CardType.Trainer,
  cardNumber: 'SCR 131',
  imageUrl: 'https://images.pokemontcg.io/sv7/131.png',
  trainerType: TrainerType.Stadium,
  effect: (state, _playerIndex) => {
    // Stadium effect: if Tera Pokemon in play, max bench size is 8
    // This is a passive effect checked by the engine when placing bench Pokemon
    // For now, just log it
    return {
      ...state,
      gameLog: [...state.gameLog, 'Area Zero Underdepths is now in play!'],
    };
  },
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
