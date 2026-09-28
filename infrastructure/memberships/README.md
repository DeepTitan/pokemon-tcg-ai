# Trace memberships

This is an isolated AWS membership stack, separate from film billing and the capture stack. Staging membership and capture stacks are deployed; production rollout is not complete. Billing defaults off. See [current rollout status](../../docs/TRACE_MEMBERSHIPS_ROLLOUT.md) for deployed resources, passed provider checks and remaining dependencies.

- **Free:** continuous recording, leaderboard eligibility, full replays from the last seven days, and one new replay share per rolling seven days per installation.
- **Pro — USD $14.99/month** (internal plan ID `trace`): full archive replay access and expanded sharing.
- **Supporters Club — USD $39.99/month:** Pro plus opponent decklists **after the match has ended**.
- **Owner switch:** the configured owner's verified Cognito subject can receive both entitlements immediately via a separate database flag. This bypasses billing only. Native/server match-completion checks still apply.

## Access decisions

Account and device responses include `capabilities: {recordMatches, leaderboard, recentReplayDays, freeSharesPerWindow, shareWindowDays, fullHistory, expandedSharing, opponentDecklists}`. The free baseline is `true, true, 7, 1, 7, false, false, false`. It also applies to unlinked installations and expired/canceled accounts. Active Pro enables `fullHistory` and `expandedSharing`; Supporters and the verified owner additionally enable `opponentDecklists`. The legacy `traceAccess` Boolean still means **paid** access, for compatibility; it must no longer be used to gate all recording or downloads. Missing/offline membership cannot grant premium access but must leave the free baseline usable.

The capture service enforces archive ages and the free share quota independently; see `../aws/README.md`. Ratings retain all accepted games, irrespective of subscription. Existing public links remain readable. A new link's free quota belongs to the capture installation, not a global account, so this is a product limit rather than strong anti-abuse protection.

Cognito accounts verify their email. The API pins each access token to this pool and app client, then calls Cognito `GetUser` to validate it. Browser tokens stay in the website's HttpOnly cookie proxy. Confirmation emails can be resent through `POST /v1/auth/resend`; unknown or already-confirmed accounts receive generic success. Native devices use their existing capture UUID and bearer; those are checked against the capture device table with a strong read. A device must be explicitly linked by a signed-in member using a one-time code to receive that account's premium entitlements. Free capture, recent replays and the free sharing allowance do not require linkage.

Paid access requires one recognized subscription, status `active`, a paid invoice establishing the current tier, exact allowlisted price/amount/USD/monthly recurrence, quantity one, and a future paid-period end. `trialing`, `past_due`, `unpaid`, paused, malformed and conflicting subscriptions deny access. No trial is offered. Cancellation at period end preserves access until that date. Customers manage or switch existing plans through an isolated Stripe portal configuration; checkout returns `409 subscription_exists` for an existing membership.

Current-tier payment evidence binds the invoice to the same subscription, customer, currency and mode, then checks a non-credit line for the current subscription item and price covering the current period. Generated prorations and paid zero-total invoices remain valid. An older Pro payment cannot establish Supporters access. Missing, unexpanded or paginated invoice lines fail closed as `payment_pending`; the current adapter does not fetch additional invoice-line pages. Existing cached snapshots without this evidence-policy version are reconciled before granting access. This is a resilience guard, not evidence of a Stripe exploit. The existing latest-invoice-only policy still suspends paid access during an unpaid update, rather than retaining the prior tier; real failed-upgrade behavior must be tested before launch. [Pinned invoice-line schema](https://docs.stripe.com/api/invoice-line-item/object?api-version=2024-06-20), [invoice schema](https://docs.stripe.com/api/invoices/object?api-version=2024-06-20).

Subscription state is read consistently from DynamoDB. Verified webhooks trigger a **fresh Stripe subscription lookup**, rather than copying an event's potentially stale snapshot. Account mutations are serialized by a conditional 90-second lease; every entitlement write checks ownership and lease expiry. The Lambda timeout is 29 seconds, so an old execution cannot continue after another execution takes its lease. Only successfully persisted updates receive a durable event receipt and a 2xx acknowledgement. Stripe retries transient failures/lock contention. Duplicate and out-of-order events cannot roll entitlements back. Reads reconcile snapshots older than five minutes; reconciliation failure denies the protected read with 503.

Checkouts persist a stable idempotency key before creation, retrieve current session state on retries, and expire a previous open session when the selected plan changes. Checkout accepts card payment only. Return URLs use the stack's trusted `WebOrigin` plus `/trace/account`; production/live billing require `https://victoryroad.app`, while staging may use one explicitly configured protected Vercel origin. No request header or client field controls redirects. API redirects are disabled and returned billing URLs must use the expected Stripe host. Nothing trusts a client price, customer ID, account subject, plan flag, or admin flag.

## Checkout before account setup

New visitors choose a plan and go directly to Stripe. They create or sign into a verified Trace account after payment, using the same email they entered at checkout. Returning signed-in members use the existing account checkout/portal flow; owners already have access and are not asked to pay.

The website first creates a random 32-byte proof in an HttpOnly, Secure, SameSite cookie, then starts checkout with that existing cookie. The browser never receives the proof in JSON or a URL. The service stores only its SHA-256 hash. The three server-only endpoints additionally require `x-trace-proxy-key`, taken from the website's `TRACE_MEMBERSHIP_PROXY_SECRET` and compared against `webProxySecret` in the dedicated Secrets Manager JSON:

| Endpoint | Server request | Response |
| --- | --- | --- |
| `POST /v1/checkout/guest` | `{plan, checkoutToken}` | `{url}` to hosted Stripe Checkout |
| `POST /v1/checkout/status` | `{checkoutToken}` | `{state, plan, expiresAt}` without email or Stripe/customer/session IDs |
| `POST /v1/checkout/claim` | `{checkoutToken}` plus verified Cognito bearer | `{claimed:true}` after the transaction commits |

Status states are `none`, `open`, `processing`, `paid`, `expired`, and `claimed`. Unknown valid proofs return `none`. Open sessions have a one-hour deadline. A completed purchase with inactive current billing returns `processing` plus `reason: "purchase_not_active"`, so the website offers billing help and blocks a second purchase. It never treats a formerly paid subscription as an unused checkout merely because billing later failed or was canceled.

Guest records are serialized under a separate conditional lease. A blank anonymous Stripe customer is saved before checkout; Stripe collects its email during checkout. Each reservation has stable idempotency and metadata bindings. Repeated clicks reuse the same open session, and changing plan expires the prior session first. If Stripe created a session but its response was lost, the service retries the original key while valid or locates that exact reservation under its persisted customer. It does not discard the reservation just because an immediate session listing was empty. Customer-only partial records recover safely.

Claiming re-fetches the exact Stripe session, checks its customer, proof hash, reservation, mode, price and payment, then verifies that the account's verified email matches Stripe's checkout email. A second fresh lookup checks the customer's current subscriptions. Both guest and account leases are held while one DynamoDB transaction binds the customer, saves the entitlement snapshot, and marks the purchase claimed. Reverse customer ownership cannot be overwritten. A retry after a lost successful response is safe. Redirect parameters, browser emails, session IDs and subscription flags never grant access.

An account with an abandoned or canceled older membership customer may claim a legitimate guest purchase. The service first verifies no live or unfinished subscription remains, expires that old customer's open Trace checkouts, rechecks subscriptions, and atomically replaces the old binding. An existing active/unpaid/unfinished membership returns `subscription_exists`; it is never overwritten and no refund or additional charge is attempted automatically.

Unpaid guest records expire after 90 days. Once a completed paid session is observed, its record loses its TTL and is retained until claimed or resolved. The pre-checkout `GUEST_CUSTOMER` binding also lets paid webhooks retain the record when the browser never returns. Claimed records remain for a further 90 days. The website cookie lasts 30 days; losing it requires support to verify and recover the purchase. There is deliberately no API accepting a user-supplied session ID as a substitute. Missing-proof or duplicate-active-purchase copy must direct the user to recovery/billing help, not tell them to pay again. Guest deduplication is browser-bound and cannot prevent someone intentionally purchasing again from a different browser/proof before an account is linked.

## Database records and owner switch

The membership table has a single string partition key `pk`:

| Prefix | Contents |
| --- | --- |
| `ACCOUNT#<sub>` | Verified email, bound Stripe customer, subscription snapshot, pending checkout reservation |
| `CUSTOMER#<cus_id>` | Reverse customer-to-subject binding written before checkout |
| `GUEST#<proof hash>` | Guest customer, exact reservation/session, payment retention and claim state |
| `GUEST_CUSTOMER#<cus_id>` | Guest proof binding, written before checkout, for paid webhook retention |
| `DEVICE#<capture UUID>` | Linked subject and the capture credential hash at approval |
| `LINK#<SHA-256 code>` | Device/credential binding and ten-minute expiry; atomically consumed |
| `EVENT#<evt_id>` | Processed webhook receipt, retained 30 days |
| `LOCK#<sub>` | Lease nonce/expiry for serialized billing mutations |
| `RATE#...` | Short-lived rate-limit counters (identities hashed for auth) |

Link codes use ten random base32 characters, displayed `XXXXX-XXXXX`. Opening the verification URL does **not** approve anything. The user signs in, sees the code and explicitly approves. Approval atomically checks the current device credential, consumes the code, and creates a previously absent device link. Already linked devices must first unlink deliberately. Token rotation or UUID re-registration cannot inherit an existing account's access. No account access or refresh token is returned to a linked device.

`OwnerSwitches` is a **separate table**, keyed by `ownerSubject`. Its only granting record is:

```json
{"ownerSubject":"<verified owner's Cognito sub>","enabled":true}
```

The function configuration `OWNER_SUBJECT` must match this exact immutable account subject. Blank configuration disables the override. Rows for any other account do nothing, even if `enabled` is true. The Lambda role has `GetItem` only on this table; **no customer API or function code can write the switch**. Operator access to the database/CloudFormation is the only way to change it. To revoke immediately, set `enabled` to false; reads do not cache the flag. Do not grant anyone broad database permissions as part of a customer plan.

Before pinning the owner, verify their exact email with Cognito, inspect that account's `sub` and `email_verified=true`, and confirm the requested owner with the user. Never infer ownership from the first registration or the game username. The owner's email/subject and existing-user migration policy are still pending.

## Configuration and deployment

1. Copy `config.example.json` to a gitignored local file. Fill the correct capture device table, a private artifact bucket, profile and region. Use an isolated staging table and stable protected Vercel alias for provider tests, never production fixtures. Start with `BillingEnabled=false`, `StripeMode=test`. `ReservedConcurrency=0` omits a reservation; positive values need verified account quota headroom.
2. Deploy this isolated stack only when authorized. The script validates locally and runs all offline tests by default; **`--execute` is the explicit cloud-write step**:

   ```bash
   python3 infrastructure/memberships/deploy.py /private/tmp/trace-memberships-config.json
   python3 infrastructure/memberships/deploy.py /private/tmp/trace-memberships-config.json --execute
   ```

3. Set all of `SesIdentity`, `SesFromEmail`, `SesRegion` for verified SES delivery. Production configuration requires SES; default Cognito email is development-only and limited to 50 messages/day/account. Check supported region, SES production access, sender coverage and `iam:CreateServiceLinkedRole` permission. `WebOrigin` must be canonical in production/live mode; only staging may use an HTTPS Vercel origin.
4. In a dedicated Stripe sandbox, create two fixed recurring USD monthly prices: 1499 and 3999 cents, quantity one. No free trial, adjustable quantity, or promotion-code field. Create an isolated customer portal configuration permitting only these plans, payment-method updates, invoices and subscription cancellation. Do not reuse the film product's portal configuration.

   See [the sandbox setup plan](../../docs/TRACE_MEMBERSHIPS_STRIPE_SETUP.md) for exact offline request payloads and separate setup/runtime permissions. The adapter accepts standard `sk_test_`/`sk_live_` and restricted `rk_test_`/`rk_live_` keys only in their matching environment; prefer a dedicated restricted runtime credential after verifying its permissions in the sandbox.
5. Register a snapshot webhook endpoint at `<MembershipApiUrl>/v1/webhook`, API version **2024-06-20**, for `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `customer.subscription.created/updated/deleted/paused/resumed`, `invoice.paid`, `invoice.payment_failed` and `invoice.payment_action_required`. The Stripe API adapter explicitly pins 2024-06-20.
6. Store `{"secretKey":"sk_test_...","webhookSecret":"whsec_...","webProxySecret":"<random server-only secret of at least 43 characters>"}` as a dedicated Secrets Manager secret. Pass only its ARN and public configuration IDs to deployment. No secrets in source, CLI arguments, logs, browser code or app binaries. Runtime Stripe secrets are cached for five minutes. Set matching server-only `TRACE_MEMBERSHIP_PROXY_SECRET` and `TRACE_WEB_ORIGIN` on the website. Guest routes fail closed when the proxy secret is absent. Switch API/webhook secrets together.
7. Set `BillingEnabled=true` in the **test stack**, connect the web proxy/native URL, and verify signup, email confirmation/recovery, purchase, failed card, account refresh, duplicate checkout, plan change, cancellation, invoice failure, device link/unlink, owner on/off, and pre/post-match decklist gates end to end. Offline tests below are not proof of these external-service integrations.
8. Launch only after the isolated provider journey, existing-user migration and owner verification pass. Configure live prices/secret, canonical origin and `StripeMode=live`; enabled live billing additionally requires `--allow-live-billing`. Set `TRACE_MEMBERSHIP_API_URL` for server proxy, capture API and desktop. Follow `../../docs/TRACE_MEMBERSHIPS_ROLLOUT.md`; no automatic publication or destructive migration is part of this script.

All tables/user pools are retained on stack deletion. Backups/PITR protect membership and switch state. Logs record only error class and request ID; no body, tokens, email or upstream exception message. Public auth/code attempts have per-identity limits in addition to API Gateway/Cognito limits. No CORS credentials or cross-origin browser access is configured.

## Verification

```bash
python3 -m unittest discover -s infrastructure/memberships/tests -v
python3 -m py_compile infrastructure/memberships/lambda/*.py infrastructure/memberships/deploy.py
```

Offline tests use synthetic accounts, fake persistence/Cognito/Stripe, deterministic time and genuine HMAC signatures. They cover entitlements, freemium, owner scope, device linking, price validation, checkout/claim recovery, webhook ordering and failed persistence. Deployment tests cover SES configuration, production redirects and concurrency input. They never start Trace or Pokémon TCG Live, charge a card, send email or contact external providers.

YAML syntax, Python compilation and AWS CloudFormation template validation have passed. Real-AWS staging capture smoke tests passed with policy enforcement disabled and enabled. Auth/email and paid Stripe end-to-end verification remain pending; consult [rollout status](../../docs/TRACE_MEMBERSHIPS_ROLLOUT.md) for current evidence rather than treating offline tests as provider validation.

Implementation references: [Cognito GetUser](https://docs.aws.amazon.com/cognito-user-identity-pools/latest/APIReference/API_GetUser.html), [Stripe webhook verification and delivery](https://docs.stripe.com/webhooks), [Checkout sessions](https://docs.stripe.com/api/checkout/sessions/create?api-version=2024-06-20).
