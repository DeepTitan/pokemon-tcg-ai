# Live client-close rating release — November 2, 2026

Production source commit: `242ec2a`.

Recorded client-close defeats now contribute calculated post-match Live ratings when both starting ratings agree and the observation is still the player's latest. These inferred results remain excluded from Trace's confirmed-match replay. Contradictory results, disputed input ratings, unfinished captures, missing ratings, and newer observations prevent applying the inferred calculation. Confirmed results take precedence.

Validation: regression test for isaiahw/seality5 (1611 → 1598, −13), duplicate/idempotent calculations, incomplete and conflicting evidence, newer observations, and confirmed-result precedence. Worker, public projection, publisher-lease tests and all nine public API tests pass.

Compared the old and new workers against all 2440 production source projections using identical deployed catalog/audit assets. All 2331 accepted matches and the entire Trace replay are identical. Thirty-three latest Live display ratings changed, including isaiahw to 1598. Original match records were not altered.

Deployed only the worker code, preserving the existing deployed asset files and configuration. AWS reports Active / Successful and the deployed package checksum was verified. Rebuild generation: `abc9d5310e5b871c346ad306e2b658ec3950c1a588e5678d6f59298fe3dd4683`.

Verified the canonical website feed reports isaiahw latestLiveRating=1598, liveRatingBefore=1611, liveRatingChange=-13, liveRatingTiming=post-match, liveRatingCalculated=true. This is a calculation after the latest recorded match, not confirmation of an account's current Elo after unrecorded games. Browser automation was unavailable for a visual check.

Rollback package and production comparison evidence are retained in ignored `artifacts/live-client-exit-release-20261102/`. Restore the prior worker package with a current revision precondition and invoke its rebuild action to roll back the derived display values.
