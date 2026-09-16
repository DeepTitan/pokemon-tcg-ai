# Trace leaderboard deployment

## Existing website

The leaderboard is built in the existing **victoryroad** Vercel project. It shares
that deployment with the Trace landing page, download access, shared-match pages,
and replay viewer. The separate existing **prize-map** Vercel project owns the
`https://victoryroad.app` apex domain and proxies `/trace` routes to Trace's stable
alias, `https://victoryroad-lovat.vercel.app`. Do not create another hosting project or replace the existing site
configuration to publish it.

The apex project's `next.config.ts` includes `beforeFiles` routing for nested
`/trace/players/:name` and `/trace/leaderboard-static/:path*` requests. Those apex
changes are a separate release and are not included in this Trace source checkout.
Promote both prepared projects when shipping the new public routes.

Public routes:

- `/trace/leaderboard` — player standings; `#method` opens the rating explanation.
- `/trace/players/<encoded-player-name>` — a player's rating and match history.
- `/trace/leaderboard-static/events.json` — the public, sanitized match snapshot.
- `/trace/leaderboard-static/assets/` — the compiled leaderboard application.
- `/trace/leaderboard-static/card-art/` — featured Pokémon card images.
- `/trace/leaderboard-static/previews/` — screenshot thumbnails for link previews.

The specific leaderboard and player rewrites precede the existing
`/trace/:shareId` shared-match rewrite. `/trace/access` continues to use the download
access handler. The existing root landing page and replay assets remain in the same
`landing/dist` output.

## Snapshot and refresh policy

This release uses the **September 16, 2026 snapshot**: 375 player identities,
including 11 registered Trace players, with 319 matches counted by the rating
engine. The snapshot is a publication artifact, **not an automatically refreshed
feed**. New matches and registration changes appear only after the public snapshot
is regenerated, verified, and deployed again.

`landing/leaderboard/events.json` contains only the reviewed public projection.
Private raw captures do not belong in this release tree. Generate an updated public
file in the private working repository using
`projectPublicLeaderboardSnapshot` from `scripts/leaderboard-public-snapshot.ts`.
Never copy the raw archive directly into the deployment input.

The recursive allowlist retains the names, registration status, match outcomes,
Live scores, featured Pokémon, prizes, and duration needed for the UI and rating
replay. It removes source paths, diagnostic evidence, raw logs, full decklists,
unused after-scores, and private observation records. Verified season mappings, if
present, retain their numeric values and availability time with a generic public
evidence label. Projection must leave every unrounded rating update, accepted match,
and duplicate/conflict decision unchanged.

## Build and export

The root `vercel.json` defines the existing site's complete build sequence:

```sh
npm --prefix landing ci
node scripts/build-share-runtime.mjs
npm run tracker:build
npm run leaderboard:build
node landing/build.mjs
node --import tsx scripts/build-leaderboard-pages.ts
```

Vercel installs the root package dependencies before this build command. For a new
local checkout, install the root dependencies with `npm ci` first.

`vite.leaderboard.production.config.ts` builds the app with the `/trace` route base
and `/trace/leaderboard-static/` asset base. `landing/build.mjs` preserves the existing
landing and replay build. `build-leaderboard-pages.ts` then reapplies the public
allowlist, copies only the required leaderboard assets, and writes:

- `landing/dist/trace/leaderboard-static/` — public JSON, app, artwork, and thumbnails.
- `landing/assets/leaderboard-pages.json.gz` — server-rendered HTML metadata for the
  leaderboard and every player.

The generated page bundle is included with `api/leaderboard-page.mjs`, which delegates
to `landing/api/leaderboard-page.mjs`. The bundle stays out of public static asset
copies. Social crawlers receive titles, canonical URLs, and screenshot image metadata
without running React. Unknown players receive a 404. Page rendering does not fetch
the private archive or call a remote data service.

`dist-leaderboard`, `landing/dist`, the generated page bundle, `.vercel`, dependency
directories, environment files, and credentials are not release source files.

## Screenshot thumbnails

Thumbnails are **1200 × 630 JPEG screenshots of the real app**, using its
`?preview=share` layout for larger text and fewer rows. The checked-in files live in
`landing/leaderboard/previews/`: `leaderboard.jpg` and one `<player-id>.jpg` image for
each registered player. Player profiles without a screenshot use the leaderboard
image, with matching alternative text.

The exporter adds a content hash to image URLs to refresh message previews when an
image changes. Screenshot generation is manual; refreshing the JSON alone does not
refresh those images. Regenerate screenshots when updating the snapshot or visual
design, and verify the board and player screenshots agree with the displayed rating.
Keep existing card artwork in `landing/leaderboard/card-art/` synchronized with the
featured Pokémon references.

## Preserved download behavior and validation

This release carries forward the existing download-access wrapper, library, and
tests (`api/download-access.mjs` and `landing/lib/download-access*`). The landing
download flow continues to use that handler and the existing deployed environment
configuration. Do not reset download secrets or replace the access system while
publishing the leaderboard. No credentials are stored in this checkout.

Before deployment, run the rating/projection and social metadata checks, the
leaderboard page-handler tests, the preserved download tests, and the full site
build. In particular:

```sh
node --import tsx scripts/__tests__/leaderboard-public-snapshot.test.ts
node --import tsx scripts/__tests__/leaderboard-social-preview.test.ts
node --test landing/lib/leaderboard-page.test.mjs landing/lib/download-access.test.mjs
```

Then verify board and player navigation, image URLs, the public JSON projection,
and the existing landing/download/shared-match routes. This is a website release;
its commit message must not use the desktop release automation's `[PATCH]` marker.
