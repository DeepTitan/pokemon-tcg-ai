# Trace transactional email setup

Checkpoint: September 29, 2026, with public DNS verified at 05:24 UTC and SES status checked at 05:27:39 UTC. The owner received the staging Cognito verification email in Gmail's Spam folder and completed the normal user confirmation flow. Staging still uses `COGNITO_DEFAULT`, with sender `no-reply@verificationemail.com`. This proves delivery and account confirmation for that message; it does not prove inbox placement, branded-sender readiness or a spam fix.

AWS account `108241940679`, region `us-east-1`: the SES domain identity `victoryroad.app` exists with RSA-2048 DKIM. All three public DKIM CNAME answers now match the required targets, but SES still reports `PENDING` and `VerifiedForSendingStatus:false` at 05:27:39 UTC. It is not yet verified for sending. SES remains in sandbox mode: sending enabled, 200 messages/day and one message/second. No SES production-access request has been submitted, no branded sender configuration has been deployed, and no branded email has been sent through this identity. Delivery-failure, bounce and complaint monitoring is not operational yet.

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

Do not mark email ready until all three public CNAME answers match, AWS reports successful verification, and the authorized delivery/recovery tests pass. SES production access is an additional gate for public onboarding. Current staging uses Cognito's development sender; that does not prove readiness of the new SES sender.

## Branded-email test while SES remains in the sandbox

Cognito confirmation and SES recipient verification are separate. The confirmed owner's email has not been verified as an SES identity. With the template's `DEVELOPER` email configuration, SES sandbox sending requires a verified recipient address or domain; verifying only the `victoryroad.app` sender does not allow delivery to arbitrary Gmail recipients. [Cognito email settings](https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-email.html), [SES sandbox restrictions](https://docs.aws.amazon.com/ses/latest/dg/request-production-access.html).

The first recipient-helper attempt stopped on an exception-class mismatch before identity creation. After correcting that handler, the authorized retry succeeded with `verificationRequested:true` and `verified:false`: one AWS recipient-verification email was requested for the owner's supplied address. The user has been asked to follow its verification link. Receipt and completion are still pending; this request does not establish a verified recipient or branded sending readiness.

After authorized DNS publication and successful DKIM verification:

1. With explicit authorization for the verification email, create an SES email identity for the exact test recipient in `us-east-1`. The recipient must follow the AWS verification link. This is a test-only SES requirement, not a new signup step for future production users.
2. Select the actual From address on `victoryroad.app`, then set staging `SesIdentity=victoryroad.app`, `SesRegion=us-east-1`, and `SesFromEmail` together. Deploy only staging and verify the pool reads back `EmailSendingAccount=DEVELOPER` with the expected identity and sender. Cognito may create its SES service-linked role.
3. Use a user-requested password-recovery flow to test the confirmed owner's branded email without deleting, recreating or administratively resetting the account. Have the user inspect the From address, DKIM authentication and inbox/spam placement, then enter the code privately if completing recovery. Do not record codes or passwords.
4. For new-signup delivery proof, use a separate exact SES-verified test address. Do not assume a plus-address inherits recipient verification, and do not reuse the confirmed owner as a fresh signup.

Neither DKIM verification nor an accepted API response guarantees inbox placement. Public onboarding still requires SES production access; then recipients no longer need SES identity verification. The optional [notification-error logging draft](TRACE_MEMBERSHIPS_NOTIFICATION_LOGGING.md) remains undeployed and can help diagnose provider errors. It does not fix spam filtering or prove inbox delivery.

## Draft SES production-access request — not submitted

Region: `us-east-1`. Mail type: **Transactional**. Website: `https://victoryroad.app/trace`. The responsible contact email, exact From address and expected daily volume must be supplied and reviewed before submission; none is inferred from the owner's game username. Verify the domain and decide how delivery failures and complaints will be monitored before presenting those controls as operational.

> We request Amazon SES production access in us-east-1 for Trace, a Pokémon TCG match-recording application on Victory Road. SES will be used through Amazon Cognito for transactional account email verification, user-requested verification-code resends and password-reset codes only.
>
> Recipients provide their own email address when creating a Trace account or requesting account recovery. Verification codes establish control of the address before account access is granted. The membership API rate-limits signup, resend and recovery requests. This request does not cover marketing, newsletters, imported address lists or unsolicited invitations.
>
> The application and an isolated staging Cognito pool are implemented. The victoryroad.app SES domain identity has been created with RSA-2048 DKIM and all three required CNAME records are publicly visible, but SES verification is still pending. Public production onboarding has not launched through this identity. We will confirm DKIM verification and complete real email-delivery and account-recovery tests before enabling public sending.
>
> Before submission, we will provide the responsible contact, selected sender address, realistic initial daily volume, and the confirmed process for monitoring delivery failures, bounces and complaints. We will not use this sender for promotional email. Public sending will begin only after those controls are in place and SES production access is approved.

This is a review draft, not evidence that a request was sent or approved. Replace its outstanding implementation statements with verified facts before submission; do not invent deliverability controls or volume estimates. Separate sandbox Stripe configuration and the owner's normal staging Cognito confirmation do not establish production billing readiness or a production owner subject. There is no Discord prerequisite.

## After verification and approval

Configure `SesIdentity=victoryroad.app`, `SesRegion=us-east-1`, and the reviewed `SesFromEmail` together in the membership deployment config. Keep the existing staging/production separation and trusted `WebOrigin`. Production validation requires SES configuration, but configuration alone does not prove deliverability. Refer to [the rollout checklist](TRACE_MEMBERSHIPS_ROLLOUT.md) before enabling public onboarding.
