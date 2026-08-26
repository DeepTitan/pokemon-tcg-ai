# Trace cloud backup

Trace keeps SQLite as the offline source of truth. When a user explicitly enables cloud backup, the desktop app registers an anonymous per-install identity and sends reconstructed match reviews over HTTPS.

The AWS stack uses:

- API Gateway HTTP API for the desktop-facing endpoint
- Lambda for validation and per-install bearer authentication
- DynamoDB for device credentials and the match index
- a private, versioned S3 bucket for compressed review payloads

Data is encrypted in transit and at rest. The bucket blocks all public access, DynamoDB point-in-time recovery is enabled, and CloudFormation retains all three data resources if the stack is removed.

Deploy with:

```bash
AWS_PROFILE_NAME=default AWS_REGION_NAME=us-east-1 ./scripts/aws/deploy-trace-cloud.sh
```

The deploy script also sets the repository variable `TRACE_SYNC_API_URL`, which the semantic release workflow compiles into subsequent Trace builds.
