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

---

# Simplified head-to-head thumbnail — September 14, 2026

## Ground truth and evidence

- Selected visual: `/Users/theisaiahw/.codex/generated_images/01a026d2-f866-7a21-8e5c-aad0cce1bd7e/exec-54dc4d6f-8bd0-47c1-898c-18ae85da1185.png` (second displayed concept, 1730 × 909).
- User-requested adaptation: simplify that composition for a small thumbnail, particularly the prominent Trace mascot/branding.
- Implementation: `artifacts/design-qa/simplified-1200x630.png`, rendered by the actual share-card handler's exported renderer, not a generated imitation.
- Browser evidence: `artifacts/design-qa/simplified-browser.png`, captured in the in-app browser at 1280 × 720. The native image is displayed at 1200 × 630, x=40, y=45, density 1.
- Combined visual comparison: `artifacts/design-qa/simplified-browser-comparison.png`. The reference was normalized to 1200 × 630 and placed above the browser image cropped to its exact 1200 × 630 bounds. Browser letterboxing is excluded.
- Focused small-size check: `artifacts/design-qa/simplified-messenger-size.png`, 360 × 189, also inspected at that CSS size in the browser preview.
- Preview: `http://127.0.0.1:4185/`.
- State: real recorded match `iSeI8XrGnpD4vM_-TKqaLT1K`, isaiahw vs. 6TiramiSUI7, victory, 3–0 prizes taken, 1836/1783 ratings, September 14 at 5:16 AM CDT, 19m.

## Findings and comparison history

- No actionable P0/P1/P2 visual findings in the paired comparison. The two upright cards, symmetrical player columns, and central result retain the selected direction.
- Intentional simplifications: no mascot, header, tagline, repeated winner sentence, URL, promotional text, colored washes, or result divider ornaments. Trace appears once as a small footer wordmark. Metadata remains one unobtrusive footer row.
- Ratings sit immediately below each player name instead of sharing a baseline. This preserves a consistent centered column for different-length names and keeps the primary player names large.
- A preventive edge-case check found that a minimum font-size constraint could allow exceptionally wide names to overflow. The renderer now truncates by estimated rendered width as well as character count. Tests cover wide names, XML escaping, and absent ratings; the normal-match output is unchanged by this correction.

## Required fidelity surfaces

- Typography: bundled Nunito retains Trace's established character and the chosen concept's strong sans-serif hierarchy. Names, result, score, and Pokémon captions remain distinct at 360px. Secondary timestamp/rating text is intentionally smaller.
- Spacing/layout: equal 282 × 394 card slots, centered name/rating/caption columns, separated central result, 60px footer insets. No overlap or clipping in the actual match. Safe name fitting handles variable input.
- Colors: flat warm ivory, navy text, muted metadata, semantic green victory/red defeat. Removal of the source concept's blue/red washes is intentional decluttering, not missing artwork.
- Image quality: exact original Dragapult ex and Drakloak card PNGs, uncropped and unmodified. No generated card printing, replacement art, mascot approximation, or invented icons. Real source art is slightly softer at full resolution than the generated concept, but clear at target social size.
- Copy/content: actual player names, ratings, card names, outcome, prize score, timestamp, and duration are preserved. Only redundant branding/marketing copy is removed. Prize score explicitly says PRIZES TAKEN.

## Verification

- All eight landing tests pass, including data preservation, 1200 × 630 PNG output, missing-art fallback, missing ratings, wide names, XML escaping, defeat, and incomplete-match states.
- Browser full-size thumbnail link opens the actual 1200 × 630 image. Returning to the preview works.
- Browser warnings/errors: none.
- No new share links created, no live deployment performed, and no Messenger message sent during this design refinement.

## Follow-up polish

- P3: secondary metadata is intentionally fine print at small social sizes; card identities, names, result, and score are the priority.

## Implementation checklist

- [x] Simplify branding and preserve match data.
- [x] Render and inspect original assets at full and thumbnail size.
- [x] Compare the selected visual and browser output in one normalized image.
- [x] Verify rendering and edge-case tests.
- [ ] If the user approves this refinement, bump the share image cache version and deploy the renderer to the existing Trace host.

final result: passed

---

# Restore selected head-to-head design; remove only footer

## Source and evidence

- Source visual truth: `/Users/theisaiahw/.codex/generated_images/01a026d2-f866-7a21-8e5c-aad0cce1bd7e/exec-54dc4d6f-8bd0-47c1-898c-18ae85da1185.png`, 1730 × 909. User explicitly restored its centered branding, colored sides, and inline name/Elo arrangement; only the complete footer is removed.
- Implementation: `artifacts/design-qa/restored-1200x630.png`, rendered from the real match data and original card/mascot assets.
- Full comparison: `artifacts/design-qa/restored-comparison.png`, source and implementation normalized to 1200 × 630 and stacked.
- Browser screenshot: `artifacts/design-qa/restored-browser.png`, current user viewport 443 × 998, density 1. The browser displays the 1200 × 630 image at 443 × 232, x=0, y=383.
- Focused browser comparison: `artifacts/design-qa/restored-browser-comparison.png`, source scaled to 443 × 232 above the exact browser image crop. This checks the actual small-thumbnail presentation without counting browser letterboxing as a layout difference.
- Additional thumbnail: `artifacts/design-qa/restored-messenger-size.png`, 360 × 189.
- State: the same isaiahw vs. 6TiramiSUI7 victory used in the selected concept. No match data was fabricated or changed.

## Comparison history and findings

- Previous refinement diverged from the user's desired layout by removing the mascot/color and stacking Elo. Those changes are reversed.
- Initial restored composition centered each inline name/Elo group and placed several center elements a few pixels lower than the reference. Fixed by aligning the group to each card's left edge and matching the reference's vertical positions. Post-fix evidence is in both combined comparisons above.
- No actionable P0/P1/P2 findings remain. Original card art and real mascot replace the concept's generated imitations; minor glyph/illustration differences are intentional asset fidelity, not a new design.
- The removed footer consists of the bottom divider, date/time, duration, and tagline. The top-center mascot/TRACE/MATCH REPLAY/domain, left/right color, upright cards, inline Elo, result, prize score, and winner statement remain.

## Fidelity checks

- Typography: bundled Nunito preserves product typography. Names and Elo share one baseline, with subordinate muted Elo. Text fitting prevents long names escaping the player column. Headline, score, captions, and winner hierarchy retain the reference arrangement.
- Layout: original three-column structure, card positions, top-center brand lockup, short score dividers, and caption alignment are restored. Footer area remains clean rather than being filled with new content.
- Color: pale blue left, ivory center, and pale peach right match the selected reference. Green/red result semantics remain intact.
- Images: exact original card PNGs and existing mascot; no generated Pokémon or modified card facts. Background is a reusable raster asset derived from the chosen reference.
- Content: player names, Elo, card names, prize score, and result remain exact. Date/duration are intentionally no longer in the image because the user requested removal of the full footer; underlying share data is unchanged.
- Browser: full-size image link and return navigation work. Console warnings/errors: none. All eight landing tests pass, including explicit checks for the restored header/inline Elo and absence of footer text.

## Background asset provenance

- Saved project asset: `/private/tmp/trace-social-card/landing/assets/trace-share-background.png`.
- Method: built-in ImageGen, reference-guided background extraction. Original generated output remains at `/Users/theisaiahw/.codex/generated_images/01a026d2-f866-7a21-8e5c-aad0cce1bd7e/exec-8d8ea4bb-c61f-431b-8d5f-09506c2622ee.png`.
- Final prompt: "Extract only the background color wash from this reference into a reusable 1200×630 landscape background asset. Preserve the reference's extremely soft pale sky blue along the full left edge, blending gently into warm off-white in the center, and very soft pale peach/terracotta along the full right edge. Remove every foreground element: all text, cards, mascot, logo, rules, shadows, scores, and footer. The entire result should be the same clean luminous blue-to-ivory-to-peach background, completely empty, smooth and flat with no new objects or textures. This is an implementation asset for the exact reference layout, not a new design. Do not increase color saturation. No letters, marks, icons or artifacts."
- Both Vercel function bundle configurations include the new asset for a later deployment.

## Handoff scope

Local design preview only; no production deployment, cache-version change, or Messenger message during this revision. A live release remains a separate next step after this visual refinement.

final result: passed

---

# Approved thumbnail release: remove URL only

- User approved the restored layout and requested removal of the URL beneath Trace. The renderer removes that single text element; mascot, header, colors, cards, inline names/Elo, result, prizes, and winner remain unchanged.
- Regenerated the exact real-match PNG and inspected it at 360 × 189 in `artifacts/design-qa/simplified-messenger-size.png`. The approved layout is preserved and the URL is absent.
- All nine landing tests pass, including a regression assertion that the URL/footer stay absent and that metadata references image version 5 without changing the persistent replay link.
- Updated social-image alt text to match the footer-free image. Both function bundle configurations include the background asset.
- Release target is the existing Trace Vercel project `victoryroad`, not the separate Prize Map project serving the apex homepage.

final result: passed
