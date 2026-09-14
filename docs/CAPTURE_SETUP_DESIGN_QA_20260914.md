# Trace connection dialog QA

final result: passed

Source visual truth: the existing connection dialog, reproduced from the original TrackerApp markup at http://127.0.0.1:5180/.local-preview/before.html?preview=connect.
Source screenshot: /private/tmp/connect-dialog-before.png
Implementation: http://127.0.0.1:5180/tracker.html?preview=connect
Implementation screenshot: /private/tmp/connect-dialog-after.png

Comparison: both screenshots were displayed together in one comparison input at 1024 × 680 CSS pixels, 1024 × 680 image pixels, density 1. First-run state, empty archive, light theme. No density normalization was needed. The final result is an intentional redesign, not a pixel-identical recreation. User requested the existing warm visual character, a much quieter keyboard guide, and exactly two visible actions.

## Findings and iteration history

- The first redesign was too dense for the user's preference. It had a large eight-frame demo, multiple interactive buttons, expanded instructions, and additional dismissal/playback options. Replaced it with a compact seven-position preview, two shortcut rows, and only Check for updates and Connect capture. The animation runs once for under five seconds, then rests.
- The first redesign pushed the connection action below the fold at 1024 × 680. The simplified final dialog fits completely, with both actions and the data disclosure visible. Matched screenshots above verify the fix.
- No actionable P0/P1/P2 issues remain in the reviewed first-run state.

## Required surfaces

- Typography: retained Nunito/Nunito Sans; one headline, brief supporting text, two compact shortcut descriptions. All text remains readable and untruncated at the supported desktop minimum and the user's 675 × 998 preview pane.
- Spacing/layout: 510px dialog, consistent inset spacing, one compact guide, two equal-width action columns. No scrolling is required in the reviewed states.
- Colors/tokens: existing cream surface and navy typography; restrained green guide and warm yellow action/key highlights. The disabled update button in the browser preview reflects native-only availability.
- Assets: reused the existing Trace mascot and Phosphor icons; no replacement brand artwork. Timeline marks and keycaps are native interface elements.
- Copy: clearly distinguishes individual frames from attacks/key moments. Full directional instructions and the complete key-moment definition remain available to screen readers. Captured-data disclosure is preserved.

The full-view screenshots show the dialog at readable size; a separate focused crop was unnecessary.

## Interaction verification

- Browser inspection confirmed exactly two buttons inside the final dialog.
- Shift+A resets the example, D advances one frame, S jumps to the next attack; the guide uses the production replay shortcut functions. Forward/reverse WASD and arrow navigation was also exercised during the first implementation.
- The initial guide honored emulated reduced motion by remaining still; final code retains the same preference checks and disables CSS motion. Browser emulation was cleared afterward.
- Modal focus stays contained; Escape restores the preceding focus when closing. No visible dismiss option remains.
- The updater remains a single instance with its existing operation/process guards. The compact portal shows only the check action and status. The native update notification handles installation after settings close.
- Focused updater regression test, TypeScript check, and final production build passed. The complete tracker suite passed earlier in this change. An initially requested shortcut test filename did not exist; the production shortcut behavior was verified in-browser instead.
- An intermediate HMR error from restoring the existing shortcut module was resolved before the final reload; no runtime error was observed in the final page.

Native connection and updater execution were not triggered from the browser preview. Existing native callbacks remain wired; this preview is for local design review, not a deployment.
