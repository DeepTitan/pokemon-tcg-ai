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

The deploy script also sets the repository variable `TRACE_SYNC_API_URL`, which the semantic release workflow compiles into subsequent Trace builds.

## Prepared shared replays

Creating a share link now prepares and stores the complete compressed public response **before returning the URL**. Viewers receive those existing gzip bytes instead of making Lambda parse and recompress the whole recorded match on every visit. The wire payload and all recorded frames remain unchanged.

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
