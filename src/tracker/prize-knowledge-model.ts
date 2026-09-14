import type { Card, PlayerState, PokemonInPlay } from '../engine/types.js';
import { cardInfoToEngineCard, cardSourceIdFromReviewCard } from './card-adapter.js';
import type { CapturedDecklist, CardInfo, ReviewCardVisibility, TrackedPlayerBoard } from './types.js';

export interface PrizeKnowledge {
  kind: 'unavailable' | 'revealed' | 'inferred';
  cards: Card[];
  visibility: Record<string, ReviewCardVisibility>;
  note: string;
}

/** A current-frame multiset, never a mapping onto face-down prize positions.
 * Reads no later frames and never writes inferred identities into game state.
 */
export function derivePrizeKnowledge({ deck, player, board, visibility, catalog, local,
  stadium, stadiumOwner, pendingCards = [] }: {
  deck?: CapturedDecklist; player: PlayerState; board: TrackedPlayerBoard;
  visibility: Record<string, ReviewCardVisibility>; catalog: ReadonlyMap<string, CardInfo>;
  local: boolean; stadium: Card | null; stadiumOwner?: string;
  pendingCards?: Card[];
}): PrizeKnowledge {
  const unavailable = (note: string): PrizeKnowledge => ({ kind: 'unavailable', cards: player.prizes, visibility, note });
  const identified = (card: Card) => (visibility[card.id] === 'known' || visibility[card.id] === 'temporarily-revealed')
    && Boolean(cardSourceIdFromReviewCard(card));
  if (!local) return unavailable('Only directly revealed opponent Prize cards are shown.');
  if (player.prizes.length && player.prizes.every(identified)) {
    return { kind: 'revealed', cards: player.prizes, visibility, note: 'Revealed Prize cards, grouped by card. Display order is not prize position.' };
  }
  if (!deck) return unavailable('Prize inference needs a complete captured starting decklist.');
  if (deck.playerName !== board.name || deck.total !== 60 || !deck.cards.length
    || deck.cards.some(c => !c.cardId || !Number.isInteger(c.count) || c.count < 1)
    || deck.cards.reduce((n, c) => n + c.count, 0) !== 60) {
    return unavailable('The captured inventory could not be verified.');
  }
  const remaining = 6 - board.prizesTaken;
  if (!Number.isInteger(remaining) || remaining < 1 || remaining > 6 || board.prizesKnown === false
    || player.prizes.length !== remaining || board.deckCountKnown === false
    || player.deck.length !== board.deckCount || player.hand.length !== board.handCount) {
    return unavailable('Waiting for complete zone counts before inferring Prize cards.');
  }
  if (stadium && !stadiumOwner) return unavailable('Waiting for the Stadium’s owner before inferring Prize cards.');
  const outside = [...player.deck, ...player.hand, ...player.discard, ...player.lostZone, ...pendingCards];
  const seenPokemon = new Set<PokemonInPlay>();
  const addPokemon = (pokemon: PokemonInPlay | null | undefined): void => {
    if (!pokemon || seenPokemon.has(pokemon)) return;
    seenPokemon.add(pokemon);
    outside.push(pokemon.card, ...pokemon.attachedEnergy, ...pokemon.attachedTools);
    addPokemon(pokemon.previousStage);
  };
  addPokemon(player.active);
  player.bench.forEach(addPokemon);
  // Older archived canonical states kept only the first entry of Live's flat
  // evolution stack. The same-frame public board still retains every physical
  // card underneath that Pokémon. Reconcile those cards too, without guessing
  // identities from names or carrying knowledge from a different replay frame.
  const publicEvolutionIds = new Set<string>();
  for (const pokemon of [player.active, ...player.bench]) {
    if (!pokemon) continue;
    const tracked = [board.active, ...(board.bench || [])].find(p => p?.id === pokemon.card.id);
    if (!tracked) continue;
    if (tracked.cardId && tracked.cardId.toLowerCase() !== cardSourceIdFromReviewCard(pokemon.card)?.toLowerCase()) {
      return unavailable('Card identities conflict in this frame; Prize inference is unavailable.');
    }
    for (const card of tracked.evolutionCards || []) {
      if (!card.id || !card.cardId) return unavailable('The full 60-card accounting is incomplete at this action.');
      outside.push(cardInfoToEngineCard(catalog.get(card.cardId), card.id, card.name, card.cardId));
      publicEvolutionIds.add(card.id);
    }
  }
  if (stadium && stadiumOwner === board.name) outside.push(stadium);
  // Evolution snapshots can reference the same attachment from multiple stages.
  // Count an entity once, but reject conflicting identities for that entity.
  const unique = new Map<string, Card>();
  for (const card of outside) {
    if (!card.id || !(identified(card) || (publicEvolutionIds.has(card.id) && cardSourceIdFromReviewCard(card)))) {
      return unavailable('Search the full deck first. Every card outside your prizes must be accounted for.');
    }
    const previous = unique.get(card.id);
    if (previous && cardSourceIdFromReviewCard(previous) !== cardSourceIdFromReviewCard(card)) {
      return unavailable('Card identities conflict in this frame; Prize inference is unavailable.');
    }
    unique.set(card.id, card);
  }
  const prizeIds = new Set(player.prizes.map(c => c.id));
  if (unique.size !== 60 - remaining || prizeIds.size !== remaining
    || [...prizeIds].some(id => unique.has(id))) {
    return unavailable('The full 60-card accounting is incomplete at this action.');
  }
  const counts = new Map<string, number>();
  for (const entry of deck.cards) {
    const id = entry.cardId.toLowerCase();
    if (counts.has(id)) return unavailable('The captured inventory contains duplicate entries.');
    counts.set(id, entry.count);
  }
  const subtract = (card: Card) => {
    const id = cardSourceIdFromReviewCard(card)?.toLowerCase();
    if (!id || !counts.get(id)) return false;
    counts.set(id, counts.get(id)! - 1);
    return true;
  };
  for (const card of unique.values()) if (!subtract(card)) return unavailable('The captured deck and current cards do not reconcile.');
  // Directly revealed prizes must agree with the inferred multiset too.
  const revealed = player.prizes.filter(identified);
  for (const card of revealed) if (!subtract(card)) return unavailable('Revealed prizes do not reconcile with the captured deck.');
  const cards = [...revealed];
  for (const [cardId, count] of counts) for (let copy = 0; copy < count; copy++) {
    cards.push(cardInfoToEngineCard(catalog.get(cardId), `inferred-prize:${board.name}:${cardId}:${copy}`, cardId, cardId));
  }
  if (cards.length !== remaining) return unavailable('The remaining Prize count does not reconcile.');
  return { kind: 'inferred', cards, visibility: Object.fromEntries(cards.map(c => [c.id, 'known'])),
    note: 'Inferred from your decklist · Prize positions unknown.' };
}
