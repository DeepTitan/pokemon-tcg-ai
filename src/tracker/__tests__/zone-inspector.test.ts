import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReviewOverlay } from '../ReviewInteractions.js';
import { cardInfoToEngineCard, hiddenReviewCard } from '../card-adapter.js';
import type { Card } from '../../engine/types.js';

const card = (id: string, printing: string) => cardInfoToEngineCard(undefined, id, 'Metal Energy', printing);
const render = (cards: Card[], hidden: string[] = []) => renderToStaticMarkup(createElement(ReviewOverlay, {
  inspector: { kind:'zone', title:'You · Prize cards', subtitle:'Inferred from your decklist · Prize positions unknown.', cards,
    visibility:Object.fromEntries(cards.map(c => [c.id, hidden.includes(c.id) ? 'hidden' as const : 'known' as const])) },
  catalog:new Map(), onClose:()=>{}, onInspectCard:()=>{},
}));
const identical = render([card('one','sve_1'),card('two','sve_1')]);
assert.match(identical, /aria-label="Metal Energy, 2 copies"/);
assert.match(identical, /zone-card-count[^>]*>×2/);
assert.match(identical, /2 cards/);
assert.doesNotMatch(identical, /Board zone|0 hidden|visible|View inferred/);
assert.equal((identical.match(/<img /g) || []).length, 1);
const printings = render([card('one','sve_1'),card('two','sve_2')]);
assert.equal((printings.match(/<img /g) || []).length, 2, 'Different printings keep distinct cards');
const hidden = render([hiddenReviewCard('a'),hiddenReviewCard('b')], ['a','b']);
assert.match(hidden, /2 hidden/);
assert.equal((hidden.match(/aria-label="Unknown card"/g) || []).length, 2);
assert.doesNotMatch(hidden, /zone-card-count/);
console.log('zone-inspector: duplicate quantities, printing distinctions, private cards and compact copy verified');
