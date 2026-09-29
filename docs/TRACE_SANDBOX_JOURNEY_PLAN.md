# Trace sandbox checkout journey

Prepared September 28, 2026. Planning only: no provider calls, secret reads, accounts,
payment sessions or browser actions were made for this plan.

## Scope and starting point

The existing `scripts/smoke-trace-member-session-staging.py` passed real Cognito
login, private cookie handling, Free capabilities, redirect-only downloads,
CSRF, refresh and logout against the protected staging website. It deliberately
requires billing to be disabled and deletes an account only when it has no
Stripe customer. **Do not turn off those guards to reuse it for a paid test.**

Use a separate companion, proposed name
`scripts/smoke-trace-member-purchase-staging.py`, which shares the private request
transport but has its own paid-test preflight, state machine and cleanup. The
companion has not been implemented or executed. It needs no Stripe runtime key:
all customer-facing requests use the website proxy. Provider inspection and
cleanup are separate scoped operator steps in the dedicated sandbox.

Fixed targets:

- CloudFormation: `trace-memberships-staging`.
- Cognito pool: `us-east-1_ELXorHpct`; client: `2js5quloo43e2700j7vki1l9n0`.
- API: `https://scn2ntfvfa.execute-api.us-east-1.amazonaws.com`.
- Browser origin: `https://trace-memberships-staging-deeptitan-6729s-projects.vercel.app`.

Before any mutation, verify the physical stack resources, exact web origin,
`Environment=staging`, `StripeMode=test`, `BillingEnabled=true`, owner unset,
dedicated configured price/portal IDs, and preview project identity. The operator
must also verify the sandbox account, `livemode=false` on created objects,
monthly USD prices of 1499/3999 cents, and the staging webhook destination.
An unexpected mode, origin, identifier or unavailable guest route stops the run;
it never falls back to production or a different credential.

## Keep browser and API evidence distinct

The CLI runner keeps its cookies in process memory. Opening its returned Stripe
URL in another browser does **not** transfer the HttpOnly purchase cookie to that
browser. The runner could still claim through its own cookie after a test
payment, but this proves API behavior only, not the return-page experience.

For a complete browser journey, start on the protected pricing page and click
the plan button there. Pay and return in that same browser. Do not inject cookie
values or copy proof into JavaScript, URLs, screenshots or logs. Browser signup
and delivered email confirmation are a separate real-email check; an
admin-confirmed synthetic user cannot prove those steps.

## Minimal fixtures

Two independent guest purchases cover both initial plans: one Pro and one
Supporters Club. Each has a unique purchase cookie and matching synthetic email.
Use two disposable Cognito accounts (invitations suppressed, credentials only in
memory) for an email-free adapter test. The other fixture's account can exercise
wrong-email rejection; a third account is unnecessary. No owner grant, actual
device, match upload or native app is needed to check account entitlements.

Record only fixture labels, states and nonsecret provider object IDs in a
restricted cleanup inventory. Never record credentials, cookie/proof values,
full Checkout URLs or portal URLs. The provider URLs are temporary capabilities,
even though navigating to their allowlisted hosts is expected product behavior.

## Concrete sequence per initial plan

| Step | Action | Required evidence |
| --- | --- | --- |
| 1 | `POST /trace/api/checkout/prepare`, twice | `ready:true`; one Secure/HttpOnly/host-only proof cookie; repeat does not rotate it; no Stripe effect. |
| 2 | `POST /trace/api/checkout/guest` with only `{plan}` while signed out | One allowlisted hosted Checkout URL; no account prerequisite or provider IDs in extra JSON fields. |
| 3 | Repeat the same-plan request with the same cookie | Same open Checkout URL and no second session/customer. In the first fixture, optionally start with the other plan then switch before payment; verify the old open session expires. |
| 4 | `POST /trace/api/checkout/status` | `{state:'open',plan,expiresAt}` only. A success query string alone leaves the account Free. An unpaid claim cannot grant access. |
| 5 | Complete the genuine hosted Checkout using sandbox payment details | Operator/browser step. Verify displayed plan, USD amount, monthly recurrence and return origin. Do not substitute a manually created subscription. |
| 6 | Poll status with the original cookie | `paid` only after authoritative payment; `expiresAt:null`. Bound polling (for example 90 seconds) reports pending/failure rather than assuming success. |
| 7 | Try another checkout with that paid proof, both signed out and signed in | `accountRequired:true`, never another hosted checkout. |
| 8 | Sign into the mismatched synthetic account and explicitly claim | `409 checkout_email_mismatch`; proof remains; no customer binding or paid grant. Sign out and use the matching account. |
| 9 | Before explicit claim, read matching account | Still Free. Payment/return URL by itself has not attached the purchase. |
| 10 | Explicit `POST /trace/api/checkout/claim` | `{claimed:true}`; proof cleared only after success; session cookies retained. |
| 11 | `GET /trace/api/account` | Active purchased plan, future expiry, `admin:false`, paid flags/capabilities exactly as below. |
| 12 | Retry claim using the retained pre-response cookie in the API harness only | Same account may safely recover a lost successful response. Another account cannot take ownership. The normal browser remains without the cleared proof. |
| 13 | Attempt another purchase after activation | Pricing guest route returns account action; account checkout returns `subscription_exists`. No duplicate subscription. |
| 14 | `POST /trace/api/portal` | URL on `https://billing.stripe.com/p/session/...`; operator verifies bound fixture customer and dedicated portal configuration. Never print the full URL. |

All POSTs require the exact staging Origin and JSON. The in-memory cookie jar
must accept exactly the existing access/refresh cookies plus
`__Host-trace-checkout`, and apply clears correctly. Retain access/refresh/proof
across requests; never persist them for cross-process resume. Failure diagnostics
use status, allowlisted error codes and request IDs only.

Expected paid capabilities for both plans: `recordMatches:true`,
`leaderboard:true`, `recentReplayDays:7`, `fullHistory:true`,
`expandedSharing:true`, `freeSharesPerWindow:1`, `shareWindowDays:7`.
Pro must have `opponentDecklists:false`; Supporters must have it `true`.
That flag alone does not prove the post-match boundary: the separate capture/
tracker synthetic-match tests must still reject unfinished-match access.

## Portal and webhook evidence

After successful claim, use the real sandbox portal to request end-of-period
cancellation. Verify its display/confirmation and then observe
`cancelAtPeriodEnd:true` while paid access remains valid through the period.
This is not proof of a month passing or actual expiry.

For webhook proof, require an actual signed sandbox delivery to the staging
endpoint with a successful response, the known fixture event receipt in the
membership table, and the current subscription change reflected in account data.
Claim/status can reconcile Stripe directly, so an active account alone is
**not** evidence that the webhook works. Re-deliver that exact fixture event and
confirm there is no duplicate or stale entitlement change. Do not fabricate a
webhook signature or copy a full event payload into a report.

Use the Pro fixture's portal upgrade to exercise Supporters selection, displayed
proration, and the resulting paid invoice before granting the higher tier.
A failed upgrade must not grant unpaid Supporters access. This is an additional
provider case, not established by the initial two purchases. Deliberate failed
payments, expired sessions, missing proof, delayed/out-of-order events, and real
email delivery should be reported separately, not implied by the happy path.

## Cleanup and abort behavior

The existing session runner's cleanup is intentionally unsuitable once a paid
customer exists. A purchase companion must track only its own fixture objects.
First expire its unpaid open sessions and cancel its sandbox subscriptions
immediately with explicit operator authority. Verify no continuing test
subscription remains. Preserve a minimal nonsecret provider audit/cleanup record.

Only after fixture billing is inactive and pending deliveries are accounted for,
remove the exact disposable Cognito users and owned membership keys:
`ACCOUNT#subject`, `CUSTOMER#customer`, `GUEST#proofHash`, and
`GUEST_CUSTOMER#customer`, with ownership conditions. Guest/account leases are
released normally; remove only remaining fixture leases/rate keys and known
fixture event receipts. Never table-scan and bulk-delete by a broad prefix, touch
the owner table, remove products/prices/webhook configuration, or delete another
customer. Deleting a local account alone does not cancel a subscription.

If provider cleanup cannot be confirmed, stop and report the nonsecret fixture
object IDs for explicit cleanup. Do not report success or erase the only cleanup
inventory. No provider mutation has been authorized by this planning document.

## Existing coverage and implementation delta

- `landing/lib/guest-checkout.test.mjs`: offline proof bootstrap, retries,
  cross-tab locks, status redaction, duplicate guards, plan switching,
  authenticated claim/error handling and cookie preservation.
- `landing/lib/membership.test.mjs`: origin boundaries, session refresh/logout,
  plan/expiry projection, downloads and billing URL allowlists.
- Backend `infrastructure/memberships/tests/test_guest_checkout.py`: atomic
  ownership/claim, paid recovery, invoice/tier evidence, inactive/conflicting
  subscriptions and provider identity binding, using fake providers.
- `scripts/smoke-trace-member-session-staging.py`: real email-free auth/session
  evidence only; no guest purchase or portal path.
- Backend `infrastructure/memberships/stripe_sandbox_plan.py`: offline provider
  setup payloads only; not a checkout/payment test runner.

The useful automation delta is the staged purchase state machine, a three-cookie
private transport, explicit hosted-payment handoff, assertions tied to real
fixture provider IDs, and paid-fixture cleanup. No new live automation should be
enabled until the sandbox/provider configuration and cleanup authority are set.
