# Trace freemium and membership rollout

## Agreed behavior

- **Free:** continuous capture, leaderboard eligibility, full replays from the last 30 days, own deck/prize study, captured opponent decklists, and one new replay share per installation per rolling seven days. This is ongoing free access, not a recording trial.
- **Pro:** USD $4.99/month or $49.99/year for full archive access and unlimited sharing. Internal plan ID remains `trace`.
- **Supporters Club:** USD $39.99/month, including Pro, exclusive Discord access/support, and early features/nightly releases. Opponent starting lists require complete validated capture and verified player identity and are available during matches. Match results still require authoritative completion evidence.
- Subscription status never filters rating events, deletes captures or stops recording. The desktop applies the 30-day replay window to existing local games too, while keeping their summaries visible and all original data saved. Existing public links remain accessible.
- No Discord account or community join is required for signup, checkout, download, device linking or deployment.
- One verified owner may bypass billing through a pinned Cognito subject and separate database switch. This grants product access, not AWS/billing administration, and never bypasses match-end evidence.

## Release locations

- Desktop/capture/membership: GitHub `DeepTitan/pokemon-tcg-ai`, `main`. Current published source: `83a3a9bff91ee6f3e1b96dfecb4c0dff83b617b8`, merged in PR #12; includes the new upgrade modal, earlier pricing changes, and idle capture recovery.
- Website: the same GitHub repository's separate `codex/trace-pricing-website` branch, deployed runtime source `e59470e99b6e73e82bfa68dfe06b53effbcdc5db`, merged in PR #13. Local checkout: `/Users/theisaiahw/.codex/worktrees/trace-pricing-website/victoryroad`. This preserves the independently deployed Trace website source; do not replace it with the main branch's old landing directory.
- Trace Vercel project: `victoryroad` (`prj_xu8lQXM29IgPY7fLDvbkT4qah4Ta`), team `deeptitan-6729s-projects`. The `victoryroad-lovat.vercel.app` alias supplies the public `/trace` routes. The apex Victory Road site uses the separate `prize-map` project.
- Do not deploy the dirty root workspace or unrelated Prize Map source.

## Readiness and configuration

### Trace 0.1.101 upgrade experience published — October 28, 2026

- [Release v0.1.101](https://github.com/DeepTitan/pokemon-tcg-ai/releases/tag/v0.1.101) is public and latest, published at 19:12:31 UTC from exact source `83a3a9bff91ee6f3e1b96dfecb4c0dff83b617b8`. [Release workflow 40750349724](https://github.com/DeepTitan/pokemon-tcg-ai/actions/runs/40750349724) passed every job; the public tag resolves to that source.
- The top-right Upgrade button, locked archive rows, and exhausted sharing allowance open the approved board-preview modal with context-specific copy, lighter typography, and $4.99/month or $49.99/year choices. It uses the actual current/final board when available and a clearly labeled example otherwise. The preview never fetches a gated replay. Existing Free and admin entitlements are unchanged.
- The chosen billing interval continues through the existing protected website checkout flow. Website deployment `dpl_CipShuiFuj4cRTw3ZeKkhrdeF6N9` was staged, verified, and promoted. The public script at `victoryroad.app/trace-script.js` matches the tested runtime source. All 150 website tests passed, including interval handoff, duplicate-click prevention, failure/retry, existing-member routing, and destination validation.
- Browser verification confirmed both live Stripe checkout amounts, the actual production modal, annual disclosure, Escape/focus recovery, and existing-admin routing to account management. No payment was submitted, subscription created, or admin access changed. These checks do not claim a newly completed live paid-entitlement journey.
- Tracker regression suites passed on both platforms, along with 77 Windows native tests. Windows installer and packaged executable passed signing/publisher-chain checks. macOS passed signing, notarization, stapling, Gatekeeper, clean-install launch, and relocated helper verification. The production capture/membership endpoint pair passed with enforcement enabled.
- The public updater returns 0.1.101 for all four platform keys. All installer/update downloads and signature files returned HTTP 200 and matched GitHub asset SHA-256 digests; signatures match the manifest and both payloads passed cryptographic verification in CI. The final notes-only metadata update was verified through the public latest endpoint with every URL and signature preserved. The superseded v0.1.99 draft remains unpublished.
- Evidence: `artifacts/upgrade-release/release-workflow.log`, `public-release-verification.json`, `ui-and-checkout-verification.json`, `endpoint-pair.json`, and modal/checkout screenshots. Repository-wide TypeScript checking still reports pre-existing errors outside the changed modules; the tracker build and required release suites passed.

### Trace 0.1.100 published — October 27, 2026

- [Release v0.1.100](https://github.com/DeepTitan/pokemon-tcg-ai/releases/tag/v0.1.100) is public and latest, published at 23:47:36 UTC from exact source `0fb9556bac7827163fea80ef5b03b277f6be380e`. [Release workflow 40602052771](https://github.com/DeepTitan/pokemon-tcg-ai/actions/runs/40602052771) passed every job.
- Tracker regression suites passed on both platforms; all 76 Windows native tests passed. Windows installer and extracted packaged app passed Authenticode and publisher-chain verification. macOS passed signing, notarization, stapling, Gatekeeper, clean-install launch, and relocated capture-helper checks.
- The public latest updater returns 0.1.100 for all four platform keys. All three installer/update downloads returned HTTP 200; public signature files match the manifest. Both updater payloads passed cryptographic verification in CI. The updater's notes were changed to user-facing release text after publication, preserving every other manifest field, URL, and signature, then verified through the public latest endpoint.
- Fresh read-only production checks confirmed active live Stripe prices of $4.99/month and $49.99/year, matching the deployed backend and desktop source. Capture/membership endpoint pairing passed with enforcement enabled.
- The superseded v0.1.99 draft remains unpublished. No Microsoft support request was sent. Evidence is in `artifacts/pricing-release/trace-full-release-20261027.log`, `public-release-verification-20261027.json`, `live-trace-prices-20261027.json`, and `desktop-endpoint-pair-20261027.json`.

### Signing recovered — October 27, 2026

- Fresh smoke run `40601727120` from `309da81205453bbc186a239808c9d27cf99d1350` passed Azure signing, Authenticode verification, and Windows certificate-chain trust using Microsoft Artifact Signing client `1.0.146`. The full release workflow now pins that same verified client version.
- The production capture/membership endpoint pairing check passed again with enforcement enabled. Both desktop pricing surfaces still show $4.99/month and $49.99/year.
- Full desktop publication remains subject to the release workflow's platform build, signing, notarization, package, and updater checks. Use a fresh v0.1.100 candidate; the old v0.1.99 draft belongs to superseded $5/$50 source and must remain unpublished. No support request was sent.
- Evidence: `artifacts/pricing-release/azure-signing-recovered-20261027.log` and `desktop-endpoint-pair-20261027.json`.

### Additional signing diagnostics — October 26, 2026, 18:55 UTC

- At the user's request, the prepared support request was **not submitted**. PR #9 adds read-only Azure health diagnostics and tests Microsoft's newer Artifact Signing client `1.0.146` in the focused smoke workflow; production release signing and publication gates are unchanged.
- Run `40381943010` from `309da81205453bbc186a239808c9d27cf99d1350` confirmed subscription `Enabled`, provider `Registered`, signing-account provisioning `Succeeded`, correct East US endpoint, and PublicTrust profile `Active` / provisioning `Succeeded`. The active certificate was created October 26 at 06:29:50 and expires October 29 at 06:29:50; the timestamp endpoint returned HTTP 200. The portal independently showed the subscription Active.
- Client `1.0.146` still received an accepted signing request followed by `Failed` with null signatures/certificate: operation `bfc5c82d-5b8b-42f8-a283-97bfc444e4dc`, October 26 at 18:55:45 UTC. This rules out the older client as the sole cause.
- A [Microsoft employee's September 18 response to the same post-reactivation symptom](https://learn.microsoft.com/en-gb/answers/questions/6007861/struggling-with-failed-signing-please-help) says signing recovery takes **1–2 days** after a paused subscription is re-enabled. This is consistent with our observations, not confirmation of this account's internal cause. No subscription, resource, certificate, role assignment, or payment settings were changed.
- Preserve the held desktop release and retry after the reactivation window; do not publish the superseded v0.1.99 draft or bypass signature validation. Prices remain verified at $4.99/month and $49.99/year. Evidence: `artifacts/pricing-release/azure-signing-diagnostics-20261026.json` and `azure-signing-new-client-20261026.log`.

### Desktop signing recheck — October 26, 2026, 18:48 UTC

- Fresh Windows signing smoke run `40379556675` from current `main` source `b6fc375243e097fda5b43251b95fcac7df427a6b` failed on both attempts. GitHub OIDC authentication and signing submission passed, but Azure completed each operation with `status: Failed` and null signature/certificate fields. Operation IDs: `84378cb2-dd87-43a6-b7c7-5bebc3b9549c` at 18:39:54 UTC and `e6bcccfb-15a3-4519-ada8-e428e4ea996b` at 18:47:45 UTC.
- Azure portal showed `trace-public-trust` Active, including a current Active certificate created October 26 and expiring October 29. These observations do not establish why the signing service failed. No signing resources or permissions were changed.
- Read-only production checks confirmed both active live Trace Stripe prices are exactly $4.99/month and $49.99/year on the existing Trace Pro product. The desktop upgrade modal and account settings, public Trace pricing HTML/script, and configured backend IDs match. Production capture/membership endpoint pairing passed with enforcement enabled.
- The public updater still advertises v0.1.98. No new desktop version was published. Do not publish draft v0.1.99: it contains the superseded $5/$50 source and is bound to a different source SHA. When signing recovers, choose a fresh patch release version for the verified current source, preserving the existing signed-release gates.
- Evidence: `artifacts/pricing-release/desktop-release-recheck-20261026.json`, `desktop-live-prices-20261026.json`, `desktop-endpoint-pair-20261026.json`, and the two signing logs. A concrete Microsoft support request is prepared locally as `azure-signing-support-request.txt`; submission requires the user's authorization to contact Microsoft.

### Final price adjustment — October 26, 2026

- Current Trace Pro prices are **$4.99/month** (`price_1UUs2p3qgXndaKhC0EvP86xr`, product default) and **$49.99/year** (`price_1UUs2p3qgXndaKhCE4lnH6xN`). The yearly offer saves $9.89 compared with twelve monthly payments.
- The $5/$50 prices are preserved in `PreviousTracePriceId` / `PreviousTraceAnnualPriceId`, alongside the original $14.99 price in `LegacyTracePriceId`. Existing subscriptions retain their charges and access; new checkout and dedicated portal offers use $4.99/$49.99. Supporters Club remains $39.99/month.
- Membership stack reached `UPDATE_COMPLETE`; deployed Lambda source and exact price configuration were verified. All 159 backend tests, 143 website tests, CI access checks and the tracker production build passed.
- Website source `f55756a5ab0d99d79972a884bd8dd7d4b1ad1f9a` was staged and promoted as `dpl_4o6evXGFzJkBPMxqN3mZuhFRYpda`, https://victoryroad-h6ivm6pt6-deeptitan-6729s-projects.vercel.app. Public monthly/yearly copy and savings were verified. Both real checkout sessions had the exact amount, price, interval and quantity; retries reused sessions, and test sessions were expired without payment or a subscription.
- The corresponding Film Archive offers were changed separately on product `prod_VCL6fmh9K853Nk`: monthly `price_1UUs583qgXndaKhCQJlOhoGX`, yearly `price_1UUs583qgXndaKhC93y10pGF`. Both live checkouts and the public shared upgrade dialog passed verification.
- **Desktop remains unpublished.** Signing smoke run `40279110334`, attempt 3, now authenticates and submits to Azure successfully, but Azure returns signing operation `Failed` with no signature (operation `3269e1e7-bf53-45f1-9b4a-826433b36647`). No unsigned release was published. Draft v0.1.99 contains the superseded $5/$50 copy; after signing recovers, build a new patch version from `64627d90a874474b87dd17a09aa8980e49afbc33` or a verified descendant instead of publishing that old draft.
- Receipts and screenshot: `artifacts/pricing-release/fractional-*`, `provider-checkout-verification.json` and `film-fractional-verification.json`. Temporary browser fixtures were cleared; no user's free unlocks were consumed.

### Pricing release — October 26, 2026

- Both AWS stacks reached `UPDATE_COMPLETE`. Deployed Lambda source matches the tested membership and capture source exactly; the new Free policy is 30 days with private deck/prize study included.
- New active live prices on existing Trace Pro product `prod_VLc91SAAadBLMi`: `price_1UUgmc3qgXndaKhCnePvpFhA` (USD $5/month, default) and `price_1UUgnE3qgXndaKhC6SpQ6QlS` (USD $50/year). The former $14.99 monthly ID remains configured as `LegacyTracePriceId`; this release does not migrate existing subscription charges.
- Dedicated portal `bpc_1UKvSh3qgXndaKhCohNHB9Li` now offers both new Pro prices and unchanged Supporters pricing. Price-only updates, quantity one, existing proration/cancellation behavior, and the unrelated film portal are preserved.
- Website deployment `dpl_GVTZgrtGoGuZcA1WKWDh3rWXE3Dy` was staged, verified and promoted. All seven public HTTP checks passed. Both live checkout cadences returned the exact expected Stripe price, amount and quantity, and same-cadence retries reused their sessions. Validation sessions were expired; no payment was submitted and no subscription was created.
- Desktop v0.1.99 remains a held draft from workflow run `40276564757`. macOS signing, notarization, Gatekeeper and clean-path launch checks passed. Windows capture tests and compilation passed, but the signing provider returned HTTP 403; focused signing run `40279110334` reproduced the provider failure with fresh authentication. Resume only after signing availability is restored, then verify Windows publisher signatures and the public updater manifest before claiming desktop publication.
- Nonsecret release receipts are in `artifacts/pricing-release/`. The runtime log scan found two Node `url.parse()` deprecation warnings, without application failures.

### Staging and email checkpoint — September 29, 2026

- The protected website preview uses source `03834b2`, deployment
  `dpl_DtTEKuUfGUSGFNKVMh87KrxZoYuN`, at
  `https://trace-memberships-staging-deeptitan-6729s-projects.vercel.app`.
  Production aliases and public billing were unchanged at that checkpoint;
  the production progress below supersedes that status.
- Both initial sandbox purchases, explicit claims, portal access, paid Pro →
  Supporters upgrade, failed-upgrade preservation, cancellation and signed
  webhook delivery/retry passed. All successful and failed synthetic purchase
  fixtures were cleaned up with scoped ownership checks; Stripe audit objects
  and the real owner account were preserved. The backend passed 116 tests.
  See the [dated browser and helper evidence](../../trace-memberships-web-20260927/docs/TRACE_MEMBERSHIPS_DRY_RUN_20260928.md#protected-staging-browser-check--september-29-2026).
- The synthetic staging installation/API and explicit browser approval passed
  Free → Supporters → unlink to Free. This did **not** test the packaged native
  app's canonical `/trace/link` handoff, release endpoint pairing or isolated-data
  behavior. A subsequent native readiness check passed 26 Rust tests and three
  frontend suites. No packaged app was launched; production endpoint pairing
  and testing an isolated packaged app remained open at that checkpoint.
  Production endpoint pairing subsequently passed as recorded below.
- The real owner account is confirmed in staging, after the original Cognito
  email arrived in Spam. It has no production subject binding or owner override.
- Domain DKIM and the exact SES test recipient are verified. Staging Cognito
  uses `DEVELOPER` email with `From: Trace <no-reply@victoryroad.app>` and subject
  `Your Trace code`. A fresh normal-UI recovery email displayed September 29 at
  1:19 AM appeared unread in Inbox before opening, rendered the deployed sender
  and neutral body, and passed Gmail SPF, DKIM and DMARC. The earlier recovery
  email also passed authentication, but the owner reported its initial Spam
  placement and marked it Not spam. The fresh mailbox result does not guarantee
  inbox placement for others or prove why earlier messages went to Spam.
  Password-recovery completion remains pending; no password was changed.
  See [sender evidence](TRACE_MEMBERSHIPS_EMAIL_SETUP.md).
- The five-resource email operations stack reached `CREATE_COMPLETE`. SNS
  subscription is now confirmed. The guarded feedback helper attached both
  Bounce/Complaint topics and passed read-back. One simulator bounce and one
  complaint reached the owner-addressed Gmail notifications, matched by SES
  message ID and exact simulator destination. Feedback routing is verified;
  these tests did not fire the CloudWatch reputation-rate alarms.
  SES production access was requested once at 06:17:57 UTC and initially read
  back `PENDING`. Around 06:20 UTC, AWS confirmed `ProductionAccessEnabled:true`
  and review `GRANTED`, case `179066268400340`. SES public sending is approved
  for this account and region. See [operations status](TRACE_EMAIL_OPERATIONS.md).

### Current production checkpoint — September 29, 2026

The public membership website, live billing backend and signed desktop update
are deployed, with replay and sharing limits enabled. Production owner
signup/binding and the final account-link and recovery checks remain pending.

- Isolated `trace-memberships-production` reached `UPDATE_COMPLETE` with
  `BillingEnabled=true`, `StripeMode=live` and the canonical web origin
  `https://victoryroad.app`. Its endpoint is
  `https://kg0vg9dnk0.execute-api.us-east-1.amazonaws.com`; Cognito pool
  `us-east-1_FhL6gNP11`, client `6hq47mf56i6grejr3bs3gnraci`, Accounts table
  `trace-memberships-production-Accounts-1MC7VRDW6OLXV` and owner switch table
  `trace-memberships-production-OwnerSwitches-10KAUO5WKZ1VM` are preserved.
  Branded SES sending, the eight-character password policy with no composition
  requirements and signed-out account 401 were verified. The read-only billing
  readiness audit passed all 25 recorded checks. Owner override remains off.
- Dedicated live Trace prices are `price_1UKuvY3qgXndaKhC01dmcmd0` (Pro,
  USD $14.99/month) and `price_1UKv0K3qgXndaKhCwDLKwIFe` (Supporters Club,
  USD $39.99/month). Portal `bpc_1UKvSh3qgXndaKhCohNHB9Li` contains only those
  two Trace plans, with quantity one, price-only updates, `always_invoice`
  proration and cancellation at period end. The existing film portal remains
  the default. Dedicated webhook `we_1UKvWE3qgXndaKhCD2Aom9hw` targets the new
  production `/v1/webhook`, with API version `2024-06-20` and the backend's
  exact 11 event types.
- The dedicated restricted live runtime key has only Customers Write,
  Customer Portal Write, Checkout Sessions Write, Prices Read, Subscriptions
  Read and Invoices Read. Temporary Webhook Endpoints Write was removed after
  setup. The initial key was rotated immediately and its rejection was
  confirmed with HTTP 401. The replacement key and webhook signing secret are
  stored with the existing web proxy secret in the dedicated production AWS
  secret. No credential value belongs in source or release evidence. Existing
  film products and credentials are unchanged.
- Clean website source `110789d00e59b0b126db2891ddc1f105d1003a35`, deployment
  `dpl_FU7u55HPXzfw5hJNhxuPgLdSTfcw`, is public through stable upstream
  `victoryroad-lovat.vercel.app` and canonical `https://victoryroad.app/trace`.
  The unrelated dirty dashboard edit was excluded from the clean source build.
  Apex route version `578c870d-ca80-414b-bb6e-40d37084ec3e` is live with exactly
  11 rules and no staged version. All nine original film/public routes retain
  their definitions and relative order. The membership API and account script
  are the only added routes.
- The initial API project rule used `:action*` in its destination, which
  produced proxy JSON 404 responses. Changing only that destination capture to
  `$1` restored dispatch; no runtime code or `vercel.json` change was needed.
  Canonical HTTP smoke passed 7/7: pricing, signup, desktop link, account
  script, account 401/no-store, signed-out download redirect and leaderboard.
  Three harmless login POST checks also passed: an empty body with canonical
  Origin returns 400; wrong or missing Origin returns 403. The same input and
  Origin checks passed on the protected routing alias before promotion.
- A separate production session smoke passed using one temporary synthetic
  account with email delivery suppressed. It verified canonical login,
  Secure/HttpOnly/host-only cookies, exact Free capabilities, CSRF rejection,
  refresh, logout and rejection of revoked credentials. The synthetic user and
  account row were removed; token-derived rate counters were left for their
  normal short TTL (logical expiry no later than 08:15:51 UTC) rather than
  scanning production for them. This did not exercise the owner's signup or
  email delivery and did not touch Stripe, devices or captures.
- Normal browser flows reached live Stripe Checkout showing Pro at
  $14.99/month and Supporters Club at $39.99/month. Canceling returned to the
  canonical Trace account page. No payment details or payment were submitted.
  Scoped cleanup passed: both sessions are expired and unpaid, have no payment
  associations, and their single guest customer has no subscriptions or invoices.
  Only the second session required expiration; switching plans had expired the
  first. These checks establish checkout presentation and cancel
  routing, not a live purchase, paid entitlement, claim or portal journey.
- The owner's staging account is confirmed, but production signup, email
  verification, immutable subject binding and the database owner switch are
  still pending. Staging confirmation does not establish a production identity.
- Production capture is `UPDATE_COMPLETE`, paired with the new membership API,
  with `RequireMembership=true` after the signed desktop release became public.
  All 65 offline capture tests passed.
  The earlier deployment preserved storage identities, stack tags and the exact
  `KEYS_ONLY` leaderboard stream ARN. A later enforcement change set,
  `trace-membership-enforcement-7eb64863feea885f43face3a`, was executed after
  rechecking the exact reviewed artifact and deployed baseline. Post-update
  verification passed: only the membership flag changed, with unchanged code,
  other environment values, IAM role, tags, storage and leaderboard stream.
  CloudFormation reused the exact previous processed SAM tree as its Original
  template; the processed tree is unchanged. Free capture, summaries and
  leaderboard contributions remain available for linked and unlinked devices.
- The read-only [endpoint preflight](TRACE_NATIVE_RELEASE_PREFLIGHT.md) passed
  against actual production CloudFormation ownership in both directions; its
  17 offline guard tests passed. GitHub's membership endpoint points at the new
  production API, and the capture endpoint retains its existing identity.
  The native build from merged `main` commit `8be41e2d` passed GitHub run
  `36540773920` and is published as `v0.1.89`. All six public assets download
  anonymously and match their GitHub hashes. Both updater signatures verify;
  the public manifest matches the release and all four platform entries point
  to the expected assets. Mac signing, notarization, stapling and hosted startup
  checks passed. Windows passed all 50 Rust tests and verified the publisher
  signatures on both installer and extracted app. Both app binaries contain
  the exact production API pair and no staging endpoints. A prior build exposed
  a Windows-only test socket race, fixed by setting the accepted fixture socket to blocking mode;
  all seven focused membership tests passed. The post-enforcement endpoint
  preflight also passed with `RequireMembership=true`. This does not establish
  that a packaged app has completed the canonical account-link flow. No local
  app or game was launched, and no game was recorded for these checks.

Evidence is saved under ignored `artifacts/membership/`, including
`production-stripe-catalog-20260929.json`,
`production-billing-readiness-20260929.json`,
`production-pro-checkout-20260929.png`,
`production-supporters-checkout-20260929.png`,
`production-capture-enforcement-reviewed-20260929.json`,
`production-capture-enforcement-executed-20260929.json`,
`production-capture-enforcement-verified-20260929.json`,
`native-release-v0.1.89-verification.json` and
`production-endpoint-pair-20260929.json`. Some earlier catalog booleans describe
pre-promotion state; the checkpoint above reflects the later browser and routing
results. Website promotion and correction evidence is in the sibling checkout's
`artifacts/membership/production-promotion-20260929/` and
`artifacts/membership/production-route-correction-20260929/`; the reviewed route
plan and guard correction are committed there as `8ad12ba`.
The final canonical read-only check passed 7/7 at 08:29:50 UTC, including
pricing, signup, linking, account script, leaderboard, signed-out account 401
with no-store and the signed-out download redirect. Its sanitized evidence is
in the website checkout's `artifacts/membership/production-final-http-20260929/`.

Remaining work is production owner signup and binding,
password recovery completion and a packaged native account-link check.
The production owner account was still absent at the final September 29 check;
its signup remains handed off to the user, and no owner override is enabled.
Sandbox purchases and unpaid live checkout screens do not establish a complete
live paid-entitlement journey or a finished freemium rollout.

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
7. With saved/synthetic captures, verify recent free reads, locked old replays including the pre-upgrade archive, one free share then rejection, repeat-share reuse, concurrent share requests, premium sharing, membership outages and pre/post-match deck restrictions. Existing sanitized public links must remain readable. **Do not launch Pokémon TCG Live or enter a match.**

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
