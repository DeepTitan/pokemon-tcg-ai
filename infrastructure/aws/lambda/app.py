import base64
import copy
import datetime as dt
import gzip
import hashlib
import hmac
import json
import os
import re
import secrets
import urllib.error
import urllib.request

import boto3
from botocore.exceptions import ClientError
from boto3.dynamodb.conditions import Key
from boto3.dynamodb.types import TypeSerializer


DEVICES_TABLE = os.environ["DEVICES_TABLE"]
MATCHES_TABLE = os.environ["MATCHES_TABLE"]
SHARES_TABLE = os.environ["SHARES_TABLE"]
PAYLOAD_BUCKET = os.environ["PAYLOAD_BUCKET"]
PUBLIC_SHARE_BASE_URL = os.environ.get("PUBLIC_SHARE_BASE_URL", "https://victoryroad.app/trace").rstrip("/")
MEMBERSHIP_API_URL = os.environ.get("MEMBERSHIP_API_URL", "").rstrip("/")
REQUIRE_MEMBERSHIP = os.environ.get("REQUIRE_MEMBERSHIP", "false") == "true"
DEVICE_ID = re.compile(r"^[A-Za-z0-9._-]{16,128}$")
MATCH_ID = re.compile(r"^[A-Za-z0-9._:-]{1,220}$")
SHARE_ID = re.compile(r"^[A-Za-z0-9_-]{20,64}$")
FREE_HISTORY_SECONDS = 7 * 86400
MATCH_SUMMARY_FIELDS = ("importedAt", "source", "localPlayer", "opponent", "winner", "turnCount",
                        "localRating", "opponentRating", "ratingChange", "ratingAfter", "operationCount",
                        "durationSeconds", "socialPreview")

dynamodb = boto3.resource("dynamodb")
dynamodb_client = boto3.client("dynamodb")
devices = dynamodb.Table(DEVICES_TABLE)
matches = dynamodb.Table(MATCHES_TABLE)
shares = dynamodb.Table(SHARES_TABLE)
s3 = boto3.client("s3")


def handler(event, _context):
    method = event.get("requestContext", {}).get("http", {}).get("method", "")
    path = event.get("rawPath", "")
    try:
        if method == "POST" and path == "/v1/register":
            return register(event)

        share_id = (event.get("pathParameters") or {}).get("shareId", "")
        if method == "GET" and path.startswith("/v1/shares/"):
            if not SHARE_ID.fullmatch(share_id):
                return response(400, {"error": "invalid_share_id"})
            summary_only = str((event.get("queryStringParameters") or {}).get("summary", "")) == "1"
            return get_shared_match(share_id, summary_only, event.get("headers"))

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
            return get_match(identity, match_id, event)
        if method == "POST" and path.endswith("/share"):
            return share_match(identity, match_id, event)
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
    try:
        devices.put_item(Item={
            "deviceId": device_id,
            "tokenHash": digest(token),
            "createdAt": now,
            "updatedAt": now,
        }, ConditionExpression="attribute_not_exists(deviceId)")
    except ClientError as error:
        if error.response.get("Error", {}).get("Code") != "ConditionalCheckFailedException":
            raise
        # Device identifiers are public identifiers, not proof of ownership.
        # Re-registering must never replace another installation's bearer token.
        return response(409, {"error": "device_already_registered"})
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


class NoMembershipRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        # Never forward device credentials to a redirected host.
        return None


def device_membership(event):
    if not re.fullmatch(r"https://[A-Za-z0-9.-]+(?:/[A-Za-z0-9_-]+)*", MEMBERSHIP_API_URL):
        raise ValueError("membership_not_configured")
    headers = {str(key).lower(): value for key, value in (event.get("headers") or {}).items()}
    request = urllib.request.Request(MEMBERSHIP_API_URL + "/v1/devices/status", headers={
        "Authorization": headers.get("authorization", ""),
        "X-Trace-Device": headers.get("x-trace-device", ""),
        "Accept": "application/json",
    })
    with urllib.request.build_opener(NoMembershipRedirects()).open(request, timeout=5) as result:
        encoded = result.read(16385)
    if len(encoded) > 16384:
        raise ValueError("invalid_membership_response")
    return json.loads(encoded)


def has_paid_capability(membership, capability):
    if not isinstance(membership, dict) or membership.get("linked") is not True:
        return False
    owner = membership.get("status") == "admin" and membership.get("admin") is True and membership.get("plan") == "supporter"
    expires = parsed_time(membership.get("expiresAt"))
    paid = (membership.get("status") == "active" and membership.get("plan") in ("trace", "supporter")
            and expires is not None and expires > utc_now())
    return (membership.get("traceAccess") is True and (paid or owner)
            and isinstance(membership.get("capabilities"), dict)
            and membership["capabilities"].get(capability) is True)


def require_membership(event, capability="fullHistory"):
    # The flag enables premium read/share enforcement, never capture enforcement.
    if not REQUIRE_MEMBERSHIP:
        return None
    try:
        membership = device_membership(event)
    except (OSError, ValueError, urllib.error.URLError):
        return response(503, {"error": "membership_unavailable"})
    if not isinstance(membership, dict):
        return response(503, {"error": "membership_unavailable"})
    if has_paid_capability(membership, capability):
        return None
    return response(403, {"error": "history_membership_required"})


def utc_now():
    return dt.datetime.now(dt.timezone.utc)


def parsed_time(value):
    try:
        parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00")) if isinstance(value, str) else None
        return parsed.astimezone(dt.timezone.utc) if parsed is not None and parsed.tzinfo is not None else None
    except (ValueError, OverflowError):
        return None


def history_started_at(item, now=None):
    """Persisted age wins; legacy rows use their earliest usable existing date.

    A client timestamp can only shorten first-upload access. Neither a correction
    nor a later client date can refresh the stored seven-day access window.
    """
    fixed = parsed_time(item.get("historyStartedAt"))
    if fixed is not None:
        return fixed
    dates = [parsed_time(item.get(key)) for key in ("importedAt", "updatedAt")]
    if now is not None:
        dates.append(now)
    return min((date for date in dates if date is not None), default=None)


def is_recent_match(item):
    started = history_started_at(item)
    now = utc_now()
    return started is not None and now - dt.timedelta(seconds=FREE_HISTORY_SECONDS) < started <= now


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
    stored = s3.put_object(
        Bucket=PAYLOAD_BUCKET,
        Key=object_key,
        Body=compressed,
        ContentType="application/json",
        ContentEncoding="gzip",
        ServerSideEncryption="AES256",
        Metadata={"trace-match-id-sha256": hashlib.sha256(match_id.encode()).hexdigest()},
    )

    summary = match_summary(review, body.get("summary"))
    existing = matches.get_item(
        Key={"deviceId": device_id, "matchId": match_id},
        ConsistentRead=True,
    ).get("Item") or {}
    fields = clean({
        "deviceId": device_id,
        "matchId": match_id,
        "objectKey": object_key,
        "objectVersionId": stored.get("VersionId"),
        "updatedAt": now,
        "payloadBytes": len(compressed),
        "reducerVersion": reducer_version,
        **summary,
    })
    anchor = history_started_at(existing) if existing else history_started_at(fields, parsed_time(now))
    # An undated legacy row must not become "new" merely because it was repaired.
    anchor = (anchor or dt.datetime(1970, 1, 1, tzinfo=dt.timezone.utc)).isoformat().replace("+00:00", "Z")
    # Updating fields preserves a concurrent share reservation. In particular,
    # a background capture upload cannot erase shareId or refresh its access age.
    fields.pop("deviceId")
    fields.pop("matchId")
    names = {f"#f{i}": key for i, key in enumerate(fields)}
    values = {f":v{i}": value for i, value in enumerate(fields.values())}
    expression = ", ".join(f"#f{i} = :v{i}" for i in range(len(fields)))
    removed = {f"#r{i}": key for i, key in enumerate(MATCH_SUMMARY_FIELDS) if key not in fields}
    names.update(removed)
    expression += ", historyStartedAt = if_not_exists(historyStartedAt, :anchor)"
    if removed:
        # Keep the old replacement semantics for corrected/missing summary data.
        # Preserving a stale Elo after a correction would change ranked eligibility.
        expression += " REMOVE " + ", ".join(removed)
    item = matches.update_item(
        Key={"deviceId": device_id, "matchId": match_id},
        UpdateExpression="SET " + expression,
        ExpressionAttributeNames=names,
        ExpressionAttributeValues={**values, ":anchor": anchor}, ReturnValues="ALL_NEW",
    )["Attributes"]
    # Only explicitly shared matches get a public-response artifact. Refresh it
    # during upload so viewers do not pay the serialization cost after an update.
    if item.get("shareId"):
        shared = shares.get_item(Key={"shareId": item["shareId"]}, ConsistentRead=True).get("Item")
        if shared and shared.get("deviceId") == device_id and shared.get("matchId") == match_id:
            prepare_shared_replay(item["shareId"], shared, item, review)
    return response(200, public_summary(item))


def list_matches(device_id):
    items = matches.query(
        KeyConditionExpression=Key("deviceId").eq(device_id),
        ConsistentRead=True,
    ).get("Items", [])
    items.sort(key=lambda item: item.get("importedAt", item.get("updatedAt", "")), reverse=True)
    return response(200, {"matches": [public_summary(item) for item in items]})


def get_match(device_id, match_id, event=None):
    item = matches.get_item(
        Key={"deviceId": device_id, "matchId": match_id},
        ConsistentRead=True,
    ).get("Item")
    if not item:
        return response(404, {"error": "match_not_found"})
    if not is_recent_match(item):
        denied = require_membership(event or {})
        if denied:
            return denied
    review = stored_review(item)
    return compressed_response(200, {
        "review": visible_review(review),
        "reducerVersion": int(item.get("reducerVersion", 0)),
        "updatedAt": item.get("updatedAt"),
    })


def share_match(device_id, match_id, event):
    item = matches.get_item(
        Key={"deviceId": device_id, "matchId": match_id},
        ConsistentRead=True,
    ).get("Item")
    if not item:
        return response(404, {"error": "match_not_found"})

    share_id = item.get("shareId")
    existing_share = isinstance(share_id, str) and SHARE_ID.fullmatch(share_id)
    free_share = False
    if REQUIRE_MEMBERSHIP and not existing_share:
        if not is_recent_match(item):
            denied = require_membership(event, "expandedSharing")
            if denied:
                return denied
        else:
            # A billing outage must not block the free allowance. Only a fresh,
            # valid entitlement can bypass its server-side quota.
            try:
                free_share = not has_paid_capability(device_membership(event), "expandedSharing")
            except (OSError, ValueError, urllib.error.URLError):
                free_share = True

    supplied_summary = social_summary_fields(read_json(event).get("summary"))
    if supplied_summary:
        names = {f"#field{index}": key for index, key in enumerate(supplied_summary)}
        values = {f":value{index}": value for index, value in enumerate(supplied_summary.values())}
        expression = ", ".join(
            f"{name} = {value}"
            for name, value in zip(names, values)
        )
        item = matches.update_item(
            Key={"deviceId": device_id, "matchId": match_id},
            UpdateExpression=f"SET {expression}",
            ExpressionAttributeNames=names,
            ExpressionAttributeValues=values,
            ReturnValues="ALL_NEW",
        )["Attributes"]

    if not existing_share:
        share_id, denied = reserve_share(device_id, match_id, item, free_share)
        if denied:
            return denied
    else:
        # Repair the public lookup if a retained match outlived a replaced share table.
        shares.update_item(
            Key={"shareId": share_id},
            UpdateExpression="SET deviceId = :device, matchId = :match, createdAt = if_not_exists(createdAt, :created)",
            ConditionExpression="attribute_not_exists(shareId) OR (deviceId = :device AND matchId = :match)",
            ExpressionAttributeValues={
                ":device": device_id, ":match": match_id,
                ":created": item.get("updatedAt", timestamp()),
            },
        )

    shared = shares.get_item(Key={"shareId": share_id}, ConsistentRead=True)["Item"]
    # Do not return the link until its ready-to-send bytes are safely stored.
    # Repeated Share clicks reuse the prepared version when nothing changed.
    prepare_shared_replay(share_id, shared, item)

    return response(200, {
        "shareId": share_id,
        "url": f"{PUBLIC_SHARE_BASE_URL}/{share_id}",
    })


def reserve_share(device_id, match_id, item, free_share):
    """One pointer, public lookup and free-use reservation commit atomically.

    Reusing the same match does not consume another allowance, even after a lost
    response or failure while preparing the public payload. Quota is per capture
    installation, not an account-wide anti-abuse measure.
    """
    serialize = TypeSerializer().serialize
    attrs = lambda values: {key: serialize(value) for key, value in values.items()}
    for _ in range(5):
        previous = item.get("shareId")
        if isinstance(previous, str) and SHARE_ID.fullmatch(previous):
            return previous, None
        candidate = secrets.token_urlsafe(18)
        now = int(utc_now().timestamp())
        condition = "attribute_not_exists(shareId)"
        values = {":share": candidate}
        if "shareId" in item:
            condition += " OR shareId = :old"
            values[":old"] = item["shareId"]
        writes = [
            {"Update": {"TableName": MATCHES_TABLE, "Key": attrs({"deviceId": device_id, "matchId": match_id}),
                        "UpdateExpression": "SET shareId = :share",
                        "ConditionExpression": "attribute_exists(matchId) AND (" + condition + ")",
                        "ExpressionAttributeValues": attrs(values)}},
            {"Put": {"TableName": SHARES_TABLE,
                     "Item": attrs({"shareId": candidate, "deviceId": device_id, "matchId": match_id, "createdAt": timestamp()}),
                     "ConditionExpression": "attribute_not_exists(shareId)"}},
        ]
        if free_share:
            writes.append({"Update": {
                "TableName": DEVICES_TABLE, "Key": attrs({"deviceId": device_id}),
                "UpdateExpression": "SET lastFreeShareAt = :now, lastFreeShareId = :share",
                "ConditionExpression": "attribute_exists(deviceId) AND (attribute_not_exists(lastFreeShareAt) OR lastFreeShareAt <= :cutoff)",
                "ExpressionAttributeValues": attrs({":now": now, ":share": candidate, ":cutoff": now - FREE_HISTORY_SECONDS}),
            }})
        try:
            dynamodb_client.transact_write_items(TransactItems=writes)
            return candidate, None
        except ClientError as error:
            if error.response.get("Error", {}).get("Code") != "TransactionCanceledException":
                raise
            current = matches.get_item(Key={"deviceId": device_id, "matchId": match_id}, ConsistentRead=True).get("Item")
            if not current:
                return None, response(404, {"error": "match_not_found"})
            previous = current.get("shareId")
            if isinstance(previous, str) and SHARE_ID.fullmatch(previous):
                return previous, None
            if free_share:
                device = devices.get_item(Key={"deviceId": device_id}, ConsistentRead=True).get("Item") or {}
                used = device.get("lastFreeShareAt")
                if used is not None and int(used) > now - FREE_HISTORY_SECONDS:
                    next_share = dt.datetime.fromtimestamp(int(used) + FREE_HISTORY_SECONDS, dt.timezone.utc)
                    return None, response(403, {"error": "share_limit_reached",
                                               "nextShareAt": next_share.isoformat().replace("+00:00", "Z")})
            item = current
    return None, response(409, {"error": "share_busy"})


def stored_review(item):
    request = {"Bucket": PAYLOAD_BUCKET, "Key": item["objectKey"]}
    if item.get("objectVersionId"):
        request["VersionId"] = item["objectVersionId"]
    stored = s3.get_object(**request)["Body"].read()
    return json.loads(gzip.decompress(stored))


def visible_review(review, public=False):
    """Project a replay without the protected starting opponent inventory.

    Stored captures remain intact. Full lists are never a public-share feature;
    updated desktop clients retrieve their own opponent list separately after
    checking current membership and native terminal match evidence.
    """
    if not isinstance(review, dict):
        return {}
    result = copy.deepcopy(review)
    local = result.get("localPlayer")
    if public or not isinstance(local, str) or not local:
        result.pop("decklists", None)
    elif isinstance(result.get("decklists"), list):
        result["decklists"] = [entry for entry in result["decklists"]
                               if isinstance(entry, dict) and entry.get("playerName") == local]
    else:
        result.pop("decklists", None)
    # Raw capture/debug strings can include the original full match-start packet.
    result["rawLog"] = ""

    def hidden_card(card):
        return {"id": card.get("id", "hidden"), "name": "Hidden card",
                "cardType": "Trainer", "trainerType": "Item", "cardNumber": "",
                "imageUrl": "/tracker-assets/pokemon-card-back.jpg"}

    def strip_inventories(value, depth=0):
        if isinstance(value, list):
            return [strip_inventories(entry, depth + 1) for entry in value]
        if isinstance(value, dict):
            return {key: strip_inventories(entry, depth + 1) for key, entry in value.items()
                    if key.lower() not in ("deckinfo", "rawoperations", "rawpayload", "decodedmessage")
                    and not (depth > 0 and key.lower() in ("decklists", "rawlog"))}
        return value

    def card_ids(value):
        if isinstance(value, list):
            return set().union(*(card_ids(entry) for entry in value)) if value else set()
        if isinstance(value, dict):
            identifiers = {value['id']} if isinstance(value.get('id'), str) else set()
            for entry in value.values():
                identifiers.update(card_ids(entry))
            return identifiers
        return set()

    turns = result.get("turns")
    if not isinstance(turns, list):
        result["turns"] = []
        turns = []
    for turn in turns:
        if not isinstance(turn, dict):
            continue
        canonical = turn.get("canonical")
        if not isinstance(canonical, dict):
            turn.pop("canonical", None)
            canonical = {}
        visibility = canonical.get("visibility")
        if not isinstance(visibility, dict):
            visibility = {}
        state = canonical.get("state")
        if not isinstance(state, dict):
            canonical.pop("state", None)
            state = {}
        players = state.get("players")
        if not isinstance(players, list):
            state.pop("players", None)
            players = []
        names = canonical.get("playerNames")
        if not isinstance(names, list):
            names = []
        public_ids = set()
        for player in players:
            if isinstance(player, dict):
                for zone in ("active", "bench", "discard", "lostZone"):
                    public_ids.update(card_ids(player.get(zone)))
        public_ids.update(card_ids(state.get("stadium")))
        local_visible_ids = set()
        for index, player in enumerate(players):
            if isinstance(player, dict) and index < len(names) and names[index] == local:
                for zone in ("deck", "hand", "prizes"):
                    local_visible_ids.update(identifier for identifier in card_ids(player.get(zone))
                                             if visibility.get(identifier) != "hidden")
        # Legacy reducers marked deck identities "known" just because a packet
        # contained a source ID. Only explicit reveals or public board evidence
        # qualify; presence of a hidden-zone card ID is not visibility evidence.
        def revealed(card):
            identifier = card.get("id")
            return isinstance(identifier, str) and (identifier in public_ids or visibility.get(identifier) == "temporarily-revealed")

        for index, player in enumerate(players):
            if not isinstance(player, dict):
                continue
            is_local = index < len(names) and names[index] == local
            for zone in ("deck", "hand", "prizes"):
                cards = player.get(zone)
                if not isinstance(cards, list):
                    continue
                player[zone] = [
                    card if not isinstance(card, dict) or
                    revealed(card) or
                    (is_local and visibility.get(card.get("id")) != "hidden")
                    else hidden_card(card) for card in cards
                ]
        pending = canonical.get("pendingCards")
        if isinstance(pending, list):
            for index, cards in enumerate(pending):
                if not isinstance(cards, list):
                    pending[index] = []
                    continue
                is_local = index < len(names) and names[index] == local
                pending[index] = [card if isinstance(card, dict) and
                                  (revealed(card) or visibility.get(card.get("id")) == "known" or
                                   (is_local and visibility.get(card.get("id")) != "hidden"))
                                  else hidden_card(card if isinstance(card, dict) else {}) for card in cards]
        elif pending is not None:
            canonical.pop("pendingCards", None)
        selections = canonical.get("selections")
        selections = list(selections) if isinstance(selections, list) else []
        selections.append(canonical.get("selection"))
        for selection in selections:
            if isinstance(selection, dict) and isinstance(selection.get("optionCards"), list):
                selection["optionCards"] = [card if isinstance(card, dict) and
                                             (revealed(card) or card.get("id") in local_visible_ids)
                                             else hidden_card(card if isinstance(card, dict) else {})
                                             for card in selection["optionCards"]]
        snapshot = turn.get("snapshot")
        if not isinstance(snapshot, dict):
            turn.pop("snapshot", None)
            snapshot = {}
        snapshot_players = snapshot.get("players")
        if not isinstance(snapshot_players, dict):
            snapshot.pop("players", None)
            snapshot_players = {}
        for name, board in snapshot_players.items():
            if name == local or not isinstance(board, dict):
                continue
            for zone in ("deckCards", "prizeCards", "knownHandCards"):
                if isinstance(board.get(zone), list):
                    board[zone] = [card for card in board[zone] if isinstance(card, dict)
                                   and revealed(card)]
            board["knownHand"] = [card["name"] for card in board.get("knownHandCards", [])
                                  if isinstance(card, dict) and isinstance(card.get("name"), str)]
    return strip_inventories(result)


def shared_source(item):
    # Small, deterministic fingerprint; no replay parsing is needed to check it.
    source = {
        "projectionVersion": 2,
        "deviceId": item["deviceId"], "matchId": item["matchId"],
        "objectKey": item["objectKey"], "objectVersionId": item.get("objectVersionId"),
        "summary": public_summary(item),
    }
    return digest(json.dumps(source, sort_keys=True, separators=(",", ":"), ensure_ascii=False))


def prepare_shared_replay(share_id, shared, item, review=None, force=False):
    source = shared_source(item)
    prepared = shared.get("preparedReplay")
    if (not force and isinstance(prepared, dict) and prepared.get("format") == 2
            and prepared.get("source") == source and prepared.get("objectKey")
            and prepared.get("objectVersionId") and prepared.get("etag")):
        return prepared, None

    if review is None:
        review = stored_review(item)
    payload = {
        "review": visible_review(review, public=True), "summary": public_summary(item),
        "reducerVersion": int(item.get("reducerVersion", 0)),
        "updatedAt": item.get("updatedAt"),
    }
    encoded = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    compressed = gzip.compress(encoded, compresslevel=6, mtime=0)
    etag = f'"{hashlib.sha256(compressed).hexdigest()}"'
    object_key = f"devices/{item['deviceId']}/shared-replays/{digest(item['matchId'])}.json.gz"
    stored = s3.put_object(
        Bucket=PAYLOAD_BUCKET, Key=object_key, Body=compressed,
        ContentType="application/json", ContentEncoding="gzip", ServerSideEncryption="AES256",
    )
    version_id = stored.get("VersionId")
    if not version_id or version_id == "null":
        raise RuntimeError("Shared replay preparation requires versioned storage")
    prepared = {
        "format": 2, "source": source, "objectKey": object_key,
        "objectVersionId": version_id, "etag": etag,
    }
    # Pin an S3 version so concurrent updates cannot replace bytes underneath an
    # older pointer/ETag. A stale pointer is harmless: readers check source above.
    shares.update_item(
        Key={"shareId": share_id}, UpdateExpression="SET preparedReplay = :prepared",
        ConditionExpression="deviceId = :device AND matchId = :match",
        ExpressionAttributeValues={
            ":prepared": prepared, ":device": item["deviceId"], ":match": item["matchId"],
        },
    )
    return prepared, compressed


def get_shared_match(share_id, summary_only=False, request_headers=None):
    shared = shares.get_item(Key={"shareId": share_id}, ConsistentRead=True).get("Item")
    if not shared:
        return response(404, {"error": "share_not_found"})
    item = matches.get_item(
        Key={"deviceId": shared["deviceId"], "matchId": shared["matchId"]},
        ConsistentRead=True,
    ).get("Item")
    if not item:
        return response(404, {"error": "share_not_found"})
    if summary_only:
        if not item.get("socialPreview"):
            review = stored_review(item)
            preview = social_preview_from_review(review)
            if preview:
                item = matches.update_item(
                    Key={"deviceId": shared["deviceId"], "matchId": shared["matchId"]},
                    UpdateExpression="SET socialPreview = :preview",
                    ExpressionAttributeValues={":preview": preview},
                    ReturnValues="ALL_NEW",
                )["Attributes"]
        return response(200, {"summary": public_summary(item)})
    # Older links are upgraded once on demand. Normal reads just relay stored
    # gzip bytes; private retrieval and summary-only responses stay unchanged.
    prepared, compressed = prepare_shared_replay(share_id, shared, item)
    headers = {str(key).lower(): value for key, value in (request_headers or {}).items()}
    validators = str(headers.get("if-none-match", "")).split(",")
    response_headers = {
        "content-type": "application/json; charset=utf-8",
        # Revalidate every visit: browser caching must not bypass a removed link
        # or hide an updated match. Private/authenticated endpoints stay no-store.
        "cache-control": "private, no-cache", "etag": prepared["etag"],
        "x-content-type-options": "nosniff",
    }
    if any(value.strip().removeprefix("W/") in ("*", prepared["etag"]) for value in validators):
        return {"statusCode": 304, "headers": response_headers, "body": ""}
    if compressed is None:
        try:
            compressed = s3.get_object(
                Bucket=PAYLOAD_BUCKET, Key=prepared["objectKey"], VersionId=prepared["objectVersionId"],
            )["Body"].read()
        except ClientError as error:
            if error.response.get("Error", {}).get("Code") not in ("NoSuchKey", "NoSuchVersion", "404"):
                raise
            # S3's existing old-version lifecycle may expire a previously pinned
            # artifact. Repair that copy without invalidating the original link.
            prepared, compressed = prepare_shared_replay(share_id, shared, item, force=True)
            response_headers["etag"] = prepared["etag"]
    return {
        "statusCode": 200, "isBase64Encoded": True,
        "headers": {**response_headers, "content-encoding": "gzip"},
        "body": base64.b64encode(compressed).decode("ascii"),
    }


def social_summary_fields(summary):
    if not isinstance(summary, dict):
        return {}
    result = {}
    for key in ("localRating", "opponentRating", "ratingAfter", "operationCount", "durationSeconds"):
        value = summary.get(key)
        if isinstance(value, int) and not isinstance(value, bool) and value >= 0:
            result[key] = value
    rating_change = summary.get("ratingChange")
    if isinstance(rating_change, int) and not isinstance(rating_change, bool):
        result["ratingChange"] = rating_change
    preview = social_preview(summary)
    if preview:
        result["socialPreview"] = preview
    return result


def social_preview(summary):
    snapshot = summary.get("finalSnapshot")
    if not isinstance(snapshot, dict):
        return {}
    players = snapshot.get("players")
    if not isinstance(players, dict):
        return {}
    local_player = summary.get("localPlayer")
    opponent = summary.get("opponent")
    local_board = players.get(local_player)
    opponent_board = players.get(opponent)
    if not isinstance(local_board, dict) or not isinstance(opponent_board, dict):
        return {}
    local_card = representative_pokemon(local_board)
    opponent_card = representative_pokemon(opponent_board)
    return clean({
        "localCardId": local_card.get("cardId") if local_card else None,
        "localCardName": local_card.get("name") if local_card else None,
        "opponentCardId": opponent_card.get("cardId") if opponent_card else None,
        "opponentCardName": opponent_card.get("name") if opponent_card else None,
        "localPrizes": integer(local_board.get("prizesTaken")),
        "opponentPrizes": integer(opponent_board.get("prizesTaken")),
    })


def social_preview_from_review(review):
    if not isinstance(review, dict):
        return {}
    turns = review.get("turns")
    if not isinstance(turns, list):
        return {}
    snapshot = next(
        (turn.get("snapshot") for turn in reversed(turns)
         if isinstance(turn, dict) and isinstance(turn.get("snapshot"), dict)),
        None,
    )
    if snapshot is None:
        return {}
    return social_preview({
        "localPlayer": review.get("localPlayer"),
        "opponent": review.get("opponent"),
        "finalSnapshot": snapshot,
    })


def representative_pokemon(board):
    candidates = []
    active = board.get("active")
    if isinstance(active, dict):
        candidates.append((active, True, True))
    bench = board.get("bench")
    if isinstance(bench, list):
        candidates.extend((card, False, True) for card in bench if isinstance(card, dict))
    discard = board.get("discardCards")
    if isinstance(discard, list):
        candidates.extend((card, False, False) for card in discard if isinstance(card, dict))

    grouped = {}
    for card, active_card, in_play in candidates:
        name = str(card.get("name", "")).strip()
        if not name or name.lower() == "unknown card" or name.lower().endswith("energy"):
            continue
        max_hp = integer(card.get("maxHp"))
        if max_hp is None and not isinstance(card.get("cardType"), str):
            continue
        key = name.lower()
        lineages = {
            value.strip().lower()
            for value in card.get("evolutionStack", [])
            if isinstance(value, str) and value.strip()
        }
        entry = grouped.setdefault(key, {
            "card": card,
            "count": 0,
            "highestHp": 0,
            "inPlayCount": 0,
            "active": False,
            "highestEnergyCount": 0,
            "isRuleBox": bool(re.search(r"(?:\bex\b|\bV(?:MAX|STAR|-UNION)?\b|\bGX\b|Radiant|BREAK)", name, re.I)),
            "lineageNames": set(),
        })
        entry["count"] += 1
        entry["highestHp"] = max(entry["highestHp"], max_hp or 0)
        entry["inPlayCount"] += int(in_play)
        entry["active"] = entry["active"] or active_card
        energies = card.get("energies")
        entry["highestEnergyCount"] = max(
            entry["highestEnergyCount"], len(energies) if isinstance(energies, list) else 0,
        )
        entry["lineageNames"].update(lineages)
        if not entry["card"].get("cardId") and card.get("cardId"):
            entry["card"] = card

    def family_count(entry):
        return entry["count"] + sum(
            grouped.get(lineage, {}).get("count", 0) for lineage in entry["lineageNames"]
        )

    def score(entry):
        return (
            family_count(entry) * 300
            + len(entry["lineageNames"]) * 500
            + int(entry["isRuleBox"]) * 350
            + entry["highestHp"] * 2
            + entry["inPlayCount"] * 50
            + entry["highestEnergyCount"] * 100
            + int(entry["active"]) * 100
        )

    if not grouped:
        return None
    return max(
        grouped.values(),
        key=lambda entry: (
            score(entry), family_count(entry), entry["count"], int(entry["isRuleBox"]), entry["highestHp"],
        ),
    )["card"]


def integer(value):
    return value if isinstance(value, int) and not isinstance(value, bool) else None


def match_summary(review, supplied_summary=None):
    turns = review.get("turns") if isinstance(review.get("turns"), list) else []
    supplied = social_summary_fields(supplied_summary)
    local_rating = review.get("localRating")
    opponent_rating = review.get("opponentRating")
    return clean({
        "importedAt": review.get("importedAt"),
        "source": review.get("source"),
        "localPlayer": review.get("localPlayer"),
        "opponent": review.get("opponent"),
        "winner": review.get("winner"),
        "turnCount": len(turns),
        "localRating": local_rating if isinstance(local_rating, int) else supplied.get("localRating"),
        "opponentRating": opponent_rating if isinstance(opponent_rating, int) else supplied.get("opponentRating"),
        "ratingChange": supplied.get("ratingChange"),
        "ratingAfter": supplied.get("ratingAfter"),
        "operationCount": supplied.get("operationCount"),
        "durationSeconds": supplied.get("durationSeconds"),
        "socialPreview": supplied.get("socialPreview"),
    })


def public_summary(item):
    preview = item.get("socialPreview")
    return clean({
        "id": item.get("matchId"),
        "importedAt": item.get("importedAt"),
        "source": item.get("source"),
        "localPlayer": item.get("localPlayer"),
        "opponent": item.get("opponent"),
        "winner": item.get("winner"),
        "turnCount": int(item.get("turnCount", 0)),
        "localRating": int(item["localRating"]) if "localRating" in item else None,
        "opponentRating": int(item["opponentRating"]) if "opponentRating" in item else None,
        "ratingChange": int(item["ratingChange"]) if "ratingChange" in item else None,
        "ratingAfter": int(item["ratingAfter"]) if "ratingAfter" in item else None,
        "operationCount": int(item["operationCount"]) if "operationCount" in item else None,
        "durationSeconds": int(item["durationSeconds"]) if "durationSeconds" in item else None,
        "socialPreview": public_social_preview(preview),
        "reducerVersion": int(item.get("reducerVersion", 0)),
        "updatedAt": item.get("updatedAt"),
    })


def public_social_preview(preview):
    if not isinstance(preview, dict):
        return None
    return clean({
        "localCardId": preview.get("localCardId"),
        "localCardName": preview.get("localCardName"),
        "opponentCardId": preview.get("opponentCardId"),
        "opponentCardName": preview.get("opponentCardName"),
        "localPrizes": int(preview["localPrizes"]) if "localPrizes" in preview else None,
        "opponentPrizes": int(preview["opponentPrizes"]) if "opponentPrizes" in preview else None,
    })


def read_json(event):
    raw = event.get("body") or "{}"
    if event.get("isBase64Encoded"):
        raw = base64.b64decode(raw)
    elif isinstance(raw, str):
        raw = raw.encode("utf-8")
    else:
        raise ValueError("invalid_body")
    headers = {str(key).lower(): value for key, value in (event.get("headers") or {}).items()}
    content_encoding = str(headers.get("content-encoding", "")).lower()
    if "gzip" in content_encoding and raw.startswith(b"\x1f\x8b"):
        try:
            raw = gzip.decompress(raw)
        except (OSError, EOFError) as error:
            raise ValueError("invalid_gzip") from error
    try:
        data = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
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


def compressed_response(status, body):
    encoded = json.dumps(body, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    compressed = gzip.compress(encoded, compresslevel=6)
    return {
        "statusCode": status,
        "isBase64Encoded": True,
        "headers": {
            "content-type": "application/json; charset=utf-8",
            "content-encoding": "gzip",
            "cache-control": "no-store",
            "x-content-type-options": "nosniff",
        },
        "body": base64.b64encode(compressed).decode("ascii"),
    }


def digest(value):
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def timestamp():
    return dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z")


def clean(mapping):
    return {key: value for key, value in mapping.items() if value is not None}
