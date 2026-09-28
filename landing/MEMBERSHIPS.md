# Trace membership website

Implementation prepared locally; no payments, accounts, emails, or production deployments were created during development.

## Production configuration

- `TRACE_MEMBERSHIP_API_URL`: HTTPS base URL for the separate Trace membership service, without `/v1`.
- `TRACE_WEB_ORIGIN`: exact canonical browser origin; defaults to `https://victoryroad.app`. No trailing slash or path. Preview deployment origins must be configured explicitly; request headers cannot extend this allowlist.
- `TRACE_MEMBERSHIP_PROXY_SECRET`: 43–512 character server-only secret matching `webProxySecret` in the membership backend. It authenticates guest-checkout/status/claim calls from this proxy. It is never included in frontend JavaScript or responses.
- Stripe and Cognito credentials stay in the membership service. None belong in this website, frontend JavaScript, or browser storage.

The membership proxy fails closed without a valid service URL. Public pricing, leaderboard, and shared replays remain accessible. Pricing buttons open Stripe Checkout directly. No Trace sign-in or signup is required before payment. After paying, the purchaser signs up or signs in with the email used at checkout and explicitly activates the membership. Protected account/download actions require email-verified sign-in. Access and refresh tokens are stored only in Secure, HttpOnly, host-only cookies; state-changing requests require an exact allowed Origin and JSON content type. Provider JSON and errors are allowlisted before reaching the browser.

`/trace/access` now checks current member entitlements before redirecting to fixed installers. Legacy password/Discord grants do not grant access. The installers themselves are still existing public GitHub release assets: download gating is not the desktop entitlement boundary. Desktop and capture services must enforce app and opponent-decklist access independently.

Owner access is displayed only when the member service returns `plan: supporter`, `status: admin`, and `admin: true`. This site has no owner-role assignment or override switch. The backend's configured owner subject and database switch remain authoritative. Owner access never bypasses match completion.

## Routes

- `/trace`: public pricing ($14.99 USD/month Trace; $39.99 USD/month Supporters Club).
- `/trace/signup`, `/trace/confirm`, `/trace/login`, `/trace/recover`, `/trace/reset`: account lifecycle including resend confirmation code.
- `/trace/account`: membership status, subscription management and authenticated downloads.
- `/trace/connect?userCode=XXXXX-XXXXX`: link a desktop app only after explicit code confirmation and consent.
- `/trace/api/:action`: HTTP-cookie proxy; only approved account/auth/checkout/portal/link-approve actions are exposed. No webhooks, device credentials, arbitrary upstream relay, or admin mutations.

Checkout returns to `/trace/account?checkout=success` or `?checkout=cancel`. Guest purchase status is checked separately from account status. A confirmed guest purchase is linked only after an explicit activation request with a verified account whose email matches Stripe, backed by the server-held purchase proof. A success URL alone grants nothing; the account is rechecked. Existing signed-in owners and subscribers go to their account instead of starting another purchase. Existing subscriptions otherwise receive `subscription_exists` and a Manage billing action. Stripe URL responses are restricted to the specific Checkout and customer-portal hosts and paths.

## Guest purchase proof and retries

- A web-only `POST /trace/api/checkout/prepare` creates a random 32-byte proof in a Secure, HttpOnly, host-only cookie for 30 days. This makes no Stripe or upstream payment call. Existing proof is never replaced.
- The homepage holds the same `trace-checkout` Web Lock across prepare and checkout. Account checkout and resume actions use that lock too, including across tabs. Browsers without Web Locks fail closed with an update-browser message. A failed prepare creates no payment session; a failed checkout response can retry using the cookie already stored by prepare.
- `POST /trace/api/checkout/guest` accepts only the selected plan from page JavaScript. The proxy supplies the existing cookie proof server-side; without it, no anonymous payment session is created. No purchase proof, email, customer ID or session ID is returned to JavaScript. The normal hosted Stripe URL is the only navigation response.
- `POST /trace/api/checkout/status` and `POST /trace/api/checkout/claim` also take the proof only from the cookie. The latter additionally requires a verified member session. Signing in, confirming email, resetting a password, or signing out does not erase the proof; it is cleared only after successful activation.
- Both anonymous and authenticated checkout paths inspect any existing purchase first. Paid or processing purchases go to setup, not another checkout. An open/expired unpaid guest checkout stays on the same backend guest path; a plan switch is handled by the backend lock, which expires the prior open Stripe session before replacing it.
- A completed but inactive subscription returns `processing` with `reason: purchase_not_active`. The page shows billing/support recovery and does not suggest paying again. Missing browser proof also offers sign-in/support recovery without pretending activation succeeded.
- Paid unclaimed records remain in the backend indefinitely for recovery; the browser cookie still expires after 30 days or can be cleared by the customer. Cookie loss and an unverified/mismatched email cannot be solved by trusting a caller-provided Stripe session ID. Support recovery is required when both normal sign-in and the original browser proof are unavailable.

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

Guest payment fixtures (all synthetic, no Stripe URLs are fabricated):

- `/__purchase?state=paid&role=anonymous`: confirmed payment, then signup/sign-in.
- `/__purchase?state=paid&role=none`: explicit activation into a signed-in account.
- `/__purchase?state=open&role=anonymous`: resume an unfinished checkout (payment call remains disabled).
- `/__purchase?state=inactive&role=none`: completed purchase whose subscription needs billing help.
- `/__purchase?state=processing&role=anonymous`: payment still confirming.

These fixture routes exist only in the separate preview server, which is excluded from the deployment.

## Validation

- `node --test landing/lib/membership.test.mjs landing/lib/download-access.test.mjs landing/lib/guest-checkout.test.mjs`: 38 tests covering CSRF, token redaction/refresh/revocation, legacy grant removal, exact origin and redirect allowlists, entitlement expiry, owner schema, duplicate subscriptions, code approval and failures.
- `npm --prefix landing test`: 96 tests pass, including existing public leaderboard, replay and social-image tests. Guest coverage includes stable cookie bootstrap, lost-response retry safety, CSRF, secret/token redaction, cross-tab checkout locking, authenticated/guest duplicate guards, plan switches, explicit activation, email mismatch, inactive purchases and owner no-charge behavior.
- Production tracker/leaderboard bundles and landing build pass. Existing asset/chunk-size warnings remain.
- Browser fixture verified signup → confirm → login → plan selection, disabled payment flow, owner access, required device consent and connected state. Desktop and 390px mobile layouts checked; no horizontal overflow. Screenshots in `artifacts/membership/` (ignored local artifacts).
- Direct-checkout follow-up verified the pricing action skips signup, the synthetic paid return carries setup into signup, explicit activation reaches active membership, unfinished checkout can resume, and inactive purchases show recovery. Preview payments remain disabled; no live Stripe/Cognito integration or real charge was tested.

Before release: deploy/configure the member service and its prices/webhooks, establish the real owner's verified account and DB switch, resolve existing-user migration, verify real test-mode billing and email end-to-end, and coordinate the desktop/cloud entitlement release. No production deployment is implied by these local checks.
