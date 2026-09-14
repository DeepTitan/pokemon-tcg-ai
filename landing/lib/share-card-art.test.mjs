import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import { Resvg } from '@resvg/resvg-js';
import { originalCardArt } from './share-catalog.mjs';
import { artScan, measureCardArt, framedCardArt, CARD_DISPLAY_HEIGHT } from './share-card-art.mjs';
import { embeddedCardArt } from '../api/share-card.mjs';

const png = (body, width = 256, height = 256) => ({ contentType: 'image/png', bytes: new Resvg(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${body}</svg>`,
).render().asPng() });
const artwork = new URL('../assets/share-card-art/', import.meta.url);

test('every bundled card uses the audited PTCGL frame and renders at full card height', () => {
  const files = readdirSync(artwork).filter(name => name.endsWith('.png'));
  assert.ok(files.length >= 101);
  for (const file of files) {
    const image = originalCardArt(file.slice(0, -4));
    assert.ok(image, `${file}: must be in the original-art allowlist`);
    const bounds = measureCardArt(image);
    assert.deepEqual(bounds, { x: 37, y: 0, width: 182, height: 256, method: 'ptcgl-frame' }, file);
    const scan = artScan(image);
    // A changed texture layout must fail CI instead of silently cropping a new
    // asset. Current opaque variants have white outer gutters; others use alpha.
    for (const x of [5, 250]) for (let y = 0; y < 256; y++) {
      const pixel = scan.subarray((y * 256 + x) * 4, (y * 256 + x) * 4 + 4);
      assert.ok(pixel[3] < 17 || [...pixel.subarray(0, 3)].every(v => v >= 245), `${file}: unexpected gutter`);
    }
    const render = new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="402">${framedCardArt(image, 200, 0)}</svg>`).render();
    const pixels = render.pixels;
    for (const y of [0, CARD_DISPLAY_HEIGHT - 1]) {
      assert.ok(pixels[(y * 400 + 200) * 4 + 3] > 16, `${file}: visible card must reach both height guides`);
    }
  }
});

test('downloaded artwork is trimmed by visible alpha, including off-center padding', () => {
  const image = png('<rect x="25" y="8" width="168" height="240" fill="red"/>');
  assert.deepEqual(measureCardArt(image), { x: 25, y: 8, width: 168, height: 240, method: 'alpha' });
  const markup = framedCardArt(image, 200);
  assert.match(markup, /height="402" viewBox="25 8 168 240"/);
  assert.doesNotMatch(markup, /preserveAspectRatio="none"/);
});

test('tightly cropped opaque art keeps the entire border and fallback has equal height', () => {
  const image = png('<rect width="180" height="252" fill="white"/><rect x="5" y="5" width="170" height="242" fill="red"/>', 180, 252);
  const bounds = measureCardArt(image);
  assert.equal(bounds.height, 256);
  assert.ok(bounds.width >= 182 && bounds.width <= 184);
  const back = { bytes: readFileSync(new URL('../assets/pokemon-card-back.jpg', import.meta.url)), contentType: 'image/jpeg' };
  assert.match(framedCardArt(back, 200), /height="402"/);
});

test('empty, corrupt and unrecognized square assets cannot silently become tiny cards', async () => {
  assert.throws(() => measureCardArt(png('')), /empty/);
  assert.throws(() => measureCardArt(png('<rect width="256" height="256" fill="red"/>')), /unrecognized/);
  assert.throws(() => measureCardArt({ bytes: Buffer.from('invalid'), contentType: 'image/png' }));
  assert.throws(() => measureCardArt({ ...png('', 512, 512), layout: 'ptcgl-square' }), /dimensions/);
  const unrecognized = png('<rect width="256" height="256" fill="red"/>');
  const badUrl = `data:image/png;base64,${unrecognized.bytes.toString('base64')}`;
  const fallback = await embeddedCardArt(badUrl);
  assert.equal(fallback.contentType, 'image/jpeg');
  assert.equal(fallback.bounds.height, 256);
});
