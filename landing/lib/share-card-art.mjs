import { Resvg } from '@resvg/resvg-js';

// Measure in a fixed coordinate space, then crop with an SVG viewBox. The final
// renderer still samples the original artwork; this does not downsample assets.
export const ART_SCAN_SIZE = 256;
export const CARD_DISPLAY_HEIGHT = 402;

export function artDataUri(image) {
  return `data:${image.contentType};base64,${Buffer.from(image.bytes).toString('base64')}`;
}

export function artScan(image) {
  const size = ART_SCAN_SIZE;
  return new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><image href="${artDataUri(image)}" width="${size}" height="${size}" preserveAspectRatio="xMidYMid meet"/></svg>`, {
    font: { loadSystemFonts: false },
  }).render().pixels;
}

function boundsOf(rows, columns) {
  const xs = columns.flatMap((count, x) => count > 0 ? [x] : []);
  const ys = rows.flatMap((count, y) => count > 0 ? [y] : []);
  if (!xs.length || !ys.length) throw new Error('Card artwork is empty');
  return { x: xs[0], y: ys[0], width: xs.at(-1) - xs[0] + 1, height: ys.at(-1) - ys[0] + 1 };
}

function portrait(bounds) {
  const ratio = bounds.width / bounds.height;
  return ratio >= 0.64 && ratio <= 0.8 && bounds.height >= 100;
}

export function measureCardArt(image) {
  if (image.layout === 'ptcgl-square') {
    const bytes = Buffer.from(image.bytes);
    if (bytes.length < 24 || bytes.subarray(1, 4).toString() !== 'PNG'
      || bytes.readUInt32BE(16) !== 256 || bytes.readUInt32BE(20) !== 256) {
      throw new Error('Unrecognized PTCGL card texture dimensions');
    }
    // PTCGL's 256-square textures use the same centered 182x256 card frame.
    // Alpha variants expose this frame directly; flattened variants also have
    // gray/white gutters and art bleeding outside it. Use the frame, not the
    // full texture or a color trim that could cut off card text or borders.
    return { x: 37, y: 0, width: 182, height: 256, method: 'ptcgl-frame' };
  }
  const size = ART_SCAN_SIZE;
  const pixels = artScan(image);
  const rows = Array(size).fill(0);
  const columns = Array(size).fill(0);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    if (pixels[(y * size + x) * 4 + 3] > 16) { rows[y]++; columns[x]++; }
  }
  const alphaBounds = boundsOf(rows, columns);
  if (portrait(alphaBounds)) return { ...alphaBounds, method: 'alpha' };

  throw new Error('Card artwork has unrecognized padding or proportions');
}

export function framedCardArt(image, centerX, top = 124, height = CARD_DISPLAY_HEIGHT) {
  const bounds = image.bounds || measureCardArt(image);
  const width = height * bounds.width / bounds.height;
  return `<svg x="${centerX - width / 2}" y="${top}" width="${width}" height="${height}" viewBox="${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}" preserveAspectRatio="xMidYMid meet" overflow="hidden"><image href="${artDataUri(image)}" width="${ART_SCAN_SIZE}" height="${ART_SCAN_SIZE}" preserveAspectRatio="xMidYMid meet"/></svg>`;
}
