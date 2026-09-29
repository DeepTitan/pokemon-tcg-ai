#!/usr/bin/env python3
"""Staging-only Supporters device-link smoke; offline unless --execute.

No match, native app, login, email, payment or account mutation. Browser approval
belongs to the operator. The existing paid-smoke private FIFO Channel is reused
from the sibling web release checkout; no registration token leaves memory.

Run using the AWS CLI's Python runtime (provides awscli.botocore):
  python scripts/aws/smoke-trace-device-link-staging.py --execute \
    --control-dir /private/tmp/trace-paid-smoke-device-UNIQUE \
    --expected-subject VERIFIED_SUPPORTER_COGNITO_UUID

Read events FIFO privately. On device-link-ready, approve connectUrl in the
already signed-in staging Supporters browser, then write {"command":"approved"}
to commands. The script verifies Supporters, unlinks, checks Free, cleans its
own rows, emits completed (or failed), and waits for {"command":"acknowledge"}.
Do not print the code/URL, token, account response or private cleanup inventory.
"""
import argparse
import datetime as dt
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import secrets
import time
import urllib.error
import urllib.request

ACCOUNT = '108241940679'
REGION = 'us-east-1'
CAPTURE_STACK = 'trace-memberships-capture-staging'
MEMBER_STACK = 'trace-memberships-staging'
CAPTURE_API = 'https://wfricgjx12.execute-api.us-east-1.amazonaws.com'
MEMBER_API = 'https://scn2ntfvfa.execute-api.us-east-1.amazonaws.com'
WEB = 'https://trace-memberships-staging-deeptitan-6729s-projects.vercel.app'
CHANNEL_HELPER = Path(__file__).resolve().parents[3] / 'trace-memberships-web-20260927/scripts/smoke-trace-member-purchase-staging.py'
FREE = {'recordMatches': True, 'leaderboard': True, 'recentReplayDays': 7,
        'freeSharesPerWindow': 1, 'shareWindowDays': 7,
        'fullHistory': False, 'expandedSharing': False, 'opponentDecklists': False}
SUPPORTER = {**FREE, 'fullHistory': True, 'expandedSharing': True, 'opponentDecklists': True}


def require(condition, label):
    if not condition:
        raise RuntimeError(label)


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def load_channel():
    require(CHANNEL_HELPER.is_file(), 'reviewed private FIFO helper is unavailable')
    spec = importlib.util.spec_from_file_location('trace_device_private_channel', CHANNEL_HELPER)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.Channel


def values(rows, key, value):
    return {row[key]: row.get(value, '') for row in rows}


def validate_stack(stack, name):
    require(stack.get('StackName') == name and stack.get('StackStatus') in {'CREATE_COMPLETE', 'UPDATE_COMPLETE'}, 'stable exact staging stack required')
    require(re.fullmatch(rf'arn:aws:cloudformation:{REGION}:{ACCOUNT}:stack/{name}/[A-Za-z0-9-]+', stack.get('StackId', '')), 'unexpected staging account or stack ARN')
    params = values(stack.get('Parameters', []), 'ParameterKey', 'ParameterValue')
    require(params.get('Environment') == 'staging', 'explicit staging environment required')
    return params, values(stack.get('Outputs', []), 'OutputKey', 'OutputValue')


def assert_free(status):
    require(status.get('linked') is False and status.get('plan') == 'none' and status.get('status') == 'none'
            and status.get('traceAccess') is False and status.get('opponentDecklists') is False
            and status.get('admin') is False and status.get('capabilities') == FREE, 'exact unlinked Free entitlement required')


def assert_supporter(status):
    require(status.get('linked') is True and status.get('plan') == 'supporter' and status.get('status') == 'active'
            and status.get('traceAccess') is True and status.get('opponentDecklists') is True
            and status.get('admin') is False and status.get('capabilities') == SUPPORTER, 'exact non-owner Supporters entitlement required')
    require(dt.datetime.fromisoformat(status.get('expiresAt', '').replace('Z', '+00:00')) > dt.datetime.now(dt.timezone.utc), 'future paid period required')


class NoRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *_args, **_kwargs):
        return None


class DeviceLink:
    def __init__(self, channel, expected_subject):
        from awscli.botocore.session import Session
        from awscli.botocore.config import Config
        session = Session(profile='default')
        config = Config(retries={'max_attempts': 1}, connect_timeout=5, read_timeout=20, ignore_configured_endpoint_urls=True)
        self.aws = {name: session.create_client(name, region_name=REGION, config=config)
                    for name in ('sts', 'cloudformation', 'dynamodb')}
        self.channel, self.subject = channel, expected_subject
        self.device = 'trace-staging-link-smoke-' + secrets.token_hex(16)
        self.token = self.credential_hash = self.created_at = self.code_hash = None
        self.devices = self.members = None
        self.guarded = self.register_attempted = False
        self.rate_keys = set()
        self.http = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirects())

    def guard(self):
        require(self.aws['sts'].get_caller_identity()['Account'] == ACCOUNT, 'wrong AWS account')
        cf = self.aws['cloudformation']
        capture = cf.describe_stacks(StackName=CAPTURE_STACK)['Stacks']
        member = cf.describe_stacks(StackName=MEMBER_STACK)['Stacks']
        require(len(capture) == len(member) == 1, 'one exact stack per service required')
        cp, co = validate_stack(capture[0], CAPTURE_STACK)
        mp, mo = validate_stack(member[0], MEMBER_STACK)
        require(co.get('ApiUrl') == CAPTURE_API and mo.get('MembershipApiUrl') == MEMBER_API, 'fixed staging endpoints required')
        require(cp.get('MembershipApiUrl') == MEMBER_API and cp.get('RequireMembership') == 'true', 'capture must use enforced staging membership')
        require(mp.get('BillingEnabled') == 'true' and mp.get('StripeMode') == 'test'
                and mp.get('OwnerSubject', '') == '' and mp.get('WebOrigin') == WEB, 'test billing, staging web and no owner required')
        self.devices, self.members = co.get('DevicesTable'), mo.get('MembershipsTableName')
        require(re.fullmatch(CAPTURE_STACK + r'-TraceDevices-[A-Za-z0-9]+', self.devices or '')
                and re.fullmatch(MEMBER_STACK + r'-Accounts-[A-Za-z0-9]+', self.members or '')
                and mp.get('CaptureDevicesTableName') == self.devices, 'staging table linkage required')
        for stack, expected in ((capture[0], {'TraceApi': 'wfricgjx12', 'TraceDevices': self.devices}),
                                (member[0], {'MembershipApi': 'scn2ntfvfa', 'Accounts': self.members})):
            resources = values(cf.list_stack_resources(StackName=stack['StackId'])['StackResourceSummaries'], 'LogicalResourceId', 'PhysicalResourceId')
            require(all(resources.get(key) == value for key, value in expected.items()), 'physical staging resource ownership required')
        require(not self.item(self.devices, {'deviceId': {'S': self.device}}), 'synthetic device must not exist')
        require(not self.item(self.members, {'pk': {'S': 'DEVICE#' + self.device}}), 'synthetic link must not exist')
        self.guarded = True
        print('PASS exact staging APIs, account and physical tables verified', flush=True)

    def item(self, table, key):
        require(table in {self.devices, self.members} and table is not None, 'unapproved table read')
        return self.aws['dynamodb'].get_item(TableName=table, Key=key, ConsistentRead=True).get('Item', {})

    def call(self, method, path, body=None, expected=200):
        require(self.guarded, 'staging preflight must pass before HTTP')
        registration = (method, path) == ('POST', '/v1/register')
        allowed = {('GET', '/v1/devices/status'), ('POST', '/v1/devices/link/start'), ('POST', '/v1/devices/unlink')}
        require(registration or (method, path) in allowed, 'HTTP operation is outside device-link smoke')
        endpoint = CAPTURE_API if registration else MEMBER_API
        headers = {'Accept': 'application/json'}
        if not registration:
            require(bool(self.token), 'synthetic device token required')
            headers.update({'Authorization': 'Bearer ' + self.token, 'X-Trace-Device': self.device})
        if body is not None:
            headers['Content-Type'] = 'application/json'
        request = urllib.request.Request(endpoint + path, data=json.dumps(body).encode() if body is not None else None,
                                         headers=headers, method=method)
        try:
            response = self.http.open(request, timeout=25)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            code, raw = response.code, response.read(65537)
        require(code == expected and len(raw) <= 65536, 'unexpected device-link HTTP response')
        result = json.loads(raw)
        require(isinstance(result, dict), 'object response required')
        return result

    def run(self):
        self.guard()
        self.register_attempted = True
        registered = self.call('POST', '/v1/register', {'deviceId': self.device}, 201)
        self.token = registered.get('token')
        require(registered.get('deviceId') == self.device and isinstance(self.token, str)
                and re.fullmatch(r'[A-Za-z0-9_-]{40,128}', self.token), 'invalid synthetic registration')
        self.credential_hash = digest(self.token)
        device = self.item(self.devices, {'deviceId': {'S': self.device}})
        require(device.get('tokenHash') == {'S': self.credential_hash} and device.get('createdAt', {}).get('S'), 'registered credential ownership required')
        self.created_at = device['createdAt']['S']
        assert_free(self.call('GET', '/v1/devices/status'))
        print('PASS newly registered installation has exact Free access', flush=True)
        bucket = int(time.time()) // 600
        self.rate_keys = {'RATE#link-start:' + self.device + '#' + str(value) for value in (bucket - 1, bucket, bucket + 1)}
        started = self.call('POST', '/v1/devices/link/start', {})
        code = started.get('userCode', '')
        require(isinstance(code, str) and re.fullmatch(r'[A-Z2-7]{5}-[A-Z2-7]{5}', code), 'invalid private link code')
        self.code_hash = digest(code.replace('-', ''))
        expires = dt.datetime.fromisoformat(started.get('expiresAt', '').replace('Z', '+00:00'))
        seconds = int((expires - dt.datetime.now(dt.timezone.utc)).total_seconds())
        require(0 < seconds <= 610, 'bounded link expiry required')
        pending = self.item(self.members, {'pk': {'S': 'LINK#' + self.code_hash}})
        require(pending.get('deviceId') == {'S': self.device} and pending.get('credentialHash') == {'S': self.credential_hash}, 'private link binding required')
        # The server currently advertises a canonical URL. Never navigate it: this
        # smoke constructs only the fixed protected staging connect route.
        self.channel.emit('device-link-ready', userCode=code, connectUrl=WEB + '/trace/connect?code=' + code,
                          expiresAt=started['expiresAt'], deviceId=self.device)
        self.channel.command({'approved'}, timeout=seconds)
        status = self.call('GET', '/v1/devices/status')
        assert_supporter(status)
        linked = self.item(self.members, {'pk': {'S': 'DEVICE#' + self.device}})
        require(linked.get('subject') == {'S': self.subject} and linked.get('credentialHash') == {'S': self.credential_hash}, 'approved account and credential must match fixture')
        require(not self.item(self.members, {'pk': {'S': 'LINK#' + self.code_hash}}), 'approval must consume link code')
        print('PASS explicit browser approval grants exact Supporters to this installation', flush=True)
        assert_free(self.call('POST', '/v1/devices/unlink', {}))
        assert_free(self.call('GET', '/v1/devices/status'))
        require(not self.item(self.members, {'pk': {'S': 'DEVICE#' + self.device}}), 'unlink must remove device association')
        print('PASS unlink immediately restores exact Free access', flush=True)

    def cleanup(self):
        if not self.guarded or not self.register_attempted:
            return
        db = self.aws['dynamodb']
        device = self.item(self.devices, {'deviceId': {'S': self.device}})
        if not self.credential_hash:
            require(not device, 'registration response lost; retain private device inventory for cleanup')
            return
        require(not device or (device.get('tokenHash') == {'S': self.credential_hash}
                              and device.get('createdAt') == {'S': self.created_at}), 'refusing cleanup of changed device ownership')
        deletes = [{'Delete': {'TableName': self.devices, 'Key': {'deviceId': {'S': self.device}},
                               'ConditionExpression': 'attribute_not_exists(deviceId) OR (tokenHash = :hash AND createdAt = :created)',
                               'ExpressionAttributeValues': {':hash': {'S': self.credential_hash}, ':created': {'S': self.created_at}}}},
                   {'Delete': {'TableName': self.members, 'Key': {'pk': {'S': 'DEVICE#' + self.device}},
                               'ConditionExpression': 'attribute_not_exists(pk) OR credentialHash = :hash',
                               'ExpressionAttributeValues': {':hash': {'S': self.credential_hash}}}}]
        if self.code_hash:
            deletes.append({'Delete': {'TableName': self.members, 'Key': {'pk': {'S': 'LINK#' + self.code_hash}},
                                       'ConditionExpression': 'attribute_not_exists(pk) OR (deviceId = :device AND credentialHash = :hash)',
                                       'ExpressionAttributeValues': {':device': {'S': self.device}, ':hash': {'S': self.credential_hash}}}})
        for key in sorted(self.rate_keys):
            row = self.item(self.members, {'pk': {'S': key}})
            if row:
                require(set(row) == {'pk', 'attempts', 'ttl'}, 'unexpected device rate row')
                deletes.append({'Delete': {'TableName': self.members, 'Key': {'pk': {'S': key}},
                                           'ConditionExpression': '#attempts = :attempts AND #ttl = :ttl',
                                           'ExpressionAttributeNames': {'#attempts': 'attempts', '#ttl': 'ttl'},
                                           'ExpressionAttributeValues': {':attempts': row['attempts'], ':ttl': row['ttl']}}})
        db.transact_write_items(TransactItems=deletes)
        for operation in deletes:
            deletion = operation['Delete']
            require(not self.item(deletion['TableName'], deletion['Key']), 'synthetic cleanup verification failed')
        print('PASS conditional cleanup removed only this synthetic device and its known link records', flush=True)

    def inventory(self):
        return {'deviceId': self.device, 'devicesTable': self.devices, 'membershipsTable': self.members,
                'credentialHash': self.credential_hash, 'createdAt': self.created_at,
                'codeHash': self.code_hash, 'rateKeys': sorted(self.rate_keys)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--execute', action='store_true')
    parser.add_argument('--control-dir')
    parser.add_argument('--expected-subject')
    args = parser.parse_args()
    if not args.execute:
        print('Plan only: staging synthetic device registration, browser approval, Supporters/Free checks and conditional cleanup. No provider calls or files created.')
        return 0
    require(args.control_dir and re.fullmatch(r'[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}', args.expected_subject or ''), 'private control directory and verified Supporters subject required')
    channel, runner, failure, cleanup_failed = load_channel()(args.control_dir), None, False, False
    try:
        try:
            runner = DeviceLink(channel, args.expected_subject)
            runner.run()
        except Exception as error:
            failure = True
            print('FAIL ' + (str(error) if type(error) is RuntimeError else type(error).__name__), flush=True)
        finally:
            if runner is not None:
                try:
                    runner.cleanup()
                except Exception:
                    cleanup_failed = failure = True
                    print('FAIL synthetic cleanup needs operator review; private inventory retained', flush=True)
        channel.emit('failed' if failure else 'completed', cleanupRequired=cleanup_failed,
                     **({'inventory': runner.inventory()} if cleanup_failed and runner else {}))
        channel.command({'acknowledge'})
        return 1 if failure else 0
    finally:
        channel.close()


if __name__ == '__main__':
    raise SystemExit(main())
