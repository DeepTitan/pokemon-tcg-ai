import base64
import datetime as dt
import gzip
import hashlib
import hmac
import json
import os
import re
import secrets

import boto3
from boto3.dynamodb.conditions import Key


DEVICES_TABLE = os.environ["DEVICES_TABLE"]
MATCHES_TABLE = os.environ["MATCHES_TABLE"]
PAYLOAD_BUCKET = os.environ["PAYLOAD_BUCKET"]
DEVICE_ID = re.compile(r"^[A-Za-z0-9._-]{16,128}$")
MATCH_ID = re.compile(r"^[A-Za-z0-9._:-]{1,220}$")

dynamodb = boto3.resource("dynamodb")
devices = dynamodb.Table(DEVICES_TABLE)
matches = dynamodb.Table(MATCHES_TABLE)
s3 = boto3.client("s3")


def handler(event, _context):
    method = event.get("requestContext", {}).get("http", {}).get("method", "")
    path = event.get("rawPath", "")
    try:
        if method == "POST" and path == "/v1/register":
            return register(event)

        identity = authorize(event)
        if not identity:
            return response(401, {"error": "unauthorized"})

        if method == "GET" and path == "/v1/matches":
            return list_matches(identity)

        match_id = (event.get("pathParameters") or {}).get("matchId", "")
        if not MATCH_ID.fullmatch(match_id):
            return response(400, {"error": "invalid_match_id"})
        if method == "PUT":
            return put_match(identity, match_id, event)
        if method == "GET":
            return get_match(identity, match_id)
        return response(404, {"error": "not_found"})
    except ValueError as error:
        return response(400, {"error": str(error)})
    except Exception as error:  # Lambda logs retain the real error; clients get no internals.
        print(json.dumps({"level": "error", "type": type(error).__name__, "message": str(error)}))
        return response(500, {"error": "internal_error"})


def register(event):
    body = read_json(event)
    device_id = body.get("deviceId", "")
    if not isinstance(device_id, str) or not DEVICE_ID.fullmatch(device_id):
        raise ValueError("invalid_device_id")

    token = secrets.token_urlsafe(36)
    now = timestamp()
    devices.put_item(Item={
        "deviceId": device_id,
        "tokenHash": digest(token),
        "createdAt": now,
        "updatedAt": now,
    })
    return response(201, {"deviceId": device_id, "token": token})


def authorize(event):
    headers = {str(key).lower(): value for key, value in (event.get("headers") or {}).items()}
    device_id = headers.get("x-trace-device", "")
    authorization = headers.get("authorization", "")
    if not DEVICE_ID.fullmatch(device_id) or not authorization.startswith("Bearer "):
        return None
    token = authorization[7:].strip()
    if not token:
        return None
    item = devices.get_item(Key={"deviceId": device_id}, ConsistentRead=True).get("Item")
    if not item or not hmac.compare_digest(item.get("tokenHash", ""), digest(token)):
        return None
    devices.update_item(
        Key={"deviceId": device_id},
        UpdateExpression="SET lastSeenAt = :now",
        ExpressionAttributeValues={":now": timestamp()},
    )
    return device_id


def put_match(device_id, match_id, event):
    body = read_json(event)
    review = body.get("review")
    reducer_version = body.get("reducerVersion")
    if not isinstance(review, dict) or review.get("id") != match_id:
        raise ValueError("review_id_mismatch")
    if not isinstance(reducer_version, int) or reducer_version < 0:
        raise ValueError("invalid_reducer_version")

    encoded = json.dumps(review, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    compressed = gzip.compress(encoded, compresslevel=6)
    object_key = f"devices/{device_id}/matches/{hashlib.sha256(match_id.encode()).hexdigest()}.json.gz"
    now = timestamp()
    s3.put_object(
        Bucket=PAYLOAD_BUCKET,
        Key=object_key,
        Body=compressed,
        ContentType="application/json",
        ContentEncoding="gzip",
        ServerSideEncryption="AES256",
        Metadata={"trace-match-id-sha256": hashlib.sha256(match_id.encode()).hexdigest()},
    )

    summary = match_summary(review)
    item = {
        "deviceId": device_id,
        "matchId": match_id,
        "objectKey": object_key,
        "updatedAt": now,
        "payloadBytes": len(compressed),
        "reducerVersion": reducer_version,
        **summary,
    }
    matches.put_item(Item=item)
    return response(200, public_summary(item))


def list_matches(device_id):
    items = matches.query(
        KeyConditionExpression=Key("deviceId").eq(device_id),
        ConsistentRead=True,
    ).get("Items", [])
    items.sort(key=lambda item: item.get("importedAt", item.get("updatedAt", "")), reverse=True)
    return response(200, {"matches": [public_summary(item) for item in items]})


def get_match(device_id, match_id):
    item = matches.get_item(
        Key={"deviceId": device_id, "matchId": match_id},
        ConsistentRead=True,
    ).get("Item")
    if not item:
        return response(404, {"error": "match_not_found"})
    stored = s3.get_object(Bucket=PAYLOAD_BUCKET, Key=item["objectKey"])["Body"].read()
    review = json.loads(gzip.decompress(stored))
    return response(200, {
        "review": review,
        "reducerVersion": int(item.get("reducerVersion", 0)),
        "updatedAt": item.get("updatedAt"),
    })


def match_summary(review):
    turns = review.get("turns") if isinstance(review.get("turns"), list) else []
    return clean({
        "importedAt": review.get("importedAt"),
        "source": review.get("source"),
        "localPlayer": review.get("localPlayer"),
        "opponent": review.get("opponent"),
        "winner": review.get("winner"),
        "turnCount": len(turns),
    })


def public_summary(item):
    return clean({
        "id": item.get("matchId"),
        "importedAt": item.get("importedAt"),
        "source": item.get("source"),
        "localPlayer": item.get("localPlayer"),
        "opponent": item.get("opponent"),
        "winner": item.get("winner"),
        "turnCount": int(item.get("turnCount", 0)),
        "reducerVersion": int(item.get("reducerVersion", 0)),
        "updatedAt": item.get("updatedAt"),
    })


def read_json(event):
    raw = event.get("body") or "{}"
    if event.get("isBase64Encoded"):
        raw = base64.b64decode(raw).decode("utf-8")
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as error:
        raise ValueError("invalid_json") from error
    if not isinstance(data, dict):
        raise ValueError("invalid_json_object")
    return data


def response(status, body):
    return {
        "statusCode": status,
        "headers": {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store",
            "x-content-type-options": "nosniff",
        },
        "body": json.dumps(body, separators=(",", ":"), ensure_ascii=False),
    }


def digest(value):
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def timestamp():
    return dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z")


def clean(mapping):
    return {key: value for key, value in mapping.items() if value is not None}
