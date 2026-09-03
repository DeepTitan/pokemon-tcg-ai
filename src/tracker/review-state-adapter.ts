import {
  CardType,
  EnergyType,
  GamePhase,
  PokemonStage,
  TrainerType,
  type Card,
  type PlayerState,
  type PokemonCard,
  type PokemonInPlay,
  type TrainerCard,
} from '../engine/types.js';
import type { CanonicalReviewState, MatchReview, ReviewSelection, TrackedCard, TrackedPokemon, TrackedTurn } from './types.js';

export function displayedDeckCount(board: { deckCount?: number; deckCountKnown?: boolean }, canonicalDeckCount: number): number | '?' {
  if (board.deckCountKnown === false) return '?';
  return board.deckCount ?? canonicalDeckCount;
}

function previewCard(card: TrackedCard, index = 0): Card {
  const name = card.name || 'Captured card';
  const reviewIdentity = { reviewSourceId: card.cardId };
  const pokemonLike = /Pokémon|Munkidori|Dragapult|Dreepy|Drakloak|Budew|Charizard|Pidgeot|Fezandipiti|Rotom/i.test(name);
  if (pokemonLike) {
    const pokemon: PokemonCard = {
      ...reviewIdentity,
      id: card.id,
      name,
      cardType: CardType.Pokemon,
      imageUrl: card.imageDataUrl || '/tracker-assets/pokemon-card-back.jpg',
      cardNumber: card.cardId || '',
      hp: 120,
      stage: PokemonStage.Basic,
      type: EnergyType.Psychic,
      retreatCost: 1,
      attacks: [{ name: 'Captured attack', cost: [EnergyType.Colorless], damage: 30, description: 'Exact rules appear when the native card catalog resolves this printing.' }],
      prizeCards: 1,
      isRulebox: false,
    };
    return pokemon;
  }
  const trainer: TrainerCard = {
    ...reviewIdentity,
    id: card.id,
    name,
    cardType: CardType.Trainer,
    imageUrl: card.imageDataUrl || '/tracker-assets/pokemon-card-back.jpg',
    cardNumber: card.cardId || '',
    trainerType: TrainerType.Item,
  };
  return trainer;
}

function previewPokemon(tracked: TrackedPokemon, index: number): PokemonInPlay {
  const converted = previewCard(tracked, index);
  const card: PokemonCard = converted.cardType === CardType.Pokemon
    ? converted as PokemonCard
    : {
      ...converted,
      cardType: CardType.Pokemon,
      hp: tracked.maxHp || 120,
      stage: PokemonStage.Basic,
      type: EnergyType.Psychic,
      retreatCost: 1,
      attacks: [],
      prizeCards: 1,
      isRulebox: false,
    };
  return {
    card,
    currentHp: Math.max(0, card.hp - tracked.damage),
    damageCounters: Math.floor(tracked.damage / 10),
    attachedEnergy: [],
    attachedTools: [],
    statusConditions: [],
    isEvolved: false,
    turnPlayed: 0,
    damageShields: [],
    cannotRetreat: false,
  };
}

function emptyPlayer(): PlayerState {
  return {
    deck: [], hand: [], active: null, bench: [], prizes: [], discard: [], lostZone: [],
    supporterPlayedThisTurn: false, energyAttachedThisTurn: false, retreatedThisTurn: false,
    prizeCardsRemaining: 6, extraTurn: false, skipNextTurn: false, abilitiesUsedThisTurn: [],
  };
}

function sampleSearch(): ReviewSelection {
  const names = ['Dreepy', 'Drakloak', 'Dragapult ex', 'Psychic Energy', 'Ultra Ball', 'Nest Ball', 'Boss’s Orders', 'Iono', 'Rare Candy', 'Night Stretcher', 'Buddy-Buddy Poffin', 'Super Rod'];
  const optionCards = names.map((name, index) => previewCard({ id: `preview-search-${index}`, name }, index));
  return {
    id: 'preview-deck-search',
    kind: 'entity',
    selectionMethod: 1,
    subActionType: 5,
    sourceEntityId: 'preview-ultra-ball',
    sourceCardId: 'sv-ultra-ball',
    sourceZonePositions: [8],
    allOptionIds: optionCards.map((card) => card.id),
    eligibleOptionIds: optionCards.slice(0, 3).map((card) => card.id),
    selectedOptionIds: [optionCards[2].id],
    optionCards,
    minimum: 0,
    maximum: 1,
    completed: true,
  };
}

export function trackedTurnToCanonical(review: MatchReview, turn: TrackedTurn): CanonicalReviewState {
  const playerNames: [string, string] = [review.localPlayer, review.opponent];
  const players: [PlayerState, PlayerState] = [emptyPlayer(), emptyPlayer()];
  const visibility: CanonicalReviewState['visibility'] = {};
  playerNames.forEach((name, playerIndex) => {
    const tracked = turn.snapshot.players[name];
    if (!tracked) return;
    const player = players[playerIndex];
    player.active = tracked.active ? previewPokemon(tracked.active, playerIndex) : null;
    player.bench = tracked.bench.map((pokemon, index) => previewPokemon(pokemon, index + playerIndex));
    player.discard = (tracked.discardCards || tracked.discard.map((cardName, index) => ({ id: `preview-discard-${playerIndex}-${index}`, name: cardName }))).map(previewCard);
    player.hand = (tracked.knownHandCards || tracked.knownHand.map((cardName, index) => ({ id: `preview-hand-${playerIndex}-${index}`, name: cardName }))).map(previewCard);
    while (player.hand.length < tracked.handCount) player.hand.push({ ...previewCard({ id: `preview-hidden-hand-${playerIndex}-${player.hand.length}`, name: 'Hidden card' }), name: 'Hidden card' });
    const deckCount = tracked.deckCount ?? Math.max(0, 60 - tracked.handCount - tracked.discard.length - tracked.bench.length - (tracked.active ? 1 : 0) - 6);
    player.deck = Array.from({ length: deckCount }, (_, index) => ({ ...previewCard({ id: `preview-deck-${playerIndex}-${index}`, name: 'Hidden card' }), name: 'Hidden card' }));
    player.prizes = Array.from({ length: Math.max(0, 6 - tracked.prizesTaken) }, (_, index) => ({ ...previewCard({ id: `preview-prize-${playerIndex}-${index}`, name: 'Hidden card' }), name: 'Hidden card' }));
    player.prizeCardsRemaining = player.prizes.length;
    for (const card of [...player.deck, ...player.prizes, ...player.hand]) visibility[card.id] = card.name === 'Hidden card' ? 'hidden' : 'known';
    for (const card of player.discard) visibility[card.id] = 'known';
  });
  const selections = turn.index === 7 ? [sampleSearch()] : [];
  selections.flatMap((selection) => selection.optionCards).forEach((card) => { visibility[card.id] = 'temporarily-revealed'; });
  return {
    state: {
      players,
      currentPlayer: turn.player === review.opponent ? 1 : 0,
      turnNumber: Math.max(1, turn.index),
      phase: review.winner ? GamePhase.GameOver : GamePhase.MainPhase,
      stadium: null,
      winner: review.winner ? (review.winner === review.localPlayer ? 0 : 1) : null,
      turnActions: [], gameLog: [], gameFlags: [],
    },
    playerNames,
    localPlayerIndex: 0,
    visibility,
    appliedEffects: {},
    selections,
    selection: selections.at(-1),
  };
}
