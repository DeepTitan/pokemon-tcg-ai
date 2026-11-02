# Live-first leaderboard release — November 2, 2026

Published after the user approved the local two-tab build and requested shipment.

- Public page: https://victoryroad.app/trace/leaderboard
- Trace tab: https://victoryroad.app/trace/leaderboard?ranking=trace
- Source commit: `43f2c28` on `codex/live-leaderboard-tabs`.
- Production deployment: `dpl_BfN4e7CznewrwEEVTShLnCEmy1Cq`.
- Deployment URL: https://victoryroad-qnaq1kl1j-deeptitan-6729s-projects.vercel.app
- Existing project: `victoryroad`, `prj_xu8lQXM29IgPY7fLDvbkT4qah4Ta`.
- Stable upstream: https://victoryroad-lovat.vercel.app
- Previous production: `dpl_8tQMsCCcqDUVVZBCnbiP3BYMRxjD`, source `86d9f069e7240d9e047153589eed0fca29096545`.

The release adds Pokémon TCG Live as the default ranking view. Trace rankings remain available in the second tab, with a hover/focus/tap explanation in the rating header. Capture dates and top-of-page explanation were removed per user feedback. The Trace calculation and match eligibility are unchanged.

## Deployment and verification

Used the existing project and production environment. The full configured build completed with `--prod --skip-domain`, then authenticated staged requests verified the new bundle, public feed, metadata, and both social images. Promoted the reviewed deployment with `vercel promote`. The stable upstream resolves to the new deployment. No apex routing or environment changes were required.

Canonical public checks returned HTTP 200 for the landing page, both leaderboard views, AudioPusher's profile, account page, training page, public feed, and both share images. The public leaderboard serves `/trace/leaderboard-static/assets/leaderboard-BjGIk_W7.js`, matching the reviewed local build. Share images are distinct valid 1200 × 630 PNGs. The feed contained 2,015 players and 2,331 matches during staging and continues to refresh.

Browser verification on the canonical public URL confirmed Live selected by default, correct Live and Trace ordering, the Trace-only explanation and Escape dismissal, and a copied public Trace link that preserves `ranking=trace`. No console warnings or errors originated from the public site; unrelated Vercel sign-in logs were excluded. The public Live view was left open.

Validation includes the earlier production build, strict TypeScript, and 45 focused tests, plus 24 release-time download/feed/page/preview checks. Screenshot and HTTP evidence are kept locally under `artifacts/leaderboard-release/`, including `production-live.jpg` and `production-checks.json`.

## Rollback reference

The previous complete deployment remains available at https://victoryroad-9kviazqj2-deeptitan-6729s-projects.vercel.app. If a rollback is requested, promote that deployment in the same project; do not redeploy an older source checkout or change the apex routes.
