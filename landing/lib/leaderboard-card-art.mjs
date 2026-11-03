import { readFileSync } from 'node:fs';
import { originalCardArt, shareCardCatalog } from './share-catalog.mjs';
import { publicCardArtUrl } from './generated/share-matchup.mjs';

const catalog = shareCardCatalog();
export const leaderboardArtManifest = JSON.parse(readFileSync(new URL('../assets/leaderboard-art-manifest.json', import.meta.url)));
const illustrations = new Map();
for (const [id, entry] of Object.entries(leaderboardArtManifest.cards)) {
  if (catalog.get(id)?.name !== entry.name) throw new Error(`Leaderboard art identity mismatch: ${id}`);
  if (!illustrations.has(entry.name)) illustrations.set(entry.name, id);
}

export const printingId = id => id.replace(/_(?:ph|sph|mph)\d*$/, '');

/** Only catalog-backed printings and recognized cosmetic finishes can load art. */
export function knownCardId(input, cards = catalog) {
  if (typeof input !== 'string' || !/^[a-z0-9-]+_\d+(?:_(?:ph|sph|mph)\d*)?$/i.test(input)) return undefined;
  const id = input.toLowerCase();
  return cards.has(id) || cards.has(printingId(id)) ? id : undefined;
}

function bundledArt(id) {
  if (!Object.hasOwn(leaderboardArtManifest.cards, id)) return undefined;
  return { bytes: readFileSync(new URL(`../assets/leaderboard-card-art/${id}.png`, import.meta.url)), contentType: 'image/png' };
}

/** Shared by history thumbnails and social images; never resolve by incoming names. */
export function leaderboardCardArt(input) {
  const id = knownCardId(input);
  if (!id) return undefined;
  const base = printingId(id);
  const exact = bundledArt(id) ?? bundledArt(base) ?? originalCardArt(id) ?? originalCardArt(base);
  if (exact) return exact;
  // A new finish/illustration can use the same catalog-confirmed Pokémon portrait.
  const name = (catalog.get(id) ?? catalog.get(base))?.name;
  return bundledArt(illustrations.get(name));
}

// Number-preserving set identities from PTCGL deck imports, verified against
// Limitless card pages when building the bundled manifest. Internal ALT IDs
// are deliberately excluded: their numbers are not public collector numbers.
const publicSets = {
  me1: 'MEG', me2: 'PFL', 'me2-5': 'ASC', me3: 'POR', me4: 'CRI', me5: 'PBL', 'me5-5': '30C', mebsp: 'MEP',
  sv1: 'SVI', sv2: 'PAL', sv3: 'OBF', 'sv3-5': 'MEW', sv4: 'PAR', 'sv4-5': 'PAF', sv5: 'TEF', sv6: 'TWM',
  'sv6-5': 'SFA', sv7: 'SCR', sv8: 'SSP', 'sv8-5': 'PRE', sv9: 'JTG', sv10: 'DRI', svbsp: 'SVP',
};
export function leaderboardPublicArtUrl(input) {
  const id = knownCardId(input);
  if (!id) return undefined;
  const base = printingId(id), [set, number] = base.split('_');
  const external = publicSets[set];
  return external
    ? `https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpci/${external}/${external}_${number.padStart(3, '0')}_R_EN_LG.png`
    : publicCardArtUrl(base);
}
