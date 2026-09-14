# Browser replay parity

The shared viewer uses the same `TrackerApp`, board components, card adapters,
damage/attack/position models, and navigation implementation as the desktop app.
It loads the already reconstructed, public shared review; it does not run a
second gameplay engine or rebuild the captured sequence with different rules.

## September 14, 2026 repair

Two web integration gaps made the shared viewer behave differently:

- Browser card lookup called `/api/turnlume/card-sources`, a local development
  endpoint which returned 404 in production. Public provider URLs also returned
  404 for newer Mega-era sets, so known cards rendered as card backs.
- Shift+A/D jumped to the first/latest frame, but Shift+Left/Right fell through
  to single-frame navigation. A focused replay slider bypassed the app handler.

Shared URLs now resolve printed metadata from static per-set catalogs under
`/tracker-assets/card-catalog/`, and original available artwork under
`/tracker-assets/card-art/`. Native lookup and localhost tracker lookup remain
unchanged. The shared keyboard handler maps Shift+Left/A to first and
Shift+Right/D to latest, even with the scrubber focused. Left/A and Right/D step
one frame; Up/W and Down/S navigate meaningful events. Inspectors, editable text,
composition events, and browser/board zoom modifiers retain their own input.

## Assets and boundaries

- 25,394 printed catalog entries, split by set and requested lazily.
- 588 original available card images, normalized to 182×256 portrait frames.
- Full printed details are retained (rules, classification, retreat, weakness,
  resistance, set/number, attacks and abilities), not only thumbnail metadata.
- Exact artwork variants are preferred, with base-printing and provider
  fallbacks when original art is not bundled. This is not a claim that every
  future or uncached printing has an original image in this release.
- No local paths, match records, hidden card identities, or user telemetry are
  exported into these static catalogs. Shared match data is not modified.
- Per-set requests coalesce; the in-memory cache is bounded to 32 sets.
  Failures remain retryable and never block the recorded board from loading.

Refresh available printed metadata and original artwork at release time:

```sh
node --import tsx scripts/build-share-catalog.ts <PTCGL-config-cache> <Trace-card-art>
node scripts/build-replay-art.mjs <Trace-card-art>
npm --prefix landing test
npm run tracker:test
npm run tracker:build
node landing/build.mjs
```

Only card-database files and allowlisted card-image filenames are exported.
The landing build validates all bundled card frames and copies these assets to
`/tracker-assets/` on `victoryroad-lovat.vercel.app`. Production requests use
that host directly (including image URLs): the apex is a separate deployment
and does not forward the nested catalog/art paths. Local previews use relative
paths. The original public Trace asset host supports cross-origin requests.

## Verification

The reported isaiahw/pau1ek public replay (`uZEUk2bui30licgLu7or7Ngm`) has 130
frames, reducer version 17, and 48 distinct known card IDs. All 48 resolve to
hosted images; no provider fallback is needed for this match. Chrome checks
cover the bench, hand, stadium, attachments, card inspector, first/latest frame
navigation (0/129), single stepping (128/129), meaningful events (123/129), and
blocking replay shortcuts while an inspector is open. The existing tracker
suite and all landing tests pass, including the 96-deck thumbnail regression
corpus and asset framing checks.

This is a web deployment, not a native installer release. Native installations
already have their local artwork service; the shared shortcut changes will be
included in the next desktop build.
