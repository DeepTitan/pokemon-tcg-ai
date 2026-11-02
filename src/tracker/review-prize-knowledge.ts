import type { Card } from '../engine/types.js';
import { cardSourceIdFromReviewCard } from './card-adapter.js';
import { collectPrizeOutsideCards, derivePrizeKnowledge, type PrizeKnowledge, type PrizeKnowledgeInput } from './prize-knowledge-model.js';
import { deriveReviewTurnStatus } from './turn-status-model.js';
import type { CardInfo, MatchReview, ReviewSelection, TrackedTurn } from './types.js';

const source = (card: Card) => cardSourceIdFromReviewCard(card)?.toLowerCase();
const physicalEntityId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const identified = (card: Card, input: PrizeKnowledgeInput) => Boolean(source(card))
  && ['known', 'temporarily-revealed'].includes(input.visibility[card.id]);

function knownOutside(input: PrizeKnowledgeInput): Map<string, string> | undefined {
  const { cards, publicAttachmentIds, error } = collectPrizeOutsideCards(input);
  if (error) return undefined;
  const known = new Map<string, string>();
  for (const card of cards) {
    const printing = source(card);
    if (!printing || !(identified(card, input) || publicAttachmentIds.has(card.id))) continue;
    if (!card.id || (known.has(card.id) && known.get(card.id) !== printing)) return undefined;
    known.set(card.id, printing);
  }
  return known;
}

function samePhysicalPrizes(before: PrizeKnowledgeInput, after: PrizeKnowledgeInput): boolean {
  const previous = new Set(before.player.prizes.map(card => card.id));
  return previous.size === before.player.prizes.length && previous.size === after.player.prizes.length
    && after.player.prizes.every(card => physicalEntityId.test(card.id) && previous.has(card.id))
    && new Set(after.player.prizes.map(card => card.id)).size === previous.size;
}

function prizeExchange(before: TrackedTurn, after: TrackedTurn, localIndex: number, taking = false): boolean {
  const signature = (selection: ReviewSelection) => JSON.stringify([selection.id, selection.completed, selection.selectedOptionIds]);
  const previous = new Set((before.canonical?.selections || []).map(signature));
  if (!taking && after.canonical?.selections.some(selection => selection.completed
    && selection.sourceZonePositions.includes(localIndex === 0 ? 19 : 20)
    && !previous.has(signature(selection)))) return true;
  const previousEvents = new Set(before.events.map(event => event.id));
  return after.events.some(event => !previousEvents.has(event.id) && (
    /\b(?:swap\w*|exchang\w*|shuffl\w*|replac\w*|return\w*|put|add\w*|mov\w*)\b.*\bprize|\bprizes?\b.*\b(?:swap\w*|exchang\w*|shuffl\w*|replac\w*|return\w*|put|add\w*|mov\w*)\b/i.test(event.text)
    || event.facts?.some(fact => /prize/i.test(fact.value) && ['movement', 'shuffle'].includes(fact.kind))
  ));
}

/** Preserve established prize contents through incomplete non-prize snapshots.
 * Track physical cards leaving prizes instead of forgetting the whole list when
 * an unrelated zone loses a card. Never read future frames or persist guesses.
 */
export function deriveReviewPrizeKnowledge(
  review: MatchReview, selectedIndex: number, catalog: ReadonlyMap<string, CardInfo>,
): PrizeKnowledge | undefined {
  const frame = (index: number) => {
    const turn = review.turns[index], canonical = turn?.canonical;
    const board = turn?.snapshot.players[review.localPlayer];
    if (!canonical || !board || board.name !== review.localPlayer
      || canonical.playerNames[canonical.localPlayerIndex] !== review.localPlayer) return undefined;
    const input: PrizeKnowledgeInput = {
      deck: review.decklists?.find(deck => deck.playerName === review.localPlayer),
      player: canonical.state.players[canonical.localPlayerIndex], board,
      visibility: canonical.visibility, catalog, local: true, stadium: canonical.state.stadium,
      stadiumOwner: deriveReviewTurnStatus(review, index, canonical).stadiumOwner,
      pendingCards: canonical.pendingCards?.[canonical.localPlayerIndex],
    };
    return { turn, canonical, input };
  };
  if (!Number.isInteger(selectedIndex) || selectedIndex < 0 || selectedIndex >= review.turns.length) return undefined;
  const selected = frame(selectedIndex);
  if (!selected) return undefined;
  const current = derivePrizeKnowledge(selected.input);
  if (selected.input.board.prizesKnown !== false && selected.input.board.prizesTaken === 6) {
    return { kind: 'revealed', cards: [], visibility: {}, note: 'No Prize cards remain.' };
  }
  if (current.kind !== 'unavailable' || !current.cards.length) return current;

  for (let index = selectedIndex - 1; index >= 0; index--) {
    let previous = frame(index);
    if (!previous) continue;
    const verified = derivePrizeKnowledge(previous.input);
    if (verified.kind === 'unavailable' || !verified.cards.length) continue;
    const known = knownOutside(previous.input);
    if (!known) return current;
    const completeAnchor = known.size === 60 - verified.cards.length;
    let cards = verified.cards.slice();
    for (let next = index + 1; next <= selectedIndex; next++) {
      const following = frame(next);
      if (!following) return current;
      const { input, turn, canonical } = following;
      const remaining = 6 - input.board.prizesTaken;
      if (input.board.prizesKnown === false || !Number.isInteger(remaining) || remaining < 1 || remaining > cards.length) return current;
      const outside = knownOutside(input);
      if (!outside) return current;
      if (new Set(input.player.prizes.map(card => card.id)).size !== input.player.prizes.length) return current;
      const physicalPrizes = new Set(input.player.prizes.filter(card => physicalEntityId.test(card.id)).map(card => card.id));
      const priorPhysical = new Set(previous.input.player.prizes.filter(card => physicalEntityId.test(card.id)).map(card => card.id));
      if (physicalPrizes.size === input.player.prizes.length && priorPhysical.size === previous.input.player.prizes.length
        && [...physicalPrizes].some(id => !priorPhysical.has(id))) return current;
      if (collectPrizeOutsideCards(input).cards.some(card => physicalPrizes.has(card.id))) return current;
      for (const [id, printing] of outside) if (known.has(id) && known.get(id) !== printing) return current;
      const unchangedEntities = samePhysicalPrizes(previous.input, input) && input.player.prizes.length === remaining;
      const taken = cards.length - remaining;
      const additions = [...outside].filter(([id]) => !known.has(id));
      if (taken) {
        // At a complete anchor every non-prize physical card was accounted for.
        // Exactly N newly observed cards alongside N prizes taken identify the
        // cards to subtract, even if another zone's snapshot is now incomplete.
        if (!completeAnchor || additions.length !== taken || prizeExchange(previous.turn, turn, canonical.localPlayerIndex, true)) return current;
        for (const [id, printing] of additions) {
          const offset = cards.findIndex(card => source(card) === printing);
          if (offset < 0) return current;
          cards.splice(offset, 1); known.set(id, printing);
        }
      } else if (!unchangedEntities && (!completeAnchor || additions.length
        || prizeExchange(previous.turn, turn, canonical.localPlayerIndex)
        || /capture baseline|partial capture/i.test(turn.label))) return current;

      const prizeCounts = new Map<string, number>();
      for (const card of cards) {
        const printing = source(card);
        if (!printing) return current;
        prizeCounts.set(printing, (prizeCounts.get(printing) || 0) + 1);
      }
      const revealedCounts = new Map(prizeCounts);
      for (const card of input.player.prizes.filter(card => identified(card, input))) {
        const printing = source(card)!;
        if (!revealedCounts.get(printing)) return current;
        revealedCounts.set(printing, revealedCounts.get(printing)! - 1);
      }
      // Reject any candidate inconsistent with identified cards in this frame.
      // This also catches an exchange whose descriptive event was missing.
      if (input.deck) {
        const available = new Map(input.deck.cards.map(card => [card.cardId.toLowerCase(), card.count]));
        for (const printing of outside.values()) available.set(printing, (available.get(printing) || 0) - 1);
        if ([...available.values()].some(count => count < 0)
          || [...prizeCounts].some(([printing, count]) => (available.get(printing) || 0) < count)) return current;
      }
      previous = following;
    }
    return { kind: 'remembered', cards, visibility: Object.fromEntries(cards.map(card => [card.id, 'known'])),
      note: 'Inferred from your decklist · Prize positions unknown.' };
  }
  return current;
}
