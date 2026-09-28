import { cardSourceIdFromReviewCard } from './card-adapter.js';
import { humanizeGameTerms, unselectedCardsForTurn } from './game-log-copy.js';
import type { CardInfo, TrackedChoiceCard, TrackedTurn } from './types.js';

export function actionCardsForTurn(turn: TrackedTurn, catalog: ReadonlyMap<string, CardInfo>): TrackedChoiceCard[] {
  const cards = [...(turn.choiceCards || [])];
  const promotionOnly = cards.some((card) => card.choiceRole === 'promoted')
    && !cards.some((card) => card.choiceRole === 'action');
  if (promotionOnly) return cards;
  const actionCardIds = new Set(cards
    .filter((card) => card.choiceRole === 'action' && card.cardId)
    .map((card) => card.cardId!.toLowerCase()));

  turn.events.forEach((event) => {
    if (!event.cardId || actionCardIds.has(event.cardId.toLowerCase())) return;
    const info = catalog.get(event.cardId) || catalog.get(event.cardId.toLowerCase());
    if (!info) return;
    cards.unshift({
      id: `${turn.index}:action:${info.id}`,
      cardId: info.id,
      name: info.name,
      imageDataUrl: info.imageDataUrl,
      cardType: info.cardType,
      choiceRole: 'action',
    });
    actionCardIds.add(event.cardId.toLowerCase());
  });

  const seen = new Set(cards.map((card) => card.id));
  for (const card of unselectedCardsForTurn(turn)) {
    if (seen.has(card.id)) continue;
    seen.add(card.id);
    const cardId = cardSourceIdFromReviewCard(card);
    const info = cardId ? catalog.get(cardId) || catalog.get(cardId.toLowerCase()) : undefined;
    cards.push({
      id: card.id,
      cardId,
      name: humanizeGameTerms(card.name),
      imageDataUrl: card.imageUrl || info?.imageDataUrl,
      cardType: info?.cardType,
      choiceRole: 'unchosen',
    });
  }

  return cards;
}
