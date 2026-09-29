# Trace transactional email setup

Checkpoint: September 29, 2026, with public DNS verified at 05:24 UTC and SES domain/DKIM verification confirmed at 05:35:28 UTC. The owner previously received the staging Cognito verification email in Gmail's Spam folder and completed the normal user confirmation flow. That message used `COGNITO_DEFAULT`, with sender `no-reply@verificationemail.com`. The staging SES sender deployment has now completed: Cognito reads back `EmailSendingAccount:DEVELOPER`, the `victoryroad.app` SES source ARN and `From:no-reply@victoryroad.app`. The normal recovery form has requested the owner's branded recovery email; the user confirmed the resent message arrived in Spam and marked it Not spam. Recovery completion remains pending; no password was changed. The earlier message proves account confirmation, not inbox placement or a spam fix.

AWS account `108241940679`, region `us-east-1`: the SES domain identity `victoryroad.app` now reports identity and DKIM `SUCCESS`, with `VerifiedForSendingStatus:true`. All three public DKIM CNAME answers match the required targets. The operator made one SES v1 `verify_domain_dkim` request before the successful read-back; the existing tokens and RSA-2048 settings did not change. SES remains in sandbox mode: sending enabled, 200 messages/day and one message/second. No SES production-access request has been submitted and branded receipt is now confirmed in Gmail Spam; inbox delivery and received-message authentication remain unverified. The owner's SNS subscription is confirmed and both domain feedback topics are attached with passing read-back; notification delivery testing remains pending.

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

The first recipient-helper attempt stopped on an exception-class mismatch before identity creation. After correcting that handler, the authorized retry requested one AWS recipient-verification email. The user received it and completed the verification link; AWS read-back confirms success. This clears the exact recipient's sandbox requirement. The staging sender is deployed and a recovery email has been requested through the normal UI, but the user confirmed branded receipt in Spam. They marked it Not spam. Received-message authentication remains unverified, and this mailbox action does not establish inbox delivery for other users.

After authorized DNS publication and successful DKIM verification:

1. **Completed for the exact owner test recipient:** the authorized SES verification email was requested and its link confirmed in `us-east-1`. This is a test-only SES requirement, not a new signup step for future production users. Other test recipients still require separate verification while SES remains in the sandbox.
2. **Completed in staging:** `SesIdentity=victoryroad.app`, `SesRegion=us-east-1`, and `SesFromEmail=no-reply@victoryroad.app` are deployed. The pool reads back `EmailSendingAccount=DEVELOPER` with the expected source identity and From address. Production is unchanged.
3. Use a user-requested password-recovery flow to test the confirmed owner's branded email without deleting, recreating or administratively resetting the account. Have the user inspect the From address, DKIM authentication and inbox/spam placement, then enter the code privately if completing recovery. Do not record codes or passwords.
4. For new-signup delivery proof, use a separate exact SES-verified test address. Do not assume a plus-address inherits recipient verification, and do not reuse the confirmed owner as a fresh signup.

Neither DKIM verification nor an accepted API response guarantees inbox placement. Public onboarding still requires SES production access; then recipients no longer need SES identity verification. The optional [notification-error logging draft](TRACE_MEMBERSHIPS_NOTIFICATION_LOGGING.md) remains undeployed and can help diagnose provider errors. It does not fix spam filtering or prove inbox delivery.

The reviewed staging deployment changed only the three SES parameters above and
completed successfully. The backend's 116 tests passed before deployment.
Neither that test result nor successful deployment establishes email receipt.

After the normal recovery UI request, SES statistics showed one delivery attempt
and zero bounces, complaints or rejects. The user's Inbox/Spam response remains
pending. No password has been changed. These provider counters are evidence of
an attempted send, not receipt, successful recovery or reliable inbox placement.
The separate five-resource [email operations stack](TRACE_EMAIL_OPERATIONS.md)
reached `CREATE_COMPLETE`. Its SNS confirmation email was requested, but the
owner's confirmation is pending. The read-only attachment check correctly
stopped at `exact_owner_subscription_must_be_confirmed`; Bounce/Complaint topics
are not yet attached and monitoring is not operational.

The recovery-request screenshot captured an older account-page JavaScript
instance that still displayed the former 12-character/composition rule. Reloading
the same reset route showed the correct deployed copy: **8–128 characters. No
numbers or symbols required.** No code or password was entered during that
check. Source and existing signup/reset regressions already used the current
rule; this was a stale open tab, not a new reset validation defect. No runtime
patch or redeployment was needed.

Evidence: [branded recovery requested, before tab reload](../artifacts/membership/branded-recovery-requested-20260929.png).

## SES production-access request — not submitted

The single [review draft and operator prerequisites](TRACE_EMAIL_OPERATIONS.md#truthful-ses-production-access-request-draft--not-submitted) live in the email operations document. Confirm the public From address and the owner's monitoring responsibility before submission. A precise daily-volume forecast is not an added requirement; do not invent one. Replace pending statements only with observed evidence, and do not present deployed but unconfirmed alert resources as operational. Separate sandbox Stripe configuration and the owner's normal staging Cognito confirmation do not establish production billing readiness or a production owner subject. There is no Discord prerequisite.

## After verification and approval

Configure `SesIdentity=victoryroad.app`, `SesRegion=us-east-1`, and the reviewed `SesFromEmail` together in the membership deployment config. Keep the existing staging/production separation and trusted `WebOrigin`. Production validation requires SES configuration, but configuration alone does not prove deliverability. Refer to [the rollout checklist](TRACE_MEMBERSHIPS_ROLLOUT.md) before enabling public onboarding.

## Recovery resend and alert attachment

On September 29, the user requested another email. The normal Trace recovery UI
acknowledged a second request to the confirmed owner account. No password or
code was entered. AWS showed the SNS subscription already confirmed, so no
subscription confirmation was resent. The guarded feedback helper then attached
Bounce and Complaint notifications to the reviewed topic and passed read-back.
The owner confirmed recovery receipt in Spam and marked it Not spam. Gmail's
SPF/DKIM/DMARC results and actual alert delivery remain pending. Evidence: [recovery resend acknowledgment](../artifacts/membership/branded-recovery-resent-20260929.png).

## Spam investigation after the resend

The resent branded recovery email arrived in Gmail Spam. The user marked it
Not spam. Read-only AWS checks confirmed `SigningEnabled:true`, DKIM `SUCCESS`,
and RSA-2048; the current MAIL FROM uses SES defaults. Public DNS retains
`p=quarantine; adkim=r; aspf=r` DMARC. No DNS policy was weakened or changed.
SES default MAIL FROM can authenticate with SPF; aligned DKIM can satisfy
DMARC. Missing apex SPF alone does not prove this SES message failed. Actual
Gmail SPF/DKIM/DMARC results were requested and remain pending.

The shared Cognito verification template also supplies password-recovery email.
The signup-specific subject was changed to `Your Trace code`, with neutral
verification/recovery instructions and an ignore-if-unrequested sentence.
The configured sender adds the display name Trace while preserving the exact
address and SES identity. This improves recognition and clarity; it is not
evidence of a spam fix. Staging deployment completed and AWS read-back confirms
`From: Trace <no-reply@victoryroad.app>`, subject `Your Trace code`, and the
reviewed body. All 116 backend tests passed. No additional email was sent after
this copy change, so its received rendering has not yet been tested.

## Recipient follow-up and mailbox check

The owner later reported that recent emails came through and believed the
authentication result was successful. They explicitly authorized inspecting
their Gmail for the Trace messages. The connected Gmail account and existing
browser session were work accounts, not the personal test recipient; the
personal account requires a normal Google sign-in. That page is prepared for
the owner. Actual SPF/DKIM/DMARC results and the latest message labels have not
yet been read independently. Do not treat a moved-from-Spam message as proof it
originally arrived in Inbox or assume this recipient result generalizes.
