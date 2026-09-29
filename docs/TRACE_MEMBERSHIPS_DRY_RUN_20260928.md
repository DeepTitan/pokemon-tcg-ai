# Trace launch dry run — September 28, 2026

**Status: both initial sandbox purchases, Pro cancellation, failed-upgrade protection, app linking and real email confirmation passed. Remaining provider checks and production release are pending.**

This release spans the public Trace website, a new membership API, capture service enforcement, and a desktop update newer than v0.1.88. Publishing the pricing HTML alone would send people into missing account routes and sell features the current desktop release cannot unlock.

## Protected staging browser check — September 29, 2026

The root operator verified the normal website flow in Chrome against
`https://trace-memberships-staging-deeptitan-6729s-projects.vercel.app`:

- The protected preview opened using the operator's existing Vercel session,
  without redirecting to SSO. Protection was not disabled.
- The `--browser-fixture` helper created one disposable, admin-confirmed Cognito
  account with its invitation suppressed. Credentials stayed in the private
  handoff; no real signup or confirmation email was sent.
- Entering those credentials in Trace's normal login form reached **My account**.
  It showed **Free · Active**, no subscription, and the expected download, app-link
  and upgrade actions. This check did not download or link an actual device.
- The normal **Sign out** action returned to the **Welcome back** login screen.

Evidence: [Free account browser screenshot](../artifacts/free-account-browser-20260929.png).

The same browser fixture then completed the real sandbox Pro flow:

- Signed-out pricing → **Get Pro** opened Stripe-hosted Checkout for **$14.99/month**.
  The public Stripe test card completed payment and the return page showed
  **Your Pro payment is confirmed**.
- Normal Trace sign-in followed by explicit **Activate membership** reached
  **My account**, showing **Pro · Active**, $14.99 USD per month and renewal on
  October 28, 2026. The success URL alone did not activate the account.
- The guarded helper independently confirmed the exact Pro capabilities:
  full archive and expanded sharing, with no owner override or opponent deck study.
- Actual signed `invoice.paid`, `customer.subscription.created` and
  `customer.subscription.updated` deliveries returned HTTP 200. The completed
  Checkout event initially received `409 billing_busy` during concurrent
  reconciliation; Stripe's automatic retry returned `200 received:true` at
  04:25:45 UTC. Manually resending that same event returned `200 received:true`
  at 04:33:43 UTC. This is real delivery/retry evidence, beyond account-state polling.
- **Manage billing** exposed a URL-compatibility defect: Stripe created the
  portal successfully, but the website rejected the newer query-based URL.
  After the scoped validator fix, the normal button opened Stripe's hosted
  sandbox portal with the exact Pro subscription, $14.99 price and configured
  management controls.
- The portal accepted end-of-period cancellation and displayed service ending
  October 29. The helper's `verify-cancellation` check passed: Pro stayed active
  and `cancelAtPeriodEnd` was true. This proves the cancellation flag and retained
  paid access, not that the period ended or access expired.
- A failed Supporters upgrade exposed a paid-access regression. After deploying
  backend `d9c4a94`, a fresh helper check confirmed the existing Pro subscription
  remained active with full history and expanded sharing, no opponent deck-study
  access, and its original expiry. The operator voided only the unpaid sandbox
  upgrade invoice. Stripe then showed `pending_update:null`, active Pro and the
  same Pro price; the helper again confirmed the exact Pro capabilities. No
  unpaid Supporters access was granted. A successful paid upgrade is still a
  separate pending check.

Evidence: [Pro account browser screenshot](../artifacts/pro-account-browser-20260929.png)
and [period-end cancellation screenshot](../artifacts/pro-cancel-period-end-20260929.png),
plus the root operator's [sanitized browser checkpoint](../artifacts/browser-membership-evidence-20260929.md).
No provider URL containing a secret or account credential is retained here.

An independent synthetic account then completed the Supporters browser flow:

- **Join Supporters** opened hosted Checkout for **$39.99/month**.
- Canceling before payment returned to **Finish checkout**. Resuming reopened
  the exact same Stripe Checkout session, rather than creating another one.
- Completing the test payment, returning, signing in and explicitly choosing
  **Activate membership** reached **Supporters · Active**.
- The helper independently confirmed the exact Supporters plan and capabilities,
  including post-match deck study, with `admin:false`. This account-level check
  does not replace the capture/tracker tests that enforce the match-end boundary.

Evidence: [Supporters account browser screenshot](../artifacts/supporter-account-browser-20260929.png).
The restricted fixture inventory is retained separately for scoped cleanup.

The synthetic staging installation/API smoke also passed: the unlinked device
started Free, explicit browser approval linked it to the expected Supporters
account, and unlinking restored Free capabilities. Fixture cleanup completed
with `cleanupRequired:false`. The helper constructed the staging
`/trace/connect` URL; the packaged native app instead opens the canonical
`https://victoryroad.app/trace/link` URL. This verifies the staging API and browser
approval path, not a packaged native workflow. Native release endpoint pairing
and isolated-data checks remain pending. No native app or game was launched.

Evidence: [Supporters app-link confirmation](../artifacts/supporter-app-linked-browser-20260929.png).

The owner's real Gmail confirmation email arrived in **Spam**. The user supplied
the code, and Trace's normal confirmation form displayed **Email confirmed.
Sign in to continue.** This proves staging delivery and confirmation for that
address. It does not establish reliable inbox placement, password recovery,
real-owner login, or a production owner grant. No email address or code is
retained in this report, and no DNS changes have been made; exact GoDaddy
approval remains pending.

Evidence: [Staging email confirmation](../artifacts/owner-email-confirmed-staging-20260929.png).

Separately, the first Pro API-adapter attempt reached customer creation but
Checkout returned HTTP 503. That earlier failed fixture remains separate from
the successful browser purchase and is retained for diagnosis and cleanup.

**Still unverified:** password-recovery delivery and completion, reliable inbox
placement, real-owner login and privileged binding, actual subscription expiry,
successful paid portal upgrades, and production rollout. The synthetic purchase
fixtures do not establish email delivery; the separate real-address check above
does. The production
observations and original provider checklist below retain their September 28
baseline date; they are not a fresh production-state audit.

## Verified locally

- Free recording is independent of account/payment/network admission.
- Recent replays are available for seven days. Compact results and leaderboard history remain available afterward.
- Existing local SQLite, JSONL and browser archives survive the migration without losing access or being deleted.
- Free sharing has one new share per installation per rolling seven days. Concurrent requests cannot spend the same allowance twice; retries reuse an existing link.
- Pro adds full retained replay history and expanded sharing. Supporters adds post-match deck study; owner access does not bypass match completion.
- Public replay links remain available at any age, without viewer payment. The shared viewer does not expose full opponent inventories from cached payloads.
- Browser fixture: Start free opens signup; a Free account sees downloads; explicit device-code consent reaches the connected state; a synthetic paid return requires explicit activation before showing Supporters access.
- Three-plan pricing was checked on desktop and at 390px width. The fixture makes no external payment, email, capture, download or game-launch calls.
- The exact native `/trace/link?code=...` handoff now reaches the account approval form with its code retained.
- Discord is an optional community link. It is not required for signup, payment, downloads or device linking. The earlier activation implementation was removed following the owner's clarification.
- Updated website suite: **113 passing tests**, exact Vercel build passed. Updated membership suite: **70 passing tests**. The unchanged capture suite passed **65 tests**. Native/tracker suites and targeted expiry, migration and stale-credential regressions passed. Existing build warnings concern asset/chunk sizes.
- The first protected deployment exposed a real Vercel routing issue: `cleanUrls` rewrites targeting `.html` returned 404 despite a successful build. Static rewrite destinations now use `/` and `/trace-account`; account security headers also cover the direct static path. The corrected protected deployment confirms pricing, signup, native linking, and account JavaScript return HTTP 200. Signup and linking return private/no-store, noindex, no-referrer and the strict account CSP.
- After Discord removal, the synthetic Free account browser check reaches downloads directly and completes code-confirmed app linking. No provider or real device is involved.

The unit suites exercise mocked providers. Their passing results are not proof of a working Stripe, Cognito, or production email connection.

## Protected deployment — September 29, 2026

- Source commit: `03834b201ded958622475588731a0c5f19c69349` in the website checkout.
- Stable preview: https://trace-memberships-staging-deeptitan-6729s-projects.vercel.app/trace
- Deployment: `dpl_DtTEKuUfGUSGFNKVMh87KrxZoYuN`.
- Built from a clean Git archive; the unrelated working-tree dashboard change
  was excluded. The exact Vercel build passed. Focused validation passed
  57 web tests for the password/recovery update; the unchanged purchase helper
  previously passed its 13 tests.
- Post-alias checks confirmed an unauthenticated request redirects to Vercel
  sign-in, the signed-out account API returns 401/private no-store, and signup
  returns 200/private no-store. Sandbox membership configuration is installed.
  Production aliases, environment values and apex routing remain unchanged.
- Signup and password reset accept 8–128 characters without composition rules.
  The deployed Cognito policy has minimum length 8 and all composition flags
  false. An unfinished signup now offers code entry, resend and sign-in recovery
  instead of a generic error. The user received the real confirmation email in
  Spam and confirmed it through the normal UI; inbox placement is not fixed.

## Production baseline — September 28, 2026

Read-only check: `node scripts/verify-trace-memberships-http.mjs https://victoryroad.app`.

| Check | Current result |
| --- | --- |
| Free pricing published | Not yet; existing page returns 200 |
| Signup account page | 400; caught by the old replay route |
| Account JavaScript | 404 |
| Account API | 404 |
| Signed-out download redirect to account login | Still the old access flow |
| Public leaderboard | 200; working |

Actual apex production is the `prize-map` Vercel project. Its existing project routing rules proxy Trace to `victoryroad-lovat.vercel.app`. Scoped additive rules can support the membership API and member script without rebuilding the unrelated film app. Preserve the existing rules/version for rollback.

## Original provider checklist — September 28, 2026

1. Restore AWS sign-in. Both existing AWS profiles currently return an expired-session error.
2. Inspect the deployed capture stack and preserve its device table, tokens, data, and leaderboard stream. Deploy the isolated member stack with billing disabled first.
3. Configure and verify email delivery, separate Trace Stripe prices/portal/webhook, and the web proxy secret through server-side configuration. Do not export film billing secrets into a local environment file.
4. Verify the owner's chosen email, pin its immutable Cognito subject, and enable only that subject's separate database switch.
5. Use real Stripe **test mode** for both plans: checkout, email confirmation, explicit activation, account linking, entitlement grant, duplicate/retry protection, upgrade/cancel/downgrade, and webhook replay. A success URL alone must never grant paid access.
6. Confirm Free signup reaches download and device linking without payment or Discord membership.
7. Use synthetic/saved match captures to check replay expiry, sharing allowance, Supporters pre/post-match access, and migration. Do not launch Pokémon TCG Live or queue a real match.
8. Publish the signed desktop update before opening paid checkout. Confirm the installer/updater advertises a version newer than v0.1.88 and contains the deployed membership API URL.
9. Configure the production website, publish the scoped apex routes, and rerun the HTTP smoke test plus the authenticated journey. Enable live billing only after test-mode verification.

## Limitations to retain

- The free sharing allowance is per installation, not an account-wide anti-abuse guarantee.
- Existing local files stay on the user's computer. Current-client UI/API gates do not provide tamper-proof DRM or change old binaries retroactively.
- Local archive grandfathering does not grant free new cloud shares of old games.
- No real payment, production account, native app, or game has been created/launched during this dry run.
