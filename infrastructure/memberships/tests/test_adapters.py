"""Exercise external-boundary adapters with SDK/HTTP fakes; imports cannot contact AWS."""
from contextlib import contextmanager
import importlib.util
import io
import json
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import MagicMock, Mock, patch
import urllib.error
import urllib.request

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'lambda'))
from membership import ApiError, Config


class ClientError(Exception):
    def __init__(self, code):
        self.response = {'Error': {'Code': code}}
        super().__init__('Upstream provider detail must not be logged')


class Serializer:
    def serialize(self, value):
        if isinstance(value, bool):
            return {'BOOL': value}
        if isinstance(value, int):
            return {'N': str(value)}
        if isinstance(value, dict):
            return {'M': {k: self.serialize(v) for k, v in value.items()}}
        return {'S': value}


def load_adapters():
    boto = types.ModuleType('boto3')
    boto.resource, boto.client = Mock(), Mock()
    boto_types = types.ModuleType('boto3.dynamodb.types')
    boto_types.TypeSerializer = Serializer
    exceptions = types.ModuleType('botocore.exceptions')
    exceptions.ClientError = ClientError
    config = types.ModuleType('botocore.config')
    config.Config = Mock()
    modules = {'boto3': boto, 'boto3.dynamodb': types.ModuleType('boto3.dynamodb'),
               'boto3.dynamodb.types': boto_types, 'botocore': types.ModuleType('botocore'),
               'botocore.exceptions': exceptions, 'botocore.config': config}
    spec = importlib.util.spec_from_file_location('membership_test_adapters', Path(__file__).parents[1] / 'lambda/adapters.py')
    module = importlib.util.module_from_spec(spec)
    with patch.dict(sys.modules, modules):
        spec.loader.exec_module(module)
    return module


adapters = load_adapters()


class AdapterTests(unittest.TestCase):
    def setUp(self):
        adapters.boto3.client.reset_mock()
        adapters.boto3.resource.reset_mock()

    def test_stripe_redirect_rejected_without_following_location(self):
        policy = adapters.NoRedirect()
        request = urllib.request.Request('https://api.stripe.com/v1/prices/price_fixture',
                                         headers={'Authorization': 'Bearer synthetic'})
        with self.assertRaises(urllib.error.HTTPError) as caught:
            policy.redirect_request(request, None, 302, 'Found', {}, 'https://untrusted.example/collect')
        caught.exception.close()

    def test_response_urls_reject_other_hosts_userinfo_and_non_https(self):
        for value in ['https://checkout.stripe.com.evil.example/pay/a', 'http://checkout.stripe.com/pay/a',
                      'https://user@checkout.stripe.com/pay/a', 'javascript:alert(1)']:
            with self.subTest(value=value), self.assertRaises(ApiError):
                adapters.allowed_url(value, 'checkout.stripe.com')
        self.assertEqual(adapters.allowed_url('https://checkout.stripe.com/c/pay/test', 'checkout.stripe.com'),
                         'https://checkout.stripe.com/c/pay/test')

    def test_stripe_request_uses_pinned_version_and_fixed_host_with_no_redirects(self):
        stripe = adapters.Stripe('secret-arn', 'bpc_fixture', False)
        stripe.secrets = lambda: {'secretKey': 'sk_test_fixture'}
        stripe.opener = MagicMock()
        stripe.opener.open.return_value.__enter__.return_value = io.BytesIO(b'{"id":"price_fixture"}')
        self.assertEqual(stripe.price('price_fixture'), {'id': 'price_fixture'})
        sent = stripe.opener.open.call_args.args[0]
        self.assertEqual(sent.full_url, 'https://api.stripe.com/v1/prices/price_fixture')
        self.assertEqual(sent.get_header('Stripe-version'), '2024-06-20')
        with self.assertRaises(ApiError):
            stripe.price('../../evil.example')

    def test_sandbox_secret_cannot_be_used_in_live_mode(self):
        stripe = adapters.Stripe('secret-arn', 'bpc_fixture', True)
        stripe.secrets_client = Mock()
        stripe.secrets_client.get_secret_value.return_value = {'SecretString': json.dumps({'secretKey': 'sk_test_fixture'})}
        with self.assertRaises(ApiError) as caught:
            stripe.secrets()
        self.assertEqual(caught.exception.code, 'billing_unavailable')

    def test_checkout_cannot_choose_redirect_or_price_from_client_parameters(self):
        stripe = adapters.Stripe('secret-arn', 'bpc_fixture', False)
        stripe.request = Mock(return_value={'id': 'cs_fixture'})
        stripe.checkout('cus_fixture', 'price_fixture', 'subject', 'key', 1234)
        fields = stripe.request.call_args.args[2]
        self.assertEqual(fields['success_url'], 'https://victoryroad.app/trace/account?checkout=success')
        self.assertEqual(fields['cancel_url'], 'https://victoryroad.app/trace/account?checkout=cancel')
        self.assertEqual(fields['payment_method_types[0]'], 'card')
        self.assertEqual(fields['line_items[0][quantity]'], 1)
        self.assertNotIn('allow_promotion_codes', fields)

    def test_persistence_write_requires_current_lease_and_uses_lowlevel_serialization(self):
        store = adapters.Store('members', 'devices', 'owner-switch')
        store.table.name = 'members'
        store.save_account('subject', {'snapshot': {'plan': 'trace'}}, 'lease-nonce', 1234)
        transaction = store.client.transact_write_items.call_args.kwargs['TransactItems']
        guard = transaction[0]['ConditionCheck']
        self.assertEqual(guard['Key'], {'pk': {'S': 'LOCK#subject'}})
        self.assertEqual(guard['ExpressionAttributeValues'][':nonce'], {'S': 'lease-nonce'})
        self.assertIn('leaseUntil > :now', guard['ConditionExpression'])
        self.assertEqual(transaction[1]['Update']['Key'], {'pk': {'S': 'ACCOUNT#subject'}})
        store.client.transact_write_items.side_effect = ClientError('TransactionCanceledException')
        with self.assertRaises(ApiError) as caught:
            store.save_account('subject', {'snapshot': {'plan': 'trace'}}, 'stale-lease', 1234)
        self.assertEqual(caught.exception.code, 'billing_busy')
        store.client.transact_write_items.side_effect = None

    def test_entitlement_and_device_switch_reads_are_consistent(self):
        store = adapters.Store('members', 'devices', 'owner-switch')
        store.table.get_item.return_value = {'Item': {'pk': 'ACCOUNT#subject'}}
        store.account('subject')
        self.assertTrue(store.table.get_item.call_args.kwargs['ConsistentRead'])
        store.capture_device('device')
        self.assertTrue(store.devices.get_item.call_args.kwargs['ConsistentRead'])
        store.owner_enabled('subject')
        self.assertTrue(store.owners.get_item.call_args.kwargs['ConsistentRead'])

    def test_cognito_resend_hides_unknown_account_and_rejects_throttling(self):
        cognito = adapters.Cognito(Config('pool', 'client', 'region'))
        cognito.client = Mock()
        cognito.client.resend_confirmation_code.side_effect = ClientError('UserNotFoundException')
        self.assertIsNone(cognito.resend('member@example.test'))
        cognito.client.resend_confirmation_code.side_effect = ClientError('TooManyRequestsException')
        with self.assertRaises(ApiError) as caught:
            cognito.resend('member@example.test')
        self.assertEqual(caught.exception.code, 'rate_limited')


if __name__ == '__main__':
    unittest.main()
