"""Offline contract tests: no AWS credentials, network, or captured-game uploads."""
import base64
import copy
import gzip
import importlib.util
import io
import json
import os
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import Mock, patch


class ClientError(Exception):
    def __init__(self, code):
        self.response = {"Error": {"Code": code}}
        super().__init__(code)


def load_app():
    # Stub only SDK initialization; every table/object operation below is an
    # explicit in-memory fake. Accidentally calling a real AWS client is impossible.
    boto = types.ModuleType("boto3")
    boto.resource = Mock()
    boto.client = Mock()
    exceptions = types.ModuleType("botocore.exceptions")
    exceptions.ClientError = ClientError
    conditions = types.ModuleType("boto3.dynamodb.conditions")
    conditions.Key = Mock()
    modules = {"boto3": boto, "botocore": types.ModuleType("botocore"),
               "botocore.exceptions": exceptions,
               "boto3.dynamodb": types.ModuleType("boto3.dynamodb"),
               "boto3.dynamodb.conditions": conditions}
    env = {name: name for name in ("DEVICES_TABLE", "MATCHES_TABLE", "SHARES_TABLE", "PAYLOAD_BUCKET")}
    spec = importlib.util.spec_from_file_location("trace_cloud_test_app", Path(__file__).parents[1] / "lambda/app.py")
    app = importlib.util.module_from_spec(spec)
    with patch.dict(sys.modules, modules), patch.dict(os.environ, env):
        spec.loader.exec_module(app)
    return app


app = load_app()


class Table:
    def __init__(self, *keys):
        self.keys = keys
        self.items = {}

    def key(self, value):
        return tuple(value[key] for key in self.keys)

    def get_item(self, *, Key, **_):
        item = self.items.get(self.key(Key))
        return {"Item": copy.deepcopy(item)} if item else {}

    def put_item(self, *, Item, ConditionExpression=None):
        key = self.key(Item)
        if ConditionExpression and key in self.items:
            raise ClientError("ConditionalCheckFailedException")
        self.items[key] = copy.deepcopy(Item)
        return {}

    def update_item(self, *, Key, UpdateExpression, ExpressionAttributeValues,
                    ExpressionAttributeNames=None, ConditionExpression=None, **_):
        key = self.key(Key)
        item = self.items.get(key)
        values = ExpressionAttributeValues
        if ConditionExpression:
            can_create = "attribute_not_exists(shareId)" in ConditionExpression
            if (not item and not can_create) or (item and (
                    item.get("deviceId") != values[":device"] or item.get("matchId") != values[":match"])):
                raise ClientError("ConditionalCheckFailedException")
        item = copy.deepcopy(item or Key)
        if "if_not_exists(createdAt" in UpdateExpression:
            item.update(deviceId=values[":device"], matchId=values[":match"])
            item.setdefault("createdAt", values[":created"])
        else:
            names = ExpressionAttributeNames or {}
            for assignment in UpdateExpression.removeprefix("SET ").split(", "):
                field, placeholder = assignment.split(" = ")
                item[names.get(field, field)] = copy.deepcopy(values[placeholder])
        self.items[key] = item
        return {"Attributes": copy.deepcopy(item)}


class Objects:
    def __init__(self):
        self.versions = {}
        self.latest = {}
        self.reads = []
        self.writes = []

    def put_object(self, **request):
        self.writes.append(request)
        version = str(len(self.writes))
        key = request["Key"]
        self.versions[(key, version)] = request["Body"]
        self.latest[key] = version
        return {"VersionId": version}

    def get_object(self, **request):
        self.reads.append(request)
        key = request["Key"]
        version = request.get("VersionId", self.latest.get(key))
        if (key, version) not in self.versions:
            raise ClientError("NoSuchVersion")
        return {"Body": io.BytesIO(self.versions[(key, version)]), "VersionId": version}


def decode(response):
    return json.loads(gzip.decompress(base64.b64decode(response["body"])))


class SharedReplayTests(unittest.TestCase):
    def setUp(self):
        app.matches = Table("deviceId", "matchId")
        app.shares = Table("shareId")
        app.devices = Table("deviceId")
        app.s3 = Objects()
        self.device = "trace-device-test-001"
        self.match = "match-1"
        self.review = {"id": self.match, "source": "live-network", "localPlayer": "Player A",
                       "opponent": "Player B", "winner": "Player A", "decklists": {"Player A": ["card"]},
                       "turns": [{"index": 0, "snapshot": {"hand": ["私のカード"]}, "canonical": {"turn": 1}},
                                 {"index": 1, "snapshot": {"hand": []}, "canonical": {"turn": 2}}]}
        self.upload()

    def item(self):
        return app.matches.get_item(Key={"deviceId": self.device, "matchId": self.match})["Item"]

    def upload(self):
        return app.put_match(self.device, self.match, {"body": json.dumps({"review": self.review, "reducerVersion": 11})})

    def share(self, summary=None):
        response = app.share_match(self.device, self.match, {"body": json.dumps({"summary": summary})})
        self.share_id = json.loads(response["body"])["shareId"]
        return response

    def prepared(self):
        return app.shares.get_item(Key={"shareId": self.share_id})["Item"]["preparedReplay"]

    def test_private_upload_and_retrieval_unchanged(self):
        self.assertEqual(len(app.s3.writes), 1)
        self.assertEqual(app.shares.items, {})
        result = app.get_match(self.device, self.match)
        self.assertEqual(result["headers"]["cache-control"], "no-store")
        self.assertEqual(decode(result)["review"], self.review)

    def test_share_prepares_complete_payload_before_returning(self):
        self.assertEqual(self.share()["statusCode"], 200)
        self.assertEqual(len(app.s3.writes), 2)
        prepared = self.prepared()
        self.assertTrue(prepared["objectVersionId"])
        stored = app.s3.writes[-1]
        self.assertEqual(stored["ServerSideEncryption"], "AES256")
        self.assertEqual(stored["ContentEncoding"], "gzip")
        payload = json.loads(gzip.decompress(stored["Body"]))
        self.assertEqual(payload, {"review": self.review, "summary": app.public_summary(self.item()),
                                   "reducerVersion": 11, "updatedAt": self.item()["updatedAt"]})
        self.assertNotIn("deviceId", payload)
        self.assertNotIn("objectKey", payload["summary"])

    def test_prepared_get_does_no_replay_decode_or_compression(self):
        self.share()
        app.s3.reads.clear()
        with patch.object(app.gzip, "decompress", side_effect=AssertionError("decoded replay")), \
             patch.object(app.gzip, "compress", side_effect=AssertionError("compressed replay")), \
             patch.object(app.json, "loads", side_effect=AssertionError("parsed replay")):
            result = app.get_shared_match(self.share_id)
        self.assertEqual(decode(result)["review"], self.review)
        self.assertEqual(len(app.s3.reads), 1)
        self.assertEqual(app.s3.reads[0]["VersionId"], self.prepared()["objectVersionId"])
        self.assertEqual(result["headers"]["cache-control"], "private, no-cache")

    def test_repeated_share_preserves_prepared_copy(self):
        first = self.share()
        prepared = self.prepared()
        app.s3.reads.clear()
        self.assertEqual(self.share(), first)
        self.assertEqual(self.prepared(), prepared)
        self.assertEqual(app.s3.reads, [])
        self.assertEqual(len(app.s3.writes), 2)

    def test_matching_etag_skips_s3_and_checks_weak_and_list_validators(self):
        self.share()
        etag = self.prepared()["etag"]
        for value in (etag, f"W/{etag}", f'"old", {etag}', "*"):
            app.s3.reads.clear()
            result = app.get_shared_match(self.share_id, request_headers={"If-None-Match": value})
            self.assertEqual(result["statusCode"], 304)
            self.assertEqual(result["body"], "")
            self.assertEqual(app.s3.reads, [])

    def test_wrong_etag_returns_complete_payload(self):
        self.share()
        self.assertEqual(app.get_shared_match(self.share_id, request_headers={"if-none-match": '"old"'})["statusCode"], 200)

    def test_revoked_or_missing_links_never_return_cached_success(self):
        self.share()
        app.shares.items.clear()
        result = app.get_shared_match(self.share_id, request_headers={"if-none-match": "*"})
        self.assertEqual(result["statusCode"], 404)
        self.assertEqual(result["headers"]["cache-control"], "no-store")

    def test_missing_match_fails_closed(self):
        self.share()
        app.matches.items.clear()
        self.assertEqual(app.get_shared_match(self.share_id)["statusCode"], 404)

    def test_changed_upload_prepares_fresh_bytes_before_acknowledgement(self):
        self.share()
        old_etag = self.prepared()["etag"]
        self.review["turns"].append({"index": 2, "snapshot": {"winner": "Player A"}})
        self.assertEqual(self.upload()["statusCode"], 200)
        self.assertEqual(len(app.s3.writes), 4)
        self.assertNotEqual(self.prepared()["etag"], old_etag)
        result = app.get_shared_match(self.share_id, request_headers={"if-none-match": old_etag})
        self.assertEqual(result["statusCode"], 200)
        self.assertEqual(decode(result)["review"], self.review)

    def test_changed_share_metadata_invalidates_prepared_response(self):
        self.share()
        old_etag = self.prepared()["etag"]
        self.share({"localRating": 1800})
        self.assertNotEqual(self.prepared()["etag"], old_etag)
        self.assertEqual(decode(app.get_shared_match(self.share_id))["summary"]["localRating"], 1800)
        writes = len(app.s3.writes)
        self.share({"localRating": 1800})
        self.assertEqual(len(app.s3.writes), writes)

    def test_legacy_link_prepares_once_without_changing_id(self):
        self.share_id = "legacy-share-abcdefghijkl"
        item = self.item()
        item.pop("objectVersionId")
        app.matches.put_item(Item=item)
        app.shares.put_item(Item={"shareId": self.share_id, "deviceId": self.device, "matchId": self.match})
        self.assertEqual(decode(app.get_shared_match(self.share_id))["review"], self.review)
        writes = len(app.s3.writes)
        app.get_shared_match(self.share_id)
        self.assertEqual(len(app.s3.writes), writes)

    def test_missing_prepared_version_is_repaired(self):
        self.share()
        prepared = self.prepared()
        del app.s3.versions[(prepared["objectKey"], prepared["objectVersionId"])]
        self.assertEqual(decode(app.get_shared_match(self.share_id))["review"], self.review)
        self.assertNotEqual(self.prepared()["objectVersionId"], prepared["objectVersionId"])
        self.assertEqual(self.prepared()["etag"], prepared["etag"])

    def test_access_errors_are_not_silently_treated_as_cache_misses(self):
        self.share()
        writes = len(app.s3.writes)
        with patch.object(app.s3, "get_object", side_effect=ClientError("AccessDenied")):
            with self.assertRaises(ClientError):
                app.get_shared_match(self.share_id)
        self.assertEqual(len(app.s3.writes), writes)

    def test_failed_refresh_can_retry_without_losing_the_saved_game(self):
        self.share()
        self.review["winner"] = "Player B"
        write = app.s3.put_object
        def fail_prepared(**request):
            if "/shared-replays/" in request["Key"]:
                raise RuntimeError("prepared write failed")
            return write(**request)
        with patch.object(app.s3, "put_object", side_effect=fail_prepared):
            with self.assertRaisesRegex(RuntimeError, "prepared write failed"):
                self.upload()
        self.assertEqual(decode(app.get_match(self.device, self.match))["review"], self.review)
        self.assertEqual(self.upload()["statusCode"], 200)
        self.assertEqual(decode(app.get_shared_match(self.share_id))["review"], self.review)

    def test_stale_prepared_pointer_does_not_serve_old_replay(self):
        self.share()
        old = self.prepared()
        self.review["winner"] = "Player B"
        self.upload()
        app.shares.items[(self.share_id,)]["preparedReplay"] = old
        self.assertEqual(decode(app.get_shared_match(self.share_id))["review"]["winner"], "Player B")

    def test_artifact_reads_are_version_pinned(self):
        self.share()
        original = app.s3.writes[-1]
        app.s3.put_object(**{**original, "Body": gzip.compress(b'{"wrong":"version"}')})
        self.assertEqual(decode(app.get_shared_match(self.share_id))["review"], self.review)

    def test_source_reads_are_version_pinned(self):
        source = app.s3.writes[0]
        app.s3.put_object(**{**source, "Body": gzip.compress(b'{"wrong":"version"}')})
        self.share()
        self.assertEqual(decode(app.get_shared_match(self.share_id))["review"], self.review)

    def test_summary_only_stays_small_and_separate(self):
        self.share({"localPlayer": "Player A", "opponent": "Player B", "finalSnapshot": {"players": {
            "Player A": {"active": {"cardId": "sv6_130", "name": "Dragapult ex", "maxHp": 320}},
            "Player B": {"active": {"cardId": "sv6_130", "name": "Dragapult ex", "maxHp": 320}},
        }}})
        app.s3.reads.clear()
        result = app.get_shared_match(self.share_id, summary_only=True)
        self.assertNotIn("review", json.loads(result["body"]))
        self.assertEqual(app.s3.reads, [])
        self.assertEqual(result["headers"]["cache-control"], "no-store")

    def test_share_does_not_return_a_link_when_preparation_fails(self):
        with patch.object(app.s3, "put_object", side_effect=RuntimeError("storage unavailable")):
            with self.assertRaisesRegex(RuntimeError, "storage unavailable"):
                self.share()
        self.assertEqual(self.share()["statusCode"], 200)
        self.assertTrue(self.prepared())

    def test_unversioned_artifact_storage_is_rejected(self):
        with patch.object(app.s3, "put_object", return_value={}):
            with self.assertRaisesRegex(RuntimeError, "versioned storage"):
                self.share()

    def test_wrong_share_owner_cannot_be_overwritten(self):
        self.share()
        app.shares.items[(self.share_id,)]["deviceId"] = "another-device"
        with self.assertRaises(ClientError):
            self.share()
        self.assertEqual(app.shares.items[(self.share_id,)]["deviceId"], "another-device")

    def test_private_route_still_requires_authentication(self):
        result = app.handler({"requestContext": {"http": {"method": "GET"}},
                              "rawPath": "/v1/matches/match-1", "pathParameters": {"matchId": self.match}}, None)
        self.assertEqual(result["statusCode"], 401)

    def test_public_handler_passes_cache_validator(self):
        self.share()
        result = app.handler({"requestContext": {"http": {"method": "GET"}},
                              "rawPath": f"/v1/shares/{self.share_id}",
                              "pathParameters": {"shareId": self.share_id},
                              "headers": {"if-none-match": self.prepared()["etag"]}}, None)
        self.assertEqual(result["statusCode"], 304)


if __name__ == "__main__":
    unittest.main()
