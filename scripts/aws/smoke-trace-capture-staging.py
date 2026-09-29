#!/usr/bin/env python3
"""Synthetic capture smoke test. Offline by default; never targets production.

Save the named stack's `aws cloudformation describe-stacks` JSON, then run:
  python3 scripts/aws/smoke-trace-capture-staging.py \
    --stack-description /tmp/trace-staging-stack.json --enforcement enabled
Add --execute only after reviewing the printed staging targets. Execution
revalidates the stack and physical resource ownership before any mutation.
AWS CLI credentials are used normally; tokens never appear in logs or reports.
All fixture records and S3 object versions are removed in a finally block.
No public website, payment, email, desktop app, or game is opened.
"""
import argparse
import copy
import datetime as dt
import gzip
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request

STACK = "trace-memberships-capture-staging"
PRODUCTION_API = "p5xbv2rfya"
OUTPUTS = {"ApiUrl", "DevicesTable", "MatchesTable", "SharesTable", "PayloadBucket"}
RESOURCE_KEYS = {"TraceDevices": "DevicesTable", "TraceMatches": "MatchesTable",
                 "TraceShares": "SharesTable", "TracePayloads": "PayloadBucket"}
SENTINELS = ("SMOKE_PROTECTED_INVENTORY", "SMOKE_HIDDEN_IDENTITY", "SMOKE_SECRET_PRINT", "SMOKE_SECRET_ART")


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def iso(value):
    return value.isoformat(timespec="seconds").replace("+00:00", "Z")


def validate_stack(document, region, enforcement):
    stacks = document.get("Stacks", [])
    require(len(stacks) == 1 and stacks[0].get("StackName") == STACK, "Only the exact isolated staging stack is allowed")
    stack = stacks[0]
    require(re.fullmatch(rf"arn:aws:cloudformation:{re.escape(region)}:\d{{12}}:stack/{STACK}/[A-Za-z0-9-]+", stack.get("StackId", "")), "Invalid staging stack ARN")
    params = {p["ParameterKey"]: p.get("ParameterValue", "") for p in stack.get("Parameters", [])}
    require("staging" in params.get("Environment", "") and "production" not in params.get("Environment", ""), "Stack Environment must explicitly be staging")
    require(params.get("RequireMembership", "false") == ("true" if enforcement == "enabled" else "false"), "Requested enforcement does not match stack parameters")
    values = {p["OutputKey"]: p["OutputValue"].rstrip("/") for p in stack.get("Outputs", []) if p["OutputKey"] in OUTPUTS}
    require(set(values) == OUTPUTS, "Stack output allowlist is incomplete")
    endpoint = values["ApiUrl"]
    require(PRODUCTION_API not in endpoint.lower(), "Production API is forbidden")
    require(re.fullmatch(rf"https://[a-z0-9]{{8,14}}\.execute-api\.{re.escape(region)}\.amazonaws\.com", endpoint), "Only an exact regional API Gateway origin is allowed")
    for key in OUTPUTS - {"ApiUrl"}:
        require(values[key].lower().startswith(STACK + "-") and re.fullmatch(r"[A-Za-z0-9_.-]+", values[key]), f"{key} must belong to the explicit staging name prefix")
    return stack["StackId"], values


def fixture(match_id, when):
    """Shape from test_membership_privacy.py / real cloud replay DTO, no real game data."""
    local, opponent = "Synthetic Smoke Player", "Synthetic Smoke Opponent"
    own = {"playerName": local, "playerId": "a", "source": "match-start",
           "cards": [{"cardId": "SMOKE_OWN_CARD", "count": 60}], "total": 60}
    hidden = {"id": "hidden-opponent-card", "name": SENTINELS[1],
              "reviewSourceId": SENTINELS[2], "imageUrl": SENTINELS[3], "cardType": "Pokemon"}
    revealed = {"id": "public-opponent-card", "name": "Smoke Revealed Pokemon", "cardType": "Pokemon"}
    review = {
        "id": match_id, "source": "trace-staging-smoke-synthetic", "importedAt": iso(when),
        "localPlayer": local, "opponent": opponent, "winner": local,
        "rawLog": SENTINELS[0], "decklists": [own, {**own, "playerName": opponent, "playerId": "b",
                                                    "cards": [{"cardId": SENTINELS[0], "count": 60}]}],
        "turns": [{"index": 0, "number": 1,
                   "actions": [{"type": "game-end", "text": "Synthetic Smoke Player won the game."}],
                   "snapshot": {"players": {local: {}, opponent: {
                       "deckCards": [hidden, revealed], "prizeCards": [hidden], "knownHandCards": [hidden],
                       "knownHand": [SENTINELS[1]], "active": revealed, "discardCards": [revealed]}}},
                   "canonical": {"playerNames": [local, opponent],
                                 "visibility": {hidden["id"]: "hidden", revealed["id"]: "known"},
                                 "state": {"players": [{"hand": [{"id": "own-card", "name": "Smoke Own Card"}]},
                                                       {"deck": [hidden, revealed], "hand": [hidden], "prizes": [hidden], "active": {"card": revealed}}]},
                                 "pendingCards": [[], [hidden]], "selection": {"optionCards": [hidden]},
                                 "selections": [{"optionCards": [hidden]}]},
                   "rawPayload": {"type": "EndGameModification", "players": [{"deckInfo": {"cards": {SENTINELS[0]: 60}}}]}}],
    }
    return {"review": review, "reducerVersion": 999, "summary": {"operationCount": 1, "durationSeconds": 60}}


def assert_private_projection(body, public=False):
    review = body.get("review", {})
    rendered = json.dumps(body)
    require(all(value not in rendered for value in SENTINELS), "Protected opponent identity escaped replay projection")
    require("rawPayload" not in rendered and review.get("rawLog") == "", "Raw capture escaped replay projection")
    require("Smoke Revealed Pokemon" in rendered and "Smoke Own Card" in rendered, "Projection removed visible gameplay")
    if public:
        require("decklists" not in review and "deviceId" not in body, "Public replay leaked starting inventory/device")
    else:
        require(len(review.get("decklists", [])) == 1 and review["decklists"][0]["playerName"] == review["localPlayer"], "Private replay starting-list boundary failed")


class NoRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *_args, **_kwargs):
        return None


class Smoke:
    def __init__(self, args, document):
        self.args = args
        self.stack_id, self.targets = validate_stack(document, args.region, args.enforcement)
        self.run_id = secrets.token_hex(12)
        self.device = "trace-staging-smoke-" + self.run_id
        self.ids = {name: self.device + "-" + name for name in ("recent", "second", "old")}
        now = dt.datetime.now(dt.timezone.utc) - dt.timedelta(minutes=1)
        self.payloads = {name: fixture(value, now - dt.timedelta(days=8 if name == "old" else 0)) for name, value in self.ids.items()}
        self.token = None
        self.register_attempted = False
        self.checks = []
        self.cleanup_errors = []
        # No proxy redirects or canonical public URLs: every HTTP call stays at the allowlisted API.
        self.http = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirects())

    def aws(self, service, operation, *args):
        result = subprocess.run(["aws", "--profile", self.args.profile, "--region", self.args.region,
                                 "--no-cli-pager", "--output", "json", service, operation, *args],
                                capture_output=True, text=True, timeout=60)
        require(result.returncode == 0, f"AWS {service} {operation} failed (diagnostic output withheld)")
        return json.loads(result.stdout) if result.stdout.strip() else {}

    def verify_live_allowlist(self):
        live = self.aws("cloudformation", "describe-stacks", "--stack-name", STACK)
        require(validate_stack(live, self.args.region, self.args.enforcement) == (self.stack_id, self.targets), "Live stack differs from supplied staging allowlist")
        resources = self.aws("cloudformation", "list-stack-resources", "--stack-name", self.stack_id)
        by_name = {row["LogicalResourceId"]: row["PhysicalResourceId"] for row in resources["StackResourceSummaries"]}
        for logical, output in RESOURCE_KEYS.items():
            require(by_name.get(logical) == self.targets[output], f"Physical stack ownership mismatch: {output}")
        require(self.targets["ApiUrl"].split("//")[1].split(".")[0] == by_name.get("TraceApi"), "API ownership mismatch")
        self.pass_check("named staging stack and physical resource ownership")

    def pass_check(self, label):
        self.checks.append(label)
        print("PASS " + label, flush=True)

    def call(self, method, path, expected=200, body=None, auth=True, headers=None):
        allowed = path == "/v1/register" or path == "/v1/matches" or any(
            path in (f"/v1/matches/{match}", f"/v1/matches/{match}/share") for match in self.ids.values())
        allowed = allowed or bool(re.fullmatch(r"/v1/shares/[A-Za-z0-9_-]{20,64}(?:\?summary=1)?", path))
        require(allowed, "HTTP path is outside this test's allowlist")
        request_headers = {"Accept": "application/json", **(headers or {})}
        if auth:
            require(bool(self.token), "Missing synthetic device token")
            request_headers.update({"X-Trace-Device": self.device, "Authorization": "Bearer " + self.token})
        encoded = None
        if body is not None:
            encoded = json.dumps(body).encode()
            request_headers["Content-Type"] = "application/json"
            if method == "PUT":
                encoded = gzip.compress(encoded, mtime=0)
                request_headers["Content-Encoding"] = "gzip"
        request = urllib.request.Request(self.targets["ApiUrl"] + path, data=encoded, headers=request_headers, method=method)
        try:
            response = self.http.open(request, timeout=30)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            status = response.code
            payload = response.read(2_000_001)
            response_headers = {key.lower(): value for key, value in response.headers.items()}
        require(status == expected, f"{method} {path.rsplit('/', 1)[-1]}: expected HTTP {expected}, got {status}")
        require(len(payload) <= 2_000_000, "Unexpectedly large fixture response")
        if response_headers.get("content-encoding") == "gzip":
            payload = gzip.decompress(payload)
        return (json.loads(payload) if payload else {}), response_headers

    def item(self, table, key):
        return self.aws("dynamodb", "get-item", "--table-name", self.targets[table], "--consistent-read",
                        "--key", json.dumps({name: {"S": value} for name, value in key.items()})).get("Item", {})

    def match_item(self, name):
        return self.item("MatchesTable", {"deviceId": self.device, "matchId": self.ids[name]})

    def run(self):
        self.verify_live_allowlist()
        self.register_attempted = True
        registered, _ = self.call("POST", "/v1/register", 201, {"deviceId": self.device}, auth=False)
        self.token = registered.get("token")
        require(registered.get("deviceId") == self.device and isinstance(self.token, str) and len(self.token) > 20, "Invalid synthetic registration")
        before = self.item("DevicesTable", {"deviceId": self.device})
        repeat, _ = self.call("POST", "/v1/register", 409, {"deviceId": self.device}, auth=False)
        require(repeat.get("error") == "device_already_registered" and "token" not in repeat, "Repeat registration replaced credential")
        require(before == self.item("DevicesTable", {"deviceId": self.device}), "Conflicting registration mutated existing device")
        self.call("GET", "/v1/matches", 401, auth=False, headers={"X-Trace-Device": self.device, "Authorization": "Bearer invalid-synthetic-token"})
        self.pass_check("registration conflict preserves credentials; invalid bearer rejected")

        for name, payload in self.payloads.items():
            saved, _ = self.call("PUT", "/v1/matches/" + self.ids[name], body=payload)
            require(saved.get("id") == self.ids[name] and saved.get("winner") == "Synthetic Smoke Player", "Synthetic completed replay was not saved")
        listed, _ = self.call("GET", "/v1/matches")
        require({entry["id"] for entry in listed.get("matches", [])} == set(self.ids.values()), "Free all-time history index missing a fixture")
        recent, _ = self.call("GET", "/v1/matches/" + self.ids["recent"])
        assert_private_projection(recent)
        old_status = 403 if self.args.enforcement == "enabled" else 200
        old, _ = self.call("GET", "/v1/matches/" + self.ids["old"], old_status)
        if old_status == 403:
            require(old == {"error": "history_membership_required"}, "Old replay did not report membership boundary")
        else:
            assert_private_projection(old)
        old_row = self.match_item("old")
        rewritten = copy.deepcopy(self.payloads["old"])
        rewritten["review"]["importedAt"] = iso(dt.datetime.now(dt.timezone.utc))
        self.call("PUT", "/v1/matches/" + self.ids["old"], body=rewritten)
        require(self.match_item("old").get("historyStartedAt") == old_row.get("historyStartedAt"), "Reupload reset immutable history age")
        self.call("GET", "/v1/matches/" + self.ids["old"], old_status)
        self.pass_check("free capture/index, recent replay privacy, old replay policy and immutable age")

        row = self.match_item("recent")
        expected_key = self.object_key("recent", "matches")
        require(row.get("objectKey", {}).get("S") == expected_key, "Unexpected synthetic source object key")
        with tempfile.TemporaryDirectory(prefix="trace-staging-smoke-") as folder:
            output = str(Path(folder) / "synthetic-source.json.gz")
            metadata = self.aws("s3api", "get-object", "--bucket", self.targets["PayloadBucket"], "--key", expected_key,
                                "--version-id", row["objectVersionId"]["S"], output)
            raw = json.loads(gzip.decompress(Path(output).read_bytes()))
        require(raw == self.payloads["recent"]["review"], "Original synthetic capture was not preserved")
        require(metadata.get("ServerSideEncryption") == "AES256", "Source object encryption missing")
        self.pass_check("Dynamo source version and encrypted S3 original preserved")

        first, _ = self.call("POST", "/v1/matches/" + self.ids["recent"] + "/share", body={})
        share_id = first.get("shareId", "")
        require(re.fullmatch(r"[A-Za-z0-9_-]{20,64}", share_id), "Invalid generated synthetic share ID")
        # The response currently advertises the production website. Deliberately never navigate it.
        device_after_share = self.item("DevicesTable", {"deviceId": self.device})
        again, _ = self.call("POST", "/v1/matches/" + self.ids["recent"] + "/share", body={})
        require(again == first, "Share retry was not idempotent")
        require(self.match_item("recent").get("shareId", {}).get("S") == share_id, "Match reservation missing")
        share_row = self.item("SharesTable", {"shareId": share_id})
        require(share_row.get("deviceId", {}).get("S") == self.device and share_row.get("matchId", {}).get("S") == self.ids["recent"], "Share reverse lookup does not match fixture")
        require(share_row.get("preparedReplay", {}).get("M", {}).get("format", {}).get("N") == "2", "Prepared replay privacy format missing")
        for field in ("lastFreeShareAt", "lastFreeShareId"):
            require(self.item("DevicesTable", {"deviceId": self.device}).get(field) == device_after_share.get(field), "Share retry consumed quota again")
        shared, headers = self.call("GET", "/v1/shares/" + share_id, auth=False)
        assert_private_projection(shared, public=True)
        require(bool(headers.get("etag")), "Prepared share validator missing")
        self.call("GET", "/v1/shares/" + share_id, 304, auth=False, headers={"If-None-Match": headers["etag"]})
        self.pass_check("atomic share pointers, retry reuse, public privacy and conditional caching")

        if self.args.enforcement == "enabled":
            require(device_after_share.get("lastFreeShareId", {}).get("S") == share_id, "Free quota reservation missing")
            second, _ = self.call("POST", "/v1/matches/" + self.ids["second"] + "/share", 403, body={})
            require(second.get("error") == "share_limit_reached", "Second free share did not reach quota")
            expected_reset = iso(dt.datetime.fromtimestamp(int(device_after_share["lastFreeShareAt"]["N"]) + 7 * 86400, dt.timezone.utc))
            require(second.get("nextShareAt") == expected_reset, "Quota reset is not seven days from original reservation")
            require("shareId" not in self.match_item("second"), "Denied share left a partial match reservation")
            old_share, _ = self.call("POST", "/v1/matches/" + self.ids["old"] + "/share", 403, body={})
            require(old_share.get("error") == "history_membership_required", "Old new share bypassed history boundary")
            self.pass_check("one new free share per seven days; denied shares leave no match pointer")
        else:
            require("lastFreeShareAt" not in device_after_share, "Disabled enforcement unexpectedly consumed free quota")
            self.pass_check("rollout-disabled mode leaves free quota unused (enforced quota NOT tested)")

    def object_key(self, name, kind):
        return f"devices/{self.device}/{kind}/{hashlib.sha256(self.ids[name].encode()).hexdigest()}.json.gz"

    def cleanup(self):
        if not self.register_attempted:
            return
        # Read only our exact synthetic keys; no table scans or prefix-wide deletion.
        for name in self.ids:
            try:
                row = self.match_item(name)
                share_id = row.get("shareId", {}).get("S")
                if share_id:
                    shared = self.item("SharesTable", {"shareId": share_id})
                    require(shared.get("deviceId", {}).get("S") == self.device and shared.get("matchId", {}).get("S") == self.ids[name], "Refusing to clean a share not owned by this fixture")
                    self.delete_item("SharesTable", {"shareId": share_id})
                for kind in ("matches", "shared-replays"):
                    key = self.object_key(name, kind)
                    versions = self.aws("s3api", "list-object-versions", "--bucket", self.targets["PayloadBucket"], "--prefix", key)
                    owned = [{"Key": key, "VersionId": version["VersionId"]} for group in ("Versions", "DeleteMarkers")
                             for version in versions.get(group, []) if version.get("Key") == key]
                    if owned:
                        deleted = self.aws("s3api", "delete-objects", "--bucket", self.targets["PayloadBucket"],
                                           "--delete", json.dumps({"Objects": owned, "Quiet": True}))
                        require(not deleted.get("Errors"), "Synthetic object cleanup returned errors")
                self.delete_item("MatchesTable", {"deviceId": self.device, "matchId": self.ids[name]})
            except Exception:
                self.cleanup_errors.append("Cleanup incomplete for synthetic match " + name)
        try:
            self.delete_item("DevicesTable", {"deviceId": self.device})
        except Exception:
            self.cleanup_errors.append("Cleanup incomplete for synthetic device")

    def delete_item(self, table, key):
        self.aws("dynamodb", "delete-item", "--table-name", self.targets[table],
                 "--key", json.dumps({name: {"S": value} for name, value in key.items()}))


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--stack-description", type=Path, required=True)
    parser.add_argument("--enforcement", choices=("enabled", "disabled"), required=True)
    parser.add_argument("--profile", default="default")
    parser.add_argument("--region", default="us-east-1")
    parser.add_argument("--report", type=Path, default=Path("/tmp/trace-staging-smoke-report.json"))
    parser.add_argument("--execute", action="store_true", help="Make staging-only HTTP/AWS requests; absent means offline validation only")
    args = parser.parse_args()
    smoke = Smoke(args, json.loads(args.stack_description.read_text()))
    print(json.dumps({"mode": "execute" if args.execute else "offline", "stack": STACK, "targets": smoke.targets,
                      "enforcement": args.enforcement, "syntheticMatchCount": 3}, indent=2))
    if not args.execute:
        print("Offline validation passed. No AWS/HTTP requests made. Add --execute for the staging smoke test.")
        return 0
    failure = None
    try:
        smoke.run()
    except Exception as error:
        failure = str(error) if isinstance(error, RuntimeError) else type(error).__name__
    finally:
        smoke.cleanup()
        report = {"stack": STACK, "endpoint": smoke.targets["ApiUrl"], "deviceId": smoke.device,
                  "matchIds": smoke.ids, "enforcement": args.enforcement, "checks": smoke.checks,
                  "passed": failure is None and not smoke.cleanup_errors, "failure": failure,
                  "cleanupErrors": smoke.cleanup_errors, "recordedAt": iso(dt.datetime.now(dt.timezone.utc))}
        args.report.parent.mkdir(parents=True, exist_ok=True)
        descriptor = os.open(args.report, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(descriptor, "w") as handle:
            json.dump(report, handle, indent=2)
    print(("PASS" if report["passed"] else "FAIL") + " staging smoke; sanitized report: " + str(args.report))
    if failure:
        print(failure, file=sys.stderr)
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (ValueError, OSError, RuntimeError) as error:
        print("Refused/failed: " + str(error), file=sys.stderr)
        sys.exit(1)
