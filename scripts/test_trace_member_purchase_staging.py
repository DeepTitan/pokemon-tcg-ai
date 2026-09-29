"""Offline purchase-harness guard/transport tests; no credentials or providers."""
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import secrets
import stat
import subprocess
import sys
import unittest
from unittest.mock import MagicMock, patch

SPEC = importlib.util.spec_from_file_location('purchase_smoke', Path(__file__).with_name('smoke-trace-member-purchase-staging.py'))
smoke = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(smoke)


class PurchaseGuards(unittest.TestCase):
    def test_default_does_not_construct_channels_or_provider_clients(self):
        with patch.object(sys, 'argv', ['smoke']), patch.object(smoke, 'Channel', side_effect=AssertionError('FIFO created')), patch.object(smoke, 'Purchase', side_effect=AssertionError('provider constructed')), contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(smoke.main(), 0)

    def test_only_exact_billing_enabled_sandbox_configuration_is_allowed(self):
        values = {'Environment': 'staging', 'BillingEnabled': 'true', 'StripeMode': 'test', 'OwnerSubject': '', 'WebOrigin': smoke.ORIGIN, 'StripePortalConfigId': smoke.PORTAL, **smoke.PRICES}
        smoke.validate_parameters(values)
        for key, replacement in [('Environment', 'production'), ('BillingEnabled', 'false'), ('StripeMode', 'live'), ('OwnerSubject', 'someone'), ('WebOrigin', 'https://victoryroad.app'), ('TracePriceId', 'price_other'), ('StripePortalConfigId', 'bpc_other')]:
            with self.assertRaises(RuntimeError):
                smoke.validate_parameters({**values, key: replacement})

    def test_provider_urls_reject_live_checkout_and_unexpected_hosts(self):
        smoke.safe_url('https://checkout.stripe.com/c/pay/cs_test_offline#fragment', 'checkout')
        smoke.safe_url('https://billing.stripe.com/p/session/test_offline', 'portal')
        for value in ['https://checkout.stripe.com/c/pay/cs_live_offline', 'https://checkout.stripe.com.evil.test/c/pay/cs_test_offline', 'https://user@checkout.stripe.com/c/pay/cs_test_offline', 'http://checkout.stripe.com/c/pay/cs_test_offline']:
            with self.assertRaises(RuntimeError):
                smoke.safe_url(value, 'checkout')

    def test_portal_query_format_requires_exact_host_and_one_test_secret(self):
        smoke.safe_url('https://billing.stripe.com/p/session?secret=test_offline-123', 'portal')
        for value in ['https://billing.stripe.com/p/session?secret=live_offline',
                      'https://billing.stripe.com/p/session?secret=test_offline&secret=test_other',
                      'https://billing.stripe.com/p/session?secret=test_offline&redirect=https://evil.test',
                      'https://billing.stripe.com/p/session?secret=test_offline%2Fother',
                      'https://billing.stripe.com/p/session?token=test_offline',
                      'https://billing.stripe.com/p/session?secret=test_offline#fragment',
                      'https://billing.stripe.com/p/session?',
                      'https://billing.stripe.com.evil.test/p/session?secret=test_offline',
                      'https://user@billing.stripe.com/p/session?secret=test_offline']:
            with self.assertRaises(RuntimeError):
                smoke.safe_url(value, 'portal')

    def test_private_handoff_is_fifo_only_and_does_not_print_payload(self):
        folder = '/private/tmp/trace-paid-smoke-offline-' + secrets.token_hex(8)
        channel = smoke.Channel(folder)
        reader = os.open(Path(folder) / 'events', os.O_RDONLY | os.O_NONBLOCK)
        try:
            self.assertEqual(stat.S_IMODE(Path(folder).stat().st_mode), 0o700)
            for name in ('events', 'commands'):
                info = (Path(folder) / name).lstat()
                self.assertTrue(stat.S_ISFIFO(info.st_mode))
                self.assertEqual(stat.S_IMODE(info.st_mode), 0o600)
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                channel.emit('payment-ready', login={'password': 'synthetic-only'}, checkoutUrl='synthetic-test-url')
            self.assertEqual(output.getvalue(), '')
            self.assertEqual(json.loads(os.read(reader, 4096))['stage'], 'payment-ready')
            os.write(channel.fds['commands'], b'{"command":"payment-complete"}\n')
            self.assertEqual(channel.command({'payment-complete'}, timeout=1), 'payment-complete')
            os.write(channel.fds['commands'], b'{"command":"cleanup-confirmed"}\n')
            with self.assertRaises(RuntimeError):
                channel.command({'payment-complete'}, timeout=1)
        finally:
            os.close(reader)
            channel.close()
        self.assertFalse(Path(folder).exists())

    def test_http_credentials_only_use_stdin_and_cookie_clears_are_applied(self):
        runner = smoke.Purchase.__new__(smoke.Purchase)
        runner.cookies = {smoke.ACCESS: 'synthetic-access', smoke.PROOF: 'a' * 64}
        def execute(command, **kwargs):
            self.assertNotIn('synthetic-access', ' '.join(command))
            self.assertNotIn('a' * 64, ' '.join(command))
            self.assertIn('synthetic-access', kwargs['input'])
            self.assertTrue(kwargs['capture_output'])
            headers = 'HTTP/2 200\nCache-Control: private, no-store\nSet-Cookie: ' + smoke.PROOF + '=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax\n\n'
            return subprocess.CompletedProcess(command, 0, headers + '{"claimed":true}', '')
        with patch.object(smoke.subprocess, 'run', side_effect=execute):
            self.assertEqual(runner.web('checkout/claim'), {'claimed': True})
        self.assertNotIn(smoke.PROOF, runner.cookies)
        self.assertEqual(runner.cookies[smoke.ACCESS], 'synthetic-access')

    def test_paid_account_cannot_be_cleaned_before_operator_cancels_billing(self):
        runner = smoke.Purchase.__new__(smoke.Purchase)
        runner.main_user = {'subject': 'synthetic'}
        runner.web = lambda *_: {'plan': 'trace', 'status': 'active', 'traceAccess': True}
        runner.item = lambda *_: {'snapshot': {'syncedAt': 101}}
        runner.fixture = lambda: self.fail('fixture must not be touched')
        with patch.object(smoke.time, 'time', return_value=100), contextlib.redirect_stdout(io.StringIO()), self.assertRaises(RuntimeError):
            runner.cleanup_paid()

    def test_stale_none_response_cannot_authorize_cleanup(self):
        runner = smoke.Purchase.__new__(smoke.Purchase)
        runner.main_user = {'subject': 'synthetic'}
        runner.web = lambda *_: {'plan': 'none', 'status': 'none', 'traceAccess': False}
        runner.item = lambda *_: {'snapshot': {'syncedAt': 99, 'plan': 'none', 'status': 'none'}}
        runner.fixture = lambda: self.fail('stale fixture must not be touched')
        with patch.object(smoke.time, 'time', return_value=100), patch.object(smoke.time, 'monotonic', side_effect=[0, 316]), contextlib.redirect_stdout(io.StringIO()), self.assertRaises(RuntimeError):
            runner.cleanup_paid()

    def test_fresh_cleanup_transaction_is_conditioned_on_snapshot_version(self):
        runner = smoke.Purchase.__new__(smoke.Purchase)
        runner.main_user = {'subject': 'synthetic'}
        runner.table, runner.cookies, runner.cleaned = 'staging-only', {}, False
        runner.record = {'claimedBy': 'synthetic'}
        runner.web = lambda *_: {'plan': 'none', 'status': 'none', 'traceAccess': False}
        runner.fixture = lambda: {'customerId': 'cus_offline', 'guestProofHash': 'proof'}
        rows = {'ACCOUNT#synthetic': {'customerId': 'cus_offline', 'snapshot': {'syncedAt': 101, 'plan': 'none', 'status': 'none', 'expiresAt': 0}},
                'CUSTOMER#cus_offline': {'subject': 'synthetic'}, 'GUEST_CUSTOMER#cus_offline': {'proof': 'proof'}, 'GUEST#proof': {'claimedBy': 'synthetic'}}
        runner.item = rows.__getitem__
        runner.aws = {'dynamodb': MagicMock()}
        runner.delete_user = MagicMock()
        with patch.object(smoke.time, 'time', return_value=100), contextlib.redirect_stdout(io.StringIO()):
            runner.cleanup_paid()
        deletion = runner.aws['dynamodb'].transact_write_items.call_args.kwargs['TransactItems'][-1]['Delete']
        self.assertIn('#snapshot.#synced = :synced', deletion['ConditionExpression'])
        self.assertEqual(deletion['ExpressionAttributeValues'][':synced'], {'N': '101'})
        self.assertTrue(runner.cleaned)

    def test_browser_fixture_handoff_does_not_start_checkout(self):
        runner = smoke.Purchase.__new__(smoke.Purchase)
        runner.browser_fixture = True
        runner.expected_tier = 'trace'
        runner.guard = MagicMock()
        runner.user = lambda: {'email': 'synthetic@example.invalid', 'password': 'synthetic-only'}
        runner.fixture = lambda: {'users': []}
        runner.channel = MagicMock()
        runner.channel.command.side_effect = RuntimeError('pause fixture')
        runner.web = MagicMock(side_effect=AssertionError('checkout started before browser'))
        with self.assertRaisesRegex(RuntimeError, 'pause fixture'):
            runner.run()
        self.assertEqual(runner.channel.emit.call_args.args[0], 'browser-fixture-ready')
        runner.web.assert_not_called()

    def test_failure_waits_for_private_inventory_acknowledgment_before_closing(self):
        calls = []
        channel, runner = MagicMock(), MagicMock()
        channel.emit.side_effect = lambda *_, **__: calls.append('emit')
        channel.command.side_effect = lambda allowed: calls.append('acknowledge')
        channel.close.side_effect = lambda: calls.append('close')
        runner.run.side_effect = RuntimeError('controlled failure')
        runner.fixture.return_value = {'users': []}
        with patch.object(sys, 'argv', ['smoke', '--execute', '--control-dir', '/private/tmp/trace-paid-smoke-offline']), patch.object(smoke, 'Channel', return_value=channel), patch.object(smoke, 'Purchase', return_value=runner), contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(smoke.main(), 1)
        self.assertEqual(calls, ['emit', 'acknowledge', 'close'])

    def test_expected_tier_is_explicit_only_for_browser_fixture(self):
        channel, runner = MagicMock(), MagicMock()
        for tier in ('trace', 'supporter'):
            arguments = ['smoke', '--execute', '--control-dir', '/private/tmp/trace-paid-smoke-offline', '--browser-fixture']
            if tier == 'supporter':
                arguments += ['--expected-tier', 'supporter']
            with patch.object(sys, 'argv', arguments), patch.object(smoke, 'Channel', return_value=channel), patch.object(smoke, 'Purchase', return_value=runner) as constructor:
                self.assertEqual(smoke.main(), 0)
            self.assertEqual(constructor.call_args.kwargs['expected_tier'], tier)
        with patch.object(sys, 'argv', ['smoke', '--execute', '--expected-tier', 'supporter']), patch.object(smoke, 'Channel', side_effect=AssertionError('FIFO created')), contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit) as rejected:
            smoke.main()
        self.assertEqual(rejected.exception.code, 2)

    def test_paid_tiers_require_exact_capabilities_and_reject_owner_override(self):
        runner = smoke.Purchase.__new__(smoke.Purchase)
        for tier in ('trace', 'supporter'):
            deck_study = tier == 'supporter'
            account = {'plan': tier, 'status': 'active', 'traceAccess': True, 'admin': False, 'opponentDecklists': deck_study, 'expiresAt': '2100-01-01T00:00:00Z',
                       'capabilities': {'recordMatches': True, 'leaderboard': True, 'recentReplayDays': 7, 'fullHistory': True, 'expandedSharing': True, 'opponentDecklists': deck_study, 'freeSharesPerWindow': 1, 'shareWindowDays': 7}}
            runner.assert_paid(account, tier)
            for changed in ({'plan': 'supporter' if tier == 'trace' else 'trace'}, {'admin': True}, {'status': 'past_due'}, {'opponentDecklists': not deck_study}, {'capabilities': {**account['capabilities'], 'opponentDecklists': not deck_study}}):
                with self.assertRaises(RuntimeError):
                    runner.assert_paid({**account, **changed}, tier)


if __name__ == '__main__':
    unittest.main()
