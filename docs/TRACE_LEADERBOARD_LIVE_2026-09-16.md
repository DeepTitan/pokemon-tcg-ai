# Automatic leaderboard updates — September 16, 2026

Shipped to `https://victoryroad.app/trace/leaderboard` and `/trace/players/:name`.

The source of truth for this release is this isolated release checkout, branch `codex/trace-leaderboard-release`. The parent workspace contains unrelated changes and must not be deployed wholesale.

## Behavior

Completed Trace uploads now trigger a sanitized snapshot rebuild through the existing match index's KEYS_ONLY DynamoDB stream. Open pages refresh every 15 seconds while visible, and on focus or reconnection. The proxy caches for at most 3 seconds; HTTP responses require fresh data. Delayed/offline uploads appear after they reach Trace's server. No desktop update is required.

Existing rating math and ranked eligibility remain unchanged. Late arrivals and corrections are replayed chronologically; source retries replace the same recorder+match projection. New player URLs render immediately. New card artwork uses the catalog-controlled fallback. Reviewed social screenshot images remain deployment-time screenshots; current server-rendered metadata follows the live feed, while Messenger may cache previously fetched previews.

## Production resources

- Trace Vercel project: `victoryroad`, deployment `dpl_CYtpfg1PNkofk2VruSim4VPKFQpR`.
- Deployment URL: `https://victoryroad-cvep14ez5-deeptitan-6729s-projects.vercel.app`.
- Existing apex project routing is unchanged.
- New AWS stack: `trace-leaderboard-live`, region `us-east-1`.
- Public feed: `https://p5xbv2rfya.execute-api.us-east-1.amazonaws.com/v1/leaderboard`.
- Original `trace-production` stack changed only TraceMatches.StreamSpecification, without replacement or function-code changes.
- Publisher uses a conditional DynamoDB lease lasting 360 seconds, exceeding its 300-second hard execution limit. No reserved concurrency is required. Stream retries are bounded by a 24-hour maximum record age, with a retained failure queue.

## Verification

- Imported all 504 current recorder-source records after the stream mapping was Enabled.
- Feed: 377 players, 457 completed matches, 320 rated matches, 11 observed Trace users.
- All 638 prior per-player rating updates (319 games) match the previous published snapshot exactly.
- isaiahw's loss against Spysimon appears: 41W–33L, 74 rated matches, rating 1854.0141954830667, delta -12.108144683180392. Paired Live ratings were 1878 and 1953.
- A temporary ignored health-check field on that existing cloud index row verified the actual stream trigger. Publication completed in 5.02 seconds and every match/rating remained identical. The field was removed; no game client, game result, original review, or Elo was changed by the check. The stream reports OK.
- Public feed returns 200 and conditional 304, with no-store cache headers. Public player SSR reports the current score; a newly discovered opponent's page works.
- 48 landing/API tests passed, plus browser refresh, public projection, publisher/retry/lease, and 9 Python feed tests. Production build passed. Browser verification confirmed the live board and latest player history.
- Facebook crawler user-agent checks return current metadata and the existing screenshot URLs. Download protection and shared-replay tests remain passing.

## Deployment notes

Automatic approval review initially rejected a broad repository upload. `.vercelignore` was narrowed to website code and approved public assets, excluding private data, captures, training, infrastructure, secrets and source test fixtures; the filtered upload was approved. Shared display enums in `src/engine/types.ts` are included because the replay viewer needs them.

The first isolated AWS stack rolled back because the account's concurrency quota could not reserve a worker instance. Its replacement uses the tested publisher lease. An import compatibility fix omits optional undefined rating fields at the normal JSON boundary before strict public projection; it does not infer absent scores.

See `infrastructure/leaderboard/README.md` for build, backfill, failure recovery, rollback and scaling limitations. Do not redeploy an old backup-service source tree as part of a leaderboard update. Preserve the enabled match-table stream on future backup API deployments.
