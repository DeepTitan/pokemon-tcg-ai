import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('capture_deploy_parameters', Path(__file__).parents[1] / 'deploy_parameters.py')
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)


class DeploymentParametersTests(unittest.TestCase):
    def setUp(self):
        self.existing = [{'ParameterKey': 'Environment', 'ParameterValue': 'production'},
                         {'ParameterKey': 'MembershipApiUrl', 'ParameterValue': 'https://member.example.test'},
                         {'ParameterKey': 'RequireMembership', 'ParameterValue': 'true'},
                         {'ParameterKey': 'UnrelatedSecret', 'ParameterValue': '****'}]

    def test_omitted_overrides_preserve_all_existing_values(self):
        self.assertEqual(deploy.parameter_overrides(self.existing, {}), [])

    def test_only_explicit_fields_are_sent_and_retained_url_can_enable_enforcement(self):
        self.assertEqual(deploy.parameter_overrides(self.existing, {'TRACE_REQUIRE_MEMBERSHIP': 'true'}),
                         ['RequireMembership=true'])

    def test_disabling_does_not_clear_the_configured_endpoint(self):
        self.assertEqual(deploy.parameter_overrides(self.existing, {'TRACE_REQUIRE_MEMBERSHIP': 'false'}),
                         ['RequireMembership=false'])

    def test_new_enforcement_needs_an_endpoint_and_existing_enforcement_cannot_lose_it(self):
        for existing, values in (([], {'TRACE_REQUIRE_MEMBERSHIP': 'true'}),
                                 (self.existing, {'TRACE_MEMBERSHIP_API_URL': ''})):
            with self.assertRaises(ValueError):
                deploy.parameter_overrides(existing, values)

    def test_new_disabled_stack_and_explicit_complete_rollout(self):
        self.assertEqual(deploy.parameter_overrides([], {}), [])
        self.assertEqual(deploy.parameter_overrides([], {'TRACE_MEMBERSHIP_API_URL': 'https://member.example.test',
                                                        'TRACE_REQUIRE_MEMBERSHIP': 'true'}),
                         ['MembershipApiUrl=https://member.example.test', 'RequireMembership=true'])

    def test_invalid_inputs_fail_before_any_aws_operation(self):
        for value in ('http://member.test', 'https://user@member.test', 'https://member.test/?token=x', 'sk_live_bad'):
            with self.assertRaises(ValueError):
                deploy.supplied_overrides({'TRACE_MEMBERSHIP_API_URL': value})
        with self.assertRaises(ValueError):
            deploy.supplied_overrides({'TRACE_REQUIRE_MEMBERSHIP': 'yes'})
        with self.assertRaises(ValueError):
            deploy.parameter_overrides(None, {})

    def test_staging_never_publishes_release_api_and_uses_staging_tag(self):
        values = {'TRACE_ENVIRONMENT': 'staging'}
        self.assertEqual(deploy.deployment_settings([], values, 'trace-staging'),
                         {'environment': 'staging', 'publishReleaseApi': False})
        self.assertIn('Environment=staging', deploy.parameter_overrides([], values))
        with self.assertRaises(ValueError):
            deploy.deployment_settings([], {**values, 'TRACE_PUBLISH_RELEASE_API': 'true'}, 'trace-staging')

    def test_even_canonical_production_needs_explicit_publication(self):
        self.assertFalse(deploy.deployment_settings(self.existing, {}, 'trace-production')['publishReleaseApi'])
        self.assertTrue(deploy.deployment_settings(self.existing, {'TRACE_PUBLISH_RELEASE_API': 'true'},
                                                  'trace-production')['publishReleaseApi'])
        with self.assertRaises(ValueError):
            deploy.deployment_settings([], {}, 'trace-new-unknown')
