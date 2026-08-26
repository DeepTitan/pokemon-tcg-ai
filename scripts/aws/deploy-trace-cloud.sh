#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
AWS_PROFILE_NAME="${AWS_PROFILE_NAME:-default}"
AWS_REGION_NAME="${AWS_REGION_NAME:-us-east-1}"
STACK_NAME="${TRACE_STACK_NAME:-trace-production}"

ACCOUNT_ID="$(aws sts get-caller-identity --profile "$AWS_PROFILE_NAME" --query Account --output text)"
ARTIFACT_BUCKET="trace-cloudformation-${ACCOUNT_ID}-${AWS_REGION_NAME}"

if ! aws s3api head-bucket --profile "$AWS_PROFILE_NAME" --bucket "$ARTIFACT_BUCKET" 2>/dev/null; then
  if [[ "$AWS_REGION_NAME" == "us-east-1" ]]; then
    aws s3api create-bucket --profile "$AWS_PROFILE_NAME" --region "$AWS_REGION_NAME" --bucket "$ARTIFACT_BUCKET" >/dev/null
  else
    aws s3api create-bucket \
      --profile "$AWS_PROFILE_NAME" \
      --region "$AWS_REGION_NAME" \
      --bucket "$ARTIFACT_BUCKET" \
      --create-bucket-configuration "LocationConstraint=${AWS_REGION_NAME}" >/dev/null
  fi
fi

aws s3api put-public-access-block \
  --profile "$AWS_PROFILE_NAME" \
  --bucket "$ARTIFACT_BUCKET" \
  --public-access-block-configuration \
  'BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true'

PACKAGED_TEMPLATE="$(mktemp)"
trap 'rm -f "$PACKAGED_TEMPLATE"' EXIT

aws cloudformation package \
  --profile "$AWS_PROFILE_NAME" \
  --region "$AWS_REGION_NAME" \
  --template-file "$REPO_ROOT/infrastructure/aws/template.yml" \
  --s3-bucket "$ARTIFACT_BUCKET" \
  --s3-prefix trace-cloud \
  --output-template-file "$PACKAGED_TEMPLATE"

aws cloudformation deploy \
  --profile "$AWS_PROFILE_NAME" \
  --region "$AWS_REGION_NAME" \
  --template-file "$PACKAGED_TEMPLATE" \
  --stack-name "$STACK_NAME" \
  --capabilities CAPABILITY_IAM \
  --no-fail-on-empty-changeset \
  --tags app=trace environment=production

API_URL="$(aws cloudformation describe-stacks \
  --profile "$AWS_PROFILE_NAME" \
  --region "$AWS_REGION_NAME" \
  --stack-name "$STACK_NAME" \
  --query 'Stacks[0].Outputs[?OutputKey==`ApiUrl`].OutputValue | [0]' \
  --output text)"

gh variable set TRACE_SYNC_API_URL --repo DeepTitan/pokemon-tcg-ai --body "$API_URL"
printf 'Trace cloud API deployed: %s\n' "$API_URL"
