# Trace compact match-card design QA

## Evidence

- Source visual truth: `/var/folders/sf/pzrlm0hd5rz9kbcp4k_dz9sc0000gn/T/codex-clipboard-2af87837-7f24-4722-8918-ddfd75ccb4e2.png`
- Browser-rendered implementation: `/tmp/trace-compact-card.png`
- Focused implementation capture: `/tmp/trace-compact-card-focused.png`
- Browser viewport: 1280 × 720 pixels
- Source crop: 608 × 290 pixels (a 2× desktop capture representing an approximately 304 × 145 CSS-pixel archive card)
- Tested state: completed defeat against `pikapenguin25`, 1753 local Elo versus 1755 opponent Elo

## Full-view comparison

The implementation restores the source card's compact two-column composition: overlapping featured Pokémon on the left; opponent and result on one line; deck matchup below; and date, duration, and Prize score in the original stacked metadata rhythm. The previously added full-width statistics row, standalone Elo result line, new-rating line, and semantic result border are absent.

## Focused card comparison

The source's blue `YOU` and red `THEM` ribbons remain attached directly to the card art. Elo is added only inside those existing ribbons (`YOU · 1753` and `THEM · 1755`), so it does not create another row or increase the card's height. The tested compact-height viewport renders the card at 280 × 120 CSS pixels; the normal-height rule remains the source-compatible 132-pixel card height.

## Required fidelity surfaces

- Fonts and typography: the existing Nunito/product typography, opponent emphasis, result badge, deck matchup, and small metadata hierarchy match the source. Elo uses the ribbon's existing compact uppercase treatment without wrapping.
- Spacing and layout rhythm: the original 118-pixel artwork column, compact two-column body, internal gaps, and stacked metadata layout are restored. No added footer bar consumes vertical space.
- Colors and visual tokens: the source's cream card, navy text, green/red result badges, gold accent, and blue/red player ribbons are preserved without new visual treatments.
- Image quality and asset fidelity: real resolved Pokémon card art remains the primary visual. No placeholder, synthetic, or replacement assets were introduced.
- Copy and content: the original opponent, deck matchup, full date, duration, and Prize-score copy is restored. The only visible addition is each player's exact Elo inside the existing card ribbon. The terminal `All matches loaded` footer remains removed.

## Interaction and runtime checks

- The completed match remains selectable after collapsing and reopening Match Archive.
- The rendered card contains `You · 1753` and `Them · 1755`.
- The rendered DOM contains no standalone result/Elo row, no new-rating row, and no `All matches loaded` text.
- Browser logs contain no runtime warnings or errors from the application.
- The full tracker test suite and production tracker build pass.

## Findings

- P0: none.
- P1: none.
- P2: none.

## Follow-up polish

- P3: none for this scoped restoration.

final result: passed

---

# Trace share thumbnail design QA

## Ground truth

- Source reference: `/var/folders/sf/pzrlm0hd5rz9kbcp4k_dz9sc0000gn/T/codex-clipboard-d3ee3b11-4d74-40f8-bb63-5d980fbbe020.png`
- Source dimensions: 558 × 292
- Implementation capture: `artifacts/design-qa/social-card-1200x630.png`
- Implementation dimensions: 1200 × 630 at 1× density
- Small-unfurl check: `artifacts/design-qa/social-card-messenger-size.png` at 360 × 189
- Side-by-side evidence: `artifacts/design-qa/source-vs-implementation.png`
- State: real shared match `iSeI8XrGnpD4vM_-TKqaLT1K`, isaiahw vs. 6TiramiSUI7

## Comparison passes

1. Full-view layout: passed. The paired Pokémon cards remain the primary visual, the matchup and result read next, and date/time/prize score form one consistent metadata group. No clipping or overlap is visible at 1200 × 630.
2. Thumbnail-size layout: passed at 360 × 189. Match result, opponent, both Pokémon, ratings, duration, and prize score retain the intended hierarchy. Fine-print copy is correctly subordinate.
3. Typography: passed after replacing host fonts with bundled Nunito Regular, SemiBold, ExtraBold, and Black files. Local and Vercel renders now match and preserve Trace's display/body hierarchy.
4. Color and surfaces: passed. Trace blue, opponent red, victory green, gold metadata accent, cream surface, and pale board-blue panel map directly to the product palette. Borders and shadows separate the two real card images without adding decorative noise.
5. Image quality: passed. Both Pokémon use the real card artwork selected from the recorded final board, and the header uses the real Trace mascot. No generated or placeholder imagery is present in the tested match.
6. Copy and content: passed. The card states the actual opponent, result, matchup, timestamp, duration, prize score, and ratings. The closing line matches the product positioning: “Review the spot. Find the line.”
7. Metadata and accessibility: passed. The share page exposes 1200 × 630 PNG Open Graph metadata, a descriptive image alt value, matching Twitter large-image metadata, semantic title/description copy, and a canonical URL.
8. State/interaction scope: not applicable to the fixed social image. The linked browser replay remains interactive and was not replaced by the thumbnail.

## Iteration history

- Initial Vercel render depended on host fonts and produced missing-glyph boxes. Fixed by bundling the open-source Nunito TTF weights and rendering with Resvg.
- Initial social renderer downloaded the full 118-frame replay. Fixed by persisting a compact public social summary containing the selected card IDs/names, prize score, ratings, duration, and match identity.
- Initial Node function returned a web `Response` object that the project adapter did not flush. Fixed by using the Node response stream explicitly.

## Final result

Passed. The deployed preview image is byte-identical to the approved local render and returns HTTP 200 as a 1200 × 630 PNG.
