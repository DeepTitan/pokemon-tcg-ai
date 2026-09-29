"""Offline guards for the disposable staging device-link journey; no SDK/provider calls."""
import contextlib
from copy import deepcopy
import importlib.util
import io
import json
from pathlib import Path
import sys
import time
import unittest
from unittest.mock import Mock, patch

spec = importlib.util.spec_from_file_location('device_link_smoke', Path(__file__).with_name('smoke-trace-device-link-staging.py'))
smoke = importlib.util.module_from_spec(spec)
spec.loader.exec_module(smoke)
SUBJECT = '00000000-0000-0000-0000-000000000002'


def free():
    return {'linked': False, 'plan': 'none', 'status': 'none', 'traceAccess': False,
            'opponentDecklists': False, 'admin': False, 'capabilities': deepcopy(smoke.FREE)}


def supporter():
    return {'linked': True, 'plan': 'supporter', 'status': 'active', 'traceAccess': True,
            'opponentDecklists': True, 'admin': False, 'capabilities': deepcopy(smoke.SUPPORTER),
            'expiresAt': '2100-01-01T00:00:00Z'}


def runner():
    result = smoke.DeviceLink.__new__(smoke.DeviceLink)
    result.guarded, result.register_attempted = True, True
    result.device, result.subject = 'trace-staging-link-smoke-offline', SUBJECT
    result.token = 'synthetic_only_token_' + 'A' * 32
    result.credential_hash, result.created_at = smoke.digest(result.token), '2026-09-29T00:00:00Z'
    result.code_hash, result.rate_keys = 'codehash', set()
    result.devices, result.members = 'capture-staging-owned', 'member-staging-owned'
    result.aws, result.channel = {'dynamodb': Mock()}, Mock()
    return result


class DeviceLinkGuards(unittest.TestCase):
    def test_plan_mode_does_not_construct_sdk_or_private_channel(self):
        with patch.object(sys, 'argv', ['smoke']), patch.object(smoke, 'DeviceLink', side_effect=AssertionError('SDK')), \
                patch.object(smoke, 'load_channel', side_effect=AssertionError('FIFO')), contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(smoke.main(), 0)

    def test_execute_requires_specific_subject_before_any_setup(self):
        for subject in ('', 'owner', 'not-a-subject'):
            with patch.object(sys, 'argv', ['smoke', '--execute', '--control-dir', '/private/tmp/private', '--expected-subject', subject]), \
                    patch.object(smoke, 'load_channel', side_effect=AssertionError('FIFO')), self.assertRaises(RuntimeError):
                smoke.main()

    def test_stack_guard_rejects_other_account_environment_and_production(self):
        stack = {'StackName': smoke.MEMBER_STACK, 'StackStatus': 'UPDATE_COMPLETE',
                 'StackId': f'arn:aws:cloudformation:{smoke.REGION}:{smoke.ACCOUNT}:stack/{smoke.MEMBER_STACK}/fixture',
                 'Parameters': [{'ParameterKey': 'Environment', 'ParameterValue': 'staging'}], 'Outputs': []}
        smoke.validate_stack(stack, smoke.MEMBER_STACK)
        for changed in ({'StackName': 'trace-production'}, {'StackStatus': 'UPDATE_IN_PROGRESS'},
                        {'StackId': stack['StackId'].replace(smoke.ACCOUNT, '111111111111')},
                        {'Parameters': [{'ParameterKey': 'Environment', 'ParameterValue': 'production'}]}):
            with self.assertRaises(RuntimeError):
                smoke.validate_stack({**stack, **changed}, smoke.MEMBER_STACK)

    def test_http_path_allowlist_cannot_start_games_or_use_account_routes(self):
        result = runner()
        result.http = Mock(side_effect=AssertionError('unexpected request'))
        for method, path in [('PUT', '/v1/matches/match'), ('POST', '/v1/devices/link/approve'),
                             ('GET', '/v1/account'), ('POST', 'https://p5xbv2rfya.execute-api.us-east-1.amazonaws.com/v1/register')]:
            with self.assertRaises(RuntimeError):
                result.call(method, path, {})
        result.guarded = False
        with self.assertRaises(RuntimeError):
            result.call('POST', '/v1/register', {})
        result.http.assert_not_called()
        self.assertIsNone(smoke.NoRedirects().redirect_request(None, None, 302, None, None, 'https://evil.test'))

    def test_live_guard_requires_cross_stack_tables_and_physical_api_ownership(self):
        devices = smoke.CAPTURE_STACK + '-TraceDevices-Offline'
        members = smoke.MEMBER_STACK + '-Accounts-Offline'
        def stack(name, params, outputs):
            return {'StackName': name, 'StackStatus': 'UPDATE_COMPLETE',
                    'StackId': f'arn:aws:cloudformation:{smoke.REGION}:{smoke.ACCOUNT}:stack/{name}/fixture',
                    'Parameters': [{'ParameterKey': k, 'ParameterValue': v} for k, v in params.items()],
                    'Outputs': [{'OutputKey': k, 'OutputValue': v} for k, v in outputs.items()]}
        capture = stack(smoke.CAPTURE_STACK, {'Environment': 'staging', 'MembershipApiUrl': smoke.MEMBER_API, 'RequireMembership': 'true'},
                        {'ApiUrl': smoke.CAPTURE_API, 'DevicesTable': devices})
        member = stack(smoke.MEMBER_STACK, {'Environment': 'staging', 'BillingEnabled': 'true', 'StripeMode': 'test',
                                          'OwnerSubject': '', 'WebOrigin': smoke.WEB, 'CaptureDevicesTableName': devices},
                       {'MembershipApiUrl': smoke.MEMBER_API, 'MembershipsTableName': members})
        for wrong_physical in (False, True):
            result = runner()
            result.guarded = False
            cf, sts = Mock(), Mock()
            sts.get_caller_identity.return_value = {'Account': smoke.ACCOUNT}
            cf.describe_stacks.side_effect = lambda **kw: {'Stacks': [capture if kw['StackName'] == smoke.CAPTURE_STACK else member]}
            def resources(**kw):
                row = {'TraceApi': 'production' if wrong_physical else 'wfricgjx12', 'TraceDevices': devices} if smoke.CAPTURE_STACK in kw['StackName'] else {'MembershipApi': 'scn2ntfvfa', 'Accounts': members}
                return {'StackResourceSummaries': [{'LogicalResourceId': k, 'PhysicalResourceId': v} for k, v in row.items()]}
            cf.list_stack_resources.side_effect = resources
            result.aws.update(cloudformation=cf, sts=sts)
            result.item = Mock(return_value={})
            with contextlib.redirect_stdout(io.StringIO()):
                if wrong_physical:
                    with self.assertRaises(RuntimeError):
                        result.guard()
                    self.assertFalse(result.guarded)
                else:
                    result.guard()
                    self.assertTrue(result.guarded)

    def test_device_http_keeps_token_out_of_url_and_output(self):
        result = runner()
        response = Mock()
        response.__enter__ = Mock(return_value=response)
        response.__exit__ = Mock(return_value=None)
        response.code, response.read.return_value = 200, json.dumps(free()).encode()
        result.http = Mock()
        result.http.open.return_value = response
        with contextlib.redirect_stdout(io.StringIO()) as output:
            self.assertEqual(result.call('GET', '/v1/devices/status'), free())
        sent = result.http.open.call_args.args[0]
        self.assertEqual(sent.full_url, smoke.MEMBER_API + '/v1/devices/status')
        self.assertEqual(sent.get_header('Authorization'), 'Bearer ' + result.token)
        self.assertNotIn(result.token, sent.full_url + output.getvalue())

    def test_entitlement_checks_cannot_pass_owner_wrong_plan_or_expiry(self):
        smoke.assert_free(free())
        smoke.assert_supporter(supporter())
        for changed in ({'admin': True}, {'status': 'admin'}, {'plan': 'trace'}, {'linked': False},
                        {'capabilities': smoke.FREE}, {'opponentDecklists': False}, {'expiresAt': '2000-01-01T00:00:00Z'}):
            with self.assertRaises(RuntimeError):
                smoke.assert_supporter({**supporter(), **changed})
        with self.assertRaises(RuntimeError):
            smoke.assert_free({**free(), 'capabilities': smoke.SUPPORTER})

    def test_cleanup_is_conditional_and_only_touches_own_device_records(self):
        result = runner()
        rate = 'RATE#link-start:' + result.device + '#' + str(int(time.time()) // 600)
        result.rate_keys = {rate}
        stored = {
            result.device: {'deviceId': {'S': result.device}, 'tokenHash': {'S': result.credential_hash}, 'createdAt': {'S': result.created_at}},
            'DEVICE#' + result.device: {'credentialHash': {'S': result.credential_hash}},
            'LINK#codehash': {'deviceId': {'S': result.device}, 'credentialHash': {'S': result.credential_hash}},
            rate: {'pk': {'S': rate}, 'attempts': {'N': '1'}, 'ttl': {'N': '1800001200'}},
        }
        result.item = lambda table, key: stored.get(next(iter(key.values()))['S'], {})
        result.aws['dynamodb'].transact_write_items.side_effect = lambda **kw: [stored.pop(next(iter(op['Delete']['Key'].values()))['S'], None) for op in kw['TransactItems']]
        with contextlib.redirect_stdout(io.StringIO()):
            result.cleanup()
        operations = result.aws['dynamodb'].transact_write_items.call_args.kwargs['TransactItems']
        self.assertEqual(len(operations), 4)
        for operation in operations:
            deletion = operation['Delete']
            self.assertTrue(deletion['ConditionExpression'])
            self.assertIn(deletion['TableName'], {result.devices, result.members})
            self.assertNotRegex(next(iter(deletion['Key'].values()))['S'], r'^(?:ACCOUNT|OWNER|CUSTOMER|LOCK)#')
        self.assertIn('tokenHash = :hash AND createdAt = :created', operations[0]['Delete']['ConditionExpression'])
        self.assertIn('credentialHash = :hash', operations[1]['Delete']['ConditionExpression'])
        self.assertIn('deviceId = :device AND credentialHash = :hash', operations[2]['Delete']['ConditionExpression'])
        self.assertNotIn(result.token, json.dumps(operations))

    def test_changed_or_unknown_registration_credential_is_never_deleted(self):
        result = runner()
        result.item = lambda *_: {'tokenHash': {'S': 'foreign'}, 'createdAt': {'S': result.created_at}}
        with self.assertRaises(RuntimeError):
            result.cleanup()
        result.credential_hash = None
        with self.assertRaises(RuntimeError):
            result.cleanup()
        result.aws['dynamodb'].transact_write_items.assert_not_called()
        self.assertNotIn(result.token, json.dumps(result.inventory()))

    def test_workflow_requires_private_browser_approval_before_paid_check_then_unlinks(self):
        result = runner()
        result.guard = Mock()
        code, linked, calls = 'ABCDE-F2345', [False], []
        result.code_hash = None
        expiry = smoke.dt.datetime.fromtimestamp(time.time() + 590, smoke.dt.timezone.utc).isoformat()
        def call(method, path, body=None, expected=200):
            calls.append(path)
            if path == '/v1/register':
                return {'deviceId': result.device, 'token': result.token}
            if path == '/v1/devices/link/start':
                return {'userCode': code, 'expiresAt': expiry, 'verificationUrl': 'https://victoryroad.app/trace/link?code=IGNORED'}
            if path == '/v1/devices/unlink':
                linked[0] = False
            return supporter() if linked[0] else free()
        result.call = call
        def item(table, key):
            value = next(iter(key.values()))['S']
            if table == result.devices:
                return {'tokenHash': {'S': result.credential_hash}, 'createdAt': {'S': result.created_at}}
            if value.startswith('LINK#'):
                return {} if linked[0] else {'deviceId': {'S': result.device}, 'credentialHash': {'S': result.credential_hash}}
            return {'subject': {'S': SUBJECT}, 'credentialHash': {'S': result.credential_hash}} if linked[0] else {}
        result.item = item
        result.channel.command.side_effect = lambda *a, **kw: linked.__setitem__(0, True)
        with contextlib.redirect_stdout(io.StringIO()) as output:
            result.run()
        event = result.channel.emit.call_args
        self.assertEqual(event.args, ('device-link-ready',))
        self.assertEqual(event.kwargs['connectUrl'], smoke.WEB + '/trace/connect?code=' + code)
        self.assertNotIn(code, output.getvalue())
        self.assertNotIn(result.token, output.getvalue() + json.dumps(event.kwargs))
        self.assertEqual(calls, ['/v1/register', '/v1/devices/status', '/v1/devices/link/start',
                                 '/v1/devices/status', '/v1/devices/unlink', '/v1/devices/status'])

    def test_failure_cleans_then_privately_hands_off_before_closing(self):
        channel, result, order = Mock(), Mock(), []
        result.run.side_effect = OSError('do not print token_payload')
        result.cleanup.side_effect = lambda: order.append('cleanup')
        channel.emit.side_effect = lambda *a, **kw: order.append('emit')
        channel.command.side_effect = lambda *a, **kw: order.append('acknowledge')
        channel.close.side_effect = lambda: order.append('close')
        with patch.object(sys, 'argv', ['smoke', '--execute', '--control-dir', '/private/tmp/trace-paid-smoke-offline', '--expected-subject', SUBJECT]), \
                patch.object(smoke, 'load_channel', return_value=Mock(return_value=channel)), \
                patch.object(smoke, 'DeviceLink', return_value=result), contextlib.redirect_stdout(io.StringIO()) as output:
            self.assertEqual(smoke.main(), 1)
        self.assertEqual(order, ['cleanup', 'emit', 'acknowledge', 'close'])
        self.assertNotIn('token_payload', output.getvalue())


if __name__ == '__main__':
    unittest.main()
