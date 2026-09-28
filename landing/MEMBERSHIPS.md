# Trace membership website

Implementation prepared locally; no payments, accounts, emails, or production deployments were created during development.

## Production configuration

- `TRACE_MEMBERSHIP_API_URL`: HTTPS base URL for the separate Trace membership service, without `/v1`.
- `TRACE_WEB_ORIGIN`: exact canonical browser origin; defaults to `https://victoryroad.app`. No trailing slash or path. Preview deployment origins must be configured explicitly; request headers cannot extend this allowlist.
- Stripe and Cognito credentials stay in the membership service. None belong in this website, frontend JavaScript, or browser storage.

The membership proxy fails closed without a valid service URL. Public pricing, leaderboard, and shared replays remain accessible. Member pages require email-verified sign-in. Access and refresh tokens are stored only in Secure, HttpOnly, host-only cookies; state-changing requests require an exact allowed Origin and JSON content type. Provider JSON and errors are allowlisted before reaching the browser.

`/trace/access` now checks current member entitlements before redirecting to fixed installers. Legacy password/Discord grants do not grant access. The installers themselves are still existing public GitHub release assets: download gating is not the desktop entitlement boundary. Desktop and capture services must enforce app and opponent-decklist access independently.

Owner access is displayed only when the member service returns `plan: supporter`, `status: admin`, and `admin: true`. This site has no owner-role assignment or override switch. The backend's configured owner subject and database switch remain authoritative. Owner access never bypasses match completion.

## Routes

- `/trace`: public pricing ($14.99 USD/month Trace; $39.99 USD/month Supporters Club).
- `/trace/signup`, `/trace/confirm`, `/trace/login`, `/trace/recover`, `/trace/reset`: account lifecycle including resend confirmation code.
- `/trace/account`: membership status, subscription management and authenticated downloads.
- `/trace/connect?userCode=XXXXX-XXXXX`: link a desktop app only after explicit code confirmation and consent.
- `/trace/api/:action`: HTTP-cookie proxy; only approved account/auth/checkout/portal/link-approve actions are exposed. No webhooks, device credentials, arbitrary upstream relay, or admin mutations.

Checkout returns to `/trace/account?checkout=success` or `?checkout=cancel`. A success URL alone grants nothing; the account is rechecked. Existing subscriptions receive `subscription_exists` and a Manage billing action. Stripe URL responses are restricted to the specific Checkout and customer-portal hosts and paths.

## Offline preview

Run `node scripts/preview-trace-memberships.mjs`, then open `http://127.0.0.1:5190/trace`.

The fixture listens only on loopback. It never calls Cognito, Stripe, email, capture services, or native apps; it does not download installers. The page is visibly labeled as a local preview. Any synthetic email/password can demonstrate the signup/login UI.

Fixture account states:

- `/__fixture?role=admin`: owner access without checkout.
- `/__fixture?role=supporter`: active Supporters Club.
- `/__fixture?role=trace`: active Trace only.
- `/__fixture?role=none`: signed in, needs a plan.
- `/__fixture?role=anonymous`: signed out.
- `/__fixture?role=unconfigured`: unavailable membership service.

These fixture routes exist only in the separate preview server, which is excluded from the deployment.

## Validation

- `node --test landing/lib/membership.test.mjs landing/lib/download-access.test.mjs`: 22 tests covering CSRF, token redaction/refresh/revocation, legacy grant removal, exact origin and redirect allowlists, entitlement expiry, owner schema, duplicate subscriptions, code approval and failures.
- `npm --prefix landing test`: 80 tests pass, including existing public leaderboard, replay and social-image tests.
- Production tracker/leaderboard bundles and landing build pass. Existing asset/chunk-size warnings remain.
- Browser fixture verified signup → confirm → login → plan selection, disabled payment flow, owner access, required device consent and connected state. Desktop and 390px mobile layouts checked; no horizontal overflow. Screenshots in `artifacts/membership/` (ignored local artifacts).

Before release: deploy/configure the member service and its prices/webhooks, establish the real owner's verified account and DB switch, resolve existing-user migration, verify real test-mode billing and email end-to-end, and coordinate the desktop/cloud entitlement release. No production deployment is implied by these local checks.
