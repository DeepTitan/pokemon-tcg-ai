# Trace email operations — attached, delivery test pending

September 29, 2026. This deployment is limited to account `108241940679`, region `us-east-1`, and transactional Trace email from the existing `victoryroad.app` SES identity. The five-resource `trace-email-operations` stack reached `CREATE_COMPLETE`. AWS template validation passed and the exact resource names were checked absent before creation. The exact owner SNS subscription is now confirmed. The guarded feedback helper completed `--execute` and read-back passed for both domain Bounce and Complaint topics. Existing forwarding and BOUNCE/COMPLAINT suppression were preserved. Actual alert delivery has not yet been tested. No production-access request has been submitted.

The domain identity and DKIM are verified, and the exact owner test recipient is SES-verified. Staging Cognito now uses `EmailSendingAccount=DEVELOPER`, the `victoryroad.app` source identity and `From=no-reply@victoryroad.app`. The normal recovery UI requested a branded email. At the user's request, another recovery email was requested through the same UI; it acknowledged the request. The AWS subscription resend was unnecessary because the subscription was already confirmed. SES statistics show one delivery attempt and zero bounces, complaints or rejects, but the user reports that the resent recovery email arrived in Spam and was marked Not spam. No password has been changed, and actual Gmail authentication results remain pending. These counters do not establish receipt or healthy ongoing delivery. See [sender setup](TRACE_MEMBERSHIPS_EMAIL_SETUP.md) for the detailed checkpoint.

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
are complete; do not create another stack or subscription. Actual notification
delivery remains pending. SES recipient verification is
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
- Owner-approved notification delivery test reached the operations mailbox. A later approved SES mailbox-simulator test can verify actual bounce/complaint routing without using a real customer's mailbox. No such test has been run by this preparation task.
- Branded verification/recovery delivery and sender authentication were tested separately. Receiving a message in Spam establishes receipt, not inbox placement. SES production access and sender verification remain separate gates.

SNS feedback can contain recipient addresses and provider details even when original headers are off. Keep it in the owner-controlled mailbox; do not copy raw notifications into public logs or issue reports. Record only non-sensitive evidence such as test time, notification kind and delivery confirmation. Alarm actions are a notification mechanism, not proof anyone reviewed an alert.

The proposed operator response is to inspect each bounce/complaint, retain SES suppression, avoid manually retrying suppressed recipients, and investigate unexpected sending before resuming affected traffic. At a reputation alarm, the owner reviews Trace and any other SES traffic in the region and decides whether to pause new sending while investigating. This human process must be accepted by the owner; it is not implemented as an automatic pause. Current auth endpoints enforce a shared limit of 30 requests per normalized email per five-minute bucket, plus HTTP API limits of 15 requests/second and burst 30. This is not a daily email budget or an individual resend cooldown.

Before deleting this stack, inspect and detach only feedback settings that still point to this exact topic, retaining email feedback forwarding and suppression. Then remove the stack and verify its resources/subscription are gone. Do not delete the SES domain identity or a replacement notification destination.

## Truthful SES production-access request draft — not submitted

This is the canonical request draft; the sender setup document links here to avoid divergent copies. Mail type: **Transactional**. Region: `us-east-1`. Website: `https://victoryroad.app/trace`. Responsible contact proposed by the user: `williamsbyronik@gmail.com`. The deployed staging From address is `no-reply@victoryroad.app`; confirm its use for public sending before submission. A precise daily-volume forecast is not a required field in [PutAccountDetails](https://docs.aws.amazon.com/ses/latest/APIReference-V2/API_PutAccountDetails.html), so it is not an added launch gate here. Do not invent a forecast or represent pending controls as operational.

> We request Amazon SES production access in us-east-1 for Trace, a Pokémon TCG match-recording application on Victory Road. We will use SES through Amazon Cognito for account-verification codes, user-requested verification resends, and password-recovery codes only.
>
> Recipients enter an email address when signing up or requesting account recovery. We require verification before granting account access. We do not use purchased or imported recipient lists, newsletters, marketing campaigns, or unsolicited invitations. Our membership API limits authentication requests per email address, and the HTTP API also has request-rate limits.
>
> SES account suppression for hard bounces and complaints is already enabled. The domain and DKIM are verified, and the isolated staging Cognito pool uses the branded no-reply@victoryroad.app sender. A normal password-recovery request has reached one SES delivery attempt; receipt and recovery completion are not yet confirmed. The dedicated notification topic, owner subscription and SES reputation alarms are deployed. The owner subscription still needs confirmation, and Bounce/Complaint feedback attachment is blocked until then. Monitoring is not yet operational. Before submission, the owner must accept the monitoring responsibility and confirm how delivery problems will be handled.
>
> This is a small launch of user-triggered transactional email, not bulk sending. Before enabling public onboarding, we will confirm and test the operations notification channel, validate branded account-verification and recovery delivery, and stay within the approved sending quota. We will confirm the public From address before submission.

Before submitting, replace the pending statements only with observed evidence and confirm the owner's monitoring responsibility. The [SES production-access process](https://docs.aws.amazon.com/ses/latest/dg/request-production-access.html) requires truthful acknowledgment of a bounce/complaint process. A prepared template is not that process in operation. No request has been submitted by this task.

## Offline validation

```bash
python3 -m unittest discover -s scripts/aws -p test_configure_trace_email_feedback.py
python3 scripts/aws/configure-trace-email-feedback.py
```

All 12 offline tests passed, and peer review approved the scoped implementation. They cover wrong-account refusal, unconfirmed/wrong recipient, pending DKIM, missing suppression, an existing other topic, broader permissions, disabled alarms, partial-update drift, exact two-write scope and retry idempotency. They do not establish notification delivery. The separate AWS deployment and blocked preflight evidence above establish only those stated checkpoints. No AWS call is required for the offline tests.
