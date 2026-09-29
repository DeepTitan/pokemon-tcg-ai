"""Deployment input validation is offline and never invokes AWS."""
import copy
import importlib.util
import json
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).parents[1]
spec = importlib.util.spec_from_file_location('membership_deploy', ROOT / 'deploy.py')
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)


class DeployTests(unittest.TestCase):
    def setUp(self):
        self.config = json.loads((ROOT / 'config.example.json').read_text())
        self.config.update(artifactBucket='trace-fixture-artifacts')
        self.params = self.config['parameters']
        self.params['CaptureDevicesTableName'] = 'trace-existing-devices'

    def test_development_can_use_default_email_and_no_reservation(self):
        self.assertEqual(deploy.validate(self.config)['ReservedConcurrency'], '0')

    def test_cognito_deployment_matches_simple_password_policy(self):
        template = (ROOT / 'template.yml').read_text()
        policy = re.search(r'        PasswordPolicy:\n((?:          .*\n)+)', template).group(1)
        values = dict(re.findall(r'^          (\w+): (\w+)$', policy, re.MULTILINE))
        self.assertEqual(values['MinimumLength'], '8')
        for name in ('RequireLowercase', 'RequireUppercase', 'RequireNumbers', 'RequireSymbols'):
            self.assertEqual(values[name], 'false')

    def test_production_cannot_use_default_cognito_sender(self):
        self.params['Environment'] = 'production'
        with self.assertRaisesRegex(ValueError, 'SES'):
            deploy.validate(self.config)

    def test_ses_all_or_none_and_sender_covered_by_identity(self):
        self.params['SesIdentity'] = 'example.test'
        with self.assertRaisesRegex(ValueError, 'together'):
            deploy.validate(self.config)
        self.params.update(SesFromEmail='trace@example.test', SesRegion='us-east-1')
        deploy.validate(self.config)
        self.params['SesFromEmail'] = 'trace@other.test'
        with self.assertRaisesRegex(ValueError, 'covered'):
            deploy.validate(self.config)
        self.params.update(SesIdentity='trace@example.test', SesFromEmail='Trace <trace@example.test>')
        with self.assertRaisesRegex(ValueError, 'without a display name'):
            deploy.validate(self.config)

    def test_invalid_concurrency_cannot_disable_or_overallocate_accidentally(self):
        for value in ('-1', '1.5', '1001', 'twenty', ''):
            self.params['ReservedConcurrency'] = value
            with self.subTest(value=value), self.assertRaises(ValueError):
                deploy.validate(self.config)
        self.params['ReservedConcurrency'] = '20'
        deploy.validate(self.config)

    def test_live_billing_requires_explicit_flag_and_valid_ids(self):
        self.params.update(BillingEnabled='true', StripeMode='live',
                           StripeSecretArn='arn:aws:secretsmanager:us-east-1:123456789012:secret:trace-fixture',
                           TracePriceId='price_trace', SupporterPriceId='price_supporter', StripePortalConfigId='bpc_trace')
        with self.assertRaisesRegex(ValueError, 'allow-live-billing'):
            deploy.validate(self.config)
        deploy.validate(self.config, allow_live=True)
        self.params['StripeSecretArn'] = 'sk_live_do_not_store'
        with self.assertRaises(ValueError):
            deploy.validate(self.config, allow_live=True)

    def test_unknown_fields_and_missing_configuration_are_not_silently_defaulted(self):
        bad = copy.deepcopy(self.config)
        bad['parameters']['Unexpected'] = 'value'
        with self.assertRaises(ValueError):
            deploy.validate(bad)
        del self.params['ReservedConcurrency']
        with self.assertRaises(ValueError):
            deploy.validate(self.config)

    def test_production_free_service_needs_no_external_community_or_billing_config(self):
        self.params.update(Environment='production', SesIdentity='example.test',
                           SesFromEmail='trace@example.test', SesRegion='us-east-1')
        valid = deploy.validate(self.config)
        self.assertEqual(valid['BillingEnabled'], 'false')
        self.assertEqual(valid['StripeSecretArn'], '')

    def test_preview_origin_is_staging_only_and_cannot_be_a_request_url(self):
        self.params['WebOrigin'] = 'https://trace-staging.vercel.app'
        deploy.validate(self.config)
        self.params['StripeMode'] = 'live'
        with self.assertRaisesRegex(ValueError, 'canonical'):
            deploy.validate(self.config)
        self.params['StripeMode'] = 'test'
        for origin in ('https://attacker.test', 'https://preview.vercel.app/path', 'https://user@preview.vercel.app'):
            self.params['WebOrigin'] = origin
            with self.assertRaises(ValueError):
                deploy.validate(self.config)
