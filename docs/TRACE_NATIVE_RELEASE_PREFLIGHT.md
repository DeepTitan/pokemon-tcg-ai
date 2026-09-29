# Trace native release preflight

The desktop's capture and membership endpoints must belong to the same
environment. Membership authenticates the installation against the capture
device table; a mixed pair can fail authentication and trigger native device
credential recovery. Checking that both URLs use HTTPS is insufficient.

`scripts/aws/check-trace-endpoint-pair.py` checks the candidate desktop release
configuration without registering a device, probing either product API,
retrieving secrets, changing infrastructure or launching any application.
It does not set GitHub variables or run a release workflow.

## Commands and evidence

With no evidence option, the helper prints a JSON plan with
`status: not_checked` and `pairingVerified: false`. This is not a release gate
pass, even though the plan command exits successfully:

```sh
python3 scripts/aws/check-trace-endpoint-pair.py
```

The candidate URLs come from `TRACE_SYNC_API_URL` and
`TRACE_MEMBERSHIP_API_URL`, or explicit `--capture-api-url` and
`--membership-api-url` arguments. Supply the actual values intended for the
desktop build; the helper does not fetch or change GitHub variables.

Use the AWS CLI's Python runtime, or another runtime containing `botocore`, for
the explicitly requested read-only AWS check:

```sh
python3 scripts/aws/check-trace-endpoint-pair.py --check-aws --environment production
```

`--profile` defaults to `default`. The account and region are pinned to
`108241940679` and `us-east-1`; configured SDK endpoint overrides are ignored.
The helper reads only STS caller identity, CloudFormation `DescribeStacks`
and `ListStackResources`. It stops before stack reads if the account is wrong.
Resource-list pagination is supported and bounded. It emits one JSON result
and exits nonzero on failure, without printing raw provider errors or metadata.

The allowed stack pairs are fixed:

| Environment | Capture | Membership |
| --- | --- | --- |
| production | `trace-production` | `trace-memberships-production` |
| staging | `trace-memberships-capture-staging` | `trace-memberships-staging` |

The check verifies:

- Exact completed stacks, account, region and matching `Environment` parameters.
- Both candidate URLs equal the stacks' API outputs and each API belongs to
  the expected stack, verified by physical resource ID and resource type.
- Capture `MembershipApiUrl` equals the candidate membership endpoint.
- Membership `CaptureDevicesTableName` equals the capture `DevicesTable`
  output and that table is the capture stack's owned DynamoDB resource.
- Root HTTPS API Gateway URLs in the pinned region, with no credentials,
  explicit port, path, query, fragment or whitespace. These stacks use the
  `$default` stage. Native code appends exactly `/v1/devices/status`,
  `/v1/devices/link/start` and `/v1/devices/unlink`; supplying `/v1` in the
  base URL is rejected. This is URL/configuration validation, not a live
  route request or deployed route integration test.
- The exact canonical production `WebOrigin`, or the documented protected
  staging alias. The native browser link remains the canonical
  `https://victoryroad.app/trace/link?code=<user-code>` in both environments.

Pairing can be checked while `RequireMembership=false` during coordinated
deployment. The result always reports the enforcement state. Add
`--require-membership` when the gate should also require enforcement enabled.
Do not enable enforcement merely to make an early pairing check pass.

For entirely offline validation, supply a previously saved metadata snapshot:

```sh
python3 scripts/aws/check-trace-endpoint-pair.py --snapshot /path/to/snapshot.json --environment production
```

Snapshot shape: `callerAccount` is the STS account string; `capture` and
`membership` each contain `stack` (one `DescribeStacks` stack object) and
`resources` (the combined `ListStackResources` summary array). Retain only
the required stack identity/status, relevant parameters/outputs and API/device
resource summaries. Do not include credentials, secret values or unrelated
account records. The helper reads the snapshot but never writes one. The
generated fixture in `scripts/aws/test_check_trace_endpoint_pair.py` gives a
complete example. Offline evidence may be stale or fabricated; it cannot prove
current AWS configuration. Live metadata is also a point-in-time observation,
so rerun against the final candidate values before release.

Successful results explicitly retain `packagedAppVerified: false` and
`canonicalBrowserApprovalVerified: false`. Neither metadata mode inspects
compiled binaries, GitHub release variables, deployed browser behavior,
Lambda configuration drift, billing readiness or SES delivery.

## Current offline evidence and remaining package gate

On September 29, 2026, 26 focused native Rust tests passed across membership,
cloud credentials, archive migration and deck privacy. Two loopback tests
initially encountered sandbox port-binding denial and passed on an approved
rerun. Membership settings, capture-status and captured-decklist frontend
tests also passed. These used synthetic temporary data and launched no app
or game. The endpoint helper's 17 generated-metadata tests pass separately:

```sh
python3 -m unittest discover -s scripts/aws -p 'test_check_trace_endpoint_pair.py' -v
```

The release workflow already builds/signs platform packages and briefly
launches the copied macOS package to check that its process stays alive.
It does not assert the account UI or native IPC transitions. Windows E2E
currently tests native/reducer behavior and privileged route-cleanup commands,
not the GUI. No workflow is changed or dispatched by this preflight work.

Hosted runners can isolate fixture tests from the owner's installed Trace,
but a deterministic packaged fixture harness is still needed. Startup opens
the fixed application profile, initializes capture state, refreshes membership
and starts cloud sync. A fresh profile enters onboarding that cannot be
dismissed before capture setup succeeds. Browser-only mocks therefore do not
isolate native side effects or make the account controls reachable.

The next implementation is a separate, nonpublishing hosted macOS/Windows
fixture job with no provider or signing secrets, an optional native fixture
feature and a separate Tauri identifier. Its startup should use synthetic
storage and local service fixtures, bypass privileged capture setup and route
changes, capture external browser handoffs, and suppress real updater/network
destinations. Exercise the real native membership, storage and deck-access
commands through a packaged UI driver. Cover fresh/legacy archives, recent
and expired replay access, refresh/unlink and native terminal-result evidence.
Keep fixture behavior out of published builds and retain signed-package
verification separately. Never launch Pokémon TCG Live or start a match.
