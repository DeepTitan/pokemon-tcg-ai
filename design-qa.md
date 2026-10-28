# Trace landing page — design QA

final result: passed

## Screenshot sharpness correction

The original `current-app.png` capture was actually a compressed JPEG at 1440 × 960. Its WebP conversion preserved that already-soft source. The replacement is a fresh PNG capture from the current app renderer at the same recorded match position (action 75), rendered at both 1× and 2× pixel density. Lossless WebP encoding preserves the new capture's pixels. The files are 1440 × 960 (296,110 bytes) and 2880 × 1920 (1,556,760 bytes).

The landing uses responsive image candidates and sizes matching the existing frame. New asset names avoid reusing cached copies of the soft image. The layout, match content, and account state are unchanged. Capture masters are saved under `artifacts/trust-redesign/current-app-lossless-1x.png` and `artifacts/trust-redesign/current-app-retina.png`.

Validation: decoded WebP pixels exactly match both PNG capture masters. At 390px with 2× density, the browser selects the 1440px file; at 1440px with 2× density, it selects the 2880px file. Both render without horizontal overflow, with Pro closed by default. The landing build passed all seven required checks, and the preview console has no errors.

## User-requested refinement

Release-notes links were subsequently removed from both the replay caption and footer at the user's request. The caption's empty link spacing was removed too. The local preview was rebuilt and refreshed; browser verification found zero release-notes links and both installer destinations unchanged. The public production landing already contains no release-notes text. Earlier comparison captures below document the selected layout before this intentional copy removal. No website deployment was performed.

## Visual truth and evidence

- Selected visual: first displayed concept, `/Users/theisaiahw/.codex/generated_images/01a17570-88d5-7022-a32c-37cdec2cf868/exec-6c99e429-4102-46eb-a2b5-e431618f8bc7.png` (979 × 1606).
- Local implementation: `http://127.0.0.1:5195/trace`.
- Comparison capture: `artifacts/trust-redesign/local-reference-final.png` (964 × 1742), taken at a 979 × 900 CSS viewport. The browser excludes its 15-pixel scrollbar from the screenshot. Density is 1×; reference was proportionally normalized to 964 × 1581 before comparison.
- Full-view comparison: `artifacts/trust-redesign/comparison-final.jpg`.
- Focused typography, navigation and download comparison: `artifacts/trust-redesign/comparison-hero.jpg`.
- Desktop evidence: `artifacts/trust-redesign/desktop.png`, at 1440 × 1024 CSS viewport; full-page image is 1425 × 2012.
- Mobile evidence: `artifacts/trust-redesign/mobile.png`, at 390 × 844 CSS viewport.
- State: ordinary landing, default monthly cadence, all FAQ and Pro disclosures closed.

## Findings and comparison history

1. Initial comparison (`comparison-first.jpg`) found P2 excess vertical spacing around the introduction and below the preview. The hero image began around 496 CSS pixels, later than the selected mock. Reduced hero padding, copy margins, preview gap, caption height, feature spacing and disclosure-row height.
2. Recaptured and directly compared the full page and focused hero at matching normalized widths. No actionable P0/P1/P2 differences remain. Slight extra page height is accepted for the existing navigation, usable disclosure targets, actual current product image and complete affiliation notice.

## Required fidelity surfaces

- Typography: existing locally hosted Roboto/TraceUI retained; visible hero is weight 500, body 400. Headline wrapping and sage second line match the selected hierarchy. No heavy marketing font was introduced.
- Spacing/layout: centered introduction, adjacent desktop downloads, full-width replay stage, three flat benefit columns, disclosure rows and quiet Pro section follow the chosen composition. Mobile stacks downloads and benefits without horizontal overflow.
- Colors/tokens: original cream, navy, slate, sage and restrained golden download action retained. Fine separators and a modest screenshot frame follow the target.
- Image fidelity: final asset is a genuine browser capture of the current app renderer, not the generated mock. `git diff 83a3a9b HEAD -- src/tracker` was empty, confirming the renderer matches the published 0.1.101 source. It shows a recorded Dragapult ex versus Cynthia's Garchomp ex position and the real archive, current-action panel and replay controls. The different game and current controls are intentional. Screenshot is 1440 × 960, encoded to WebP without changing its content. No decorative player-name overlays were added.
- Copy/content: approved headline, succinct benefits, 30-day free window and optional Pro retained. Repeated reassurance line and Supporters Club acquisition remain absent. Privacy FAQ accurately mentions cloud synchronization and public results. Privacy page's old seven-day and gated-study wording was corrected.

## Behavior and verification

- Both public Windows/macOS installer links and release-notes destination returned HTTP 200.
- Pro is closed on ordinary visits. Opening it and switching cadence displays $4.99/month and $49.99/year with matching billing disclosures.
- `#plans` opens the existing optional offer. Local checkout returns an explicit preview-only message and recovers without a purchase or production API call.
- FAQ works with pointer and Enter. The privacy link opens the local privacy page with the corrected 30-day access window.
- Desktop and mobile have no horizontal overflow. All page images load. The final ordinary-page browser console has no errors.
- 27 existing download, account and desktop-checkout checks passed. The final landing build passed all 7 required build checks. `git diff --check` passed.

## Local review handoff

The landing source and WebP asset were presented locally and approved by the user for publication. During the local review, no deployment, Stripe change, app release, account-access change or subscription change was performed. The screenshot fixture reads the existing archive without writing to it and is isolated on a separate local origin. Raw fixture data is in ignored artifacts and is not included in the website build.

## Release verification

The full website suite passed all 151 tests before deployment. The deployment target is the existing `victoryroad` Vercel project, which serves `victoryroad.app/trace`. The production candidate is checked before promotion, and publication evidence is recorded in ignored `artifacts/trust-redesign/` files.

## Follow-up polish

The full app screenshot scales down on phones, as expected for a desktop product preview. A dedicated mobile crop could be explored later, but is not required for this selected design.

## Implementation checklist

- [x] Selected layout and current app screenshot implemented.
- [x] Privacy wording corrected.
- [x] Full and focused visual comparisons completed after spacing fixes.
- [x] Desktop/mobile and primary interactions verified.
- [x] Local preview reviewed and publication approved by the user.
