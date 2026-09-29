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

    def test_stripe_http_failure_logs_only_controlled_diagnostics_and_still_returns_503(self):
        stripe = adapters.Stripe('secret-arn', 'bpc_fixture', False)
        stripe.secrets = lambda: {'secretKey': 'rk_test_CredentialNeverLog'}
        stripe.opener = Mock()
        error = urllib.error.HTTPError(
            'https://api.stripe.com/v1/checkout/sessions?customer=cus_Private', 403,
            'Sensitive HTTP reason', {'Request-Id': 'req_Diagnostic123', 'Authorization': 'Sensitive header'},
            io.BytesIO(json.dumps({'error': {'type': 'invalid_request_error', 'code': 'permission_missing',
                                           'param': 'customer', 'message': 'Sensitive provider message',
                                           'request_log_url': 'https://sensitive.example/log'}}).encode()))
        stripe.opener.open.side_effect = error
        with patch('builtins.print') as logged, self.assertRaises(ApiError) as caught:
            stripe.request('GET', '/v1/checkout/sessions', {'customer': 'cus_Private', 'email': 'private@example.test'})
        self.assertEqual((caught.exception.status, caught.exception.code), (503, 'billing_unavailable'))
        logged.assert_called_once()
        self.assertEqual(json.loads(logged.call_args.args[0]), {
            'event': 'stripe_http_error', 'method': 'GET', 'endpoint': 'checkout_sessions', 'status': 403,
            'requestId': 'req_Diagnostic123', 'type': 'invalid_request_error',
            'code': 'permission_missing', 'param': 'customer'})

    def test_stripe_diagnostics_discard_malformed_oversized_and_sensitive_fields(self):
        bodies = [b'not JSON: rk_test_Private', b'x' * 8193,
                  json.dumps({'error': {'type': 'sk_test_Private', 'code': 'rk_test_Private',
                                        'param': 'customer_private_email', 'message': 'private@example.test'}}).encode(),
                  json.dumps({'error': ['private@example.test']}).encode()]
        for body in bodies:
            with self.subTest(body_size=len(body)):
                stream = io.BytesIO(body)
                error = urllib.error.HTTPError('https://sensitive.example', 400, 'private',
                                               {'Request-Id': 'req_Private\nAuthorization: secret'}, stream)
                with patch('builtins.print') as logged:
                    adapters.log_stripe_http_error('POST', '/v1/checkout/sessions/cs_Private/expire', error)
                self.assertEqual(json.loads(logged.call_args.args[0]), {
                    'event': 'stripe_http_error', 'method': 'POST',
                    'endpoint': 'checkout_session_expire', 'status': 400})
                self.assertTrue(stream.closed)

    def test_stripe_diagnostics_never_log_unknown_method_or_resource_path(self):
        error = urllib.error.HTTPError('https://sensitive.example', 400, 'private', {}, io.BytesIO(b'{}'))
        with patch('builtins.print') as logged:
            adapters.log_stripe_http_error('CUSTOMER_PRIVATE', '/v1/private/customer?token=private', error)
        self.assertEqual(json.loads(logged.call_args.args[0]), {
            'event': 'stripe_http_error', 'method': 'unknown', 'endpoint': 'unknown', 'status': 400})

    def test_standard_and_restricted_keys_work_only_in_their_configured_mode(self):
        for live in (False, True):
            for family in ('sk', 'rk'):
                key = f'{family}_{"live" if live else "test"}_Synthetic123'
                with self.subTest(live=live, family=family):
                    stripe = adapters.Stripe('secret-arn', 'bpc_fixture', live)
                    stripe.secrets_client = Mock()
                    stripe.secrets_client.get_secret_value.return_value = {'SecretString': json.dumps({'secretKey': key})}
                    stripe.opener = MagicMock()
                    stripe.opener.open.return_value.__enter__.return_value = io.BytesIO(b'{"id":"price_fixture"}')
                    stripe.price('price_fixture')
                    sent = stripe.opener.open.call_args.args[0]
                    self.assertEqual(sent.get_header('Authorization'), 'Bearer ' + key)
                    stripe.secrets()
                    stripe.secrets_client.get_secret_value.assert_called_once_with(SecretId='secret-arn')

                    wrong_mode = adapters.Stripe('secret-arn', 'bpc_fixture', not live)
                    wrong_mode.secrets_client = stripe.secrets_client
                    wrong_mode.opener = Mock()
                    with self.assertRaises(ApiError) as caught:
                        wrong_mode.price('price_fixture')
                    self.assertEqual(caught.exception.code, 'billing_unavailable')
                    wrong_mode.opener.open.assert_not_called()
                    self.assertIsNone(wrong_mode._secrets)

    def test_malformed_or_publishable_credentials_never_reach_stripe_or_cache(self):
        for key in (None, 123, [], {}, '', 'rk_test_', 'sk_test_', 'pk_test_Synthetic',
                    'sk_org_Synthetic', ' rk_test_Synthetic', 'rk_test_Synthetic\n',
                    'rk_test_Syn thetic', 'rk_test_Synthetic/123', 'sk_test_Synthetic-123'):
            with self.subTest(key=key):
                stripe = adapters.Stripe('secret-arn', 'bpc_fixture', False)
                stripe.secrets_client = Mock()
                stripe.secrets_client.get_secret_value.return_value = {'SecretString': json.dumps({'secretKey': key})}
                stripe.opener = Mock()
                with self.assertRaises(ApiError) as caught:
                    stripe.price('price_fixture')
                self.assertEqual(caught.exception.code, 'billing_unavailable')
                self.assertIsNone(stripe._secrets)
                self.assertEqual(stripe._secrets_until, 0)
                stripe.opener.open.assert_not_called()

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

    def test_staging_billing_returns_only_to_its_configured_preview_and_live_refuses_it(self):
        origin = 'https://trace-staging.vercel.app'
        stripe = adapters.Stripe('secret-arn', 'bpc_fixture', False, origin)
        stripe.request = Mock(return_value={'url': 'https://billing.stripe.com/p/session/fixture'})
        stripe.guest_checkout('cus_fixture', 'price_fixture', 'proof', 'key', 1234)
        self.assertEqual(stripe.request.call_args.args[2]['success_url'], origin + '/trace/account?checkout=success')
        stripe.portal('cus_fixture')
        self.assertEqual(stripe.request.call_args.args[2]['return_url'], origin + '/trace/account')
        with self.assertRaises(ApiError):
            adapters.Stripe('secret-arn', 'bpc_fixture', True, origin)

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

    def test_auth_rate_limit_aliases_reserved_ttl_and_keeps_atomic_counter(self):
        store = adapters.Store('members', 'devices', 'owner-switch')
        store.limit('auth:synthetic-account-hash', 30, 300, 1234)
        write = store.table.update_item.call_args.kwargs
        self.assertEqual(write['Key'], {'pk': 'RATE#auth:synthetic-account-hash#4'})
        # DynamoDB reserves TTL; using the bare attribute makes every auth call fail.
        self.assertEqual(write['ExpressionAttributeNames'], {'#ttl': 'ttl', '#attempts': 'attempts'})
        self.assertEqual(write['UpdateExpression'], 'SET #ttl = :ttl ADD #attempts :one')
        self.assertEqual(write['ConditionExpression'], 'attribute_not_exists(#attempts) OR #attempts < :maximum')
        self.assertEqual(write['ExpressionAttributeValues'], {':ttl': 1834, ':one': 1, ':maximum': 30})

    def test_rate_limit_exhaustion_is_429_but_provider_failure_is_not_masked(self):
        store = adapters.Store('members', 'devices', 'owner-switch')
        store.table.update_item.side_effect = ClientError('ConditionalCheckFailedException')
        with self.assertRaises(ApiError) as caught:
            store.limit('auth:synthetic-account-hash', 30, 300, 1234)
        self.assertEqual((caught.exception.status, caught.exception.code), (429, 'rate_limited'))
        store.table.update_item.side_effect = ClientError('ValidationException')
        with self.assertRaises(ClientError):
            store.limit('auth:synthetic-account-hash', 30, 300, 1234)
        store.table.update_item.side_effect = None

    def test_cognito_wrong_password_returns_invalid_credentials_401(self):
        cognito = adapters.Cognito(Config('pool', 'client', 'region'))
        cognito.client = Mock()
        cognito.client.initiate_auth.side_effect = ClientError('NotAuthorizedException')
        with self.assertRaises(ApiError) as caught:
            cognito.login('member@example.test', 'synthetic-wrong-password')
        self.assertEqual((caught.exception.status, caught.exception.code), (401, 'invalid_credentials'))

    def test_guest_claim_is_one_transaction_guarding_both_leases_and_customer_ownership(self):
        store = adapters.Store('members', 'devices', 'owner-switch')
        store.table.name = 'members'
        store.claim_guest('proof', 'subject', {'customerId': 'cus_new', 'sessionId': 'cs_paid'},
                          {'plan': 'supporter', 'status': 'active'}, 'cus_old', 'guest-lease', 'account-lease', 1234)
        items = store.client.transact_write_items.call_args.kwargs['TransactItems']
        guards = [item['ConditionCheck'] for item in items if 'ConditionCheck' in item]
        self.assertEqual({entry['Key']['pk']['S'] for entry in guards}, {'LOCK#GUEST#proof', 'LOCK#subject'})
        account = next(item['Update'] for item in items if 'Update' in item)
        self.assertEqual(account['ConditionExpression'], 'customerId = :previous')
        self.assertEqual(account['ExpressionAttributeValues'][':previous'], {'S': 'cus_old'})
        claimed = next(item['Put'] for item in items if item.get('Put', {}).get('Item', {}).get('pk') == {'S': 'GUEST#proof'})
        self.assertIn('sessionId = :session', claimed['ConditionExpression'])
        self.assertIn('attribute_not_exists(claimedBy)', claimed['ConditionExpression'])
        reverse = next(item['Put'] for item in items if item.get('Put', {}).get('Item', {}).get('pk') == {'S': 'CUSTOMER#cus_new'})
        self.assertIn('attribute_not_exists(pk)', reverse['ConditionExpression'])
        retired = next(item['Delete'] for item in items if 'Delete' in item)
        self.assertEqual(retired['Key'], {'pk': {'S': 'CUSTOMER#cus_old'}})
        self.assertIn('#subject = :subject', retired['ConditionExpression'])

    def test_guest_stripe_session_collects_email_and_binds_proof_to_subscription(self):
        stripe = adapters.Stripe('secret-arn', 'bpc_fixture', False)
        stripe.request = Mock(return_value={'id': 'cs_guest'})
        stripe.create_guest_customer('hashed-proof')
        self.assertNotIn('email', stripe.request.call_args.args[2])
        stripe.guest_checkout('cus_guest', 'price_supporter', 'hashed-proof', 'reservation', 1234)
        fields = stripe.request.call_args.args[2]
        self.assertEqual(fields['customer'], 'cus_guest')
        self.assertEqual(fields['metadata[trace_guest]'], 'hashed-proof')
        self.assertEqual(fields['subscription_data[metadata][trace_guest]'], 'hashed-proof')
        self.assertEqual(fields['subscription_data[metadata][trace_reservation]'], 'reservation')
        self.assertNotIn('customer_email', fields)
        stripe.retrieve_checkout('cs_guest')
        self.assertEqual(stripe.request.call_args.args[2]['expand[]'], ['subscription.latest_invoice', 'line_items'])

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
