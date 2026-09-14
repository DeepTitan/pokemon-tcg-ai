import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { exportDecklist } from '../decklist-export.js';
import type { CapturedDecklist, CardInfo } from '../types.js';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/captured-decklist.json', import.meta.url), 'utf8'));
const deck: CapturedDecklist = fixture.deck;
const catalog = new Map<string, CardInfo>(fixture.cards.map((c: CardInfo) => [c.id, c]));
const result = exportDecklist(deck, catalog);
assert.ok(result.text, result.error);
assert.match(result.text, /^Pokémon: 8\n/);
assert.match(result.text, /\nTrainer: 13\n/);
assert.match(result.text, /\nEnergy: 1\n16 Basic \{M\} Energy MEE 8\n\nTotal Cards: 60\n$/);
assert.match(result.text, /1 Fezandipiti ex SFA 38\n/);
assert.match(result.text, /3 Judge POR 76\n/);
assert.match(result.text, /2 Mega Excadrill ex PBL 65\n/);
assert.match(result.text, /2 Metagross CRI 61\n/);
assert.match(result.text, /4 Pokégear 3.0 SVI 186\n/);
assert.match(result.text, /1 Buddy-Buddy Poffin TEF 144\n/);
// Reordering input doesn't change exports or mutate the captured inventory.
assert.equal(exportDecklist({ ...deck, cards: [...deck.cards].reverse() }, catalog).text, result.text);
assert.equal(exportDecklist(undefined, catalog).text, undefined);
for (const changed of [
  { ...deck, total: 59 },
  { ...deck, source: 'reconstructed' },
  { ...deck, cards: deck.cards.slice(1) },
  { ...deck, cards: deck.cards.map((c, i) => i === 0 ? { ...c, count: 2.5 } : c) },
  { ...deck, cards: [{ cardId: 'mee_8', count: 30 }, { cardId: 'MEE_8', count: 30 }] },
]) assert.equal(exportDecklist(changed as CapturedDecklist, catalog).text, undefined);
for (const changed of [undefined, { ...catalog.get('me1_114')!, category: undefined },
  { ...catalog.get('me1_114')!, name: 'me1_114' }]) {
  const partial = new Map(catalog);
  if (changed) partial.set('me1_114', changed); else partial.delete('me1_114');
  assert.equal(exportDecklist(deck, partial).text, undefined);
}
const unknown = { ...deck, cards: deck.cards.map((c, i) => i === 0 ? { ...c, cardId: 'future_114' } : c) };
assert.equal(exportDecklist(unknown, new Map([...catalog, ['future_114', { ...catalog.get('me1_114')!, id: 'future_114' }]])).text, undefined);
const finishes: CapturedDecklist = { ...deck, cards: [{cardId:'mee_8',count:58},{cardId:'sv6-5_38_ph',count:1},{cardId:'sv6-5_38_sph',count:1}] };
const variants = new Map([...catalog, ...['ph','sph'].map(suffix => [`sv6-5_38_${suffix}`, catalog.get('sv6-5_38')!] as const)]);
assert.match(exportDecklist(finishes, variants).text!, /^Pokémon: 1\n2 Fezandipiti ex SFA 38\n/);
console.log('decklist-export: complete capture, mappings, quantities, finishes, and unavailable-card guards passed');
