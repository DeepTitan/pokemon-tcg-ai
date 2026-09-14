# Replay memory improvements

This patch reduces unnecessary archive work and duplicate stored-replay objects without changing recorded gameplay or visual fidelity.

- Load archive summaries in batches of 20 and lazy-load archive thumbnails.
- Refresh stale live-network replays on selection, not with a startup-wide reconstruction sweep.
- Share exactly identical immutable objects within a loaded stored review. Different card entities, values, array order, and property order remain unchanged. No global review cache is introduced; the live assembler remains mutable and separate.
- Return validated stored JSON through native IPC without first allocating a second complete native object tree. Missing reviews still return null; invalid JSON is rejected.

Validation included exact serialized equality across 112 saved reviews / 9,299 frames. Summed separate objects and arrays across those individual loads dropped from 5,445,737 to 420,406. One 118-frame replay's retained heap delta dropped from 12.19 MiB to 2.29 MiB in an isolated Node/V8 forced-GC check. These are replay-level measurements, not a whole-app RAM percentage or WebKit heap measurements.

Native UI checks covered opening six saved games, first/next/latest frame navigation, and a complete visual decklist. Total app memory remains dependent on graphics, browser allocations, and workload; this patch does not claim a sub-50 MiB application footprint or a proven whole-app percentage reduction.

Run `npm run tracker:memory-test` for focused checks. These checks are included in `npm run tracker:test`, which is now required before signed release builds. Native storage tests cover JSON round trips. Production backup behavior is unchanged; offline-backup configuration used for local testing is not part of this patch.
