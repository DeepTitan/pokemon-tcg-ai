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

Local implementation and offline checks do **not** establish a production launch or successful provider integration. At the last preflight, AWS sessions were expired, permission for the previously blocked production billing-secret retrieval remained unresolved, and the owner's verified email/subject had not been supplied. Do not retrieve credentials through another path to bypass an approval rejection.

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

Run `python3 -m unittest discover -s infrastructure/aws/tests -p 'test*.py'` and `python3 -m unittest discover -s infrastructure/memberships/tests -p 'test*.py'`. Also check Python compilation, shell syntax and YAML parsing. These require no credentials, email sends, card charges or game launches. SAM/CloudFormation semantic validation and actual provider/IAM tests remain requirements of the authorized staging rollout.
