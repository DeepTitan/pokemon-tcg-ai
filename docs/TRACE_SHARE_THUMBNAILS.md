# Shared match thumbnails

The thumbnail and social metadata must select the same deck centerpieces as the desktop archive. `scripts/build-share-runtime.mjs` bundles the actual `archiveMatchup`, `identifyDeck`, frequency baseline, and public-art resolver from `src/tracker`; no separately maintained classifier is used.

The Vercel handlers read the existing public replay for that share link. This includes its already-shared starting inventories. They emit only the derived matchup image/description, do not add public API fields, and do not update cloud match records. A bounded five-minute cache retains only the small derived model, not the full replay. Gzip replay responses are decoded correctly. Missing starting inventories retain the app's board-based fallback.

Printed card metadata is a release asset, exported from the same PTCGL card tables that the desktop resolves. It contains no player data, match logs, IDs, or credentials. Original cached Mega-era Pokémon artwork supplies images missing from the older public image provider. Asset reads use a bundled allowlist; incoming paths cannot select arbitrary files. Catalog/art assets are included in the server functions and excluded from the landing site's static output.

To refresh these release assets from the installed game:

```sh
node --import tsx scripts/build-share-catalog.ts <PTCGL-config-cache> <Trace-card-art>
```

Normal deploys rebuild the classifier bundle from source without needing an installed game. `npm --prefix landing test` builds the same bundle and checks all 96 reviewed starting-deck cases against the release catalog, stale previews, a Dragapult mirror, missing decks, real Meowth artwork, cache expiry, and retry behavior. The full tracker regression suite must also pass.

The September 14 selector release uses image version 6. Persistent `/trace/:shareId` links are unchanged. Existing previews already cached inside messaging clients may remain old. Re-pasting the same match URL with `?preview=6` requests a distinct page URL while retaining the same match and canonical URL; messaging-client refresh behavior remains client-controlled.

Verified public cases before deployment:

- `iSeI8XrGnpD4vM_-TKqaLT1K`: Dragapult ex vs. Dragapult ex, 3–0 prizes.
- `Bqni_fMtxvQrDl6zNHRlyEhS`: Dragapult ex vs. Mega Starmie ex, 0–0 prizes (recorded values unchanged).

The approved visual layout is unchanged. Only selected cards, their captions, artwork availability, and corresponding social metadata are corrected.

The Facebook crawler compatibility release uses image version 7. Preview media is served from the existing Trace host (`victoryroad-lovat.vercel.app`), whose robots.txt explicitly allows `/api/share-card`; the apex site's robots.txt disallows `/api/`. Match and canonical URLs remain on `victoryroad.app`. Social metadata is inserted immediately after the charset declaration, before the large inlined replay stylesheet. The replay's existing `noindex, nofollow` directive is preserved.

## Card framing audit (image version 8)

All 101 bundled textures and all 588 top-level card-art PNGs in the local Trace cache were checked (689 files, with overlap between the two sets). They are 256-square PTCGL textures: 413 files expose transparent gutters and 276 have flattened white/gray gutters. All pass the shared 182-by-256 centered frame contract. All 101 bundled cards were also reviewed in rendered contact sheets. Original artwork files are unchanged.

The thumbnail renderer uses that source-specific frame for PTCGL textures, not the square canvas. Downloaded portrait artwork is measured by its alpha bounds; opaque card borders are preserved, and images are never stretched. Both sides render at 402 pixels tall. Unrecognized or broken images use the correctly sized card back rather than silently letterboxing an invalid image. SVG cropping preserves original resolution.

`npm --prefix landing test` checks every bundled asset, including transparent and flattened variants, off-center padding, opaque borders, invalid assets, fallback artwork, and visible height. A changed texture layout fails the asset audit. Run `npm --prefix landing run audit:art`, or `TRACE_ART_AUDIT_OUTPUT=/tmp/trace-art-audit node scripts/audit-share-card-art.mjs <art-directory> [...]` to produce a JSON report and contact sheets. This is an artwork audit, not a claim that every remote catalog image has been downloaded and inspected.

The 96-deck regression corpus selects 42 distinct printings. The artwork audit also caught an unhandled numbered-foil suffix (`_ph2`) and a missing [SVP 166 provider mapping](https://limitlesstcg.com/cards/SVP/166); both were corrected without changing deck identification or game data. All 42 resolve after these fixes (21 bundled, 21 fetched successfully from the external providers and passed the sizing check). The production build runs the complete asset-framing test before publishing.
