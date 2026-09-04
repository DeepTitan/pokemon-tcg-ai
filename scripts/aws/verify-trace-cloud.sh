#!/usr/bin/env bash
set -euo pipefail

AWS_PROFILE_NAME="${AWS_PROFILE_NAME:-default}"
AWS_REGION_NAME="${AWS_REGION_NAME:-us-east-1}"
STACK_NAME="${TRACE_STACK_NAME:-trace-production}"

command -v aws >/dev/null
command -v curl >/dev/null
command -v gzip >/dev/null
command -v jq >/dev/null

stack_output() {
  aws cloudformation describe-stacks \
    --profile "$AWS_PROFILE_NAME" \
    --region "$AWS_REGION_NAME" \
    --stack-name "$STACK_NAME" \
    --query "Stacks[0].Outputs[?OutputKey==\`$1\`].OutputValue | [0]" \
    --output text
}

API_URL="$(stack_output ApiUrl)"
DEVICES_TABLE="$(stack_output DevicesTable)"
MATCHES_TABLE="$(stack_output MatchesTable)"
PAYLOAD_BUCKET="$(stack_output PayloadBucket)"
DEVICE_ID="trace-e2e-$(uuidgen | tr '[:upper:]' '[:lower:]')"
MATCH_ID="trace-e2e-$(date -u +%Y%m%dT%H%M%SZ)-${RANDOM}"
WORK_DIR="$(mktemp -d)"
OBJECT_KEY=""

cleanup() {
  if [[ -n "$OBJECT_KEY" ]]; then
    aws s3api list-object-versions --profile "$AWS_PROFILE_NAME" --region "$AWS_REGION_NAME" \
      --bucket "$PAYLOAD_BUCKET" --prefix "$OBJECT_KEY" > "$WORK_DIR/s3-versions.json" 2>/dev/null || true
    jq --arg key "$OBJECT_KEY" \
      '{Objects: (([.Versions[]? | select(.Key == $key)] + [.DeleteMarkers[]? | select(.Key == $key)]) | map({Key, VersionId})), Quiet: true}' \
      "$WORK_DIR/s3-versions.json" > "$WORK_DIR/s3-delete.json" 2>/dev/null || true
    if jq -e '.Objects | length > 0' "$WORK_DIR/s3-delete.json" >/dev/null 2>&1; then
      aws s3api delete-objects --profile "$AWS_PROFILE_NAME" --region "$AWS_REGION_NAME" \
        --bucket "$PAYLOAD_BUCKET" --delete "file://$WORK_DIR/s3-delete.json" >/dev/null 2>&1 || true
    fi
  fi
  aws dynamodb delete-item --profile "$AWS_PROFILE_NAME" --region "$AWS_REGION_NAME" \
    --table-name "$MATCHES_TABLE" \
    --key "$(jq -cn --arg device "$DEVICE_ID" --arg match "$MATCH_ID" '{deviceId:{S:$device},matchId:{S:$match}}')" \
    >/dev/null 2>&1 || true
  aws dynamodb delete-item --profile "$AWS_PROFILE_NAME" --region "$AWS_REGION_NAME" \
    --table-name "$DEVICES_TABLE" \
    --key "$(jq -cn --arg device "$DEVICE_ID" '{deviceId:{S:$device}}')" \
    >/dev/null 2>&1 || true
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

jq -cn --arg device "$DEVICE_ID" '{deviceId:$device}' > "$WORK_DIR/register-request.json"
REGISTER_STATUS="$(curl --silent --show-error --output "$WORK_DIR/register-response.json" \
  --write-out '%{http_code}' --header 'content-type: application/json' \
  --data-binary "@$WORK_DIR/register-request.json" "$API_URL/v1/register")"
test "$REGISTER_STATUS" = "201"
TOKEN="$(jq -er '.token | select(length > 20)' "$WORK_DIR/register-response.json")"

UNAUTHORIZED_STATUS="$(curl --silent --show-error --output "$WORK_DIR/unauthorized-response.json" \
  --write-out '%{http_code}' --header "x-trace-device: $DEVICE_ID" \
  --header 'authorization: Bearer invalid-test-token' "$API_URL/v1/matches")"
test "$UNAUTHORIZED_STATUS" = "401"

IMPORTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
jq -cn --arg id "$MATCH_ID" --arg importedAt "$IMPORTED_AT" \
  '{review:{id:$id,importedAt:$importedAt,source:"trace-cloud-e2e",localPlayer:"Trace Tester",opponent:"Cloud Verify",winner:"Trace Tester",turns:[{number:1,actions:[]}]},reducerVersion:999}' \
  > "$WORK_DIR/put-request.json"
gzip -c "$WORK_DIR/put-request.json" > "$WORK_DIR/put-request.json.gz"

PUT_STATUS="$(curl --silent --show-error --output "$WORK_DIR/put-response.json" \
  --write-out '%{http_code}' --request PUT --header 'content-type: application/json' \
  --header 'content-encoding: gzip' \
  --header "x-trace-device: $DEVICE_ID" --header "authorization: Bearer $TOKEN" \
  --data-binary "@$WORK_DIR/put-request.json.gz" "$API_URL/v1/matches/$MATCH_ID")"
test "$PUT_STATUS" = "200"
jq -e --arg id "$MATCH_ID" '.id == $id and .turnCount == 1 and .reducerVersion == 999' \
  "$WORK_DIR/put-response.json" >/dev/null

curl --fail --silent --show-error --header "x-trace-device: $DEVICE_ID" \
  --header "authorization: Bearer $TOKEN" "$API_URL/v1/matches" > "$WORK_DIR/list-response.json"
jq -e --arg id "$MATCH_ID" '.matches | any(.id == $id and .turnCount == 1)' \
  "$WORK_DIR/list-response.json" >/dev/null

curl --fail --silent --show-error --header "x-trace-device: $DEVICE_ID" \
  --header "authorization: Bearer $TOKEN" "$API_URL/v1/matches/$MATCH_ID" > "$WORK_DIR/get-response.json"
jq -e --arg id "$MATCH_ID" \
  '.review.id == $id and .review.source == "trace-cloud-e2e" and .reducerVersion == 999' \
  "$WORK_DIR/get-response.json" >/dev/null

aws dynamodb get-item --profile "$AWS_PROFILE_NAME" --region "$AWS_REGION_NAME" \
  --table-name "$MATCHES_TABLE" --consistent-read \
  --key "$(jq -cn --arg device "$DEVICE_ID" --arg match "$MATCH_ID" '{deviceId:{S:$device},matchId:{S:$match}}')" \
  > "$WORK_DIR/dynamodb-item.json"
OBJECT_KEY="$(jq -er '.Item.objectKey.S' "$WORK_DIR/dynamodb-item.json")"

aws s3api head-object --profile "$AWS_PROFILE_NAME" --region "$AWS_REGION_NAME" \
  --bucket "$PAYLOAD_BUCKET" --key "$OBJECT_KEY" > "$WORK_DIR/s3-object.json"
jq -e '.ServerSideEncryption == "AES256" and .ContentEncoding == "gzip"' \
  "$WORK_DIR/s3-object.json" >/dev/null

printf 'Trace cloud verification passed: auth, upload, list, retrieval, DynamoDB, and encrypted S3.\n'
