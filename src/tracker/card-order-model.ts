interface DisplayOrderCard {
  id: string;
  name: string;
}

const cardNameCollator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

/**
 * Return a display-only copy ordered by card identity. Equal cards retain their
 * captured order so animations and click targets stay stable between frames.
 */
export function sortCardsForDisplay<T extends DisplayOrderCard>(
  cards: readonly T[],
  displayName: (card: T) => string = (card) => card.name,
): T[] {
  return cards
    .map((card, index) => ({ card, index, name: displayName(card).trim() }))
    .sort((left, right) => {
      const leftHidden = /^hidden card$/i.test(left.name);
      const rightHidden = /^hidden card$/i.test(right.name);
      if (leftHidden !== rightHidden) return leftHidden ? 1 : -1;
      return cardNameCollator.compare(left.name, right.name) || left.index - right.index;
    })
    .map(({ card }) => card);
}
