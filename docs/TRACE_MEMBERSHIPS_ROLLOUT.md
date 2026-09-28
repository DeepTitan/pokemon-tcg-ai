# Trace membership rollout

## Agreed product behavior

- Trace costs USD $14.99 per month.
- Supporters Club costs USD $39.99 per month and includes Trace.
- Full opponent starting decklists require Supporters Club and a recorded match-end event. A client closing or a guessed winner does not unlock them.
- One verified owner account may bypass payment. The immutable account subject is pinned in infrastructure; its separate database row controls the `enabled` Boolean. This grants product access, not AWS or billing administration. It never bypasses the match-end restriction.
- A match already admitted by the desktop app continues recording if membership subsequently expires or the installation is unlinked. Network routing is never changed by membership checks.

## Release locations

- Desktop, capture service, and new membership service: `release/trace-memberships-20260927`, branch `codex/trace-memberships`, based on upstream `9bda5aa7585988e8c15851e396d05c82062efc45`.
- Trace website: sibling checkout `release/trace-memberships-web-20260927`, branch `codex/trace-memberships-web`, based on the separate deployed website source.
- Do not deploy the dirty root workspace or the unrelated Prize Map checkout. The website and desktop have different current release sources.

## Not activated

The implementation is not a production release. Before enabling it:

1. Resolve the owner's email, then have that person verify their own account. Pin its Cognito `sub` only after verification. Never infer ownership from a Pokémon username or repository author.
2. Resolve whether existing users must subscribe or retain access. The implementation currently has no grandfathered-user exception; do not publish it as a migration policy by accident.
3. Renew the expired AWS session. Reading `trace-production` failed with “Your session has expired. Please reauthenticate using aws login.”
4. Obtain the pending permission to use existing production Stripe credentials. Automatic review rejected `vercel env pull` because it would copy production billing secrets to a local file. Do not fetch them through another path to bypass that rejection.
5. Configure and exercise Stripe test-mode checkout, renewal, upgrade, cancellation, invalid signatures, retries, and device linking before live billing. No real payment was made during implementation.

## Deployment order

1. Follow `infrastructure/memberships/README.md` for the isolated account/membership stack, initially with billing disabled. Preserve the existing capture device table. Use separate fixed USD monthly Stripe prices and a dedicated portal configuration.
2. Inspect the currently deployed capture template before changing it. Preserve the existing matches table, bucket versions, and `KEYS_ONLY` DynamoDB stream used by live leaderboards. The checked-in template retains that stream.
3. Configure the membership endpoint on the website and as the GitHub repository variable `TRACE_MEMBERSHIP_API_URL`. The desktop release workflow refuses to publish without an HTTPS endpoint.
4. Deploy the website account/proxy changes from the website checkout. Keep public leaderboards and sanitized replays working. Verify signed-out, unpaid, both paid plans, and owner states.
5. After the owner has verified their account, pin `OwnerSubject` and enable only its `OwnerSwitches` record. Test both switch positions before enabling general paid access.
6. Deploy capture privacy/registration changes. Set `MembershipApiUrl`; enable `RequireMembership` only after the agreed existing-user policy is implemented and the new desktop build is ready. Missing membership configuration cannot be enabled by CloudFormation.
7. Release the desktop app through its normal signed macOS/Windows release workflow after reviewing the new upstream head. Test with saved/synthetic captures only; do not start a real game.
8. Verify the public website, account cookies, checkout redirects, webhook processing, linked-device access, updater feed, and post-match unlock against the deployed stack.

## Boundaries and limitations

- Owner switch reads and protected decklist requests check the server afresh. Ordinary native access uses an in-memory lease of up to 60 seconds, refreshed every 30 seconds; use Refresh membership for an immediate visible account update.
- Plan buttons go straight to hosted Stripe Checkout; account creation and email verification happen after payment. Configure the web proxy's shared secret together with `webProxySecret` in the service secret, and test post-payment claiming, wrong-account recovery, cancellation, reloads, and duplicate clicks before launch.
- Missing/offline/expired membership cannot unlock new paid access. Raw captured data and already admitted matches are preserved.
- Opponent lists are removed from normal frontend events, reviews, summaries, and public share responses. A separate native command checks membership and raw match-end evidence before returning a list.
- Legacy public replay artifacts are rebuilt using projection format 2 before honoring old ETags. Previously downloaded copies cannot be recalled.
- Old desktop binaries and locally saved captures cannot be remotely revoked. Public GitHub installers are not a secure entitlement boundary; current native and service checks provide access control.
- Cloud-restored reviews without native raw match-end evidence must report opponent lists unavailable rather than trust a client-provided winner.

## Offline verification

Run capture/privacy tests with `python3 -m unittest discover -s infrastructure/aws/tests -p 'test*.py'` and membership tests with `python3 -m unittest discover -s infrastructure/memberships/tests -p 'test*.py'`.

Frontend, native, and website checks are documented in each implementation's test files. None of these checks requires opening Pokémon TCG Live or joining a match.
