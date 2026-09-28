# Trace cloud backup

Trace keeps SQLite as the offline source of truth and automatically mirrors reconstructed match reviews over HTTPS. Each installation uses an anonymous device identity. Upload failures never interrupt local capture: an on-device outbox retries them with backoff, and the first release with this behavior queues existing reconstructed matches for backfill. Request bodies are gzip-compressed so complete long matches stay below the gateway payload limit.

Match payloads include the player names and game actions needed to replay a match. This automatic backup is disclosed in Trace's capture setup rather than presented as an optional setting.

The AWS stack uses:

- API Gateway HTTP API for the desktop-facing endpoint
- Lambda for validation and per-install bearer authentication
- DynamoDB for device credentials and the match index
- a private, versioned S3 bucket for compressed review payloads

Data is encrypted in transit and at rest. The bucket blocks all public access, DynamoDB point-in-time recovery is enabled, and CloudFormation retains all three data resources if the stack is removed.

Deploy with:

```bash
AWS_PROFILE_NAME=default AWS_REGION_NAME=us-east-1 ./scripts/aws/deploy-trace-cloud.sh
```

The deploy script publishes the repository variable `TRACE_SYNC_API_URL` only with explicit `TRACE_PUBLISH_RELEASE_API=true`, and only for the canonical `trace-production` stack/environment. Staging must never update the release API. New noncanonical stacks require explicit `TRACE_STACK_NAME` and `TRACE_ENVIRONMENT` (use `staging` for provider tests). Existing parameter values are preserved unless overridden; use `TRACE_MEMBERSHIP_API_URL` and `TRACE_REQUIRE_MEMBERSHIP` for a deliberate freemium rollout. Inputs and the effective configuration are checked before writes. The semantic release workflow compiles the published URL into subsequent Trace builds.

## Prepared shared replays

Creating a share link now prepares and stores the complete compressed public response **before returning the URL**. Viewers receive those existing gzip bytes instead of making Lambda parse and recompress the whole recorded match on every visit. Public and ordinary private reviews remove protected opponent starting inventories and unknown hidden identities; originals remain private and intact.

- Only an explicitly shared match gets this additional response artifact. The existing S3 bucket remains private and encrypted; no public bucket, listing endpoint, or authentication bypass is introduced.
- The share lookup pins the prepared object's S3 `VersionId` and an ETag. A small source fingerprint includes the source version and public summary, preventing an older prepared copy from being served for an updated match.
- Uploads to an already shared match refresh its prepared copy. A preparation failure is retryable; it never erases the saved source game or returns a newly successful Share result.
- Existing links prepare themselves on first use, then use the same fast path. A missing/expired prepared S3 version is rebuilt from the source; other storage errors are not hidden.
- Browser responses use `private, no-cache` plus an ETag. The viewer uses `fetch(..., {cache: 'no-cache'})`: it can retain the response, but must revalidate every visit. A matching ETag returns 304 without reading S3. Share and match existence are checked first, so a removed link does not receive a cached success. Authenticated/private responses still use `no-store`.
- Versioned storage is required; the existing stack already enables it and expires noncurrent versions after 30 days. Prepared artifacts use a stable per-match key, so repeated updates do not create an unbounded collection of distinct object keys.

Run the offline contracts without credentials or SDK installation:

```bash
python3 -m unittest discover -s infrastructure/aws/tests -v
```

The deploy script runs them before touching AWS. `scripts/aws/verify-trace-cloud.sh` also checks a prepared artifact exists after Share, conditional 304 responses, and fresh content after upload; it creates only its own synthetic fixture and removes its source/prepared object versions afterward. **That script writes to AWS; run it only as part of an authorized cloud verification.**

An optional offline benchmark accepts an already downloaded public replay payload:

```bash
python3 infrastructure/aws/tests/benchmark_shared_replay.py /path/to/replay.json
```

For browser QA, build the viewer with `VITE_TRACE_SYNC_API_URL=http://127.0.0.1:4319 npm run tracker:build`, run `node scripts/build-share-runtime.mjs` and `node landing/build.mjs`, then add `--serve 4319` to the benchmark command. This serves an in-memory fake AWS backend on loopback only and marks when the board mounts. Restore a normal build before publishing. Browser fonts/artwork retain their ordinary loading behavior; no match is uploaded by the benchmark.

Deployment order: AWS backend/template first, then the web viewer. Existing viewers still benefit from precomputation immediately; the new viewer additionally enables conditional HTTP caching. No native installer release is needed for the backend change. Rollback can ignore the additional DynamoDB fields and S3 artifacts without removing any saved matches.

## Freemium enforcement (deployment gated)

`RequireMembership=true` now enables **premium replay/share enforcement**, not a paywall on recording. Keep it off until the freemium desktop and authoritative membership endpoint are ready. No table, bucket, device identity or `KEYS_ONLY` leaderboard stream is replaced.

- Device registration, authenticated capture uploads and compact match-summary listing remain free. Those paths never call billing, so an unlinked device, expired subscription or membership outage does not stop ingestion or remove games from ratings.
- Full private replays from the preceding seven days are free. Older or undated replays require a freshly valid linked Pro/Supporters entitlement (`fullHistory`) or the explicitly enabled owner. A missing or stale capability fails closed for premium access. Originals are never deleted on expiry.
- A new match stores an immutable `historyStartedAt` using the earlier of server upload time and a valid supplied import time. Existing rows use their earliest usable existing import/update date on first rewrite; undated legacy rows remain locked rather than becoming newly free. `if_not_exists` preserves the anchor across retries and concurrent uploads. Client timestamps can shorten the first window, never extend a stored one. This is service access control, not DRM over raw local captures or prevention of deliberate re-import under a new ID.
- Free installations may create one new replay share per rolling seven days, for a replay within their recent window. Pro/Supporters (`expandedSharing`) may share older games and bypass the free allowance. A failed membership lookup still permits an eligible free share. Known existing links are reusable regardless of age and do not consume another allowance.
- One DynamoDB transaction writes the match's share pointer, the public lookup and (for free shares) the device's `lastFreeShareAt`/`lastFreeShareId`. Concurrent different-game attempts cannot both consume the same allowance. Same-game retries reuse the winner's pointer, including after a lost response or failed artifact preparation. Capture updates preserve share pointers. A reserved share whose artifact failed should be retried for that same game; the reservation stays durable.
- Existing CRUD policies already authorize the underlying Put/Update transaction operations; no new resource or IAM action is added. The quota is per installation. Re-registering a new installation can evade it; it is not an account-wide anti-abuse guarantee.
- Existing public shares remain accessible and use the privacy projection. Paying does not reveal full opponent inventories in any public replay. Native Supporters deck study still separately requires authoritative match-end evidence.

Errors are JSON: `403 {"error":"history_membership_required"}`, `403 {"error":"share_limit_reached","nextShareAt":"<UTC ISO timestamp>"}`, `503 {"error":"membership_unavailable"}` for a protected read when membership cannot be verified, or `409 {"error":"share_busy"}` for unresolved reservation contention. Free capabilities and these errors are additive; legacy `traceAccess` remains a paid Boolean.

Offline cases in `tests/test_freemium.py` cover exact age boundaries, legacy re-upload, missing timestamps, outage behavior, paid/owner expiry, free allowance renewal, failed preparation recovery and concurrent reservations. No production data or accounts are used.
