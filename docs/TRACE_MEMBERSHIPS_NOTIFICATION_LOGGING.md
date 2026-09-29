# Staging email-error diagnostics — prepared, not deployed

The September 29 diagnostic resend was accepted by Cognito and returned a masked email destination. The owner subsequently found the default Cognito verification email in Gmail's Spam folder and completed normal account confirmation. This optional diagnostic is for provider delivery errors; it does not fix spam filtering or improve inbox placement. At inspection, the staging pool had no notification log destinations. No additional diagnostic emails should be sent without a reason or user request.

## Proposed change

Deploy [notification-logs.staging.json](../infrastructure/memberships/notification-logs.staging.json) as a **separate opt-in stack**. It creates one seven-day CloudWatch log group and one Cognito log-delivery configuration for pool `us-east-1_ELXorHpct` in account `108241940679`, region `us-east-1`. Both resources are conditional on that exact account and region. The membership deployment script does not include this template.

Only `userNotification` events at `ERROR` level are enabled. There is no authentication-activity export, request-body logging, verification-code logging, password logging, new Lambda logging, email resend, sender change or membership permission change. The destination uses `/aws/vendedlogs` and omits a customer-managed KMS key, as required by the [Cognito CloudWatch destination specification](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-properties-cognito-logdeliveryconfiguration-cloudwatchlogsconfiguration.html).

AWS controls the error payload, including a free-form `message.details` field. Its schema may change; do not describe those raw provider logs as guaranteed free of personal data. Keep access restricted to deployment operators. Diagnostic tools and reports must emit only timestamp, exact pool, fixed event source/level and an allowlisted error category. Never print raw details, recipients, codes, passwords, tokens or request bodies. An unrecognized error stays `unknown_notification_error` until privately reviewed.

These are best-effort error logs. They cannot recover earlier errors, prove successful inbox delivery, or replace a real verification/reset-email test. Notification-error logging does not require Cognito's Plus plan. [AWS notification logging documentation](https://docs.aws.amazon.com/cognito/latest/developerguide/exporting-quotas-and-usage.html).

## Review before deployment

The template passed AWS `validate-template` on September 29 but has not been deployed. These read-only checks establish the target and detect an existing configuration:

```bash
aws sts get-caller-identity --profile default --query Account --output text
aws cognito-idp get-log-delivery-configuration --profile default --region us-east-1 \
  --user-pool-id us-east-1_ELXorHpct --output json
aws cloudformation validate-template --profile default --region us-east-1 \
  --template-body file://infrastructure/memberships/notification-logs.staging.json
```

Require account `108241940679` and an empty `LogConfigurations` array immediately before initial deployment. Stop if another destination is configured: `SetLogDeliveryConfiguration` replaces the pool's configuration, so do not overwrite another export. Also inspect an existing stack or log group with the proposed names instead of adopting or replacing it blindly.

After approval, the concrete command is:

```bash
aws cloudformation deploy --profile default --region us-east-1 \
  --stack-name trace-memberships-staging-notification-errors \
  --template-file infrastructure/memberships/notification-logs.staging.json \
  --tags application=trace environment=staging purpose=notification-diagnostics
```

This command needs no IAM capability flag because the template creates no IAM role or policy resource. It still authorizes Cognito/CloudWatch to configure delivery; that can update an AWS-managed log-delivery resource policy. Verify the stack completes, read the pool's configuration back, and confirm the exact destination and seven-day retention. Absence of error events alone is not a passing email test. No deliberately bad emails or extra verification resends are part of deployment.

## Permissions and cleanup

Use deployment-operator permissions, never the membership Lambda role. Scope Cognito `GetLogDeliveryConfiguration` and `SetLogDeliveryConfiguration` to `arn:aws:cognito-idp:us-east-1:108241940679:userpool/us-east-1_ELXorHpct`. Scope log-group lifecycle, retention, tagging and later diagnostic reads to the exact staging destination wherever the service action supports resource scoping.

AWS also requires the CloudWatch delivery-management operations listed in its notification setup guide. `DescribeLogGroups`, `DescribeResourcePolicies` and `PutResourcePolicy` require account-level resources; do not pretend these permissions can all be constrained to a single group. Do not grant `logs:*`. AWS manages the delivery policy rather than this template inventing a service-principal or source-ARN policy. [CloudWatch service-log permissions](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/AWS-logs-infrastructure-CWL.html).

There is no retain policy: removing this isolated diagnostics stack removes its log group and delivery configuration. Inspect the current pool configuration before cleanup so a subsequently added export is not removed unexpectedly. Production needs its own explicit review; this staging-only template cannot configure a production pool.
