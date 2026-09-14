// Release-time export of printed card metadata and original artwork, never player data.
import fs from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { parseTable } from './turnlume-local-card-catalog.js';

const [databaseRoot, artRoot] = process.argv.slice(2);
if (!databaseRoot || !artRoot) throw new Error('Usage: build-share-catalog.ts <PTCGL config-cache> <Trace card-art>');
const assets = new URL('../landing/assets/', import.meta.url);
const cards = new Map();
for (const name of fs.readdirSync(databaseRoot).sort()) {
  if (!name.startsWith('card-database-') || !name.includes('_en_') || !name.endsWith('.json')) continue;
  const encoded = JSON.parse(fs.readFileSync(path.join(databaseRoot, name), 'utf8'))?.keys?.table?.contentBinary;
  if (typeof encoded !== 'string') continue;
  for (const card of parseTable(Buffer.from(encoded, 'base64'))) {
    const { id, name, category, hp, cardType, evolvesFrom, actions } = card;
    cards.set(id.toLowerCase(), { id, name, category, hp, cardType, evolvesFrom, actions });
  }
}
const artIds: string[] = [];
fs.mkdirSync(new URL('share-card-art/', assets), { recursive: true });
for (const filename of fs.readdirSync(artRoot).sort()) {
  // The public Pokémon image catalog does not serve the newer Mega-era set IDs.
  if (!/^me[a-z0-9-]*_\d+(?:_ph)?\.png$/i.test(filename)) continue;
  const id = filename.slice(0, -4);
  const baseId = id.replace(/_ph$/, '').toLowerCase();
  if (cards.get(baseId)?.category !== 1) continue;
  fs.copyFileSync(path.join(artRoot, filename), new URL(`share-card-art/${filename}`, assets));
  artIds.push(id);
}
const catalog = { version: 'printed-cards-2026-09-14', cards: [...cards.values()], artIds };
fs.writeFileSync(new URL('share-card-catalog.json.gz', assets), gzipSync(JSON.stringify(catalog), { level: 9 }));
console.log(`Exported ${cards.size} printed card entries and ${artIds.length} original card images; no match records.`);
