# Prize accounting regression audit — 2026-09-14

Status: implemented and verified locally on top of release v0.1.79; not deployed.

## Confirmed defects and fixes

- Action 127, isaiahw vs pau1ek: Live's flat Dragapult → [Drakloak, Dreepy] attachment list was reduced to Dragapult → Drakloak. Canonical conversion now retains every stage, with physical-ID deduplication and attachment-parent validation. Archived frames can also reconcile their existing same-frame public evolutionCards list, without mutating saved canonical state.
- Stadium activations were changing inferred ownership to the activating player. Canonical state now retains the entity's owner account. Legacy replay fallback accepts placement events for the matching physical Stadium, not activation events.
- Resolving Trainers (including Ultra Ball, Buddy-Buddy Poffin, Crushing Hammer and Eri) could disappear from the census between hand and discard. Canonical pendingCards now represents those actual protocol zones, retaining visibility and ownership; PlayerField passes the relevant player's pending cards into inference.
- Stale mulligan identities survived in the deck even when those cards had been dealt into hidden prizes. A fully identified deck search whose cardinality matches the already-established exact deck count now replaces obsolete deck locations. Partial searches and incomplete identities do not remove cards. Removed stale identities are never assigned to specific prize positions.

Reducer version is now 18. Existing selected-stale-match rebuilding applies the fix to saved matches from their retained operations; no archive-wide startup rebuild, history deletion, capture-helper restart or protocol changes were introduced.

## Real-log audit

Read-only SQLite access to the quiescent local Trace archive; all reconstruction and testing occurred in memory. No archive writes.

Command:

```sh
node --import tsx scripts/audit-prize-inference.ts '/path/to/trace.sqlite3' --rebuild --strict
```

- Matches checked: **112**
- Matches actually rebuilt from raw logs: **112** (no stored-only fallbacks)
- Captured operations replayed: **19,803**
- Frames checked: **9,299**
- Reverse-order determinism checks: **9,299**
- Frames with inferred prizes: **7,835**, across **101** matches
- Consistent successive inferred prize sets: **7,734**
- Unexplained changed sets: **0**
- Known-to-unavailable transitions with remaining prizes: **0**
- Complete-accounting failures: **0**
- Remaining unavailable results: 572 setup/count/no-prizes states, 512 frames without a complete known inventory (such as before search), 380 without captured starting decklists. These remain conservative rather than inventing identities.

This is an audit of the available archive, not a guarantee about all future captures. The strict mode exposes future availability regressions rather than silently skipping unavailable frames.

## Regression coverage and UI verification

- Full and nested evolution stacks, duplicate references, old incomplete canonical stacks, conflicting identities, missing identities, unrelated Pokémon IDs, hidden-zone protection and input immutability.
- Trainer pending → discard accounting, hidden pending-card visibility, neutral Stadium entity ownership, opponent activations, same-name Stadium replacements, and unknown ownership.
- Full vs partial deck searches after stale mulligan knowledge, unidentified search candidates, hidden prize positions and unchanged earlier frames.
- Saved real frames 126/127/128 vs pau1ek are a permanent fixture. Ultra Ball + Drakloak remain inferred when traversed 126 → 127 → 128 → 127 → 126.
- Browser verification on the regression preview opened the actual Prize inspector at frames 127, 126 and 128; each displayed Drakloak and Ultra Ball, with positions explicitly unknown.
- `npm run tracker:test`, `npm run release:test`, `npm run tracker:build` passed. Focused TypeScript check for the changed models, reducer, audit and tests passed. A broader ad-hoc TrackerApp TypeScript invocation encounters existing Phosphor barrel-export typing errors; the production Vite build passes.

Local real-frame preview: `/src/tracker/__tests__/prize-evolution-preview.html`.

## Additional pre-ship audit

At the user's request, a separate read-only pass checked nine recordings: the longest available match against each of Kaerukun_57, Sharptusk, tmp200, Yuuuuuu087, LucasZiz and MachineGunFunk, plus three older recordings found only in the September 8 backup (flying-casual, AceIKnow and NhatPhuc). The latter three were not among the original 112; they are incomplete captures, not additional complete-match proofs. No backup matches were restored into the current archive.

- 2,109 raw operations rebuilt into 1,028 frames.
- 1,028 non-sequential seek checks (odd frames descending, then even frames descending) matched the original per-frame results.
- 1,028 opponent-privacy checks: no inferred opponent prize identities.
- All nine reconstructed reviews were byte-equivalent before and after the inference checks.
- No known-to-unavailable transitions with remaining prizes and no full-accounting failures.
- AceIKnow correctly never inferred prizes: the eight available frames did not establish the required complete inventory. Other partial recordings only inferred when their captured frame satisfied the accounting checks.

No additional product changes were made during this pass. Deployment remains pending.
