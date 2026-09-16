# Compact player match history — design QA

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
