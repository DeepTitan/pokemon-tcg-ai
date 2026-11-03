# Trace checkout release — November 3, 2026 (UTC)

## Customer experience

Upgrades started in Trace collect an email and payment in Stripe, create a purchase account, and unlock Pro on the originating installation automatically. No activation code, email verification, or device-link approval interrupts the purchase. Later access from another installation requires verified email ownership. Typing an existing account's email at checkout never grants access to that account.

Trace polls its authenticated membership status while the upgrade window is open and refreshes normally after a restart. The browser return page is informational; neither its URL nor a browser redirect grants access. Manage membership opens the existing purchase's Stripe portal. Repeated Upgrade clicks reuse checkout or open existing billing management.

## Deployed sources

- Backend and native source: `dd02d2cd6d1f19ee866fc6256d8a8accb8ce6607`, [PR #21](https://github.com/DeepTitan/pokemon-tcg-ai/pull/21). The merge has the exact tree tested at `8b66fd65650e6473f85647266830008b5befdf68`.
- Membership production stack: `trace-memberships-production`, `UPDATE_COMPLETE`. Every deployed Python module was downloaded and compared byte-for-byte with the candidate. All production stack parameters and live price IDs are unchanged. The existing membership feature allowlist was preserved.
- Website source: `66ccd1844cccd0048846f5d5594572b45f4bc7f5`, GitHub branch `codex/trace-checkout-website`. This includes the previous live source `dd61b794dccdd120ad2b45a8225437504109e7d1`; its incremental change is limited to three checkout-related files.
- Website deployment: `dpl_2zMEbLCJPMt8ptJQvNhmbuC5ccbK`, staged with production configuration before promotion. The public `/trace-member.js` matches the tested source byte-for-byte, and the public return page was checked in the browser.
- Desktop: [Trace v0.1.103](https://github.com/DeepTitan/pokemon-tcg-ai/releases/tag/v0.1.103) was published at 02:21:55 UTC from the exact source above. Every job passed in [workflow 41564427393](https://github.com/DeepTitan/pokemon-tcg-ai/actions/runs/41564427393).

## Verification

- 181 backend tests, 161 website tests, 11 native membership tests, tracker regression suites, and the frontend build passed. Repository-wide TypeScript checking retains the previously confirmed baseline errors outside this change.
- Release CI passed tracker suites on both platforms, all 79 Windows native tests, Windows installer and packaged executable publisher verification, macOS notarization/stapling/Gatekeeper, a clean Mac install launch, and capture-helper relocation. Both updater payload signatures passed cryptographic verification before publication.
- Public latest release/tag resolution and all four updater platform entries resolve to 0.1.103. All six public assets returned HTTP 200 and matched GitHub's SHA-256 digests. The signature files match the manifest. A final notes-only manifest update preserved every version, date, URL and signature; a fresh asset fetch verified its digest while the canonical updater was checked independently for those unchanged fields.
- The real Stripe sandbox hosted checkout and deployed staging API passed $4.99 monthly and $49.99 yearly purchases. Each fresh installation received exactly one paid subscription and Pro access, an email-based purchase account, and no administrator entitlement or manual device link.
- A declined monthly card left access Free. Retrying the same checkout with the successful test card unlocked Pro. Repeated requests reused the same checkout session; mismatched device credentials were rejected.
- Monthly activation succeeded even when deployment protection prevented the browser return page from opening. The annual payment reached the new hosted return page directly.
- Manage membership opened the existing subscription's portal without account sign-in. A later Cognito-verified synthetic email identity recovered the monthly purchase without the checkout browser proof; the original installation retained only its purchased entitlement. This used a suppressed-email fixture and does not claim a new email-delivery test.
- Scheduled cancellation preserved Pro through the paid period and appeared in authenticated status. Disposable subscriptions were then canceled immediately. Both installations reverted to Free; the recovered purchase refreshed within the existing five-minute reconciliation window. All synthetic AWS device/account records and the suppressed-email Cognito fixture were removed, and test subscriptions cannot renew.
- Production readiness checked the capture/membership endpoint pair, unauthenticated billing rejection, valid installation credentials, and input validation before any payment session was created. No real card was charged or live subscription created.

## Operational evidence

Private test credentials and synthetic fixtures were kept outside the repository. Safe release receipts and test summaries are retained under the local ignored `artifacts/checkout-release/` directory. Production code rollback snapshot and deployment configuration are retained privately in `/private/tmp/trace-upgrade-release/`.

The previous website deployment is `dpl_5X7TPzziBfPtBaRSAc5VDSnrfo33` (`victoryroad-q8sgb61n2-deeptitan-6729s-projects.vercel.app`). Do not publish the unrelated superseded v0.1.99 draft.
