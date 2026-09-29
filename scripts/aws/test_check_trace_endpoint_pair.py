"""Offline endpoint-pair regressions; generated metadata only, no SDK or API calls."""
import contextlib
from copy import deepcopy
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

spec = importlib.util.spec_from_file_location('endpoint_pair', Path(__file__).with_name('check-trace-endpoint-pair.py'))
check = importlib.util.module_from_spec(spec)
spec.loader.exec_module(check)
CAPTURE = f'https://capture123.execute-api.{check.REGION}.amazonaws.com'
MEMBER = f'https://members123.execute-api.{check.REGION}.amazonaws.com'


def rows(values, kind):
    return [{kind + 'Key': key, kind + 'Value': value} for key, value in values.items()]


def fixture(environment='production'):
    capture, member = check.PAIRS[environment]
    devices = capture + '-TraceDevices-fixture'

    def stack(name, params, outputs, resources):
        return {'stack': {'StackName': name, 'StackStatus': 'UPDATE_COMPLETE',
                         'StackId': f'arn:aws:cloudformation:{check.REGION}:{check.ACCOUNT}:stack/{name}/fixture',
                         'Parameters': rows({'Environment': environment, **params}, 'Parameter'),
                         'Outputs': rows(outputs, 'Output')},
                'resources': [{'LogicalResourceId': logical, 'PhysicalResourceId': physical,
                               'ResourceType': kind, 'ResourceStatus': 'CREATE_COMPLETE'}
                              for logical, physical, kind in resources]}

    return {'callerAccount': check.ACCOUNT,
            'capture': stack(capture, {'MembershipApiUrl': MEMBER, 'RequireMembership': 'true'},
                             {'ApiUrl': CAPTURE, 'DevicesTable': devices},
                             [('TraceApi', 'capture123', 'AWS::ApiGatewayV2::Api'),
                              ('TraceDevices', devices, 'AWS::DynamoDB::Table')]),
            'membership': stack(member, {'CaptureDevicesTableName': devices, 'WebOrigin': check.WEB_ORIGINS[environment]},
                                {'MembershipApiUrl': MEMBER},
                                [('MembershipApi', 'members123', 'AWS::ApiGatewayV2::Api')])}


def set_value(snapshot, service, kind, key, value):
    row = next(row for row in snapshot[service]['stack'][kind + 's'] if row[kind + 'Key'] == key)
    row[kind + 'Value'] = value


def invoke(args):
    output = io.StringIO()
    with contextlib.redirect_stdout(output):
        result = check.main(args)
    return result, json.loads(output.getvalue())


class EndpointPairTests(unittest.TestCase):
    def validate(self, snapshot, environment='production', require_membership=False):
        return check.validate(snapshot, environment, CAPTURE, MEMBER, require_membership)

    def test_matching_production_and_staging_pairs_pass_without_claiming_package_verification(self):
        for environment in check.PAIRS:
            with self.subTest(environment=environment):
                result = self.validate(fixture(environment), environment)
                self.assertTrue(result['pairingVerified'])
                self.assertTrue(result['requireMembership'])
                self.assertFalse(result['packagedAppVerified'])
                self.assertFalse(result['canonicalBrowserApprovalVerified'])
                self.assertEqual(result['membershipDevicePaths'], ['/v1/devices/status', '/v1/devices/link/start', '/v1/devices/unlink'])
                self.assertEqual(result['nativeBrowserLink'], 'https://victoryroad.app/trace/link?code=<user-code>')

    def test_only_exact_https_default_stage_roots_are_accepted(self):
        invalid = [None, '', MEMBER + '/', MEMBER + '/v1', MEMBER + '/v1/devices/status',
                   MEMBER + '?code=private', MEMBER + '#private', MEMBER + ':443',
                   MEMBER.replace('https://', 'http://'), MEMBER.replace('https://', 'https://user:secret@'),
                   MEMBER.replace('us-east-1', 'us-west-2'), MEMBER.replace('amazonaws.com', 'amazonaws.com.evil.invalid'),
                   MEMBER.replace('https://', 'HTTPS://'), ' ' + MEMBER, MEMBER + '\n',
                   'https://localhost', 'https://victoryroad.app/trace/link', 'https://[::1]']
        for value in invalid:
            with self.subTest(value=value), self.assertRaisesRegex(check.GuardError, 'exact_https_api_root_required'):
                check.api_id(value)

    def test_each_release_endpoint_must_match_its_stack_output(self):
        for capture, member in [(MEMBER, MEMBER), (MEMBER, CAPTURE),
                                (CAPTURE.replace('capture123', 'otherapi12'), MEMBER),
                                (CAPTURE, MEMBER.replace('members123', 'otherapi12'))]:
            with self.subTest(capture=capture, member=member), self.assertRaises(check.GuardError):
                check.validate(fixture(), 'production', capture, member)

    def test_cross_stack_parameters_are_checked_in_both_directions(self):
        for service, key, value in [('capture', 'MembershipApiUrl', CAPTURE),
                                    ('capture', 'MembershipApiUrl', ''),
                                    ('membership', 'CaptureDevicesTableName', 'unrelated-device-table')]:
            snapshot = fixture()
            set_value(snapshot, service, 'Parameter', key, value)
            with self.subTest(service=service, key=key), self.assertRaises(check.GuardError):
                self.validate(snapshot)

    def test_wrong_caller_stack_account_region_name_state_and_environment_fail(self):
        snapshot = fixture()
        snapshot['callerAccount'] = '111111111111'
        with self.assertRaisesRegex(check.GuardError, 'wrong_aws_account'):
            self.validate(snapshot)
        for service in ('capture', 'membership'):
            for key, value in [('StackName', 'other-stack'), ('StackStatus', 'UPDATE_IN_PROGRESS'),
                               ('StackStatus', 'UPDATE_ROLLBACK_COMPLETE'),
                               ('StackId', fixture()[service]['stack']['StackId'].replace(check.ACCOUNT, '111111111111')),
                               ('StackId', fixture()[service]['stack']['StackId'].replace(check.REGION, 'us-west-2'))]:
                snapshot = fixture()
                snapshot[service]['stack'][key] = value
                with self.subTest(service=service, key=key, value=value), self.assertRaises(check.GuardError):
                    self.validate(snapshot)
            snapshot = fixture()
            set_value(snapshot, service, 'Parameter', 'Environment', 'staging')
            with self.assertRaisesRegex(check.GuardError, 'stack_environment_mismatch'):
                self.validate(snapshot)

    def test_staging_stack_pair_cannot_masquerade_as_production(self):
        with self.assertRaises(check.GuardError):
            self.validate(fixture('staging'))

    def test_outputs_alone_cannot_fake_resource_ownership(self):
        for service in ('capture', 'membership'):
            for index in range(len(fixture()[service]['resources'])):
                for key, value in [('PhysicalResourceId', 'unowned'), ('ResourceType', 'AWS::S3::Bucket'),
                                   ('ResourceStatus', 'DELETE_COMPLETE')]:
                    snapshot = fixture()
                    snapshot[service]['resources'][index][key] = value
                    with self.subTest(service=service, index=index, key=key), self.assertRaises(check.GuardError):
                        self.validate(snapshot)

    def test_duplicate_parameter_output_or_resource_ids_fail_closed(self):
        for field in ('Parameters', 'Outputs', 'resources'):
            snapshot = fixture()
            rows = snapshot['capture']['resources'] if field == 'resources' else snapshot['capture']['stack'][field]
            rows.append(deepcopy(rows[0]))
            with self.subTest(field=field), self.assertRaisesRegex(check.GuardError, 'invalid_or_duplicate_metadata_key'):
                self.validate(snapshot)

    def test_enforcement_is_reported_and_can_be_required_without_allowing_unknown_state(self):
        snapshot = fixture()
        set_value(snapshot, 'capture', 'Parameter', 'RequireMembership', 'false')
        self.assertFalse(self.validate(snapshot)['requireMembership'])
        with self.assertRaisesRegex(check.GuardError, 'capture_enforcement_not_enabled'):
            self.validate(snapshot, require_membership=True)
        set_value(snapshot, 'capture', 'Parameter', 'RequireMembership', '')
        with self.assertRaisesRegex(check.GuardError, 'capture_enforcement_state_required'):
            self.validate(snapshot)

    def test_web_origin_must_match_environment_and_never_selects_native_link_origin(self):
        for environment in check.PAIRS:
            snapshot = fixture(environment)
            set_value(snapshot, 'membership', 'Parameter', 'WebOrigin', 'https://other.vercel.app')
            with self.subTest(environment=environment), self.assertRaisesRegex(check.GuardError, 'membership_web_origin_mismatch'):
                self.validate(snapshot, environment)

    def test_default_is_a_plan_even_with_release_variables_and_does_not_read_files_or_sdk(self):
        with patch.dict(check.os.environ, {'TRACE_SYNC_API_URL': CAPTURE, 'TRACE_MEMBERSHIP_API_URL': MEMBER}), \
                patch.object(check, 'make_clients', side_effect=AssertionError('SDK')), \
                patch.object(check.Path, 'read_text', side_effect=AssertionError('file read')):
            code, result = invoke([])
        self.assertEqual(code, 0)
        self.assertEqual(result['status'], 'not_checked')
        self.assertFalse(result['pairingVerified'])

    def test_offline_snapshot_validation_redacts_unrelated_parameters(self):
        snapshot = fixture()
        snapshot['membership']['stack']['Parameters'] += rows({'IgnoredSecret': 'PRIVATE_SENTINEL'}, 'Parameter')
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'snapshot.json'
            path.write_text(json.dumps(snapshot))
            with patch.object(check, 'make_clients', side_effect=AssertionError('SDK')):
                code, result = invoke(['--snapshot', str(path), '--capture-api-url', CAPTURE, '--membership-api-url', MEMBER])
        self.assertEqual(code, 0)
        self.assertEqual(result['mode'], 'offline_snapshot')
        self.assertNotIn('PRIVATE_SENTINEL', json.dumps(result))

    def test_invalid_candidate_fails_before_any_aws_client_is_created(self):
        with patch.object(check, 'make_clients', side_effect=AssertionError('SDK')) as clients:
            code, result = invoke(['--check-aws', '--capture-api-url', CAPTURE, '--membership-api-url', MEMBER + '/v1'])
        self.assertEqual(code, 1)
        self.assertFalse(result['pairingVerified'])
        clients.assert_not_called()

    def test_provider_and_argument_failures_do_not_echo_raw_messages(self):
        with patch.object(check, 'make_clients', side_effect=RuntimeError('PRIVATE_SENTINEL')):
            code, result = invoke(['--check-aws', '--capture-api-url', CAPTURE, '--membership-api-url', MEMBER])
        self.assertEqual(code, 1)
        self.assertNotIn('PRIVATE_SENTINEL', json.dumps(result))
        code, result = invoke(['--environment', 'PRIVATE_SENTINEL'])
        self.assertEqual(code, 1)
        self.assertEqual(result['reason'], 'invalid_arguments')
        self.assertNotIn('PRIVATE_SENTINEL', json.dumps(result))

    def test_aws_mode_reads_only_identity_and_fixed_stack_metadata_with_resource_pagination(self):
        snapshot = fixture()
        sts, cf = Mock(spec=['get_caller_identity']), Mock(spec=['describe_stacks', 'list_stack_resources'])
        sts.get_caller_identity.return_value = {'Account': check.ACCOUNT}
        cf.describe_stacks.side_effect = [{'Stacks': [snapshot[kind]['stack']]} for kind in ('capture', 'membership')]
        cf.list_stack_resources.side_effect = [
            {'StackResourceSummaries': snapshot['capture']['resources'][:1], 'NextToken': 'page2'},
            {'StackResourceSummaries': snapshot['capture']['resources'][1:]},
            {'StackResourceSummaries': snapshot['membership']['resources']},
        ]
        with patch.object(check, 'make_clients', return_value={'sts': sts, 'cloudformation': cf}):
            code, result = invoke(['--check-aws', '--capture-api-url', CAPTURE, '--membership-api-url', MEMBER])
        self.assertEqual(code, 0)
        self.assertEqual(result['mode'], 'aws_read_only')
        self.assertFalse(result['cloudWrites'])
        sts.get_caller_identity.assert_called_once_with()
        self.assertEqual([call.kwargs for call in cf.describe_stacks.call_args_list],
                         [{'StackName': name} for name in check.PAIRS['production']])
        self.assertEqual(cf.list_stack_resources.call_args_list[1].kwargs,
                         {'StackName': snapshot['capture']['stack']['StackId'], 'NextToken': 'page2'})

    def test_wrong_aws_identity_stops_before_reading_any_stack(self):
        sts, cf = Mock(), Mock()
        sts.get_caller_identity.return_value = {'Account': '111111111111'}
        with self.assertRaisesRegex(check.GuardError, 'wrong_aws_account'):
            check.read_snapshot({'sts': sts, 'cloudformation': cf}, 'production')
        self.assertEqual(cf.mock_calls, [])

    def test_repeated_pagination_token_fails_instead_of_hanging(self):
        sts, cf = Mock(), Mock()
        sts.get_caller_identity.return_value = {'Account': check.ACCOUNT}
        cf.describe_stacks.return_value = {'Stacks': [fixture()['capture']['stack']]}
        cf.list_stack_resources.return_value = {'StackResourceSummaries': [], 'NextToken': 'same'}
        with self.assertRaisesRegex(check.GuardError, 'invalid_resource_pagination'):
            check.read_snapshot({'sts': sts, 'cloudformation': cf}, 'production')
        self.assertEqual(cf.list_stack_resources.call_count, 2)


if __name__ == '__main__':
    unittest.main()
