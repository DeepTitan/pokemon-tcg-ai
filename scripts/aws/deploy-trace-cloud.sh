#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
AWS_PROFILE_NAME="${AWS_PROFILE_NAME:-default}"
AWS_REGION_NAME="${AWS_REGION_NAME:-us-east-1}"
STACK_NAME="${TRACE_STACK_NAME:-trace-production}"

# Fail before accessing AWS if the read/write/privacy contracts regress.
python3 -m unittest discover -s "$REPO_ROOT/infrastructure/aws/tests" -v
python3 "$REPO_ROOT/infrastructure/aws/deploy_parameters.py" --validate-input

DEPLOY_WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$DEPLOY_WORK_DIR"' EXIT
EXISTING_PARAMETERS="$DEPLOY_WORK_DIR/parameters.json"
if aws cloudformation describe-stacks --profile "$AWS_PROFILE_NAME" --region "$AWS_REGION_NAME" \
  --stack-name "$STACK_NAME" --query 'Stacks[0].Parameters' --output json \
  >"$EXISTING_PARAMETERS" 2>"$DEPLOY_WORK_DIR/describe-error"; then
  :
else
  DESCRIBE_ERROR="$(cat "$DEPLOY_WORK_DIR/describe-error")"
  if [[ "$DESCRIBE_ERROR" == *ValidationError* && "$DESCRIBE_ERROR" == *"does not exist"* ]]; then
    printf '[]\n' >"$EXISTING_PARAMETERS"
  else
    printf 'Could not inspect the existing capture stack. Check AWS login and permissions; nothing deployed.\n' >&2
    exit 1
  fi
fi
OVERRIDE_LINES="$(python3 "$REPO_ROOT/infrastructure/aws/deploy_parameters.py" "$EXISTING_PARAMETERS" --stack-name "$STACK_NAME")"
EFFECTIVE_ENVIRONMENT="$(python3 "$REPO_ROOT/infrastructure/aws/deploy_parameters.py" "$EXISTING_PARAMETERS" --stack-name "$STACK_NAME" --environment)"
PARAMETER_ARGS=()
if [[ -n "$OVERRIDE_LINES" ]]; then
  PARAMETER_ARGS+=(--parameter-overrides)
  while IFS= read -r parameter; do
    PARAMETER_ARGS+=("$parameter")
  done <<<"$OVERRIDE_LINES"
fi

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

PACKAGED_TEMPLATE="$DEPLOY_WORK_DIR/packaged.yml"

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
  ${PARAMETER_ARGS[@]+"${PARAMETER_ARGS[@]}"} \
  --tags app=trace "environment=$EFFECTIVE_ENVIRONMENT"

API_URL="$(aws cloudformation describe-stacks \
  --profile "$AWS_PROFILE_NAME" \
  --region "$AWS_REGION_NAME" \
  --stack-name "$STACK_NAME" \
  --query 'Stacks[0].Outputs[?OutputKey==`ApiUrl`].OutputValue | [0]' \
  --output text)"

if [[ "${TRACE_PUBLISH_RELEASE_API:-false}" == 'true' ]]; then
  gh variable set TRACE_SYNC_API_URL --repo DeepTitan/pokemon-tcg-ai --body "$API_URL"
fi
printf 'Trace cloud API deployed: %s\n' "$API_URL"
