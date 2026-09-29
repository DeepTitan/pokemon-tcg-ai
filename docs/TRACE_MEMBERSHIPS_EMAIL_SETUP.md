# Trace transactional email setup

Checkpoint: September 29, 2026, with public DNS verified at 05:24 UTC and SES domain/DKIM verification confirmed at 05:35:28 UTC. The owner completed the normal staging account-confirmation flow after the original `COGNITO_DEFAULT` email arrived in Spam. Branded recovery email was subsequently received and independently passed Gmail SPF, DKIM and DMARC. A fresh normal-UI recovery message displayed at 1:19 AM arrived unread with an Inbox label before opening; it used `Trace <no-reply@victoryroad.app>`, subject `Your Trace code`, and the expected neutral body. Its Gmail authentication checks also passed. The user had marked an earlier message Not spam, so this is successful delivery to this mailbox, not evidence of universal inbox placement or a proven copy-related spam fix. Recovery completion remains pending; no password was changed.

AWS account `108241940679`, region `us-east-1`: the SES domain identity `victoryroad.app` reports identity and DKIM `SUCCESS`, with `VerifiedForSendingStatus:true`, `SigningEnabled:true` and RSA-2048. All three public DKIM CNAME answers match the required targets. The operator made one SES v1 `verify_domain_dkim` request before the successful read-back; the existing tokens and RSA-2048 settings did not change. Staging Cognito uses `EmailSendingAccount:DEVELOPER`, the expected domain source ARN and the latest `From: Trace <no-reply@victoryroad.app>` configuration. SES remains in sandbox mode: sending enabled, 200 messages/day and one message/second. Production access was requested once at 06:17:57 UTC; AWS accepted the request and read-back reports review `PENDING`, with production access still false. The owner's SNS subscription is confirmed and both domain feedback topics are attached with passing read-back. One simulator bounce and one complaint reached the owner-addressed Gmail operations notifications and matched their SES message IDs; feedback routing is verified.

## DKIM records published in GoDaddy

Public NS and SOA answers identify `ns09.domaincontrol.com` and `ns10.domaincontrol.com` as the domain's nameservers. `_domainkey` is not delegated to Vercel. Vercel's visible default DNS zone is not authoritative for this domain, so publishing only there will not verify SES. After the user's explicit approval, the operator added exactly the three DKIM CNAME records below in GoDaddy. The zone count increased from 11 to 14, all three entries matched, and public recursive DNS returned the exact targets at 05:24 UTC.

The Host values below are relative to GoDaddy's `victoryroad.app` zone. No nameserver, MX, SPF or DMARC changes were part of this publication.

| Type | Host | Points to |
| --- | --- | --- |
| CNAME | `s2bmokpldnfsqldwby6nrxeqjfirpjvd._domainkey` | `s2bmokpldnfsqldwby6nrxeqjfirpjvd.dkim.amazonses.com` |
| CNAME | `tcw74o4pbx2td5genvfcqgo5pdpbwqh3._domainkey` | `tcw74o4pbx2td5genvfcqgo5pdpbwqh3.dkim.amazonses.com` |
| CNAME | `5rtzwb2p27h3gauomgovlno3cktllhoj._domainkey` | `5rtzwb2p27h3gauomgovlno3cktllhoj.dkim.amazonses.com` |

Evidence: [published GoDaddy DKIM records](../artifacts/membership/godaddy-dkim-published-20260929.png).

The tokens above match the SES identity read from AWS. DNS publication and SES verification are separate checkpoints. These read-only checks verify the exact names and AWS status; do not add duplicate records while waiting for SES:

```bash
dig +short CNAME s2bmokpldnfsqldwby6nrxeqjfirpjvd._domainkey.victoryroad.app
dig +short CNAME tcw74o4pbx2td5genvfcqgo5pdpbwqh3._domainkey.victoryroad.app
dig +short CNAME 5rtzwb2p27h3gauomgovlno3cktllhoj._domainkey.victoryroad.app
aws sesv2 get-email-identity --profile default --region us-east-1 \
  --email-identity victoryroad.app \
  --query '{Identity:VerificationStatus,Verified:VerifiedForSendingStatus,Dkim:DkimAttributes.Status}' \
  --output json
```

Public DNS, AWS verification and the staging sender deployment now pass. Do not mark email ready until the authorized delivery/recovery tests also pass. SES production access is an additional gate for public onboarding; the earlier delivery through Cognito's development sender does not prove readiness of the new SES sender.

## Branded-email test while SES remains in the sandbox

Cognito confirmation and SES recipient verification are separate. The owner has now followed the AWS verification link, and the exact test recipient's SES identity reports `VerificationStatus:SUCCESS` and `VerifiedForSendingStatus:true`. With the template's `DEVELOPER` email configuration, SES sandbox sending requires a verified recipient address or domain; this verifies only that recipient, not arbitrary Gmail addresses. The `victoryroad.app` sender domain is also verified. [Cognito email settings](https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-email.html), [SES sandbox restrictions](https://docs.aws.amazon.com/ses/latest/dg/request-production-access.html).

The first recipient-helper attempt stopped on an exception-class mismatch before identity creation. After correcting that handler, the authorized retry requested one AWS recipient-verification email. The user received it and completed the verification link; AWS read-back confirms success. This clears the exact recipient's sandbox requirement. The user confirmed branded recovery receipt in Spam and marked it Not spam. Gmail subsequently showed SPF, DKIM and DMARC PASS for that recovery message. This confirms its authentication, not reliable inbox delivery for other users.

After authorized DNS publication and successful DKIM verification:

1. **Completed for the exact owner test recipient:** the authorized SES verification email was requested and its link confirmed in `us-east-1`. This is a test-only SES requirement, not a new signup step for future production users. Other test recipients still require separate verification while SES remains in the sandbox.
2. **Completed in staging:** `SesIdentity=victoryroad.app`, `SesRegion=us-east-1`, and `SesFromEmail=no-reply@victoryroad.app` are deployed. The pool reads back `EmailSendingAccount=DEVELOPER` with the expected source identity and From address. Production is unchanged.
3. **Receipt, latest rendering and authentication verified; recovery completion pending:** the normal recovery UI requested the confirmed owner's branded email without deleting, recreating or administratively resetting the account. Earlier mail was reported in Spam and marked Not spam. A fresh recovery email then appeared unread in Inbox before opening, with the new Trace display name, neutral subject/body and SPF/DKIM/DMARC PASS. No code or password was entered; completing recovery remains a separate check. Do not record codes or passwords.
4. For new-signup delivery proof, use a separate exact SES-verified test address. Do not assume a plus-address inherits recipient verification, and do not reuse the confirmed owner as a fresh signup.

Neither DKIM verification nor an accepted API response guarantees inbox placement. Public onboarding still requires SES production access; then recipients no longer need SES identity verification. The optional [notification-error logging draft](TRACE_MEMBERSHIPS_NOTIFICATION_LOGGING.md) remains undeployed and can help diagnose provider errors. It does not fix spam filtering or prove inbox delivery.

The reviewed staging deployment changed only the three SES parameters above and
completed successfully. The backend's 116 tests passed before deployment.
Neither that test result nor successful deployment establishes email receipt.

After the initial recovery UI request, SES statistics showed one delivery attempt
and zero bounces, complaints or rejects. Those historical counters established
only an attempted send; the later user report and Gmail inspection establish
receipt and authentication. No password has been changed. The separate
five-resource [email operations stack](TRACE_EMAIL_OPERATIONS.md) reached
`CREATE_COMPLETE`. Its owner subscription is confirmed, and both Bounce/Complaint
topics are attached with passing read-back. Subsequent simulator bounce and
complaint notifications were received and correlated in Gmail; the earlier
blocked preflight was superseded by the confirmed attachment and routing tests.

The recovery-request screenshot captured an older account-page JavaScript
instance that still displayed the former 12-character/composition rule. Reloading
the same reset route showed the correct deployed copy: **8–128 characters. No
numbers or symbols required.** No code or password was entered during that
check. Source and existing signup/reset regressions already used the current
rule; this was a stale open tab, not a new reset validation defect. No runtime
patch or redeployment was needed.

Evidence: [branded recovery requested, before tab reload](../artifacts/membership/branded-recovery-requested-20260929.png).

## SES production-access request — pending review

The single [request record and review status](TRACE_EMAIL_OPERATIONS.md#ses-production-access-request--pending-review) live in the email operations document. AWS accepted the authorized request at 06:17:57 UTC on September 29 and reports `PENDING`; `ProductionAccessEnabled` remains false. Do not resubmit while review is pending. A precise daily-volume forecast is not an added requirement and was not invented. Submission did not deploy a production application or enable live billing. Separate sandbox Stripe configuration and the owner's normal staging Cognito confirmation do not establish production billing readiness or a production owner subject. There is no Discord prerequisite.

## After verification and approval

Configure `SesIdentity=victoryroad.app`, `SesRegion=us-east-1`, and the reviewed `SesFromEmail` together in the membership deployment config. Keep the existing staging/production separation and trusted `WebOrigin`. Production validation requires SES configuration, but configuration alone does not prove deliverability. Refer to [the rollout checklist](TRACE_MEMBERSHIPS_ROLLOUT.md) before enabling public onboarding.

## Recovery resend and alert attachment

On September 29, the user requested another email. The normal Trace recovery UI
acknowledged a second request to the confirmed owner account. No password or
code was entered. AWS showed the SNS subscription already confirmed, so no
subscription confirmation was resent. The guarded feedback helper then attached
Bounce and Complaint notifications to the reviewed topic and passed read-back.
The owner confirmed recovery receipt in Spam and marked it Not spam. Gmail's
SPF/DKIM/DMARC results were subsequently verified as PASS, and the separate
simulator tests verified Bounce/Complaint notification receipt. Evidence:
[recovery resend acknowledgment](../artifacts/membership/branded-recovery-resent-20260929.png)
and [simulator results](../artifacts/membership/ses-feedback-simulator-20260929.json).

## Spam investigation after the resend

The resent branded recovery email arrived in Gmail Spam. The user marked it
Not spam. Read-only AWS checks confirmed `SigningEnabled:true`, DKIM `SUCCESS`,
and RSA-2048; the current MAIL FROM uses SES defaults. Public DNS retains
`p=quarantine; adkim=r; aspf=r` DMARC. No DNS policy was weakened or changed.
SES default MAIL FROM can authenticate with SPF; aligned DKIM can satisfy
DMARC. Missing apex SPF alone does not prove this SES message failed. Gmail's
received-message results now confirm SPF, DKIM and DMARC PASS. This rules out an
authentication failure for the inspected message; it does not identify the
original Spam classification cause.

The shared Cognito verification template also supplies password-recovery email.
The signup-specific subject was changed to `Your Trace code`, with neutral
verification/recovery instructions and an ignore-if-unrequested sentence.
The configured sender adds the display name Trace while preserving the exact
address and SES identity. This improves recognition and clarity; it is not
evidence of a spam fix. Staging deployment completed and AWS read-back confirms
`From: Trace <no-reply@victoryroad.app>`, subject `Your Trace code`, and the
reviewed body. All 116 backend tests passed. A subsequent normal-UI recovery
request verified the new sender, subject and body in Gmail, as recorded below.

## Recipient follow-up and mailbox check

The owner later reported that recent emails came through and believed the
authentication result was successful. They explicitly authorized inspecting
their Gmail for the Trace messages. The existing visible Gmail session contained
the Trace message addressed to the exact owner test recipient; any forwarding
or alias relationship between that session and the recipient was not established.
Only the relevant Trace message was inspected.

Gmail Show original displayed September 29, 2026 at 12:57 AM, delivery after
0 seconds, `From: no-reply@victoryroad.app`, the exact owner recipient, and the
older subject `Verify your Trace account`. SPF was PASS with IP `54.240.8.59`,
DKIM was PASS for `victoryroad.app`, and DMARC was PASS. The saved
[authentication summary](../artifacts/membership/gmail-trace-authentication-pass-20260929.png)
contains the summary table only, with no recovery code or password. The message
predates the neutral-copy deployment, so it does not verify the new template's
received rendering. The user had already marked it Not spam; its current Inbox
label is not proof of original inbox placement or delivery to other recipients.

## Fresh recovery email with the deployed template

A subsequent normal Trace recovery request produced the September 29 message
displayed at **1:19 AM**. Gmail showed it unread with an Inbox label before it
was opened; the agent did not change its labels or mailbox rules. The message
rendered the `Trace <no-reply@victoryroad.app>` sender, `Your Trace code` subject,
neutral verification/recovery instructions and ignore-if-unrequested sentence.
No code was entered or retained, and no password was changed.

Gmail Show original reported delivery after 1 second, SPF PASS with IP
`54.240.8.51`, DKIM PASS for `victoryroad.app`, and DMARC PASS. The
[fresh authentication summary](../artifacts/membership/gmail-fresh-trace-code-pass-20260929.png)
contains only the summary table, without the code or body. This verifies the
deployed template and successful inbox delivery for the inspected mailbox.
The earlier Not spam action may affect this mailbox's classification; the
result does not establish universal inbox placement or prove why the earlier
messages were classified as Spam.
