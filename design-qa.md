# Trace landing page design QA

## Evidence

- Selected visual: `/Users/theisaiahw/.codex/generated_images/01a026d2-f866-7a21-8e5c-aad0cce1bd7e/exec-47d923e3-59f6-426e-b033-11772ec576e6.png`
- Browser capture: `/tmp/trace-landing-implementation-v1.png`
- Combined comparison: `/tmp/trace-landing-comparison-v1.png`
- Browser viewport: 1280 × 720 CSS pixels at 2× device pixel ratio
- Selected visual: 1536 × 1024 pixels, normalized to the browser viewport for the combined comparison
- State: default desktop landing page

## Full-page comparison

The browser build preserves the selected split-screen hierarchy: a compact text-only Trace wordmark, focused replay message and platform downloads on the left, with the real match archive and Dragapult-versus-Alakazam board occupying the right. The source screenshot is clipped at the right edge to remove the Match Timeline while preserving the complete archive and match board. The result has no horizontal overflow and fits the full 1280 × 720 viewport without scrolling.

## Surface checks

- Typography: Avenir-family system stack, strong navy display type, clear secondary copy, and legible button labels.
- Layout: stable 40/60 desktop split with the download conversion path on the left and match evidence on the right; responsive stacking is defined below 860px.
- Color: cream, navy, paper, and warm yellow remain consistent with the Trace product UI.
- Imagery: authentic 2834 × 1740 Trace capture; rendered at native aspect and cropped only on the timeline side.
- Copy: concise outcome-led headline, one explanatory sentence, platform compatibility, and legal disclaimer.
- Icons: official Font Awesome Apple and Windows brand assets; no handcrafted or substitute symbols.
- Interaction: both download URLs resolve to release assets; hover, focus-visible, and reduced-motion styles are present.
- Accessibility: semantic regions, labeled download group, descriptive match image alt text, decorative icon alts, and no missing image alts.

## Findings and fixes

- P0: none.
- P1: none.
- P2: none after comparison. The board crop removes the full timeline while keeping both Match Archive and the active match visible.

## Verification

- Local HTML and all three visible assets return HTTP 200.
- macOS and Windows release links resolve successfully with HTTP 206 range responses.
- Browser dimensions: no horizontal overflow; document height equals viewport height.
- All images complete with non-zero natural dimensions.

final result: passed
