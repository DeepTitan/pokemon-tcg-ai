# Trace launch dry run — September 28, 2026

**Status: local release checks passed; provider end-to-end verification and production release are pending.**

This release spans the public Trace website, a new membership API, capture service enforcement, and a desktop update newer than v0.1.88. Publishing the pricing HTML alone would send people into missing account routes and sell features the current desktop release cannot unlock.

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
- Discord activation has a server-only callback, cookie-bound state, one-time backend nonce, account/guild binding, expiry checks and a legacy-account exemption. The pending-activation UI was verified locally; its fixture cannot launch a real OAuth exchange.
- Final website suite: **120 passing tests**; exact Vercel build passed. Backend suites: **82 membership + 65 capture tests passed**. Native/tracker suites and targeted expiry, migration and stale-credential regressions passed. Existing build warnings concern asset/chunk sizes.

The unit suites exercise mocked providers. Their passing results are not proof of a working Stripe, Cognito, Discord, or production email connection.

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

Actual apex production is the `prize-map` Vercel project. Its existing project routing rules proxy Trace to `victoryroad-lovat.vercel.app`. Scoped additive rules can support the membership API, member script, and Discord callback without rebuilding the unrelated film app. Preserve the existing rules/version for rollback.

## Required provider checks before launch

1. Restore AWS sign-in. Both existing AWS profiles currently return an expired-session error.
2. Inspect the deployed capture stack and preserve its device table, tokens, data, and leaderboard stream. Deploy the isolated member stack with billing disabled first.
3. Configure and verify email delivery, Discord OAuth/guild activation, separate Trace Stripe prices/portal/webhook, and the web proxy secret through server-side configuration. Do not export film billing secrets into a local environment file.
4. Verify the owner's chosen email, pin its immutable Cognito subject, and enable only that subject's separate database switch.
5. Use real Stripe **test mode** for both plans: checkout, email confirmation, explicit activation, account linking, entitlement grant, duplicate/retry protection, upgrade/cancel/downgrade, and webhook replay. A success URL alone must never grant paid access.
6. Check new-user Discord verification, denied/nonmember recovery, OAuth state mismatch/replay, and existing-user exemption. Never interrupt existing capture because of Discord activation.
7. Use synthetic/saved match captures to check replay expiry, sharing allowance, Supporters pre/post-match access, and migration. Do not launch Pokémon TCG Live or queue a real match.
8. Publish the signed desktop update before opening paid checkout. Confirm the installer/updater advertises a version newer than v0.1.88 and contains the deployed membership API URL.
9. Configure the production website, publish the scoped apex routes, and rerun the HTTP smoke test plus the authenticated journey. Enable live billing only after test-mode verification.

## Limitations to retain

- The free sharing allowance is per installation, not an account-wide anti-abuse guarantee.
- Existing local files stay on the user's computer. Current-client UI/API gates do not provide tamper-proof DRM or change old binaries retroactively.
- Local archive grandfathering does not grant free new cloud shares of old games.
- No real payment, production account, native app, or game has been created/launched during this dry run.
