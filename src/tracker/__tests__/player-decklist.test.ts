import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PlayerDecklist } from '../PlayerDecklist.js';
import type { CapturedDecklist } from '../types.js';

const missing = renderToStaticMarkup(createElement(PlayerDecklist, { name: 'Missing capture', catalog: new Map() }));
assert.match(missing, /aria-disabled="true"/);
assert.match(missing, /aria-describedby="[^"]+-unavailable"/);
assert.match(missing, /role="tooltip"[^>]*>Decklist not available</);
assert.doesNotMatch(missing, /aria-haspopup|role="dialog"/);
const deck: CapturedDecklist = { playerName: 'Captured', playerId: 'p1', source: 'match-start', total: 60, cards: [{ cardId: 'mee_8', count: 60 }] };
// Missing catalog/art is not a missing inventory: viewing must remain enabled.
const available = renderToStaticMarkup(createElement(PlayerDecklist, { name: 'Captured', deck, catalog: new Map() }));
assert.match(available, /aria-disabled="false"/);
assert.match(available, /aria-haspopup="dialog"/);
assert.doesNotMatch(available, /Decklist not available|aria-describedby/);
console.log('player-decklist: missing capture disabled with tooltip; captured inventory remains available');
