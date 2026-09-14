import fs from 'node:fs';
import path from 'node:path';
import { Resvg } from '../landing/node_modules/@resvg/resvg-js/index.js';
import { artScan, measureCardArt, framedCardArt } from '../landing/lib/share-card-art.mjs';

// This audit reads artwork only; it does not read or publish match records.
const roots = process.argv.slice(2).filter(arg => !arg.startsWith('--'));
const output = process.env.TRACE_ART_AUDIT_OUTPUT;
if (!roots.length) roots.push(new URL('../landing/assets/share-card-art/', import.meta.url).pathname);
const report = { audited: 0, transparent: 0, flattened: 0, failures: [], cards: [] };
const examples = [];
for (const root of roots) for (const file of fs.readdirSync(root).filter(name => name.endsWith('.png')).sort()) {
  const image = { bytes: fs.readFileSync(path.join(root, file)), contentType: 'image/png', layout: 'ptcgl-square' };
  report.audited++;
  try {
    const bounds = measureCardArt(image);
    const pixels = artScan(image);
    const transparent = pixels[(128 * 256 + 5) * 4 + 3] < 17;
    for (const x of [5, 250]) for (let y = 0; y < 256; y++) {
      const p = pixels.subarray((y * 256 + x) * 4, (y * 256 + x) * 4 + 4);
      if (p[3] >= 17 && [...p.subarray(0, 3)].some(v => v < 245)) throw new Error('Unrecognized texture gutter');
    }
    report[transparent ? 'transparent' : 'flattened']++;
    report.cards.push({ id: file.slice(0, -4), source: path.basename(root), ...bounds, displayedHeight: 402,
      displayedWidth: 402 * bounds.width / bounds.height });
    if (examples.length < 101) examples.push({ id: file.slice(0, -4), image });
  } catch (error) { report.failures.push({ id: file, error: error.message }); }
}
if (output) {
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, 'audit.json'), JSON.stringify(report, null, 2));
  for (let start = 0; start < examples.length; start += 30) {
    const items = examples.slice(start, start + 30);
    const content = items.map(({ id, image }, i) => {
      const x = (i % 6) * 156, y = Math.floor(i / 6) * 225;
      return `<g transform="translate(${x},${y})"><path d="M5 10 H151 M5 210 H151" stroke="#c3bba9"/>${framedCardArt(image, 78, 10, 200)}<text x="78" y="222" text-anchor="middle" font-size="11">${id}</text></g>`;
    }).join('');
    fs.writeFileSync(path.join(output, `cards-${start / 30 + 1}.png`), new Resvg(
      `<svg xmlns="http://www.w3.org/2000/svg" width="936" height="1125"><rect width="100%" height="100%" fill="#faf9f5"/>${content}</svg>`,
    ).render().asPng());
  }
}
console.log(JSON.stringify({ ...report, cards: undefined }, null, 2));
if (report.failures.length) process.exitCode = 1;
