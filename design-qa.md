# Shared replay access panel QA

final result: passed

## Scope and reference

Replace the shared replay's top header with a collapsible left invitation to record
games with Trace, join the existing Discord, and ask for access. This is an
intentional layout change, not a pixel-for-pixel clone of the old header. Native
archive, replay engine, card rendering, and match-loading pipeline are unchanged.

Reference: https://victoryroad.app/trace/uZEUk2bui30licgLu7or7Ngm before deployment.
Implementation: the same match served from the production build at localhost:4186.
Both comparison captures use frame 129, timeline collapsed, board zoom 100%, and
a 1600 × 960 CSS-pixel viewport (1600 × 960 screenshot output).

- Source: `/private/tmp/trace-share-panel-before.png`
- Implementation: `/private/tmp/trace-share-panel-after.png`
- Collapsed: `/private/tmp/trace-share-panel-collapsed.png`
- Compact desktop, both panels open: `/private/tmp/trace-share-panel-compact.png`

## Visual comparison

The source and implementation screenshots were supplied together in one paired
comparison. The intended change is the 300px left rail and reclaimed header height.
No P0/P1/P2 regression was found in the scoped panel during this comparison.

- Typography: existing Nunito/Nunito Sans, strong but compact invitation, readable
  line breaks, subordinate help text. No new font assets or placeholder wordmark.
- Layout and spacing: separate grid column, never an overlay. At 1600px, the open
  panel is 300px; closing it leaves a 48px mascot control and expands the board.
  At 1180 × 800, a 256px panel, replay, and 290px game log all fit; invitation and
  footer remain fully visible. Existing replay layout has a 1180px minimum width;
  phone-sized replay redesign is outside this change. New visitors below that
  width default to the collapsed rail (covered by unit tests).
- Colors and surfaces: existing cream, navy, and Trace yellow; quiet border and
  existing rounded surface vocabulary, with one primary yellow Discord link.
- Assets and icons: actual Trace mascot, correct aspect ratio and transparent
  background; existing Phosphor chevrons, external-link arrow and Discord logo.
  Real match card artwork is unchanged. No generated art or custom icon substitutes.
- Copy: a single recording invitation, the tricky-spot/friends purpose, and an
  explicit instruction to ask for Trace access after joining Discord.

## Interactions and accessibility

- Collapse/expand keeps frame 129 selected and keyboard focus on the same button.
- Reload remembers the collapsed preference; blocked storage is tested safely.
- Hidden invitation links are removed from the accessibility/focus tree.
- Toggle exposes a descriptive name, aria-expanded and aria-controls; visible
  focus ring was checked. Link focus styling follows the existing product.
- Shift+Left and Shift+Right still navigate to frames 0 and 129 after toggling.
- Game log opens alongside the rail at 1600px and 1180px without panel overlap.
- Discord link uses the existing configured invite, opens externally, and has
  noopener/noreferrer. Clicking was exercised; HTTP verification follows the
  invite redirect to Discord successfully (200). No account joined or message sent.
- Brand and About Trace links retain `/trace` as the destination.
- Browser console: no captured errors on the local implementation.
- No new animations; the panel does not introduce a reduced-motion concern.

## Automated verification

Passed: shared-access unit/render tests, full tracker:test, release:test,
tracker:build, landing/build.mjs artwork validation, and git diff --check.
