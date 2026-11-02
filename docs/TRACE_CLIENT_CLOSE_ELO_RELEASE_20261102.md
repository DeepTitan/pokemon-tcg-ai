# Trace Elo client-close forfeits — November 2, 2026

Requested policy: recorded client-close losses must affect Trace Elo and player records.

Implemented in `c579dda`; shared-image update in `a26ea94`, with full existing renderer regression coverage retained in `91a65d3`. Production web deployment: `dpl_A6EZ2ChCed52PkUVEbVGjhQ8jB1o` (https://victoryroad-340q9camp-deeptitan-6729s-projects.vercel.app).

The shared `traceRatingEvents` adapter combines confirmed matches and recorded client-close evidence. Ranked eligibility admits those recorded losses as forfeits using the existing chronological Trace formula. Original source flags remain unchanged. Both players receive their normal result updates; missing paired ratings, invalid winners, ordinary unconfirmed games, and conflicting records remain excluded. History rows retain their Client closed label and display the actual Trace deduction alongside the separate calculated Live change. Shared images use the same history and replay, with a new preview version to invalidate old images.

Production-data replay added all 32 eligible forfeits: 1454 → 1486 rated matches. Both players received exactly one update per admitted match. Profiles, records, ranks and shared previews all use that replay. Live rating values and the Live calculation formula were unchanged.

Verified results:
- isaiahw: Trace 1807.9565 → 1783.6241 (display 1784), 57W–42L, 99 games. The seality5 client-close row shows −24.3 Trace points and −13 Live Elo.
- oMatt: Trace 1492.3962 → 1476.1778 (display 1476), 4W–6L, 10 games. The g1zm0m0 row shows −16.2 Trace points and −13 Live Elo.
- TwelvePeers: 17 additional recorded losses; 80W–86L, display Trace 1651.

Validation: all leaderboard/rating regression tests, website feed/page/preview tests and the full 11-test image-renderer suite passed. Strict frontend TypeScript and production build passed. Production desktop/mobile browser checks verified both requested profiles, negative Trace changes, updated loss counts and no duplicated rows. The public 1200×630 profile PNG was visually inspected and agrees with the profile's rating, record and client-close deduction.

Worker code updated with existing deployed assets and configuration preserved; checksum verified, AWS Active/Successful. Rebuild generation: `463469335958ae423e34d339b549af9d8d88f9573ac637917bbb816ba787ecb1`. Production web promotion succeeded.

Rollback/evidence: ignored `artifacts/trace-client-close-elo-release-20261102/` contains the previous worker package, replay comparison and screenshots. Previous public website deployment was https://victoryroad-r8cgav435-deeptitan-6729s-projects.vercel.app. No original match archive was modified.
