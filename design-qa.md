# Trace plans production design QA

Date: 2026-09-30

final result: passed

## Reference and implementation

- Approved reference: `/Users/theisaiahw/.codex/generated_images/01a0f04b-8185-7403-b07c-7cdeb1a433b9/exec-bb5d6a24-bdaf-457b-aedc-47ea738d28e2.png` (1073 × 1466 pixels).
- Final implementation screenshot: `/private/tmp/trace-plans-design/local-approved.png` (1073 × 1514 pixels).
- Local page: `http://127.0.0.1:5195/trace`.
- Compared both images together at the same width. The implementation capture has 48 additional vertical pixels of viewport/footer framing; images were not stretched to match heights.

## Comparison and corrections

1. Initial comparison found the app screenshot too small and monthly price suffixes wrapping unnecessarily on desktop. Increased the screenshot's share of the hero and kept price suffixes inline where space permits.
2. Final comparison confirmed the approved white header, cream surface, navy typography, original headline, real Trace screenshot, underlined Compare plans link, flat comparison table, gold Pro treatment, concise FAQ, and footer.
3. Header and content share the existing account page's 1076px maximum width. The 32px desktop gutter intentionally preserves the shared site grid instead of the generated reference's larger gutter.
4. Production typography and approximately 52px comparison rows preserve readability. The real app screenshot replaces generated illustration details in the reference.
5. Corrected duplicate XML namespace attributes in the new standard icon assets; all four assets load.
6. At 700px, the single-row header's brand extended beyond its content grid. Switched the header to two rows at 740px and aligned sticky offsets with that breakpoint. Verified the brand and header end at the same x-coordinate (665px at a 700px viewport).

## Responsive and interaction checks

- Desktop 1440px: matching header/main grid; no horizontal overflow.
- Narrow desktop 788px: readable comparison, correctly wrapped monthly price suffixes.
- Mobile 390px: all three plans visible without sideways scrolling. Feature labels span each row; column headers remain visible while comparing. Explicit table roles and header associations retained.
- Compare plans keyboard activation lands below the fixed header.
- Start free routes the signed-in local fixture to My account.
- Get Pro and Join the club use existing checkout handlers. Local billing-disabled errors appear and buttons recover correctly; no payment was made.
- Leaderboard and Training navigation work with the shared header. Training shows its expected content.
- Browser console: no errors after asset corrections.
- Reduced-motion preference disables smooth scrolling.

## Functional scope and verification

- Existing signup, authentication, billing handlers, prices, and entitlements preserved.
- No opponent decklist feature advertised.
- Account, guest checkout, and training selector tests: 34 passed.
- Leaderboard build passed; landing and public-page builds passed, including their training and card asset checks.
- `git diff --check` passed.
- Native Trace/Pokémon gameplay was not launched.

No unresolved visual differences requiring approval remain.
