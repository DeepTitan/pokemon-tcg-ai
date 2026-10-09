# Trace mobile replay — selected portrait layout

final result: passed

Initial review scope: local shared-replay UI. User selected the second generated layout, with the stadium beside its owner and no numbered turn breakdown on the progress bar. Production release after explicit approval is recorded at the end.

## Visual evidence

- Source visual truth: `/Users/theisaiahw/pokemon-tcg-ai/artifacts/trace-mobile-20261009/selected-mobile-design.png`
- Final browser-rendered implementation: `/Users/theisaiahw/pokemon-tcg-ai/artifacts/trace-mobile-20261009/24-final-mobile.jpg`
- Normalized full-view comparison: `/Users/theisaiahw/pokemon-tcg-ai/artifacts/trace-mobile-20261009/25-final-comparison.jpg`
- Focused hand, caption, slider and button comparison: `/Users/theisaiahw/pokemon-tcg-ai/artifacts/trace-mobile-20261009/26-controls-comparison.jpg`
- Real replay: `http://127.0.0.1:4188/trace/fYENi4rxKoO8Jv75C-5EakU2`
- State: isaiahw versus NeetLv999, frame 72 of 103, Dragapult ex's Phantom Dive, paused.
- Source pixels: 853 × 1844. Implementation pixels and CSS viewport: 390 × 844, effective screenshot density 1 pixel per CSS pixel. The comparison page scales the source to 390 pixels wide without stretching; its resulting height is approximately 843 pixels. It displays both artifacts together.

## Findings and comparison history

1. Earlier implementation: prizes and discard were bare counters, six transport controls competed equally, and card inspection discarded the parent-zone context. Reproduced an additional playback defect: opening discard at frame 21 left an inspector with two cards while the board advanced to frame 32. Evidence: `13-audit-autoplay-inspector.jpg` in the evidence directory. Fixed by pausing every inspection entry point, guarding the playback timer, and maintaining an inspector history with scroll restoration.
2. First selected-layout build: the board exceeded the 390 × 844 available height and clipped the hand. Reduced bench cards to 44 × 61 touch targets, adjusted vertical gaps and kept a scrolling board for shorter viewports. Both primary navigation buttons remain at least 52 pixels high.
3. First normalized comparison (`23-design-comparison.jpg`): hand artwork was too small relative to the selected layout and the stadium lacked a visible name. Enlarged the hand, tightened field spacing, and added the stadium's name next to the owning player. The actual captured Risky Ruins art replaces the generated mock's incorrect card art.
4. Final comparison (`25-final-comparison.jpg` and `26-controls-comparison.jpg`): no remaining actionable P0/P1/P2 findings. Board height 648 pixels fits its 649.2-pixel viewport at 390 × 844. All zones, the complete hand preview, caption, scrubber and both navigation actions are visible.

## Required fidelity surfaces

- Typography: existing Nunito heading style and application fonts retained. Previous/Next are 16-pixel bold labels, with a readable two-line action title. Supporting action text truncates deliberately and opens the complete event log. Header controls are larger than the mock to give practical touch targets.
- Layout: 3 + 2 benches; opponent above, local player below; separate deck/discard and six prize positions; centered Actives; stadium beside the player who played it; visible local hand. The sticky review dock has only two primary buttons and a plain scrubber. Short phones scroll the board instead of hiding zones.
- Colors: existing warm neutral background, muted coral opponent and blue local areas, dark ink and yellow Next action. Existing current-turn and damage indicators are retained deliberately.
- Assets: original Pokémon card images, trainer avatars and Trace mascot are reused. Generated card contents are not treated as replay data. Empty discard piles have an empty state instead of a false card back. Unknown prizes and opponent hand cards remain masked.
- Copy: all action copy, card counts and board state come from the real replay. The turn picker groups recorded turn labels and identifies both participants when appropriate; it does not infer extra turns from handoff frames. It is separate from the plain scrubber.

## Interaction verification

- Ten rapid Next taps advance ten frames, with no lost requests; manual navigation pauses playback. First and final frame boundaries clamp.
- Play followed by opening discard remains at frame 72 with playback stopped. Opening Unfair Stamp and returning restores the same discard pile and scroll position (126.5 pixels in the tested case).
- Escape closes the inspector and returns keyboard focus to the originating Prize button. Tab remains in the active dialog; nested card navigation focuses its Back control.
- Prize counts, hidden Prize identities, empty zones, hand inspection, Pokémon/attachment details and direct key-moment jumps checked. Full event log remains accessible; selecting event 1 navigates to frame 1.
- 320 × 568: no horizontal document overflow; the board scrolls to the hand while controls remain within the viewport. Prize sheet fits and exposes its close button. Evidence: `18-small-phone.jpg`, `19-small-phone-bottom.jpg`.
- 375 × 667: document width equals viewport width; controls remain within the viewport. Event navigation and inspection checked at this size.
- 1280 × 900: desktop transport and zoom remain present. Desktop Prize slots still show only remaining cards (0 and 3 in the final frame). Evidence: `21-desktop-regression.jpg`.
- Browser error log: no runtime errors in the final replay verification.
- Build passed. Relevant model tests passed: mobile replay, frame navigation, key moments, zones, Prize knowledge/layout, hand layout, board zoom, shared access and shared replay loading.
- Whole-repository TypeScript checking still reports errors in unchanged engine and other files. No errors are reported for the changed replay modules. This is not a clean repository-wide typecheck claim.

## Research grounding

The original problem was discoverability and review continuity, not just screen width. TCG Live's official portrait reference preserves recognizable physical card zones. Chess.com's mobile analysis documents back/forward controls at the bottom. Apple recommends 44-point hit regions; this web implementation targets at least 44 CSS pixels for its principal buttons and board cards. W3C guidance supports a non-drag alternative to scrubbing, supplied here by Previous/Next and direct jumps. Public chess complaints about adjacent skip controls informed the placement risk, but were treated as anecdotes, not prevalence data.

- [Official TCG Live reference](https://apps.apple.com/us/app/pok%C3%A9mon-tcg-live/id1557962344)
- [Chess.com mobile analysis](https://support.chess.com/en/articles/10473022-how-do-i-use-game-analysis-on-the-app)
- [Apple button guidance](https://developer.apple.com/design/human-interface-guidelines/buttons)
- [W3C dragging alternatives](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements)

## Limits and follow-up

- No physical iPhone/Safari, VoiceOver or device safe-area run was available; browser size checks are not a substitute for those checks.
- The eight-Pokémon bench and handoff boundary cases have model regression coverage; this specific replay does not contain an expanded bench or Lost Zone state for end-to-end visual coverage.
- Browser Back is not a custom inspector navigation shortcut; use the visible Back/Close controls or Escape.
- Production deployment remains a separate user review step. No capture, account, network interception or server reconstruction code changed.

## Follow-up: hold navigation and full-screen cards

User requested accelerated Previous/Next holds and full-screen individual cards. Implemented locally:

- A tap advances one frame. A sustained pointer press repeats after 350 ms, then accelerates from 4 to 8 to 16 frames per second. A small 1×/2×/4× badge appears while holding. Release, pointer cancellation, capture loss, focus loss, tab visibility change, disabled boundaries and unmount cancel the timer. Releasing a hold does not add an extra click step.
- Individual card inspectors fill the mobile viewport; pile browsers retain their sheet layout. Artwork fits within the available screen and details/attachments remain scrollable. Close and nested Back remain available.
- Large public artwork is loaded only for inspected cards, with captured artwork as fallback. Explicit alternate-art aliases do not replace exact captured art. Pokémon TCG API's documented [large image format](https://docs.pokemontcg.io/api-reference/cards/get-card/) informs the higher-resolution URL.
- Knocked-out cards still visible in an action frame now open card details even when already removed from the canonical field; this does not fabricate in-play vitals.

Verification:

- Real browser mouse hold: Previous moved from frame 103 to 100 after one second, reached frame 80 at 4×, and remained at 80 after release. A subsequent Next tap moved exactly to 81.
- Holding Next from 101 stopped at 103 and disabled Next. Start/end and ordinary slider navigation remain available.
- Final-frame Dragapult, previously inert, opened a full-screen inspector. Its image loaded at 733 × 1024 pixels. Screenshot: `28-fullscreen-card-sharp.jpg` in the evidence directory.
- Card inspector bounds were exactly (0, 0, 390, 844), and (0, 0, 320, 568) at the small-phone size, without horizontal overflow. The complete image and Close fit on the small screen. Screenshot: `29-fullscreen-small-phone.jpg`.
- Discard → Unfair Stamp → Back restored the 36-card discard and scrollTop 290 at frame 103.
- Build, card-art regression tests, frame-hold controller tests and mobile replay model tests passed. Timer tests cover acceleration, release, cancelled short holds, stale callbacks, restarted holds and stopping within a boundary callback. TypeScript has no errors in changed modules; existing repository-wide errors remain.
- Automated touch-event dispatch is unsupported by the in-app browser. Hold behavior was verified with real pointer/mouse events; physical touch/Safari validation remains outstanding.

Final result for this local follow-up: passed, with the device-testing limits above. No deployment.

## Follow-up: animated playback, pace and header

User reported missing playback animations, slow default playback and an unhelpful capture-frame count in the header.

- Root cause: compact layout unconditionally disabled view transitions in the navigation function. Playback now explicitly requests animation, while mobile manual stepping and hold/scrub input still apply immediately. Existing motion preferences and reduced-motion behavior are respected.
- Normal mobile playback now holds ordinary actions for 600 ms, attacks/damage for 1200 ms and pass frames for 900 ms, versus the previous 1200/2600/1900 ms. Desktop pacing is unchanged. The turn menu provides 0.75×, 1×, 1.5× and 2× speeds and access to the existing animation preference.
- Mobile attack and pass effects are shortened to fit the new timing and scale with speed. The attack route measures the actual Active positions so portrait geometry, hand height and bench wrapping do not misplace the effect.
- Removed the `64 / 103` style capture-frame counter from the mobile header. Play and the turn menu remain.
- Verification caught a View Transition overlay intercepting button input; making that overlay ignore pointer input restores immediate Pause/Next/card interactions during playback.

Evidence: the real replay moved from frame 71 into Phantom Dive at frame 72 in approximately 685 ms. The browser showed `trace-frame-transition`, followed by a visible attack core (opacity 1, transformed across the board) and a lunging attacker (scale 1.03271 and Y -12.1512). The route connected the actual Active centers at offsets +52/-52 pixels. At 2× the same entry took approximately 378 ms and the core duration changed from 0.54 s to 0.27 s. Clicking Next during an active transition immediately paused on frame 73 and cleared the transition. No runtime errors were logged. Screenshot `32-clean-playback-header.jpg` shows the final header; `33-playback-settings-final.jpg` shows the turn menu and playback options.

Build, navigation/animation model tests and hold-controller tests passed; no TypeScript errors were reported in changed modules (pre-existing whole-repository errors remain). Physical touch/Safari validation remains outstanding. Final local result: passed. Nothing deployed.

## Production release — October 9, 2026

User explicitly approved shipping the reviewed implementation. Released source commit: `bf10391` on `codex/mobile-replay` in this isolated checkout.

- Project: `victoryroad` (`prj_xu8lQXM29IgPY7fLDvbkT4qah4Ta`), team `team_6rqfBuaO0W1ndg07WpRuoUv0`.
- Deployment: `dpl_537sn7dNxVDyKTheg5o6oimXoo5A`, production, READY.
- Deployment URL: https://victoryroad-4gnp2607h-deeptitan-6729s-projects.vercel.app
- Public replay: https://victoryroad.app/trace/fYENi4rxKoO8Jv75C-5EakU2
- The existing `victoryroad-lovat.vercel.app` alias was moved to the verified build; Trace CDN cache was purged to discard old shared-page viewer shells. No apex routing, account service, capture service or native application was deployed.

Production baseline comparison used Vercel's deployment source manifest: 1,043 unchanged source files matched by SHA-1; only the five edited existing replay modules differed, plus the newly added replay modules. The nine output-function entries are generated deployment artifacts. Three already-live training standings files were confirmed byte-for-byte against public production and preserved in baseline commit `07a77b1`; the original checkout's uncommitted work was untouched. Local `.claude` settings were excluded from the upload.

Release verification:

- Main tracker suite passed, including reconstruction, privacy, navigation, shared replay and card-source tests. The standard pretest stops on an outdated membership-copy assertion; the identical failure was reproduced on unchanged baseline `6bbba15`. It was not changed or represented as passing.
- Full site build and all 138 website/API tests passed. Remote production build completed successfully in 17 seconds.
- Staged `/shared-replay` and its JavaScript matched the locally tested artifact byte-for-byte. The share-page handler fetches its shell through the stable alias, so the complete shared route was checked after alias promotion.
- Public HTML loads `/assets/tracker-C8l2rwf4.js`; the production JavaScript also matched byte-for-byte after decoding its Brotli transfer encoding.
- Live browser, 390 × 844: turn menu present, raw frame counter absent, actual attack playback visible (attack opacity 1 at frame 72), Pause works, and Dragapult opens a 390 × 844 full-screen inspector. No browser runtime errors. Screenshot: `/Users/theisaiahw/pokemon-tcg-ai/artifacts/trace-mobile-20261009/34-production-mobile-replay.jpg`.
- Existing landing, account and leaderboard pages returned success; the live training script remained byte-for-byte unchanged.
- Post-release server log scan found one Node `DEP0169` deprecation warning for `url.parse()` on a successful 200 response, with no application failures observed. This does not constitute a physical Safari or ongoing monitoring test.

Rollback point: `dpl_Haeg3RDeVt6YXTH9eLX9JhnFPAf6`, https://victoryroad-4feuaii0y-deeptitan-6729s-projects.vercel.app. A rollback must promote that deployment and restore the stable `victoryroad-lovat.vercel.app` alias, followed by public replay verification; no rollback was needed.
