"""Read the one server-derived public snapshot; never read private match objects."""
import base64
import json
import os
import re

import boto3
from botocore.exceptions import ClientError

PAYLOAD_BUCKET = os.environ["PAYLOAD_BUCKET"]
SNAPSHOT_KEY = "leaderboard/snapshot.json.gz"
# Fail closed if infrastructure accidentally points at another object.
if os.environ.get("SNAPSHOT_KEY", SNAPSHOT_KEY) != SNAPSHOT_KEY:
    raise RuntimeError("invalid_snapshot_configuration")

s3 = boto3.client("s3")


def error_response(status, code, method="GET"):
    return {
        "statusCode": status,
        "headers": {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store",
            "x-content-type-options": "nosniff",
        },
        "body": "" if method == "HEAD" else json.dumps({"error": code}, separators=(",", ":")),
    }


def snapshot_etag(snapshot):
    generation = snapshot.get("Metadata", {}).get("contentsha256", "")
    if re.fullmatch(r"[a-f0-9]{64}", generation):
        return f'"{generation}"'
    etag = snapshot.get("ETag", "")
    return etag if re.fullmatch(r'"[a-fA-F0-9-]+"', etag) else None


def matches_etag(header, etag):
    if not isinstance(header, str) or not etag:
        return False
    # GET and HEAD use weak comparison under If-None-Match.
    return any(value.strip().removeprefix("W/") in ("*", etag) for value in header.split(","))


def handler(event, _context):
    method = event.get("requestContext", {}).get("http", {}).get("method", "")
    if event.get("rawPath") != "/v1/leaderboard":
        return error_response(404, "not_found", method)
    if method not in ("GET", "HEAD"):
        result = error_response(405, "method_not_allowed", method)
        result["headers"]["allow"] = "GET, HEAD"
        return result

    body = None
    try:
        operation = s3.head_object if method == "HEAD" else s3.get_object
        snapshot = operation(Bucket=PAYLOAD_BUCKET, Key=SNAPSHOT_KEY)
        body = snapshot.get("Body")
        if snapshot.get("ContentType") != "application/json" or snapshot.get("ContentEncoding") != "gzip":
            return error_response(503, "leaderboard_unavailable", method)

        etag = snapshot_etag(snapshot)
        headers = {
            "content-type": "application/json; charset=utf-8",
            "content-encoding": "gzip",
            "cache-control": "public, max-age=0, must-revalidate",
            "x-content-type-options": "nosniff",
        }
        if etag:
            headers["etag"] = etag
        request_headers = {str(key).lower(): value for key, value in (event.get("headers") or {}).items()}
        if matches_etag(request_headers.get("if-none-match"), etag):
            return {"statusCode": 304, "headers": headers, "body": ""}
        if method == "HEAD":
            return {"statusCode": 200, "headers": headers, "body": ""}

        compressed = body.read()
        if not compressed.startswith(b"\x1f\x8b"):
            return error_response(503, "leaderboard_unavailable", method)
        return {
            "statusCode": 200,
            "isBase64Encoded": True,
            "headers": headers,
            "body": base64.b64encode(compressed).decode("ascii"),
        }
    except ClientError as error:
        code = error.response.get("Error", {}).get("Code")
        if code in ("NoSuchKey", "NotFound", "404"):
            return error_response(404, "leaderboard_not_ready", method)
        print(json.dumps({"level": "error", "event": "leaderboard_snapshot_read_failed"}))
        return error_response(503, "leaderboard_unavailable", method)
    except Exception:
        print(json.dumps({"level": "error", "event": "leaderboard_snapshot_read_failed"}))
        return error_response(503, "leaderboard_unavailable", method)
    finally:
        if body is not None:
            body.close()
