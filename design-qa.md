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
