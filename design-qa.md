# Trace Elo match-card design QA

## Evidence

- Source visual truth: `/Users/theisaiahw/.codex/generated_images/01a02079-54ad-7531-8412-0962aa60ae71/exec-58ff2c36-dbea-4d17-b07b-7384b24d8331.png`
- Browser-rendered implementation: `/tmp/trace-elo-match-cards-final.png`
- Full rail comparison: `/tmp/trace-elo-qa-full-final.png`
- Focused card comparison: `/tmp/trace-elo-qa-focused-final.png`
- Browser viewport: 1280 × 720 CSS pixels, device pixel ratio 2
- Implementation screenshot: 1280 × 720 pixels (browser-normalized CSS-pixel capture)
- Source image: 1041 × 1510 pixels
- Full comparison normalization: source scaled proportionally to a 304 px rail width; implementation cropped to the 305 × 720 px archive rail and normalized to 304 px width
- Focused comparison normalization: source card cropped to 946 × 459 px and scaled proportionally to 560 × 272 px; implementation card cropped to 283 × 147 px and scaled proportionally to 560 × 291 px
- State: completed defeat against `pikapenguin25`, 1753 local Elo versus 1755 opponent Elo, −13 Elo, new rating 1740

## Full-view comparison

The implementation preserves the selected source's hierarchy inside the real 298 px production archive rail: two deck-defining cards first, Elo directly under each card, opponent name as the primary text, result and signed Elo change next, new rating below, and the three match facts on a full-width footer row. The generated source depicts two matches while the production-data browser fixture contains one; this is a data-state difference rather than layout drift. The requested terminal “All matches loaded” footer is absent.

## Focused card comparison

The focused comparison confirms the same left/right split, image scale, player-color labels, typography hierarchy, semantic defeat border, and footer rule. The implementation intentionally compresses type and spacing slightly to fit the existing desktop app's fixed archive rail without widening or displacing the replay board.

## Required fidelity surfaces

- Fonts and typography: the existing Nunito/product system is preserved; opponent, result, Elo change, and new rating now follow the source's optical order without wrapping or truncation in the tested card.
- Spacing and layout rhythm: card images and content remain centered in the fixed rail; the metadata footer spans both columns, and the empty terminal footer no longer consumes vertical space.
- Colors and visual tokens: existing navy, cream, local blue, opponent red, trophy gold, and semantic victory/defeat borders are reused. Contrast remains clear at production density.
- Image quality and asset fidelity: real locally resolved Pokémon card art is used; no placeholder drawings or replacement assets were introduced. The browser fixture shows the cards actually observed in that captured match.
- Copy and content: deck-name prose was removed; the card now reads `YOU 1753`, `THEM 1755`, `DEFEAT · −13 ELO`, `New rating 1740`, followed only by date, duration, and Prize score.

## Comparison history

- Initial P2: the date, duration, and Prize score stacked vertically inside the text column, unlike the source's scannable full-width footer. Fix: moved metadata into a second grid row spanning both card columns. Post-fix evidence: `/tmp/trace-elo-match-cards-3.png` and `/tmp/trace-elo-qa-focused-final.png`.
- Initial P2: result hierarchy was too quiet and the selected gold border overrode the result tone. Fix: increased opponent/result/new-rating optical sizes and added semantic victory, defeat, incomplete, and recording borders. Post-fix evidence: `/tmp/trace-elo-match-cards-final.png`.

## Interaction and runtime checks

- Selecting the completed match card retained the `selected` state.
- Collapsing and reopening Match Archive worked and restored the card.
- Accessible card copy exposed both exact Elo values, signed change, new rating, complete date, duration, and Prize score.
- The final DOM contained no `All matches loaded` text.
- Reload-and-interact page-error watch reported no runtime exceptions.
- Tracker unit suite, production tracker build, Rust formatting check, and 26 Rust library tests passed.

## Findings

- P0: none.
- P1: none.
- P2: none after the two visual corrections above.

## Follow-up polish

- P3: the browser fixture predates SQLite duration persistence, so it displays an em dash for time; native stored matches populate the same slot with their captured duration.

final result: passed
