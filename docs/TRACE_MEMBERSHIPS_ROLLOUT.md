# Trace freemium and membership rollout

## Agreed behavior

- **Free:** continuous capture, leaderboard eligibility, full replays from the last seven days, and one new replay share per installation per rolling seven days. This is ongoing free access, not a seven-day recording trial.
- **Pro:** USD $14.99/month for full archive access and expanded sharing. Internal plan ID remains `trace`.
- **Supporters Club:** USD $39.99/month, including Pro and post-match opponent deck study. Full opponent starting lists require authoritative match-end evidence; closing the client or an inferred winner cannot unlock them.
- Subscription status never filters rating events, deletes captures or stops recording. Existing locally saved games are grandfathered by the native migration; new old-game cloud reads/shares follow the cloud policy. Existing public links remain accessible.
- No Discord account or community join is required for signup, checkout, download, device linking or deployment.
- One verified owner may bypass billing through a pinned Cognito subject and separate database switch. This grants product access, not AWS/billing administration, and never bypasses match-end evidence.

## Release locations

- Desktop/capture/membership: `release/trace-memberships-20260927`, branch `codex/trace-memberships`, based on upstream `9bda5aa7585988e8c15851e396d05c82062efc45`.
- Website: sibling `release/trace-memberships-web-20260927`, branch `codex/trace-memberships-web`, based on the separate deployed website source.
- Do not deploy the dirty root workspace or unrelated Prize Map source.

## Readiness and configuration

### Current checkpoint — September 29, 2026

- The protected website preview uses source `03834b2`, deployment
  `dpl_DtTEKuUfGUSGFNKVMh87KrxZoYuN`, at
  `https://trace-memberships-staging-deeptitan-6729s-projects.vercel.app`.
  Production aliases and public billing remain unchanged.
- Both initial sandbox purchases, explicit claims, portal access, paid Pro →
  Supporters upgrade, failed-upgrade preservation, cancellation and signed
  webhook delivery/retry passed. All successful and failed synthetic purchase
  fixtures were cleaned up with scoped ownership checks; Stripe audit objects
  and the real owner account were preserved. The backend passed 116 tests.
  See the [dated browser and helper evidence](../../trace-memberships-web-20260927/docs/TRACE_MEMBERSHIPS_DRY_RUN_20260928.md#protected-staging-browser-check--september-29-2026).
- The synthetic staging installation/API and explicit browser approval passed
  Free → Supporters → unlink to Free. This did **not** test the packaged native
  app's canonical `/trace/link` handoff, release endpoint pairing or isolated-data
  behavior. Those native release checks remain pending.
- The real owner account is confirmed in staging, after the original Cognito
  email arrived in Spam. It has no production subject binding or owner override.
- Domain DKIM and the exact SES test recipient are verified. Staging Cognito
  uses `DEVELOPER` email from `no-reply@victoryroad.app`. The recovery UI requested
  a branded email; SES reports one attempt and no bounce, complaint or reject,
  and the owner confirmed the resent email arrived in Spam and marked it Not
  spam. Actual Gmail authentication results and recovery completion are pending.
  No password was changed. See [sender evidence](TRACE_MEMBERSHIPS_EMAIL_SETUP.md).
- The five-resource email operations stack reached `CREATE_COMPLETE`. SNS
  subscription is now confirmed. The guarded feedback helper attached both
  Bounce/Complaint topics and passed read-back; actual alert delivery is pending.
  SES production access has not been requested. See [operations status](TRACE_EMAIL_OPERATIONS.md).

Remaining release work includes confirming branded email receipt/recovery and
actual email-alert receipt, obtaining SES
public sending access, production owner binding, separate live Stripe setup,
the packaged native release checks, and coordinated production deployment.
No sandbox result alone establishes that production is shipped.

### Historical setup snapshot — September 28, 2026

The September 28 readiness/progress and catalog notes below preserve the earlier
sequence and resource provenance. Their pending statements and old deployment
IDs are historical, not current readiness; the September 29 checkpoint above
and its linked evidence supersede them.

Local implementation and offline checks do **not** establish a production launch or successful provider integration. As of September 28, 2026, AWS authentication works with profile `default`, account `108241940679`, region `us-east-1`; both CloudFormation templates passed AWS validation. The user has authorized the existing Victory Road Stripe account for separate Trace plans, webhooks and test-mode checkout. Stripe sign-in succeeded; setup uses the existing `PrizeMap LLC sandbox` (`acct_1UBug9KoV4rXpeob`), whose live parent is `acct_1UBug03qgXndaKhC`. Use dedicated Trace credentials and resources; the existing film billing secret has not been exported and is not needed. The owner's email and verified Cognito subject remain pending.

### Historical authorized staging progress — September 28, 2026

- Existing production capture, leaderboard and legacy access stacks remain unchanged. The legacy `trace-access-production` stack is the private download-code service, not the new membership service; preserve its resources and existing capture-device identities.
- Isolated capture stack `trace-memberships-capture-staging` is deployed at `https://wfricgjx12.execute-api.us-east-1.amazonaws.com` and is `UPDATE_COMPLETE` with `RequireMembership=true`, pointing at the staging membership API below. Real-AWS capture smoke tests passed with both the initial disabled policy and the enabled policy. Enabled-policy evidence: `artifacts/membership/capture-staging-smoke-enabled.json`; all six groups passed, covering one new share per seven days, old-replay 403, repeat-share reuse, private/public redaction, preserved raw S3 data and error-free synthetic cleanup. Current output metadata: `artifacts/membership/capture-staging-stack.json` (refreshed after enabling enforcement).
- Isolated membership stack `trace-memberships-staging` is deployed at `https://scn2ntfvfa.execute-api.us-east-1.amazonaws.com`, with sandbox billing enabled, test mode, no owner override and the development Cognito email sender. Pool: `us-east-1_ELXorHpct`; client: `2js5quloo43e2700j7vki1l9n0`. Output metadata: `artifacts/membership/membership-staging-stack.json`.
- Membership reads only the staging device table `trace-memberships-capture-staging-TraceDevices-1KTH5BSZON6NT`. Staging matches, shares and payloads are separately provisioned; never substitute the production tables for provider tests.
- Stable protected preview `https://trace-memberships-staging-deeptitan-6729s-projects.vercel.app` is assigned and SSO access was verified. It matches the membership stack's `WebOrigin` and now points to ready deployment `dpl_7rAu1KUrnzxErs4SqbDyDM4PvF6K`, source `bc29ce1`. Preview API/origin variables and the matching sensitive proxy secret are configured. Initial HTTP checks verified pricing/signup/link/script 200, signed-out account 401 with private/no-store, missing/untrusted Origin 403, and unconfigured checkout 503. The preceding preview passed the signed-in provider checks below; the new preview still needs the sandbox payment browser journey. Production alias and environment variables remain unchanged. This is not a completed email/checkout/claim journey.
- The `victoryroad.app` SES identity was created in `us-east-1` with RSA-2048 DKIM and remains `PENDING`. DNS is authoritative at GoDaddy (`ns09.domaincontrol.com`, `ns10.domaincontrol.com`), with no `_domainkey` delegation to Vercel. No DKIM DNS records have been added, no SES production-access request submitted, and no email sent as part of sender setup. SES is still sandboxed and has no verified sender. See [email setup and draft request](TRACE_MEMBERSHIPS_EMAIL_SETUP.md).
- The two Trace products/prices below were created and verified in the existing Stripe sandbox through the Dashboard. Sandbox portal `bpc_1UKpulKoV4rXpeobDUDFzCz9`, webhook `we_1UKqEXKoV4rXpeobfsM6kmTm` and restricted application key **Trace staging runtime** now exist; no live objects were changed. Root created the key after explicit user approval. AWS secret ingestion succeeded after correcting the initial helper; only its ARN is recorded in ignored artifacts. The staging-only deployment completed successfully with test billing enabled. The matching web proxy secret was installed as a sensitive **Preview-only** variable; its ready preview is source `bc29ce1`, deployment `dpl_7rAu1KUrnzxErs4SqbDyDM4PvF6K`, at the stable alias above. The remaining setup is described in [the sandbox plan](TRACE_MEMBERSHIPS_STRIPE_SETUP.md). Staging source `5524549` is deployed and verified `UPDATE_COMPLETE`, with billing enabled in test mode and no owner override. The adapter accepts standard and restricted keys only in the configured mode. Paid access now requires invoice evidence for the current tier and period; a prior Pro invoice cannot establish Supporters access. All 90 membership tests pass. Actual restricted-key permissions and paid checkout/portal behavior still require sandbox verification, including whether a failed upgrade preserves already-paid Pro access.
- A real Cognito/protected-preview session smoke passed using one disposable admin-confirmed account with email delivery suppressed. It verified wrong-password 401, successful login with Secure/HttpOnly/host-only cookies and token-free JSON, exact Free capabilities, fixed installer redirects, authenticated CSRF rejection, automatic and explicit refresh, logout and rejection of the old access/refresh tokens. The first run exposed a reserved `ttl` field in the rate-limit query; source `915f5b8` fixes it, and the full rerun passed. Both runs cleaned up their generated users and exact account/rate rows. The website also preserves Free downloads and billing recovery for pending/invalid/conflicting subscriptions; 36 focused web tests pass. Evidence: sibling website checkout `artifacts/membership/session-smoke-20260928.md`; runner `scripts/smoke-trace-member-session-staging.py`. This confirms provider authentication/session behavior, not real email verification, payment or owner activation.

Remaining gates are authoritative DKIM publication and SES verification/production sending, the real sandbox payment/claim/portal journey and runtime permission verification, owner identity verification, and a completed protected-preview signup/email/device-link flow. The capture and disposable session smoke tests do not establish successful signup email delivery or billing/claim behavior.

### Historical Stripe sandbox catalog/setup snapshot

These IDs are sandbox-only configuration, not live billing resources. Both prices are active, USD monthly and tax-exclusive. Nonsecret evidence: `artifacts/membership/stripe-sandbox-catalog.json` (ignored locally).

| Plan | Product | Price | Amount/month |
| --- | --- | --- | --- |
| Trace Pro (`trace`) | `prod_VLWofX5NpMbIx4` | `price_1UKplGKoV4rXpeobtpGOjXvt` | $14.99 |
| Trace Supporters Club (`supporter`) | `prod_VLWpISqeqnID8w` | `price_1UKplmKoV4rXpeobxD2yr9AL` | $39.99 |

Product descriptions are “Full match archive and expanded sharing.” and “Everything in Pro, plus post-match deck study.” respectively. The portal was created at Unix timestamp `1790645583`; its response confirmed `active=true`, `livemode=false` and Trace/staging metadata. It returned `is_default=true` because this sandbox had no previous portal configuration. This did not change the live parent's default portal. Keep this sandbox configuration; do not create unnecessary additional configurations just to change the default flag. Live deployment must create a separate Trace configuration and preserve the existing film default.

`artifacts/membership/stripe-sandbox-portal-plan.json` and `stripe-sandbox-portal-shell.txt` retain the historical offline proposal, now marked superseded. Workbench rejected the generic `stripe post` command and treated `--idempotency` as an unknown API parameter; the successful resource command omitted both that flag and `--stripe-version`. The creation request's API version was not recorded. The Lambda adapter and intended snapshot webhook remain pinned to `2024-06-20`. Do not replay any creation step. Expanded read-back verified the two exact product/price pairs. A follow-up update at Unix timestamp `1790645648` explicitly disabled `adjustable_quantity` for each product, which otherwise defaulted to enabled despite the price-only update list. Final read-back verified both quantity controls disabled, subscription updates enabled with only `price`, immediate `always_invoice` proration, cancellation `at_period_end` with proration `none`, and `livemode=false`. The offline generator now explicitly disables both quantity controls. No paid checkout/claim/portal journey has run yet.

Stripe's Dashboard settings manage only the default portal configuration; creating a separate Trace configuration requires the [portal configuration API](https://docs.stripe.com/customer-management/integrate-customer-portal#customize). Automatic approval review rejected the broader “Authorizing an AI agent” key flow, and that grant has not been made. The existing signed-in [Workbench Shell supports sandbox API writes](https://docs.stripe.com/workbench/shell); root created the portal through that session without an additional setup credential or expanded agent grant. Preserve unrelated film billing configuration. No credential or signing secret belongs in these catalog/plan artifacts.

The enabled sandbox webhook `we_1UKqEXKoV4rXpeobfsM6kmTm` was created at Unix timestamp `1790646809`. Root verified `livemode=false`, API version `2024-06-20`, the staging URL `https://scn2ntfvfa.execute-api.us-east-1.amazonaws.com/v1/webhook`, and exactly the backend's 11 event types. Its signing secret is ingested into the dedicated AWS secret bundle and is not recorded here. The approved restricted application key has only Customers Write, Customer Portal Write, Checkout Sessions Write, Prices Read, Subscriptions Read and Invoices Read; all other permissions are unset. Those scopes are configured, not yet proven against real application calls.

The ignored `artifacts/membership/staging-config.json` contains the verified prices, portal ID and runtime secret ARN; `BillingEnabled=true` and `StripeMode=test`. The staging deployment completed on September 29 UTC (September 28 local), with `UPDATE_COMPLETE` and Lambda Active/Successful. Three safe readiness probes passed: signed-out account 401, unsigned webhook 400 `invalid_signature`, and a checkout-status call lacking the proxy key 401; all returned `Cache-Control: no-store`. This verifies service/secret-bundle readiness without exposing values, creating Stripe objects, or proving Stripe API permission scopes. Evidence: `artifacts/membership/staging-billing-readiness-20260929.json`, `membership-staging-billing-deploy-20260929.log` and refreshed `membership-staging-stack.json`. The web agent is running prepare/status-only preview checks next; root owns the first real checkout journey. Production is unchanged.

- `ReservedConcurrency=0` omits a reservation; it does not set Lambda's actual reserved concurrency to zero. Positive values require verified regional headroom. AWS retains 100 unreserved units, so the old hardcoded reservation of 20 could fail in a limited account. [AWS concurrency guidance](https://docs.aws.amazon.com/lambda/latest/dg/configuration-concurrency.html)
- `SesIdentity`, `SesFromEmail`, `SesRegion` configure a verified SES sender in this account; supply all three together. Production requires SES. Blank development settings use Cognito's default sender, currently limited to 50 emails/day per AWS account. Confirm SES production sending, identity verification and supported region; the deploy principal may need `iam:CreateServiceLinkedRole`. [Cognito quotas](https://docs.aws.amazon.com/cognito/latest/developerguide/quotas.html), [email configuration](https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-email.html)
- `WebOrigin` fixes Stripe checkout and portal returns. Production/live billing require `https://victoryroad.app`; test stacks may explicitly use one HTTPS Vercel origin. Request headers/client fields never select this origin.

## Isolated provider dry run

1. Publish a **protected preview** with billing unavailable and choose a stable Vercel alias. Do not expose test checkout on the public production site. Keep the same alias across redeployments so cookies and payment returns retain their origin.
2. Create an isolated staging capture stack/table and synthetic devices using explicit `TRACE_STACK_NAME` and `TRACE_ENVIRONMENT=staging`. Never upload synthetic ranked fixtures into production or point staging membership at the production device table.
3. Configure staging membership with that staging device table and the preview alias as `WebOrigin`. Keep `StripeMode=test`; use dedicated sandbox prices, webhook and portal, separate from film billing. Configure verified email delivery or a tightly limited development sender for initial tests.
4. Set preview `TRACE_MEMBERSHIP_API_URL`, `TRACE_MEMBERSHIP_PROXY_SECRET` and matching `TRACE_WEB_ORIGIN`. Match the proxy secret to service `webProxySecret`; neither enters JavaScript. Enable test billing only on staging after configuration.
5. Complete Free signup, email confirmation/resend/recovery, download, both sandbox purchases, claim and device linking. Release desktop binaries deliberately accept only the production link URL: approve a staging code manually on the protected preview and inspect staging device status instead of weakening release validation.
6. Test failed card, canceled checkout, refresh-only session, wrong-account recovery, duplicate clicks/tabs, lost responses, delayed/duplicate/out-of-order webhooks, plan switching, cancellation, failed invoice, owner on/off and unlink. No redirect parameter or browser flag may grant access.
7. With saved/synthetic captures, verify recent free reads, locked new old replays, local grandfathering, one free share then rejection, repeat-share reuse, concurrent share requests, premium sharing, membership outages and pre/post-match deck restrictions. Existing sanitized public links must remain readable. **Do not launch Pokémon TCG Live or enter a match.**

Required real-provider evidence: actual email receipt/recovery, authenticated session and CSRF rejection, atomic DynamoDB/IAM behavior, Stripe sandbox reconciliation, and preview redirect/cookie handling. Offline fakes cannot prove these integrations.

## Production deployment order

1. After the isolated dry run passes, inspect the deployed capture template and reviewed change set. Preserve device/match/share tables, private bucket versions and the `KEYS_ONLY` leaderboard stream. No replacement or destructive migration is intended.
2. Deploy the production membership stack with SES, canonical `WebOrigin` and billing initially disabled. The complete config is validated by `infrastructure/memberships/deploy.py`; `--execute` performs writes. Enabled live billing additionally requires `--allow-live-billing`.
3. Have the owner verify their account, pin its immutable Cognito `sub`, and enable only that subject's database switch. Never infer ownership from a player name, unrelated caller-supplied email or Git author.
4. Configure separate live Stripe prices ($14.99/$39.99 monthly USD, quantity one), webhook and portal. Adapter and snapshot webhook version are pinned to `2024-06-20`. Set live service and web proxy secrets together.
5. Deploy the website/account/proxy changes from the website checkout. Preserve leaderboard/share routes and the account-link alias.
6. Deploy capture privacy/freemium changes. Explicitly set `MembershipApiUrl`; enable `RequireMembership` only when membership/website/native releases are coordinated. The flag enforces premium history and free-share quota, never uploads or summaries.
7. Capture deployment preserves previous parameter values unless overridden explicitly with `TRACE_MEMBERSHIP_API_URL`, `TRACE_REQUIRE_MEMBERSHIP` or `TRACE_ENVIRONMENT`. Staging cannot publish the release API variable. Updating GitHub `TRACE_SYNC_API_URL` requires explicit `TRACE_PUBLISH_RELEASE_API=true` and canonical `trace-production` stack/environment.
8. Set desktop `TRACE_MEMBERSHIP_API_URL` and publish through normal signed macOS/Windows release workflow after reviewing upstream changes. Verify updater feeds, free capture, paid reads, webhooks, public leaderboard and post-match unlock before calling rollout complete.

## Boundaries and recovery

- `traceAccess` remains a **paid** compatibility Boolean. Additive `capabilities` supplies free recording/leaderboard, seven-day replay/one-share limits and explicit premium capabilities. Outages leave free capture usable.
- Ordinary native premium access uses a lease up to 60 seconds, refreshed every 30 seconds and capped at subscription expiry. Owner/protected list checks refresh from the server.
- Share pointer, public lookup and free-use timestamp commit atomically. Retry the same game after preparation/network failure. The allowance is per installation, not account-wide anti-abuse.
- Cloud history age is immutable once stored. Existing records use the earliest usable old date; corrections do not restart the free window. No originals are deleted on downgrade. Public compact leaderboard history covers all accepted games.
- Public installers/old binaries can bypass website download onboarding; this is not DRM. Raw local captures and previously downloaded copies cannot be remotely recalled.
- Full opponent inventories are removed from ordinary/public replay data. Protected native reads require current Supporters/owner access and raw terminal evidence. Cloud-restored reviews lacking evidence show lists unavailable.
- Legacy public replay artifacts rebuild through privacy projection format 2 before honoring old ETags.

## Offline verification

Run `python3 -m unittest discover -s infrastructure/aws/tests -p 'test*.py'` and `python3 -m unittest discover -s infrastructure/memberships/tests -p 'test*.py'`. Also check Python compilation, shell syntax and YAML parsing. These require no credentials, email sends, card charges or game launches. Both templates passed AWS CloudFormation validation on September 28, and real-AWS capture smoke tests passed with enforcement disabled and enabled. Actual email, Stripe and account/link provider tests remain requirements of the authorized staging rollout.
