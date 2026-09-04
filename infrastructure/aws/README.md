# Trace cloud backup

Trace keeps SQLite as the offline source of truth and automatically mirrors reconstructed match reviews over HTTPS. Each installation uses an anonymous device identity. Upload failures never interrupt local capture: an on-device outbox retries them with backoff, and the first release with this behavior queues existing reconstructed matches for backfill.

Match payloads include the player names and game actions needed to replay a match. This automatic backup is disclosed in Trace's capture setup rather than presented as an optional setting.

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
