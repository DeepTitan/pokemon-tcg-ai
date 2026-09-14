// Export original cached card artwork only, never match data or user files.
import fs from 'node:fs';
import path from 'node:path';
import { Resvg } from '../landing/node_modules/@resvg/resvg-js/index.js';
import { shareCardCatalog } from '../landing/lib/share-catalog.mjs';
import { artDataUri, measureCardArt } from '../landing/lib/share-card-art.mjs';

const [source] = process.argv.slice(2);
if (!source) throw new Error('Usage: node scripts/build-replay-art.mjs <Trace card-art directory>');
const output = new URL('../landing/assets/replay-card-art/', import.meta.url);
const catalog = shareCardCatalog();
const ids = [];
fs.mkdirSync(output, { recursive: true });
for (const filename of fs.readdirSync(source).sort()) {
  if (!/^[a-z0-9-]+_\d+(?:_[a-z0-9]+)?\.png$/i.test(filename)) continue;
  const id = filename.slice(0, -4).toLowerCase();
  if (!catalog.has(id)) continue;
  const image = { bytes: fs.readFileSync(path.join(source, filename)), contentType: 'image/png', layout: 'ptcgl-square' };
  const bounds = measureCardArt(image);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${bounds.width}" height="${bounds.height}" viewBox="${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}"><image href="${artDataUri(image)}" width="256" height="256"/></svg>`;
  fs.writeFileSync(new URL(`${id}.png`, output), new Resvg(svg, { font: { loadSystemFonts: false } }).render().asPng());
  ids.push(id);
}
fs.writeFileSync(new URL('../landing/assets/replay-art-manifest.json', import.meta.url), JSON.stringify({ version: 1, ids }));
console.log(`Exported ${ids.length} card images for browser replays; no match records.`);
