# Trace Stripe sandbox setup

Prepared September 28, 2026. The user authorized the existing Victory Road Stripe account for separate Trace plans, webhook configuration and test-mode checkout. No existing film secret is needed or accessed by this setup. Both products/prices, sandbox portal, webhook and explicitly approved restricted application key now exist; see [verified rollout state](TRACE_MEMBERSHIPS_ROLLOUT.md#verified-stripe-sandbox-catalog) before taking any action. The generator below only proposes requests; never replay completed creation steps. AWS secret ingestion and test-only staging billing deployment are complete. The paid provider journey and actual Stripe API permission checks are still pending.

## Isolation and compatibility

Use a dedicated Trace sandbox within the authorized account if available. Select its test environment before creating anything. Do not change the account's default API version, default portal, global branding/email settings, film products/prices/customers or existing webhook destinations. Stripe recommends a separate sandbox for new integrations because its settings/data are isolated. [Stripe API keys](https://docs.stripe.com/keys)

The runtime sends `Stripe-Version: 2024-06-20` and expects classic subscription fields: subscription-level `current_period_end` and expanded `latest_invoice.paid`. Use a snapshot webhook with that explicit version, not a thin-event destination or automatic latest version. Do not enable flexible billing or upgrade the version as part of setup. Matching API versions and permissions still require the real sandbox journey; offline tests do not prove provider compatibility.

The adapter now accepts standard `sk_test_` and restricted `rk_test_` credentials in test mode, and their live counterparts only in live mode. It rejects wrong-mode, publishable, organization, empty and malformed keys before HTTP. Invalid key values are never cached. This source change must be deployed to staging before testing a restricted key. Stripe documents restricted keys as server-side replacements for standard keys. [Restricted API keys](https://docs.stripe.com/keys/restricted-api-keys)

## Credential permissions

Use separate setup and runtime credentials. Do not store a setup credential in Lambda. This table is the smallest endpoint-derived starting set for the runtime, not a claim of provider validation:

| Resource permission | Level | Actual adapter operations |
| --- | --- | --- |
| Customers | Write | Create a new dedicated Trace customer; write also permits read |
| Prices | Read | Retrieve and validate the two configured prices |
| Subscriptions | Read | List subscriptions; read the expanded checkout subscription |
| Invoices | Read | Read expanded `latest_invoice` and its paid state |
| Checkout Sessions | Write | Create, list, retrieve and expire sessions; read expanded line items |
| Billing Portal sessions | Write | Create a session with the configured `bpc_` ID |

Dashboard category names can group resources; select the narrow resource where offered. Confirm expanded-resource and portal permissions with the actual test requests and Stripe request logs. Add only permissions identified by a failed operation; do not preemptively grant all Billing/Payment permissions. The adapter does not directly create PaymentIntents, refunds, payouts or transfers. Receiving/verifying webhooks does not need Events or Webhook Endpoints API access. Restricted keys scope resource types, not exclusively Trace object IDs, so a dedicated sandbox and application ownership checks remain important. [Stripe permission guidance](https://docs.stripe.com/keys/restricted-api-keys)

Setup via API additionally needs Products Write, Prices Write, Billing Portal configurations Write and Webhook Endpoints Write. If the operator creates those objects in the Dashboard, those setup permissions are unnecessary on the runtime key. Leave Connect permissions unset. Do not add an office IP restriction to Lambda's credential: this stack has no configured fixed egress IP. The runtime credential, webhook signing secret and proxy secret belong only in a dedicated Secrets Manager JSON, never a source file, CLI argument, screenshot or chat.

## Exact request plan

Generate the form-field payloads without credentials or network calls:

```bash
python3 infrastructure/memberships/stripe_sandbox_plan.py
```

The script is always a dry run and has no execution flag. After the two products/prices exist, pass their public IDs with `--trace-product`, `--trace-price`, `--supporter-product`, `--supporter-price` to resolve the portal allowlist. Each emitted request uses `POST` and `application/x-www-form-urlencoded`. Persist each created object ID and a unique idempotency key per setup step before execution; do not repeatedly create objects after a lost response or assume an idempotency key is retained forever.

| Step | Endpoint | Required configuration |
| --- | --- | --- |
| Pro product | `/v1/products` | Name `Trace Pro`; metadata `app=trace`, `environment=staging`, `plan=trace` |
| Pro price | `/v1/prices` | Its new product ID; USD `unit_amount=1499`, monthly interval/count 1, `per_unit`, `licensed` |
| Supporters product | `/v1/products` | Name `Trace Supporters Club`; matching metadata with `plan=supporter` |
| Supporters price | `/v1/prices` | Its new product ID; USD `unit_amount=3999`, otherwise same recurrence |
| Dedicated portal | `/v1/billing_portal/configurations` | Two products and only their new price IDs; price switching, payment-method updates, invoice history and end-of-period cancellation |
| Staging webhook | `/v1/webhook_endpoints` | URL and explicit event list below, `api_version=2024-06-20`, `connect=false` |

Prices must be active, recurring, monthly USD with no trial or variable quantity. Do not enable promotion codes. Runtime Checkout already fixes quantity to one and payment method to card. [Create prices](https://docs.stripe.com/api/prices/create?api-version=2024-06-20)

Portal settings: `default_allowed_updates=[price]`, each product's `adjustable_quantity.enabled=false`, `subscription_update.proration_behavior=always_invoice`, and `subscription_cancel.mode=at_period_end` with cancel proration `none`. The sandbox response showed quantity controls default to enabled even with price-only updates, so explicitly disable and verify both controls. Disable hosted portal login and customer email editing; sessions are created only for the authenticated account's bound customer. Return URL is the protected staging origin plus `/trace/account`. Preserve the established live film default. The first configuration in the existing sandbox became its default; keep that verified Trace configuration rather than creating duplicates. See the rollout document for actual created IDs and Workbench command limitations. [Portal configuration API](https://docs.stripe.com/api/customer_portal/configurations/create?api-version=2024-06-20)

**Two-product behavior:** use the readable product names above, with immediate prorated changes that the customer explicitly confirms in Stripe. Cancellation takes effect at the end of the paid period. Stripe documents scheduled end-of-period downgrades only between prices on the same product; no schedules are part of this setup. Verify the actual confirmation and amount display in the sandbox portal, and test an unsuccessful upgrade to ensure it grants no unpaid Supporters access. Stripe's portal branding/email settings can be account-wide, so leave them unchanged. [Portal settings](https://docs.stripe.com/customer-management/configure-portal)

Staging webhook: `https://scn2ntfvfa.execute-api.us-east-1.amazonaws.com/v1/webhook`.

```text
checkout.session.completed
checkout.session.async_payment_succeeded
checkout.session.async_payment_failed
customer.subscription.created
customer.subscription.updated
customer.subscription.deleted
customer.subscription.paused
customer.subscription.resumed
invoice.paid
invoice.payment_failed
invoice.payment_action_required
```

The emitted list comes directly from the backend's `EVENT_TYPES`. Its signing secret is distinct from the API key. A webhook-create response contains the signing secret: never print or save the full response in ordinary logs/artifacts. Store the secret directly in the approved secret store and retain only the endpoint ID in rollout evidence. The endpoint may receive unrelated account events; the service acknowledges unknown customers without granting entitlement. [Webhook endpoint API](https://docs.stripe.com/api/webhook_endpoints/create?api-version=2024-06-20)

## Wire staging, then verify

1. Store the dedicated runtime credential as `secretKey`, this endpoint's `webhookSecret`, and a randomly generated server-only `webProxySecret` of at least 43 characters in Secrets Manager. The credential is a secret; `price_`, `prod_`, `bpc_` and `we_` identifiers are configuration metadata.
2. Set `StripeSecretArn`, `TracePriceId`, `SupporterPriceId`, `StripePortalConfigId`, `StripeMode=test`, and `BillingEnabled=true` only on `trace-memberships-staging`. Preserve its staging device table and `WebOrigin=https://trace-memberships-staging-deeptitan-6729s-projects.vercel.app`. Redeploy the restricted-key adapter change.
3. Set the preview's matching `TRACE_MEMBERSHIP_PROXY_SECRET` server-side. Confirm its `TRACE_MEMBERSHIP_API_URL` is `https://scn2ntfvfa.execute-api.us-east-1.amazonaws.com` and `TRACE_WEB_ORIGIN` matches the protected alias. Never expose test checkout on the public production site.
4. Use the application's guest purchase/verified account claim flow with Stripe test payment details. Do not create a manual subscription and treat it as proof of checkout/claim behavior. Exercise both plans, cancel/failed payment, lost-response retry, wrong-email recovery, duplicate tabs, portal plan switching, delayed/duplicate webhooks and cancellation/expiry.
5. Check the exact runtime operations above using the restricted key, including all expansions and portal sessions. Test webhooks while billing is enabled; earlier deliveries while disabled can be retried afterward. Paid access must arise from authoritative Stripe state and verified ownership, never the success URL.
6. Record only nonsecret object IDs, sanitized result summaries and test outcomes. Provider success is still pending until these tests run. Configure fresh live objects/credential only after the approved sandbox journey passes.
