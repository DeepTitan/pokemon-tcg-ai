# History artwork repair — November 2, 2026

The current public leaderboard references 334 artwork IDs (309 numbered printings). The old endpoint bundled only a small Mega-era subset and redirected the rest to third-party image URLs, many of which failed. Trumbeak `me5_67` and its foil finish were affected. The audit found 174 successful images and 160 failures/card backs in this environment; those failures include an external CDN returning 403, so this is a request audit, not a claim that every browser saw exactly 160 broken images.

## Change

- Bundle verified portraits for every current history ID, plus four previously supported legacy illustrations. Native cached textures use the existing audited PTCGL crop. Remote images were taken from the image link on the corresponding Limitless card page after checking its card name against the native printed-card catalog.
- `landing/assets/leaderboard-art-manifest.json` records card identities, sources, verified pages, and SHA-256 digests. Internal alternate `svalt_142` uses the mechanically identical Chandelure `sv6_38`, matched on all printed gameplay fields; numbers are never inferred from ALT IDs.
- Add the 15 referenced 30th Celebration card definitions from the local PTCGL database to the existing printed catalog. No match records or ratings change.
- One resolver supplies history thumbnails and social images. Recognized foil suffixes normalize to their printed card. Future illustrations can use a portrait with the same catalog-confirmed Pokémon name; incoming names cannot select files.
- Publish normalized portraits as static files and bundle them with the image functions. Bump history URL and social-image revisions to invalidate old cached redirects/images.
- The Vercel build audits the current public feed and fails if any referenced artwork cannot resolve to a valid bundled portrait. This catches gaps at release time; it is not continuous monitoring of newly arriving cards. Valid but unbundled known sets have a public Limitless fallback.

## Maintenance

Run `node scripts/audit-leaderboard-art.mjs` against the live public feed, or pass a local public JSON snapshot as the first argument. For a new missing ID, verify its printed identity in the native catalog, obtain authentic artwork, normalize it using `renderLeaderboardCardArt`, and add its identity/source/digest to the manifest. Keep only printed-card metadata and public artwork in these assets. Local raw captures and player diagnostics must not be copied.

## Validation

- Full configured local website build succeeded; release gates include all bundled image checks and foil/Trumbeak regression cases.
- 33 focused image, page, and social-renderer tests passed.
- Full-project TypeScript reports existing errors in untouched engine/tracker fixtures and CaptureSetupModal icon imports; the scoped changed-code TypeScript check is recorded separately.
- Local visual inspection confirms Trumbeak, Mega Chandelure, Tyrantrum, Chandelure, Mew ex, Archaludon ex, and Dudunsparce use correctly framed authentic artwork.

Deployment and live verification will be recorded after staged checks.
