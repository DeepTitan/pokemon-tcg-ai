# Trace memberships (not deployed)

This is a new, isolated AWS stack. It neither reads the existing film subscription database nor changes the capture stack. Billing defaults off; no real credentials, products, customers, emails, charges, or cloud resources were created while implementing it.

- **Trace — USD $14.99/month:** Trace access.
- **Supporters Club — USD $39.99/month:** Trace plus opponent decklists **after the match has ended**.
- **Owner switch:** the configured owner's verified Cognito subject can receive both entitlements immediately via a separate database flag. This bypasses billing only. Native/server match-completion checks still apply.

## Access decisions

Cognito accounts verify their email. The API pins each access token to this pool and app client, then calls Cognito `GetUser` to validate it. Browser tokens stay in the website's HttpOnly cookie proxy. Confirmation emails can be resent through `POST /v1/auth/resend`; unknown or already-confirmed accounts receive generic success. Native devices use their existing capture UUID and bearer; those are checked against the capture device table with a strong read. A device also has to be explicitly linked by a signed-in member using a one-time code.

Paid access requires one recognized subscription, status `active`, latest invoice paid, exact allowlisted price/amount/USD/monthly recurrence, quantity one, and a future paid-period end. `trialing`, `past_due`, `unpaid`, paused, malformed and conflicting subscriptions deny access. No trial is offered. Cancellation at period end preserves access until that date. Customers manage or switch existing plans through an isolated Stripe portal configuration; checkout returns `409 subscription_exists` for an existing membership.

Subscription state is read consistently from DynamoDB. Verified webhooks trigger a **fresh Stripe subscription lookup**, rather than copying an event's potentially stale snapshot. Account mutations are serialized by a conditional 90-second lease; every entitlement write checks ownership and lease expiry. The Lambda timeout is 29 seconds, so an old execution cannot continue after another execution takes its lease. Only successfully persisted updates receive a durable event receipt and a 2xx acknowledgement. Stripe retries transient failures/lock contention. Duplicate and out-of-order events cannot roll entitlements back. Reads reconcile snapshots older than five minutes; reconciliation failure denies the protected read with 503.

Checkouts persist a stable idempotency key before creation, retrieve current session state on retries, and expire a previous open session when the selected plan changes. Checkout sessions accept card payment only. Return URLs are fixed to `https://victoryroad.app/trace/account`. API redirects are disabled and returned URLs must use the expected Stripe host. Nothing trusts a client price, customer ID, account subject, plan flag, or admin flag.

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

1. Copy `config.example.json` to a gitignored local file. Fill the existing capture device table name, a private CloudFormation artifact bucket, profile and region. Start with `BillingEnabled=false`, `StripeMode=test`, and blank owner/Stripe fields.
2. Deploy this isolated stack only when authorized. The script validates locally and runs all offline tests by default; **`--execute` is the explicit cloud-write step**:

   ```bash
   python3 infrastructure/memberships/deploy.py /private/tmp/trace-memberships-config.json
   python3 infrastructure/memberships/deploy.py /private/tmp/trace-memberships-config.json --execute
   ```

3. Cognito's default email service has a small sending quota. Before public launch, configure verified production SES delivery in the user pool and confirm delivery/recovery/domain settings. Do not launch a paid signup flow with only an untested sandbox sender.
4. In a dedicated Stripe sandbox, create two fixed recurring USD monthly prices: 1499 and 3999 cents, quantity one. No free trial, adjustable quantity, or promotion-code field. Create an isolated customer portal configuration permitting only these plans, payment-method updates, invoices and subscription cancellation. Do not reuse the film product's portal configuration.
5. Register a snapshot webhook endpoint at `<MembershipApiUrl>/v1/webhook`, API version **2024-06-20**, for `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `customer.subscription.created/updated/deleted/paused/resumed`, `invoice.paid`, `invoice.payment_failed` and `invoice.payment_action_required`. The Stripe API adapter explicitly pins 2024-06-20.
6. Store `{"secretKey":"sk_test_...","webhookSecret":"whsec_...","webProxySecret":"<random server-only secret of at least 43 characters>"}` as a dedicated Secrets Manager secret. Pass only its ARN, the price IDs, and the portal configuration ID to deployment. No secret values in source, CLI arguments, build logs, browser code, or app binaries. Secret retrieval occurs only in the Lambda at runtime, with a five-minute cache. Set the matching `TRACE_MEMBERSHIP_PROXY_SECRET` only on the website server. Guest routes fail closed when it is absent. Switch API+webhook secrets together.
7. Set `BillingEnabled=true` in the **test stack**, connect the web proxy/native URL, and verify signup, email confirmation/recovery, purchase, failed card, account refresh, duplicate checkout, plan change, cancellation, invoice failure, device link/unlink, owner on/off, and pre/post-match decklist gates end to end. Offline tests below are not proof of these external-service integrations.
8. Launch only after the existing-user migration policy and owner identity are settled. Configure live prices/secret and `StripeMode=live`; deploying enabled live billing additionally requires `--allow-live-billing`. Set `TRACE_MEMBERSHIP_API_URL` for the server proxy, capture API and desktop build. Root deployment owns those integrations. No automatic publication or destructive migration is part of this script.

All tables/user pools are retained on stack deletion. Backups/PITR protect membership and switch state. Logs record only error class and request ID; no body, tokens, email or upstream exception message. Public auth/code attempts have per-identity limits in addition to API Gateway/Cognito limits. No CORS credentials or cross-origin browser access is configured.

## Verification

```bash
python3 -m unittest discover -s infrastructure/memberships/tests -v
python3 -m py_compile infrastructure/memberships/lambda/*.py infrastructure/memberships/deploy.py
```

All 58 offline tests pass. Tests use synthetic accounts, in-memory fake persistence/Cognito/Stripe, deterministic time and genuine HMAC signatures. They exercise grants/revocation/expiry, strict prices, owner-only scope, wrong-pool credentials, replayed/expired link codes, changed device tokens, duplicate checkout recovery, stale snapshots, webhook ordering/duplicate delivery, concurrency and failed persistence. Guest tests additionally cover direct purchase without an account, proof/session binding, partial records, lost Stripe responses, duplicate clicks, expired checkout recovery, paid webhook retention, email mismatch, atomic claim failures/retries, abandoned prior customers, and inactive paid purchases that must not trigger repayment. They never start Trace or Pokémon TCG Live, charge a card, or send email.

YAML syntax and Python compilation also pass. SAM/CloudFormation semantic validation, real Cognito email delivery, Stripe sandbox checkout/webhook/portal verification and deployed IAM checks remain deployment-stage requirements; this environment had no SAM CLI or Python AWS SDK installed, and no secrets/cloud writes were authorized for this subtask.

Implementation references: [Cognito GetUser](https://docs.aws.amazon.com/cognito-user-identity-pools/latest/APIReference/API_GetUser.html), [Stripe webhook verification and delivery](https://docs.stripe.com/webhooks), [Checkout sessions](https://docs.stripe.com/api/checkout/sessions/create?api-version=2024-06-20).
