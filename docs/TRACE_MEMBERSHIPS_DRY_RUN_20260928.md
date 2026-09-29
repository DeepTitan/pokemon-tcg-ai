# Trace launch dry run — September 28, 2026

**Status: local release checks passed; provider end-to-end verification and production release are pending.**

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
The browser fixture remains available for the later Pro purchase check. Its
helper is waiting for `browser-complete`; no checkout has been started for this
fixture, and it must not be treated as a completed paid journey.

Separately, the first Pro API-adapter attempt reached customer creation but
Checkout returned HTTP 503. No successful payment or entitlement claim is
established. That failed fixture is retained for diagnosis and cleanup.

**Still unverified:** delivered signup/confirmation and recovery emails, a paid
Checkout return and claim in the browser, portal changes, and signed webhook
delivery. Admin-confirming the fixture does not verify email delivery. The
deployment observations and provider checklist below record the earlier
September 28 baseline; they are not a fresh production-state audit.

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

## Protected deployment

- Source commit: `874a8c6` in the website checkout.
- Preview: https://victoryroad-6wqa66sww-deeptitan-6729s-projects.vercel.app/trace
- Deployment: `dpl_FypKfULrZ5YDpbxrDMAP9CtnFVRh`.
- Verified through authenticated Vercel CLI requests; production aliases and apex routing remain unchanged.
- The account API correctly returns HTTP 503 with a non-cacheable unavailable response because membership provider configuration is not installed. This is an incomplete provider setup, not a successful end-to-end launch.

## Current production observations

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

## Required provider checks before launch

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
