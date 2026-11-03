# Leaderboard tabs — November 2, 2026

final result: passed

## Visual target and evidence

- Selected direction: option 1, with the user's requested revision removing explanatory copy and capture dates. Explanation is available only from the Trace rating info button.
- Source visual: `artifacts/leaderboard-tabs/approved-mock.png` (1398 × 1125).
- Implementation: `http://127.0.0.1:4011/trace/leaderboard`.
- Desktop evidence: `artifacts/leaderboard-tabs/desktop-live.jpg` and `artifacts/leaderboard-tabs/desktop-trace-tooltip.jpg`.
- Desktop browser override: 1398 × 1125 CSS pixels; document width is 1383px excluding the scrollbar. Browser screenshot output is 1383 × 1113 pixels. Source and implementation were compared proportionally rather than treating this browser output scale as layout drift; no image stretching or retouching was applied.
- Mobile evidence: `artifacts/leaderboard-tabs/mobile-live.jpg` and `artifacts/leaderboard-tabs/mobile-trace-tooltip.jpg`, captured with a 390 × 844 CSS viewport; browser output is 375 × 812 pixels. Viewport override reset after verification.
- State: registered players, all match counts, empty search; Live selected by default. Trace screenshot intentionally shows the tooltip. Public feed refreshed during testing, so lower rows can change between captures.
- Full-view comparison: source and rendered desktop Live screenshots opened together in the same image-comparison tool result. The mobile tooltip was included in that comparison. Final desktop Trace capture also opened and inspected.
- Focused comparison: inspected tabs, table headings, first eight rows, and the tooltip in those full-resolution images. Text and alignment were readable without separate cropped artifacts.

## Findings and accepted differences

No remaining actionable P0/P1/P2 findings.

- Typography: preserves the current site's bundled Roboto and Nunito navigation fonts, weights, and table sizes. The generated mock uses larger typography; the implementation deliberately keeps the existing production density, allowing more rows to remain visible.
- Spacing/layout: retains the production 1076px content grid, 49px rows, and existing controls. The approved underline-tab hierarchy is reproduced. The generated image's wider container and eight-row truncation are conceptual differences, not new product requirements.
- Colors/tokens: existing cream, navy, muted text, gold active line, medal colors, and green/red record bars are retained.
- Assets: existing Trace mascot and Victory Road images remain intact. Info and crown icons use the existing Phosphor library.
- Copy/content: no top explanation, subtitle, capture dates, or extra scope labels. The Live column displays real raw ratings. Trace explanation is hidden until hover/focus/tap. Data coverage details remain inside the existing collapsed footer disclosure.
- Mobile: tabs, search, filter, and toggle fit; existing compact table remains readable. Tooltip fits the viewport and dismisses with Escape or outside interaction.

## Comparison history

1. Initial rendered inspection found the Trace info button made its table header taller than Live's. Set a common minimum height on the rating-column title so switching tabs does not shift the rows. Final captures confirm aligned headers.
2. Interaction inspection found the method page's back link lost the selected Trace tab. Preserved the ranking query. Final browser check confirmed it returns to Trace.
3. Final captures show the requested minimal interface and the corrected interactions. No remaining blocking visual issues.

## Verification

- Production leaderboard build and scoped strict TypeScript check passed.
- 45 focused test cases passed across ranking selection/order, missing Live values, sharing, snapshot refresh, public projection, page metadata, image rendering, and preview cache separation.
- Browser checked: default Live sort; Trace sort; preserved search across tabs; no-result search and clear; match-count filters; unregistered population; next-page and tab-change pagination reset; arrow-key tabs; copied Trace link; direct Trace reload; profile navigation and loaded match history; method navigation and return; tooltip click/focus and Escape; mobile views.
- Browser console inspection returned no warnings or errors after these checks.
- Live data uses the existing sanitized public feed and automatic refresh. No seeded demo values are used. Trace replay and eligibility logic are unchanged.

## Follow-up

Review the local result before the production release. The implementation uses the current website source at base commit `86d9f06`, on branch `codex/live-leaderboard-tabs`. This is a website change, not a desktop-app release.
