# Trace leaderboard — design QA

## Text cleanup

2026-09-16: preserved the approved cream/navy/gold styling and compact tables while reducing repeated labels. Removed Few matches and No rating yet row subtitles, redundant navigation hints, duplicate history headings/counts, and the repeated profile footnote. Shortened share buttons, kept feedback and errors, and replaced changing refresh chatter with one quiet automatic-update note. Moved perspective/rounding explanations into existing details. Preserved Not registered, empty-record states, opponent Live ratings, timing caveats, full formula/settings, result badges, and sticky player identity.

CUA evidence: desktop leaderboard/profile/rating popover and 390 × 844 board/profile/method captures inspected. No mobile page overflow; mobile opponent Live ratings and dates remain visible. Unregistered toggle still shows explicit labels. Preview renderer v4 removes redundant instructions; copied links use p5. Strict TypeScript, production build, 25 metadata/preview/renderer tests and 3 sharing-route tests pass. Production verified at https://victoryroad-iit2qo1mw-deeptitan-6729s-projects.vercel.app through the existing victoryroad.app routes. Final JS, copy labels, opponent header and no page overflow confirmed in the browser. Both current 1200×630 PNGs were visually reviewed; Facebook-crawler metadata and image GET/HEAD/304 checks passed. Final copy review retained a visible Opponent Live header and accessible button names containing Copy link.


## OP.GG-inspired visual refinement

2026-09-16: user asked to keep Trace's identity but make the entire leaderboard feel less soft and bubbly, closer to OP.GG. Reference inspected in the in-app browser: `https://op.gg/lol/leaderboards/tier`, including its compact rankings table, restrained sans-serif type, small labels, clear rules and record bars. Existing Trace screens and Eevee assets remain the product reference.

Implemented a bundled neutral Roboto UI family, 2–3 px corners, compact controls, navy table headers with legible light labels, right-aligned rating/win-rate columns, narrow W/L record bars, and restrained top-three rank accents. Kept cream/navy/gold, Eevee, the familiar Trace wordmark, prominent WIN/LOSS badges and the sticky player identity. The same treatment reaches rating details, method text and both dynamic share images. No rating or capture behavior changed.

Evidence: CUA captures of the board at 1280 × 900 and 390 × 844, profile at 390 × 844, and ratings method at 390 × 844. Both mobile tables fit without horizontal scrolling. Public player/rating values agree with the source feed. New visual PNGs `/tmp/trace-sharp-leaderboard-preview.png` and `/tmp/trace-sharp-player-preview.png` were reviewed alongside the prior images. Outcome hierarchy remains visible while typography and borders are sharper. A before/after profile comparison was also rendered together; viewport sizes differed, so it was used only to assess type/color treatment rather than pixel geometry.

Interaction checks: search filters correctly; Show unregistered includes grey rows with explicit labels; one-game and zero-game rows remain clear. Desktop rating-help link remains available. Review caught and fixed leaked mobile typography overrides and restored 16 px mobile search text. Strict TypeScript, production build, 25 metadata/preview/renderer tests and 3 sharing-route tests pass. Renderer revision is v3 and copied sharing links use p4.

Visual QA passed at 1280 × 900, 709 × 994 and 390 × 844. The first production pass confirmed fonts, navy headers and record bars, then caught the intermediate-width table minimum and crown collision. The compact breakpoint now begins at 760 px and the decorative crown hides below 1000 px. A fresh 709 px capture confirms every column fits with no table overflow. Facebook crawler metadata, both 1200 × 630 PNGs, HEAD and conditional 304 responses passed. Final production deployment `https://victoryroad-8pzsuazf8-deeptitan-6729s-projects.vercel.app` is live through victoryroad.app; its loaded font, final stylesheet and zero table overflow were verified at 709 px. Final result: passed.

Status: passed locally and in production, 2026-09-16.

## Reference and intent

The user supplied a Discord screenshot containing seven tall match rows without the player's name. They asked for a compact screenshot that keeps the player identifiable, then emphasized making victory/loss prominent. Existing Trace cream, navy, Eevee branding, fonts and card art remain the visual reference.

Reference image: `/var/folders/sf/pzrlm0hd5rz9kbcp4k_dz9sc0000gn/T/codex-clipboard-1e30c13c-43da-4870-a646-a53615c82616.png`.

## Rendered evidence

- CUA before/after screenshots compared together at 1440 × 900: production profile before, local profile after. Before showed four complete rows; after showed ten complete rows with name, rating and record above the table.
- CUA mobile screenshot at 390 × 844: nine complete rows; no page-wide horizontal overflow. Opponent Live rating and date appear below the opponent's name. Pokémon names remain accessible and available as title text while the compact table shows card art.
- CUA scrolled mobile screenshot: player identity, rating and record stay pinned above the matches.
- Dynamic share preview: `/tmp/trace-compact-player-preview.png`, 1200 × 630, visually reviewed. Six recent games, large player identity and solid WIN/LOSS labels fit without clipping.
- Local route: `http://127.0.0.1:5181/trace/players/isaiahw`; production reference: `https://victoryroad.app/trace/players/isaiahw`.

## Checks and fixes

- Hierarchy: compact name/rank, record and rating header; result first in each row, followed by rating change and opponent.
- Contrast: white bold WIN/LOSS text on green/red badges; subtle row tint and a colored edge reinforce the result. Explicit text avoids relying on color alone. Badge contrast tests pass at 4.5:1 or better.
- Density: desktop rows approximately 58 px, mobile rows approximately 59 px. Desktop card art remains labeled; narrow screens use art with accessible names.
- Spacing: removed the oversized separate stats block and moved freshness detail to the footnote. The table heading also identifies the player.
- Behavior: Show more expands from 12 to 24 matches; sticky-header rating breakdown opens and closes with Escape; recorded results, rating deltas and opponent Live ratings remain unchanged.
- Responsive: no overlap or horizontal page overflow at the verified desktop/mobile sizes. Long opponent names wrap inside their column.
- Build and strict TypeScript checks pass. Existing renderer, metadata/API and profile-link tests pass. Share image and copied-link versions were advanced to refresh the design on new shares.

No rating formula, game capture or game client changes are included.

## Production verification

Deployed to `https://victoryroad-3kv2vb09z-deeptitan-6729s-projects.vercel.app`, aliased through the existing `victoryroad.app` Trace routes. The live profile shows ten complete rows at 1440 × 900, sticky identity, and the expected solid loss badge. Facebook crawler requests return current versioned PNG metadata, valid 1200 × 630 images, no-store responses, successful HEAD requests and conditional 304 responses. The downloaded production player image `/tmp/trace-production-player-preview.png` was visually reviewed and contains six compact rows with prominent results. New match uploads continued arriving in the public feed during verification.

## Training page and shared navigation — September 21, 2026

Source: `/Users/theisaiahw/.codex/generated_images/01a0c10c-a5a2-73d3-96ec-69e349e4bc04/exec-994a4b97-8e85-41d7-a548-ed8a7e5e2f5e.png`.
Implementation: `http://127.0.0.1:4011/trace/training`.
Evidence: `/tmp/trace-training-release-desktop.jpg`, `/tmp/trace-release-mobile-profile.jpg`.
Source and implementation compared together in the same browser-tool input at
1487×1058 CSS pixels / image pixels, DPR1. The user's requested speed/ETA and
consistent third tab are intentional additions. Live values naturally differ.

- Typography: same locally bundled Nunito Sans for training and shared navigation;
  existing readable Roboto leaderboard body preserved.
- Layout: selected horizontal hero and three-column compact records preserved.
  Shared header on training, leaderboard, profiles and method; at390×844 the brand
  row sits above three always-visible tabs. No horizontal page overflow.
- Color: cream/navy/blue/gold preserved; active tab shown consistently.
- Assets: approved Trace mascot and generated Victory Road logo; all images load.
- Content: unchanged verified records, live sanitized AWS metrics, no invented results.
- Interactions: Training→Leaderboard→How ratings work and profile→Training passed;
  correct active tab, live data, existing profile records and artwork confirmed.
- Console errors: none. Local public feed returned all15 verified checkpoints.
- Existing site/API suite:66 passed;3 projection/feed tests,3 share-route tests,
  projection/social metadata checks, strict scoped TypeScript and both Vite builds passed.
- Focused header and mobile screenshot inspection found no P0/P1/P2 issues.
  Earlier dashboard chart/record-density fixes remain intact. No new QA fixes required.

final result: passed

Production addendum: Vercel staging exposed a clean-URL rewrite mismatch; corrected
its target to the extensionless training directory before promotion. The corrected
staged page, API, fonts, logo and player page returned 200. After promotion, the
public apex dashboard rendered live metrics and all three tabs worked, including
the full ratings explanation. Production screenshot confirmed the selected design
with loaded data and branding. The public feed automatically refreshed at20:55 UTC.
No new browser errors or broken images on the production pages.

final result: passed
