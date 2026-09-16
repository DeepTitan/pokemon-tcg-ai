import base64
import gzip
import importlib.util
import io
import json
import os
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch


class FakeClientError(Exception):
    def __init__(self, code):
        self.response = {"Error": {"Code": code, "Message": "private bucket and object details"}}


class FakeS3:
    def __init__(self):
        self.calls = []
        self.error = None
        self.content = gzip.compress(b'{"players":[],"matches":[]}')
        self.body = None
        self.metadata = {"contentsha256": "a" * 64}
        self.content_type = "application/json"

    def result(self, operation, kwargs):
        self.calls.append((operation, kwargs))
        if self.error:
            raise self.error
        result = {"ContentType": self.content_type, "ContentEncoding": "gzip", "ETag": '"b123"', "Metadata": self.metadata}
        if operation == "get":
            self.body = io.BytesIO(self.content)
            result["Body"] = self.body
        return result

    def get_object(self, **kwargs):
        return self.result("get", kwargs)

    def head_object(self, **kwargs):
        return self.result("head", kwargs)


def load_feed(client, environment=None):
    boto = types.ModuleType("boto3")
    boto.client = lambda service: client
    exceptions = types.ModuleType("botocore.exceptions")
    exceptions.ClientError = FakeClientError
    spec = importlib.util.spec_from_file_location("publicfeed", Path(__file__).parents[1] / "public-feed/publicfeed.py")
    module = importlib.util.module_from_spec(spec)
    with patch.dict(sys.modules, {"boto3": boto, "botocore": types.ModuleType("botocore"), "botocore.exceptions": exceptions}), patch.dict(os.environ, {"PAYLOAD_BUCKET": "private-trace-bucket", "SNAPSHOT_KEY": "leaderboard/snapshot.json.gz", **(environment or {})}):
        spec.loader.exec_module(module)
    return module


def event(method="GET", headers=None, path="/v1/leaderboard"):
    return {"rawPath": path, "requestContext": {"http": {"method": method}}, "headers": headers or {}}


class PublicFeedTests(unittest.TestCase):
    def setUp(self):
        self.s3 = FakeS3()
        self.feed = load_feed(self.s3)

    def test_get_returns_exact_gzip_and_content_etag(self):
        result = self.feed.handler(event(), None)
        self.assertEqual(result["statusCode"], 200)
        self.assertEqual(base64.b64decode(result["body"]), self.s3.content)
        self.assertEqual(result["headers"]["etag"], '"' + "a" * 64 + '"')
        self.assertTrue(result["isBase64Encoded"])
        self.assertTrue(self.s3.body.closed)

    def test_query_cannot_select_a_private_object(self):
        request = {**event(), "queryStringParameters": {"key": "devices/private/matches/secret.json.gz", "bucket": "other-bucket"}}
        self.feed.handler(request, None)
        self.assertEqual(self.s3.calls, [("get", {"Bucket": "private-trace-bucket", "Key": "leaderboard/snapshot.json.gz"})])
        self.assertEqual(self.feed.handler(event(path="/v1/matches/private"), None)["statusCode"], 404)
        self.assertEqual(len(self.s3.calls), 1)

    def test_head_reads_metadata_only(self):
        result = self.feed.handler(event("HEAD"), None)
        self.assertEqual(result["statusCode"], 200)
        self.assertEqual(result["body"], "")
        self.assertEqual(self.s3.calls[0][0], "head")

    def test_conditional_get_and_head_support_weak_list_and_wildcard(self):
        for method in ("GET", "HEAD"):
            for header in ('"' + "a" * 64 + '"', '"old", W/"' + "a" * 64 + '"', "*"):
                result = self.feed.handler(event(method, {"If-None-Match": header}), None)
                self.assertEqual(result["statusCode"], 304)
                self.assertEqual(result["body"], "")
        self.assertEqual(self.feed.handler(event(headers={"if-none-match": '"old"'}), None)["statusCode"], 200)

    def test_missing_and_failed_objects_reveal_no_internals(self):
        for code, status in (("NoSuchKey", 404), ("404", 404), ("AccessDenied", 503)):
            self.s3.error = FakeClientError(code)
            result = self.feed.handler(event(), None)
            self.assertEqual(result["statusCode"], status)
            self.assertEqual(result["headers"]["cache-control"], "no-store")
            self.assertNotIn("private", result["body"])
        self.s3.error = RuntimeError("credentials or private storage details")
        result = self.feed.handler(event(), None)
        self.assertEqual(result["statusCode"], 503)
        self.assertNotIn("credentials", result["body"])

    def test_wrong_content_is_not_served(self):
        self.s3.content_type = "application/octet-stream"
        self.assertEqual(self.feed.handler(event(), None)["statusCode"], 503)
        self.assertTrue(self.s3.body.closed)
        self.s3.content_type = "application/json"
        self.s3.content = b"private uncompressed payload"
        self.assertEqual(self.feed.handler(event(), None)["statusCode"], 503)

    def test_post_does_not_touch_storage(self):
        result = self.feed.handler(event("POST"), None)
        self.assertEqual(result["statusCode"], 405)
        self.assertEqual(result["headers"]["allow"], "GET, HEAD")
        self.assertEqual(self.s3.calls, [])

    def test_configuration_cannot_expand_object_access(self):
        with self.assertRaisesRegex(RuntimeError, "invalid_snapshot_configuration"):
            load_feed(self.s3, {"SNAPSHOT_KEY": "devices/private.json.gz"})

    def test_s3_etag_is_used_when_content_hash_is_absent(self):
        self.s3.metadata = {}
        self.assertEqual(self.feed.handler(event(), None)["headers"]["etag"], '"b123"')


if __name__ == "__main__":
    unittest.main()
