# Trace email operations — feedback routing verified

September 29, 2026. This deployment is limited to account `108241940679`, region `us-east-1`, and transactional Trace email from the existing `victoryroad.app` SES identity. The five-resource `trace-email-operations` stack reached `CREATE_COMPLETE`. AWS template validation passed and the exact resource names were checked absent before creation. The exact owner SNS subscription is confirmed. The guarded feedback helper completed `--execute` and read-back passed for both domain Bounce and Complaint topics. Existing forwarding and BOUNCE/COMPLAINT suppression were preserved. One authorized simulator bounce and one complaint reached the owner-addressed operations notifications in Gmail, matched to their accepted SES message IDs. Feedback routing is operational; reputation-alarm firing was not exercised. SES production access was requested once at 06:17:57 UTC; AWS accepted the request and reports review `PENDING`, with `ProductionAccessEnabled:false`.

The domain identity and DKIM are verified, and the exact owner test recipient is SES-verified. Staging Cognito uses `EmailSendingAccount=DEVELOPER`, the `victoryroad.app` source identity and `From: Trace <no-reply@victoryroad.app>`. A fresh normal-UI recovery message displayed September 29 at 1:19 AM appeared unread with an Inbox label before opening. Its Trace sender, `Your Trace code` subject and neutral body matched the deployed template; Gmail Show original reported SPF, DKIM and DMARC PASS. The earlier recovery message also passed authentication, but the user reported its initial Spam placement and marked it Not spam. The fresh result establishes delivery to this mailbox after that feedback, not a guarantee for other recipients or proof that the copy change fixed spam classification. No password has been changed. See the [fresh authentication summary](../artifacts/membership/gmail-fresh-trace-code-pass-20260929.png) and [sender setup](TRACE_MEMBERSHIPS_EMAIL_SETUP.md).

## Deployed resources

The reviewed [email-operations.json](../infrastructure/memberships/email-operations.json) was deployed as the separate stack `trace-email-operations`.

| Resource | Configuration |
| --- | --- |
| SNS standard topic | `arn:aws:sns:us-east-1:108241940679:trace-email-operations` |
| Email subscription | `williamsbyronik@gmail.com`; deployment requests one SNS confirmation email |
| SES publishing policy | Only `ses.amazonaws.com`, account `108241940679`, source `arn:aws:ses:us-east-1:108241940679:identity/victoryroad.app`, action `sns:Publish` to this topic |
| CloudWatch publishing policy | Only `cloudwatch.amazonaws.com`, the same account, and the two exact alarm ARNs below |
| Bounce alarm | `trace-email-reputation-bounce`: `AWS/SES` → `Reputation.BounceRate >= 0.05` |
| Complaint alarm | `trace-email-reputation-complaint`: `AWS/SES` → `Reputation.ComplaintRate >= 0.001` |

Both alarms use one five-minute Average datapoint and keep their current state when data is missing. Five minutes is a simple operator-selected notification interval; the metric itself is SES's reputation rate, not a new five-minute delivery-rate calculation. Thresholds and missing-data handling follow [AWS's reputation alarm guidance](https://docs.aws.amazon.com/ses/latest/dg/reputationdashboard-cloudwatch-alarm.html). Alarms notify only on entering ALARM; they do not pause sending automatically. Missing metrics or an `INSUFFICIENT_DATA` state before sending is expected and is not evidence of healthy delivery.

These metrics cover the entire SES account in this region. They cannot isolate Trace or `victoryroad.app`. The SES event attachment below is domain-specific. CloudWatch's publisher policy uses the [exact source alarm ARN](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Notify_Users_Alarm_Changes.html).

There are no IAM roles, Lambda functions, additional domains, marketing resources, delivery-event exports, KMS permission changes or account-suppression changes. The existing `BOUNCE` and `COMPLAINT` suppression remains required. SNS standard-topic email is an operator alert channel, not a customer mailing list.

## Review and deployment sequence

The deployment steps below are retained as the reviewed procedure. Steps 1–6
and the subsequent simulator notification-delivery checks are complete; do not
create another stack or subscription. SES recipient verification is
separate from confirming an SNS subscription; the earlier verification does not
confirm this subscription.

1. Read `sts get-caller-identity` and require account `108241940679`. Use region `us-east-1` explicitly. Check whether the stack/topic/alarm names already exist; inspect ownership and configuration rather than adopting or overwriting existing resources. All template resources have an exact account/region condition; a wrong target would create no resources, so stack success by itself is insufficient.
2. Validate and review the template/change set. It creates the five resources listed above. No `CAPABILITY_IAM` acknowledgment is needed because no IAM resources are declared.
3. After approval, deploy:

   ```bash
   aws cloudformation deploy --profile default --region us-east-1 \
     --stack-name trace-email-operations \
     --template-file infrastructure/memberships/email-operations.json \
     --tags application=trace purpose=transactional-email-operations
   ```

4. Have the owner confirm the new SNS subscription. Verify `SubscriptionArn` is a real ARN, not `PendingConfirmation`. This step remains outstanding until observed; do not resend or replace the subscription repeatedly.
5. After SES reports successful domain verification and DKIM, run the read-only attachment preflight using the AWS CLI Python runtime:

   ```bash
   /opt/homebrew/Cellar/awscli/2.34.44/libexec/bin/python \
     scripts/aws/configure-trace-email-feedback.py --check
   ```

6. Only after approval and a passing preflight, run the same command with `--execute`. Without either flag, the helper prints an offline plan and does not load the SDK or make requests. The helper never sends application or test emails, publishes SNS messages, subscribes recipients, changes suppression, or changes the Cognito sender.

CloudFormation's [SES identity resource](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ses-emailidentity.html) has no SNS identity-notification properties. The helper therefore makes two explicit `SetIdentityNotificationTopic` calls against the existing domain: one Bounce, one Complaint. It avoids a Lambda custom resource and does not recreate/import the identity. It keeps feedback forwarding enabled, refuses enabled original-email headers, and preserves any delivery destination. It will only fill an empty destination or reuse this exact topic. It fails if another destination exists, the owner subscription is unconfirmed, policy/alarms differ, DKIM is pending, or existing suppression is missing.

SES offers no conditional notification-setting update. The helper rechecks immediately before each write, stops on drift, and verifies both after writing. A failure can leave only the first attachment applied; inspect the sanitized error and read back settings before retrying. Successful retries are idempotent. Coordinate with other operators; never replace a different topic to force a retry.

The [SES notification documentation](https://docs.aws.amazon.com/ses/latest/dg/configure-sns-notifications.html) requires a standard topic in the same region and a confirmed subscriber. Domain settings do not cover separately verified sender addresses; when selecting the branded From address, check whether it has a separate SES identity and review its effective notification settings. Do not attach unrelated identities here.

## Evidence required before calling this operational

- Stack completed with the exact topic, policy, two alarms and confirmed owner subscription; helper read-back passed for both SES feedback topics. Suppression is still `BOUNCE` plus `COMPLAINT`, and feedback forwarding is still enabled.
- **Verified:** one authorized SES mailbox-simulator bounce and one complaint were accepted at 06:15:33 and 06:15:34 UTC on September 29. The visible owner-addressed Gmail notifications matched each accepted SES `messageId`, notification kind and exact simulator destination. [Sanitized simulator evidence](../artifacts/membership/ses-feedback-simulator-20260929.json) records the matches without private headers. This establishes SES → SNS → operations-mailbox routing for both kinds. No real customer received either test message, and no mailbox rules were changed.
- **Verified for the fresh recovery message:** it appeared unread in Inbox before opening, rendered the deployed Trace sender and neutral subject/body, and passed Gmail SPF/DKIM/DMARC. Earlier mail had been marked Not spam by the user, so this mailbox result does not guarantee placement elsewhere. Password-recovery completion and SES production approval remain pending.

The [AWS mailbox simulator](https://docs.aws.amazon.com/ses/latest/dg/send-an-email-from-console.html)
does not affect reputation rates. These two tests therefore did not fire or
verify the CloudWatch reputation-threshold alarms. Their deployed configuration
and passing read-back remain the available alarm evidence.

SNS feedback can contain recipient addresses and provider details even when original headers are off. Keep it in the owner-controlled mailbox; do not copy raw notifications into public logs or issue reports. Record only non-sensitive evidence such as test time, notification kind and delivery confirmation. Alarm actions are a notification mechanism, not proof anyone reviewed an alert.

The operator response described in the submitted production-access request is to inspect each bounce/complaint, retain SES suppression, avoid manually retrying suppressed recipients, and investigate unexpected sending before resuming affected traffic. At a reputation alarm, the owner reviews Trace and any other SES traffic in the region and decides whether to pause new sending while investigating. This is a human process, not an automatic pause. Current auth endpoints enforce a shared limit of 30 requests per normalized email per five-minute bucket, plus HTTP API limits of 15 requests/second and burst 30. This is not a daily email budget or an individual resend cooldown.

Before deleting this stack, inspect and detach only feedback settings that still point to this exact topic, retaining email feedback forwarding and suppression. Then remove the stack and verify its resources/subscription are gone. Do not delete the SES domain identity or a replacement notification destination.

## SES production-access request — pending review

The authorized request was submitted once at **06:17:57 UTC on September 29,
2026**, after checking that no review was already in progress. AWS returned HTTP
200. Immediate `GetAccount` read-back showed `ReviewDetails.Status:PENDING` and
`ProductionAccessEnabled:false`; no case ID was returned at that checkpoint.
The account remains in the SES sandbox. Request acceptance is not production
approval, and no production application or live billing was deployed.

Submitted values: mail type **Transactional**, region `us-east-1`, website
`https://victoryroad.app/trace`, language `EN`, and owner contact
`williamsbyronik@gmail.com`. The request describes only user-requested Cognito
verification, resend and password-recovery messages from
`Trace <no-reply@victoryroad.app>`. It records verified authentication and feedback
routing, retained suppression/forwarding, configured reputation alarms, the
human response process above, and the early Spam-placement observation without
promising inbox placement. Public onboarding through this identity remains
gated on SES approval and the remaining application checks.

The exact [submitted request](../artifacts/membership/ses-production-access-request.ready.json)
and [accepted request/read-back evidence](../artifacts/membership/ses-production-access-submission-20260929.json)
are saved in ignored local artifacts. Do not resubmit while review is pending.
A precise daily-volume forecast is not a required field in
[PutAccountDetails](https://docs.aws.amazon.com/ses/latest/APIReference-V2/API_PutAccountDetails.html)
and was not invented for this request. Follow the
[SES production-access process](https://docs.aws.amazon.com/ses/latest/dg/request-production-access.html)
for the review outcome and any AWS follow-up.

## Offline validation

```bash
python3 -m unittest discover -s scripts/aws -p test_configure_trace_email_feedback.py
python3 scripts/aws/configure-trace-email-feedback.py
```

All 12 offline tests passed, and peer review approved the scoped implementation. They cover wrong-account refusal, unconfirmed/wrong recipient, pending DKIM, missing suppression, an existing other topic, broader permissions, disabled alarms, partial-update drift, exact two-write scope and retry idempotency. They do not establish notification delivery. Separate AWS deployment and passing attachment read-back establish only those stated checkpoints. No AWS call is required for the offline tests.
