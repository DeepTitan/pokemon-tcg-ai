# Trace memberships — implementation contract (not deployed)

Trace: USD 14.99/month. Supporters Club: USD 39.99/month, includes Trace and post-match opponent decklists. Authoritative EndGameModification required for opponent decklist release; inferred wins/client exit are not completion. Admin bypasses billing only, never match completion. Existing-user migration and owner verified email are pending user answers.

## Services

New isolated AWS SAM membership stack, separate from existing capture stack. Cognito verified-email accounts, DynamoDB membership/account/device/link state, Stripe hosted Checkout and billing portal. No live credentials in source. Web middleware proxies member API using HttpOnly auth cookies. Existing film subscriptions remain separate. AWS membership function validates Cognito access tokens through GetUser (email_verified required) and reads subscription/admin state consistently. Database-only owner override requires configured owner subject AND enabled flag; no customer API may write it.

## API

Base native: compile/env TRACE_MEMBERSHIP_API_URL. Web proxy: `/trace/api/:action` on existing Trace Vercel deployment; upstream `${TRACE_MEMBERSHIP_API_URL}/v1/:action`.

POST auth/signup {email,password}; POST auth/confirm {email,code}; POST auth/resend {email}; POST auth/login {email,password} => {accessToken,refreshToken,expiresIn}; POST auth/refresh {refreshToken} same result; POST auth/recover {email}; POST auth/reset {email,code,password}; POST auth/logout bearer. Web proxy keeps tokens in HttpOnly Secure SameSite=Lax cookies and never returns them to browser JS; checks same Origin on mutations.

GET account (Cognito bearer) => {email, plan: 'none'|'trace'|'supporter', traceAccess:boolean, opponentDecklists:boolean, admin:boolean, status:string, expiresAt:string|null, cancelAtPeriodEnd:boolean}. Missing/invalid plan/status fails closed. Admin requires immutable verified subject, separate DB switch and does not mint a Stripe subscription.
POST checkout {plan:'trace'|'supporter'} (account bearer) => {url}; price IDs/amount/currency/monthly recurrence validated server-side. Duplicate subscription routed to portal or refused. Success/cancel URL on fixed victoryroad.app/trace/account.
POST portal (account bearer) => {url}. POST webhook receives raw Stripe signature+body, verified and idempotent, reconciles authoritative current subscription under account serialization/conditional writes; allowlisted plan prices only.

Native membership calls authenticate with existing capture device UUID and bearer (`x-trace-device`, Authorization Bearer existingCloudToken); service verifies hash in existing devices table, does not accept caller-provided account subject.
GET devices/status => same entitlement fields as account, plus linked:boolean. No account returns none/false.
POST devices/link/start => {userCode,verificationUrl,expiresAt}. Store short-lived one-time code hash bound to authenticated device. Native polls devices/status using device credentials. Existing linkage only replaced through deliberate unlink first.
POST devices/link/approve {userCode} (account bearer) => {linked:true}. Explicit browser consent, matching code shown. No auto-approval from a URL. GET account only; no admin-role assignment routes.
POST devices/unlink (device bearer) removes linkage.

## Desktop IPC contract

membership_status => {linked, email, plan, traceAccess, opponentDecklists, admin, status, expiresAt, cancelAtPeriodEnd}
membership_link => {userCode, verificationUrl, expiresAt} and opens fixed https victoryroad.app URL in external browser (no native client launch).
membership_unlink => status.
load_opponent_decklist {matchId} => validated list only after fresh membership verification + native stored terminal evidence. Always omit opponent full inventory from ordinary operation/review/summary events. Own deck and naturally revealed cards remain.

Credentials never enter JS, logs, or private replay exports. Keep updater/account recovery usable without payment. Never terminate live capture routing due to expiry/connectivity.

## Direct Stripe checkout (September 27 follow-up)

The public plan buttons start hosted Stripe Checkout before account registration, matching the existing Victory Road film purchase flow. Stripe collects the purchase email. On return, the buyer creates or signs into a verified Trace account using that same email, claims the paid purchase, and links the desktop app. Logged-in members and the owner use their existing account state to avoid another purchase.

The website generates a random purchase token and retains it only in a Secure, HttpOnly, host-only cookie. It sends that token to the membership service together with an `x-trace-proxy-key` header. The header value is `TRACE_MEMBERSHIP_PROXY_SECRET` on the website and `webProxySecret` in the membership service's Secrets Manager JSON. Neither value enters page JavaScript, URLs, or analytics.

The browser first calls the web-only `POST /trace/api/checkout/prepare` to establish the cookie; that action creates no Stripe resources. A same-origin Web Lock serializes preparation and checkout across tabs. Guest checkout requires the existing cookie and never replaces it, so a dropped checkout response can be retried with the same purchase proof. Browsers without Web Locks receive an unsupported-browser message before any payment session is created. Every checkout entry point checks an existing purchase before choosing between guest and authenticated checkout.

- `POST checkout/guest {plan,checkoutToken}` returns a validated Stripe Checkout URL. Repeated requests reuse the reserved session; selecting another plan expires an open prior checkout. Completed purchases cannot open a second checkout from the same purchase token.
- `POST checkout/status {checkoutToken}` returns `{state,plan,expiresAt}`; states are `none`, `open`, `processing`, `paid`, `expired`, or `claimed`. A completed purchase whose subscription needs attention stays `processing` with the allowlisted `reason: purchase_not_active`, directing the buyer to recovery instead of another purchase. No purchase email, Stripe customer/session ID, or secret is returned.
- `POST checkout/claim {checkoutToken}` additionally requires a verified Cognito account and returns `{claimed:true}`. The service retrieves the exact bound session from Stripe, verifies paid subscription/price/mode/metadata, matches its email to the verified account, and binds ownership transactionally before granting access.

A return URL, browser-supplied email, session ID, or payment-success flag cannot grant access. Losing the browser's purchase cookie requires recovery/support rather than permitting arbitrary purchase claims. Proof-free duplicate prevention across different browsers is not promised; existing members should sign in and manage their existing subscription.

Paid, unclaimed purchase evidence is retained until the purchase is resolved; the one-hour Checkout expiry does not erase a completed purchase. Account binding and the freshly reconciled entitlement snapshot are committed together. Retrying a claim verifies the payment again and safely returns the same ownership. An abandoned account customer may be replaced only after its open checkouts are expired and fresh reconciliation confirms it has no ongoing Trace subscription.
