# Trace creator referrals

JakePTCG's link is `https://victoryroad.app/trace?ref=jakeptcg`; his optional checkout code is `jakeptcg` (case insensitive).

The website issues a signed, HttpOnly, Secure, SameSite cookie using a purpose-specific HMAC and the existing web proxy secret. The click timestamp is server-set. The backend independently verifies the signature and expiry. A link qualifies only if the initial invoice is paid strictly before 24 hours after the click. Reloading after capture does not restart the timer: the page removes `ref` from its own URL. A fresh deliberate link visit starts a new window. This is browser-based attribution; users on another device can use the checkout field.

New hosted Stripe Checkouts have an optional Creator code text field. An active link prefills it. A recognized different manually entered code takes priority; without a link, a valid entered code attributes the purchase directly. Unchanged prefilled text remains subject to the link deadline, including when a checkout is left open. A typo cannot create an affiliate. Clearing an automatically filled field does not remove the underlying valid link. This single-creator release recognizes only JakePTCG.

Successful attribution is fixed to that subscription in `AFFILIATE_SUB#<subscription>`, including the 2,000 basis-point (20%) rate. Renewals and plan changes on the same subscription retain the credit. Existing subscriptions and legacy checkout reservations are not retroactively attributed. No affiliate credit grants account access, changes prices, or creates a discount. Owner accounts remain no-charge.

Commission is based on collected card revenue after discounts, excluding tax and before Stripe fees. Taxes and refunds are apportioned using the invoice's after-discount tax-exclusive total. Full refunds remove the full commission; partial refunds remove a proportional amount. Open or lost disputes hold the affected commission at zero; winning restores it once. Credit notes without a corresponding refund also reduce the balance. Credit-balance/out-of-band/zero-dollar invoices earn no cash commission. Round USD commission half-up to cents per invoice.

`AFFILIATE_INVOICE#<invoice>` stores the current balance. Every change writes an immutable `AFFILIATE_ENTRY#<invoice>#<nonce>` adjustment in the same DynamoDB transaction. Locks serialize updates; fresh Stripe reads replace potentially stale webhook snapshots. Duplicate events, retries after lost responses, and out-of-order notifications do not accrue revenue twice. Records contain billing identifiers, not customer emails. Payouts are manual; this code never transfers funds.

## Stripe events

Keep all existing Trace event subscriptions. Add `charge.refunded`, `refund.updated`, `charge.dispute.created`, `charge.dispute.updated`, `charge.dispute.closed`, `charge.dispute.funds_withdrawn`, `charge.dispute.funds_reinstated`, `credit_note.created`, `credit_note.updated`, and `credit_note.voided` to the existing isolated Trace webhook. Keep API version `2024-06-20`. The runtime additionally requires read access to charges and disputes. Never change unrelated film webhooks.

Invoices with unknown prices, mixed unrelated invoice items, or incomplete line pagination fail closed instead of guessing commissions. Resolve such provider errors before paying a report. A failed attribution/ledger write returns a non-2xx webhook response so Stripe retries. When recovering a missed event, resend its original Stripe event to the Trace webhook.

## Monthly report

```sh
python3 infrastructure/memberships/affiliate_report.py --stack trace-memberships-production --month 2026-10 > jakeptcg-2026-10.csv
```

The operator's existing AWS login is required. This is a read-only CSV of commission changes recorded in the requested UTC month, including reversals of earlier payments. A negative total carries forward against later earnings. Deduct any previous payouts for that period; this report does not send money or record external payouts. Check Stripe delivery failures before settling a report.

## Rollout

Run offline membership/affiliate and website/proxy tests. Deploy code to the isolated staging membership function while preserving its environment, Cognito and database resources. Validate actual Stripe sandbox fields, paid invoices, renewals and reversals, then deploy the same reviewed code to the production function and add the same event types to its dedicated Trace webhook. Deploy the website referral capture last. No changes to desktop/native capture are required.

## Verification evidence (2026-10-01 UTC)

The isolated Stripe sandbox recorded a real hosted Checkout with Jake's prefilled field, a $14.99 first payment (+$3.00), a $14.99 renewal (+$3.00), and a $7.50 partial refund (-$1.50). The report reconciled to $4.50. Resending the original paid-invoice event twice did not duplicate commission. The test subscription was then canceled immediately without another refund. No live charge or payout was made. Offline coverage additionally checks manual codes, the exact 24-hour boundary, forged referrals, tax/discount calculations, full refunds, disputes, credit notes, and atomic ledger writes.

Production was published after the sandbox checks: backend commit `1d21379`, website commit `e8f3be7`, and Vercel deployment `victoryroad-en9lidrwm-deeptitan-6729s-projects.vercel.app`. The existing Trace production webhook now receives 21 events with API version `2024-06-20`. Public-domain checks verified the secure referral cookie, referral prefill for Pro, and the optional blank code field for Supporters Club. Both live checkout sessions remained unpaid and were expired after visual verification.
