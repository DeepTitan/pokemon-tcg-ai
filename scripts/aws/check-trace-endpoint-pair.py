#!/usr/bin/env python3
"""Read-only Trace desktop endpoint preflight; offline plan unless given evidence.

--snapshot validates saved CloudFormation metadata without AWS. --check-aws
reads STS identity and the two fixed stacks only, using the AWS CLI Python SDK.
Candidate URLs come from arguments or the two desktop release environment
variables. No registration, API probe, secret retrieval, file or cloud writes.
"""
import argparse
import json
import os
from pathlib import Path
import re

ACCOUNT = '108241940679'
REGION = 'us-east-1'
PAIRS = {
    'production': ('trace-production', 'trace-memberships-production'),
    'staging': ('trace-memberships-capture-staging', 'trace-memberships-staging'),
}
WEB_ORIGINS = {
    'production': 'https://victoryroad.app',
    'staging': 'https://trace-memberships-staging-deeptitan-6729s-projects.vercel.app',
}
API_PATTERN = rf'https://([a-z0-9]{{10}})\.execute-api\.{re.escape(REGION)}\.amazonaws\.com'
DEVICE_PATHS = ['/v1/devices/status', '/v1/devices/link/start', '/v1/devices/unlink']


class GuardError(Exception):
    """Only static reason codes may leave this module on failure."""


def require(condition, reason):
    if not condition:
        raise GuardError(reason)


def api_id(url):
    # These stacks use the root $default stage. Reject /v1, explicit ports,
    # credentials, query/fragment, whitespace and normalization ambiguities.
    match = re.fullmatch(API_PATTERN, url) if isinstance(url, str) else None
    require(match is not None, 'exact_https_api_root_required')
    return match.group(1)


def keyed(rows, key, value):
    require(isinstance(rows, list), 'invalid_metadata_rows')
    result = {}
    for row in rows:
        require(isinstance(row, dict) and isinstance(row.get(key), str)
                and isinstance(row.get(value), str) and row[key] not in result,
                'invalid_or_duplicate_metadata_key')
        result[row[key]] = row[value]
    return result


def stack_metadata(stack, name, environment):
    require(isinstance(stack, dict) and stack.get('StackName') == name
            and stack.get('StackStatus') in {'CREATE_COMPLETE', 'UPDATE_COMPLETE'},
            'exact_completed_stack_required')
    require(re.fullmatch(rf'arn:aws:cloudformation:{REGION}:{ACCOUNT}:stack/{name}/[A-Za-z0-9-]+',
                         stack.get('StackId', '')) is not None, 'wrong_stack_account_region_or_name')
    params = keyed(stack.get('Parameters'), 'ParameterKey', 'ParameterValue')
    outputs = keyed(stack.get('Outputs'), 'OutputKey', 'OutputValue')
    require(params.get('Environment') == environment, 'stack_environment_mismatch')
    return params, outputs


def owned_resource(rows, logical, physical, resource_type):
    ids = keyed(rows, 'LogicalResourceId', 'PhysicalResourceId')
    require(ids.get(logical) == physical, 'resource_ownership_mismatch')
    row = next(item for item in rows if item['LogicalResourceId'] == logical)
    require(row.get('ResourceType') == resource_type
            and row.get('ResourceStatus') in {'CREATE_COMPLETE', 'UPDATE_COMPLETE'},
            'resource_type_or_status_mismatch')


def validate(snapshot, environment, capture_url, member_url, require_membership=False):
    require(environment in PAIRS, 'unsupported_environment')
    capture_id, member_id = api_id(capture_url), api_id(member_url)
    require(capture_id != member_id, 'distinct_service_endpoints_required')
    require(isinstance(snapshot, dict) and snapshot.get('callerAccount') == ACCOUNT, 'wrong_aws_account')
    capture_name, member_name = PAIRS[environment]
    capture, member = snapshot.get('capture'), snapshot.get('membership')
    require(isinstance(capture, dict) and isinstance(member, dict), 'both_stack_snapshots_required')
    cp, co = stack_metadata(capture.get('stack'), capture_name, environment)
    mp, mo = stack_metadata(member.get('stack'), member_name, environment)
    require(co.get('ApiUrl') == capture_url and mo.get('MembershipApiUrl') == member_url,
            'release_endpoints_do_not_match_stack_outputs')
    require(cp.get('MembershipApiUrl') == member_url, 'capture_membership_endpoint_mismatch')
    devices = co.get('DevicesTable')
    require(isinstance(devices, str) and re.fullmatch(r'[A-Za-z0-9_.-]{3,255}', devices)
            and mp.get('CaptureDevicesTableName') == devices, 'membership_capture_device_table_mismatch')
    require(cp.get('RequireMembership') in {'true', 'false'}, 'capture_enforcement_state_required')
    require(not require_membership or cp['RequireMembership'] == 'true', 'capture_enforcement_not_enabled')
    require(mp.get('WebOrigin') == WEB_ORIGINS[environment], 'membership_web_origin_mismatch')
    owned_resource(capture.get('resources'), 'TraceApi', capture_id, 'AWS::ApiGatewayV2::Api')
    owned_resource(capture.get('resources'), 'TraceDevices', devices, 'AWS::DynamoDB::Table')
    owned_resource(member.get('resources'), 'MembershipApi', member_id, 'AWS::ApiGatewayV2::Api')
    # Emit only selected nonsecret values after all guards pass. Never echo raw
    # stacks, parameter sets, SDK exceptions, URLs rejected above or credentials.
    return {'status': 'passed', 'pairingVerified': True, 'environment': environment,
            'account': ACCOUNT, 'region': REGION,
            'captureStack': capture_name, 'membershipStack': member_name,
            'captureApiUrl': capture_url, 'membershipApiUrl': member_url,
            'devicesTable': devices, 'requireMembership': cp['RequireMembership'] == 'true',
            'webOrigin': mp['WebOrigin'], 'membershipDevicePaths': DEVICE_PATHS,
            'nativeBrowserLink': 'https://victoryroad.app/trace/link?code=<user-code>',
            'packagedAppVerified': False, 'canonicalBrowserApprovalVerified': False}


def make_clients(profile):
    try:
        from awscli.botocore.session import Session
        from awscli.botocore.config import Config
    except ImportError:
        try:
            from botocore.session import Session
            from botocore.config import Config
        except ImportError:
            raise GuardError('aws_sdk_unavailable') from None
    session = Session(profile=profile)
    config = Config(retries={'max_attempts': 1}, connect_timeout=5, read_timeout=20,
                    ignore_configured_endpoint_urls=True)
    return {name: session.create_client(name, region_name=REGION, config=config)
            for name in ('sts', 'cloudformation')}


def read_snapshot(clients, environment):
    account = clients['sts'].get_caller_identity().get('Account')
    require(account == ACCOUNT, 'wrong_aws_account')
    result = {'callerAccount': account}
    cf = clients['cloudformation']
    for kind, name in zip(('capture', 'membership'), PAIRS[environment]):
        stacks = cf.describe_stacks(StackName=name).get('Stacks')
        require(isinstance(stacks, list) and len(stacks) == 1, 'one_exact_stack_required')
        stack_metadata(stacks[0], name, environment)
        resources, token, seen = [], None, set()
        while True:
            kwargs = {'StackName': stacks[0]['StackId']}
            if token:
                kwargs['NextToken'] = token
            page = cf.list_stack_resources(**kwargs)
            rows = page.get('StackResourceSummaries')
            require(isinstance(rows, list), 'invalid_resource_page')
            resources.extend(rows)
            token = page.get('NextToken')
            if not token:
                break
            require(isinstance(token, str) and token not in seen and len(seen) < 10,
                    'invalid_resource_pagination')
            seen.add(token)
        result[kind] = {'stack': stacks[0], 'resources': resources}
    return result


class Parser(argparse.ArgumentParser):
    def error(self, message):
        raise GuardError('invalid_arguments')


def main(argv=None):
    mode = 'offline_plan'
    try:
        parser = Parser(description=__doc__)
        parser.add_argument('--environment', choices=tuple(PAIRS), default='production')
        parser.add_argument('--capture-api-url', default=os.environ.get('TRACE_SYNC_API_URL'))
        parser.add_argument('--membership-api-url', default=os.environ.get('TRACE_MEMBERSHIP_API_URL'))
        parser.add_argument('--profile', default='default')
        parser.add_argument('--require-membership', action='store_true',
                            help='also require capture enforcement enabled; pairing alone permits false')
        modes = parser.add_mutually_exclusive_group()
        modes.add_argument('--snapshot', type=Path, help='offline JSON evidence; never fetched implicitly')
        modes.add_argument('--check-aws', action='store_true', help='explicit read-only AWS metadata check')
        args = parser.parse_args(argv)
        if not args.snapshot and not args.check_aws:
            print(json.dumps({'mode': mode, 'status': 'not_checked', 'pairingVerified': False,
                              'environment': args.environment, 'account': ACCOUNT, 'region': REGION,
                              'stacks': list(PAIRS[args.environment]), 'cloudWrites': False,
                              'evidenceRequired': '--snapshot or --check-aws; both candidate URLs required'}))
            return 0
        mode = 'aws_read_only' if args.check_aws else 'offline_snapshot'
        api_id(args.capture_api_url)
        api_id(args.membership_api_url)
        require(re.fullmatch(r'[A-Za-z0-9_.-]{1,64}', args.profile) is not None, 'invalid_profile_name')
        if args.check_aws:
            snapshot = read_snapshot(make_clients(args.profile), args.environment)
        else:
            require(args.snapshot.stat().st_size <= 1024 * 1024, 'snapshot_too_large')
            snapshot = json.loads(args.snapshot.read_text())
        report = validate(snapshot, args.environment, args.capture_api_url, args.membership_api_url,
                          args.require_membership)
        print(json.dumps({'mode': mode, 'cloudWrites': False, **report}, sort_keys=True))
        return 0
    except Exception as error:
        reason = str(error) if isinstance(error, GuardError) else 'metadata_read_or_parse_failed'
        print(json.dumps({'mode': mode, 'status': 'failed', 'pairingVerified': False,
                          'cloudWrites': False, 'reason': reason}, sort_keys=True))
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
