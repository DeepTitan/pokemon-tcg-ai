# Live leaderboard infrastructure

This separate stack consumes the existing Trace match index stream. It does not replace the Trace backup/share API or make its bucket public. Enable `KEYS_ONLY` streams on the existing match table before supplying its stream ARN here. Build the Node worker into `worker-dist/worker.mjs`; the exported handler is `worker.handler`.

The worker receives `SOURCE_TABLE`, `MATCHES_TABLE`, `PAYLOAD_BUCKET` and `SNAPSHOT_KEY=leaderboard/snapshot.json.gz`. Match events contain only `deviceId` and `matchId` keys; the worker reads the current index and pinned review version, avoiding reliance on stale stream images. Only the sanitized snapshot is served publicly. The projection table, failure queue and logs are retained on stack deletion.

The stream starts at `LATEST`. Enable its event mapping before the one-time backfill to avoid losing uploads during the import. Backfill uses an explicit `{"action":"backfill","keys":[{"deviceId":"...","matchId":"..."}]}` Lambda invocation, and `{"action":"rebuild"}` republishes the current projections. These invocation paths are not exposed over HTTP.

Stream processing uses a conditional DynamoDB publisher lease to serialize source updates and snapshot publication, with batches of ten. Its 360-second lease outlives the Lambda's 300-second execution limit; a crashed invocation can be retried after the lease expires. Failed or busy batches are bisected, retried until their maximum age of 24 hours; discarded invocation metadata goes to the encrypted `WorkerFailures` queue, retained for fourteen days. This SQS destination contains failure context and stream sequence references, not a durable copy of every source record. Investigate queue messages promptly; after stream records expire, recover from the retained current match index with a backfill and rebuild. Do not treat a successful deployment as proof that this queue is empty.

The public Python function can read exactly one S3 object. It serves its compressed JSON and ETag through `GET /v1/leaderboard`; `HEAD` and conditional 304 responses are supported. Request parameters cannot choose another object. Cache revalidation is required, and errors reveal no source-storage details. The same-origin web proxy can consume this route without adding browser CORS permissions.

Offline verification:

```sh
python3 -m unittest discover -s infrastructure/leaderboard/tests -p 'test_*.py'
```

Required deployment parameters are `MatchesTableArn`, `MatchesStreamArn`, `PayloadBucket` and `ExistingApiId`. The template must be packaged with CloudFormation/SAM before deployment so both local code directories are uploaded. No production mutation is performed by the offline tests.

## Website and update timing

Completed Trace uploads update the existing match index. Its KEYS_ONLY stream invokes the publisher, which replaces the recorder's compact projection and atomically publishes the full sanitized snapshot. The website fetches that feed through `/trace/leaderboard-static/events.json`; visible pages check every 15 seconds and on focus/reconnection. The web proxy coalesces requests for at most 3 seconds. This is near-real-time, not a promise of instantaneous delivery: offline captures and upload/processing failures delay publication.

Ranked eligibility and rating parameters are unchanged. Late games and corrections replay in chronological order; missing paired match-local Live Elo still excludes a game from the ranked history. A failed page refresh retains the last successful snapshot and shows a retry message. HTML metadata uses the current roster, so new player profile URLs work without a website deployment. Social screenshot files remain reviewed deployment-time images; Messenger can additionally cache those previews.

## Build and migration

Build with `node infrastructure/leaderboard/build.mjs`. The build packages the complete public printed-card catalog already used by Trace's share pages, plus the three historical gzip assets. The complete catalog supplies exact printing mechanics for deck identification; the historical card catalog supplies known art and any records absent from the printed catalog. Known foil finishes resolve to their base printing's mechanics. Neither catalog contains private captures, and the public feed still exposes only the selected Pokémon, not the decklist.

`prepare-assets.ts` documents the one-time migration and asserts full prior replay, player metadata and match-history parity. Do not regenerate the migration assets from an arbitrary new archive: they preserve the historical September 16 launch baseline, while incoming corrections remain authoritative. When updating printed-card metadata, reprocess affected sources through the private backfill action; a rebuild alone reuses their already-selected Pokémon. Verify `node --import tsx infrastructure/leaderboard/catalog.test.ts` before packaging.

Package `template.yml` with `aws cloudformation package`. Enable the existing match table stream using its deployed CloudFormation template (preserving the production function's exact CodeUri), then deploy this isolated stack. Wait for its event source mapping to become Enabled before taking a fresh complete scan of current deviceId/matchId keys for backfill. Invoke batches of twenty via the private Lambda action. Reprocessing a source never creates or starts a Pokémon game.

Verify the public feed, exact historical rating parity, latest known completed matches, stream mapping state and empty failure queue before promoting the web release. On a web regression, promote the previous web deployment. On publisher failure, disable the event mapping while investigating; stored source projections and private match originals are retained, and backfill/rebuild can recover them. Never delete original matches to repair a derived leaderboard.

The publisher intentionally scans and replays the compact source table for each batch at the current small volume. Before substantial growth, replace full-feed delivery and replay with checkpointed/incremental processing and paginated histories; monitor invocation duration, throttles, stream iterator age and the failure queue. Lambda/API response limits still apply to the compressed snapshot.

A failure-queue entry may contain only stream sequence references. Resolve it before the stream expires. After expiry, backfill current matches and reconcile stored sourceKey hashes against the complete current match index to remove orphan projections from missed deletions.
