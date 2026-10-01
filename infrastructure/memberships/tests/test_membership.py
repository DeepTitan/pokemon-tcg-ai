"""Offline policy integration tests. No network, account signup, emails, charges, or app launch."""
import base64
from contextlib import contextmanager
from copy import deepcopy
from dataclasses import replace
import hashlib
import hmac
import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'lambda'))
from membership import (ApiError, Config, MembershipService, digest, subscription_snapshot,
                        price_plan, verified_event, password_value)

NOW = 1_800_000_000
OWNER = '00000000-0000-0000-0000-000000000001'
USER = '00000000-0000-0000-0000-000000000002'
DEVICE = 'synthetic-device-000001'
SECRET = 'whsec_offline_only'
CFG = Config('us-east-1_fixture', 'fixture-client', 'us-east-1', OWNER, True, False,
             'price_trace', 'price_supporter')


def price(plan='supporter'):
    return {'id': CFG.prices[plan], 'type': 'recurring', 'currency': 'usd',
            'unit_amount': 3999 if plan == 'supporter' else 1499, 'livemode': False,
            'active': True, 'billing_scheme': 'per_unit',
            'recurring': {'interval': 'month', 'interval_count': 1, 'usage_type': 'licensed'}}


def subscription(plan='supporter', **values):
    result = {'id': 'sub_fixture', 'customer': 'cus_fixture', 'status': 'active', 'livemode': False,
              'current_period_start': NOW - 29 * 86400, 'current_period_end': NOW + 86400,
              'cancel_at_period_end': False,
              'items': {'data': [{'id': 'si_fixture', 'price': price(plan), 'quantity': 1}]}, **values}
    result.setdefault('latest_invoice', {
        'id': 'in_fixture', 'object': 'invoice', 'paid': True, 'status': 'paid', 'livemode': False,
        'subscription': result['id'], 'customer': result['customer'], 'currency': 'usd',
        'billing_reason': 'subscription_cycle', 'amount_paid': price(plan)['unit_amount'],
        'total': price(plan)['unit_amount'], 'amount_remaining': 0,
        'lines': {'has_more': False, 'data': [{
            'id': 'il_fixture', 'object': 'line_item', 'type': 'subscription',
            'subscription': result['id'], 'subscription_item': 'si_fixture',
            'price': price(plan), 'quantity': 1, 'amount': price(plan)['unit_amount'],
            'currency': 'usd', 'livemode': False, 'proration': False,
            'period': {'start': result['current_period_start'], 'end': result['current_period_end']},
        }]},
    })
    return result


def token(subject=USER, **values):
    claims = {'iss': 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_fixture',
              'client_id': 'fixture-client', 'token_use': 'access', 'sub': subject, **values}
    encoded = base64.urlsafe_b64encode(json.dumps(claims).encode()).decode().rstrip('=')
    return 'fixture.' + encoded + '.signature'


def request(path, method='GET', payload=None, account=USER, device=False):
    return {'rawPath': '/v1/' + path, 'requestContext': {'http': {'method': method, 'sourceIp': '127.0.0.1'}},
            'headers': {'authorization': 'Bearer ' + ('capture-secret' if device else token(account)),
                        **({'x-trace-device': DEVICE} if device else {})},
            'body': json.dumps(payload or {})}


def webhook(identifier='evt_fixture', status='active', created=NOW, timestamp=NOW):
    # Status/created deliberately may be stale. Neither must drive entitlement writes.
    value = {'id': identifier, 'type': 'customer.subscription.updated', 'livemode': False,
             'created': created, 'data': {'object': {'customer': 'cus_fixture', 'status': status}}}
    raw = json.dumps(value, separators=(',', ':')).encode()
    signature = hmac.new(SECRET.encode(), str(timestamp).encode() + b'.' + raw, hashlib.sha256).hexdigest()
    return {'rawPath': '/v1/webhook', 'requestContext': {'http': {'method': 'POST'}},
            'body': raw.decode(), 'headers': {'stripe-signature': f't={timestamp},v1={signature}'}}


class FakeStore:
    def __init__(self):
        self.accounts = {USER: {'email': 'member@example.test', 'emailVerified': True, 'customerId': 'cus_fixture'},
                         OWNER: {'email': 'owner@example.test', 'emailVerified': True}}
        self.customers = {'cus_fixture': USER}
        self.devices = {DEVICE: {'tokenHash': digest('capture-secret')}}
        self.links, self.codes, self.events, self.counts = {}, {}, set(), {}
        self.owners, self.locks = {}, {}
        self.fail_save = False
        self.fail_receipt = False

    def account(self, subject):
        return deepcopy(self.accounts.get(subject))

    def remember_account(self, subject, email):
        self.accounts.setdefault(subject, {}).update(email=email, emailVerified=True)

    def owner_enabled(self, subject):
        return self.owners.get(subject) is True

    def capture_device(self, device):
        return deepcopy(self.devices.get(device))

    def device_link(self, device):
        return deepcopy(self.links.get(device))

    def customer_subject(self, customer):
        return self.customers.get(customer)

    @contextmanager
    def account_lock(self, subject, now):
        if subject in self.locks:
            raise ApiError(409, 'billing_busy')
        lease = object()
        self.locks[subject] = lease
        try:
            yield lease
        finally:
            self.locks.pop(subject, None)

    def save_account(self, subject, fields, lease, now):
        if self.fail_save:
            raise RuntimeError('synthetic persistence failure')
        if self.locks.get(subject) is not lease:
            raise ApiError(409, 'billing_busy')
        self.accounts[subject].update(deepcopy(fields))

    def bind_customer(self, subject, customer, lease, now):
        self.save_account(subject, {'customerId': customer}, lease, now)
        self.customers[customer] = subject

    def event_seen(self, event):
        return event in self.events

    def mark_event(self, event, subject, lease, now):
        if self.fail_receipt:
            raise RuntimeError('synthetic receipt failure')
        assert self.locks.get(subject) is lease
        self.events.add(event)

    def limit(self, key, maximum, seconds, now):
        key = (key, now // seconds)
        self.counts[key] = self.counts.get(key, 0) + 1
        if self.counts[key] > maximum:
            raise ApiError(429, 'rate_limited')

    def create_link(self, code_hash, device, credential_hash, expires):
        self.codes[code_hash] = {'device': device, 'hash': credential_hash, 'expires': expires}

    def approve_link(self, code_hash, subject, now):
        link = self.codes.get(code_hash)
        if not link or link['expires'] <= now or self.devices[link['device']]['tokenHash'] != link['hash']:
            raise ApiError(400, 'invalid_code')
        if link['device'] in self.links:
            raise ApiError(409, 'device_already_linked')
        self.links[link['device']] = {'subject': subject, 'credentialHash': link['hash']}
        del self.codes[code_hash]

    def unlink(self, device):
        self.links.pop(device, None)


class FakeCognito:
    def __init__(self):
        self.verified = True
        self.invalid = False
        self.calls = []

    def get_user(self, access_token):
        self.calls.append('get_user')
        if self.invalid:
            raise ApiError(401, 'unauthorized')
        claim = json.loads(base64.urlsafe_b64decode(access_token.split('.')[1] + '=='))
        return {'UserAttributes': [{'Name': 'sub', 'Value': claim['sub']},
                                   {'Name': 'email', 'Value': 'member@example.test'},
                                   {'Name': 'email_verified', 'Value': 'true' if self.verified else 'false'}]}

    def signup(self, email, password):
        self.calls.append('signup')

    def resend(self, email):
        self.calls.append('resend')


class FakeStripe:
    def __init__(self):
        self.current = [subscription()]
        self.calls = []
        self.sessions = {}
        self.failure = False
        self.catalog = {plan: price(plan) for plan in ('trace', 'supporter')}
        self.after_checkout = None
        self.scan_empty = False

    def subscriptions(self, customer):
        self.calls.append('subscriptions')
        if self.failure:
            raise ApiError(503, 'billing_unavailable')
        return deepcopy(self.current)

    def webhook_secret(self):
        return SECRET

    def price(self, identifier):
        return deepcopy(next(p for p in self.catalog.values() if p['id'] == identifier))

    def create_customer(self, email, subject):
        self.calls.append('customer')
        return {'id': 'cus_new'}

    def checkout(self, customer, identifier, subject, key, expires, affiliate=None):
        if key not in self.sessions:
            self.calls.append('create_checkout')
            self.sessions[key] = {'id': 'cs_' + str(len(self.sessions)), 'status': 'open',
                                   'customer': customer, 'client_reference_id': subject,
                                   'mode': 'subscription', 'livemode': False,
                                   'url': 'https://checkout.stripe.com/c/pay/fixture', 'expires_at': expires}
        if self.after_checkout:
            self.after_checkout()
        return deepcopy(self.sessions[key])

    def checkout_sessions(self, customer):
        self.calls.append('checkout_sessions')
        return [] if self.scan_empty else deepcopy([s for s in self.sessions.values() if s['customer'] == customer])

    def retrieve_checkout(self, identifier):
        self.calls.append('retrieve_checkout')
        return deepcopy(next(s for s in self.sessions.values() if s['id'] == identifier))

    def expire_checkout(self, identifier):
        next(s for s in self.sessions.values() if s['id'] == identifier)['status'] = 'expired'
        self.calls.append('expire_checkout')

    def checkout_url(self, session):
        return session['url']

    def portal(self, customer):
        self.calls.append('portal')
        return {'url': 'https://billing.stripe.com/p/session/fixture'}


class MembershipTests(unittest.TestCase):
    def setUp(self):
        self.store, self.cognito, self.stripe = FakeStore(), FakeCognito(), FakeStripe()
        self.clock = NOW
        self.service = MembershipService(CFG, self.store, self.cognito, self.stripe, lambda: self.clock)

    def assert_error(self, code, callback):
        with self.assertRaises(ApiError) as raised:
            callback()
        self.assertEqual(raised.exception.code, code)

    def test_free_capabilities_for_unlinked_and_inactive_accounts(self):
        expected = {'recordMatches': True, 'leaderboard': True, 'recentReplayDays': 7,
                    'freeSharesPerWindow': 1, 'shareWindowDays': 7,
                    'fullHistory': False, 'expandedSharing': False, 'opponentDecklists': False}
        unlinked = self.service.handle(request('devices/status', device=True))
        self.assertFalse(unlinked['linked'])
        self.assertFalse(unlinked['traceAccess'])
        self.assertEqual(unlinked['capabilities'], expected)
        for status in ('canceled', 'past_due', 'unpaid', 'incomplete', 'trialing', 'paused'):
            with self.subTest(status=status):
                self.stripe.current = [subscription(status=status)]
                self.store.accounts[USER].pop('snapshot', None)
                account = self.service.handle(request('account'))
                self.assertEqual(account['capabilities'], expected)
                self.assertFalse(account['traceAccess'])

    def test_new_verified_free_account_can_link_without_billing_setup(self):
        self.service.config = replace(CFG, billing_enabled=False)
        self.store.accounts.pop(USER)
        account = self.service.handle(request('account'))
        self.assertEqual(set(account), {'email', 'plan', 'traceAccess', 'opponentDecklists',
                                      'admin', 'status', 'expiresAt', 'cancelAtPeriodEnd', 'capabilities'})
        self.assertTrue(account['capabilities']['recordMatches'])
        self.assertFalse(account['capabilities']['fullHistory'])
        started = self.service.handle(request('devices/link/start', 'POST', device=True))
        approved = self.service.handle(request('devices/link/approve', 'POST', {'userCode': started['userCode']}))
        self.assertEqual(approved, {'linked': True})
        linked = self.service.handle(request('devices/status', device=True))
        self.assertTrue(linked['linked'])
        self.assertEqual(linked['capabilities'], account['capabilities'])
        self.assertFalse(linked['traceAccess'])
        self.assertEqual(self.stripe.calls, [])

    def test_paid_and_owner_capabilities_preserve_free_baseline(self):
        for plan in ('trace', 'supporter'):
            self.stripe.current = [subscription(plan)]
            self.store.accounts[USER].pop('snapshot', None)
            account = self.service.handle(request('account'))
            caps = account['capabilities']
            self.assertTrue(caps['recordMatches'])
            self.assertTrue(caps['leaderboard'])
            self.assertEqual(caps['recentReplayDays'], 7)
            self.assertTrue(caps['fullHistory'])
            self.assertTrue(caps['expandedSharing'])
            self.assertFalse(caps['opponentDecklists'])
        self.store.owners[OWNER] = True
        owner = self.service.entitlement(OWNER)
        self.assertTrue(owner['capabilities']['opponentDecklists'])
        self.store.owners[OWNER] = False
        revoked = self.service.entitlement(OWNER)
        self.assertTrue(revoked['capabilities']['recordMatches'])
        self.assertFalse(revoked['capabilities']['fullHistory'])

    def test_paid_supporter_and_trace_permissions(self):
        account = self.service.handle(request('account'))
        self.assertTrue(account['traceAccess'])
        self.assertFalse(account['opponentDecklists'])
        self.assertEqual(account['status'], 'active')
        self.stripe.current = [subscription('trace')]
        self.clock += 301
        account = self.service.handle(request('account'))
        self.assertTrue(account['traceAccess'])
        self.assertFalse(account['opponentDecklists'])

    def test_trial_unpaid_past_due_paused_and_expired_deny(self):
        for status in ['trialing', 'past_due', 'unpaid', 'paused', 'incomplete', 'canceled']:
            with self.subTest(status=status):
                self.stripe.current = [subscription(status=status)]
                self.store.accounts[USER].pop('snapshot', None)
                self.assertFalse(self.service.entitlement(USER)['traceAccess'])
        for change in [{'latest_invoice': {'paid': False}}, {'current_period_end': NOW - 1}]:
            self.stripe.current = [subscription(**change)]
            self.store.accounts[USER].pop('snapshot', None)
            self.assertFalse(self.service.entitlement(USER)['traceAccess'])

    def test_cancellation_at_period_end_preserves_paid_time(self):
        self.stripe.current = [subscription(cancel_at_period_end=True, current_period_end=NOW + 10)]
        result = self.service.entitlement(USER)
        self.assertTrue(result['traceAccess'])
        self.assertTrue(result['cancelAtPeriodEnd'])
        self.clock += 11
        self.assertFalse(self.service.entitlement(USER)['traceAccess'])

    def test_owner_switch_immediate_only_pinned_owner_and_independent_of_billing(self):
        self.service.config = replace(CFG, billing_enabled=False)
        self.store.owners[USER] = True  # A mistaken DB grant cannot make another person an admin.
        self.assertFalse(self.service.entitlement(USER)['admin'])
        self.assertFalse(self.service.entitlement(OWNER)['traceAccess'])
        self.store.owners[OWNER] = True
        result = self.service.entitlement(OWNER)
        self.assertEqual((result['admin'], result['status'], result['plan']), (True, 'admin', 'supporter'))
        self.assertTrue(result['opponentDecklists'])
        self.store.owners[OWNER] = False
        self.assertFalse(self.service.entitlement(OWNER)['traceAccess'])
        self.assertEqual(self.stripe.calls, [])

    def test_unverified_owner_never_receives_override(self):
        self.store.owners[OWNER] = True
        self.store.accounts[OWNER]['emailVerified'] = False
        self.assertFalse(self.service.entitlement(OWNER)['admin'])
        self.cognito.verified = False
        self.assert_error('email_not_verified', lambda: self.service.handle(request('account', account=OWNER)))

    def test_forged_and_wrong_pool_or_client_tokens_rejected(self):
        self.cognito.invalid = True
        self.assert_error('unauthorized', lambda: self.service.handle(request('account')))
        self.cognito.invalid = False
        for change in [{'iss': 'https://different.pool'}, {'client_id': 'foreign'}, {'token_use': 'id'}]:
            event = request('account')
            event['headers']['authorization'] = 'Bearer ' + token(**change)
            self.assert_error('unauthorized', lambda: self.service.handle(event))

    def test_customer_cannot_assign_admin_or_subject(self):
        self.assert_error('not_found', lambda: self.service.handle(request('admin', 'POST', {'enabled': True})))
        self.service.handle(request('account', payload={'admin': True, 'subject': OWNER}))
        self.assertFalse(self.store.owner_enabled(USER))

    def test_billing_disabled_and_unknown_prices_fail_closed(self):
        self.service.config = replace(CFG, billing_enabled=False)
        self.assert_error('billing_unavailable', lambda: self.service.checkout(USER, 'member@example.test', 'trace'))
        self.assertFalse(self.service.entitlement(USER)['traceAccess'])
        self.service.config = CFG
        self.stripe.current[0]['items']['data'][0]['price']['unit_amount'] = 1
        self.assertFalse(self.service.entitlement(USER)['traceAccess'])
        self.assertEqual(self.stripe.calls.count('create_checkout'), 0)

    def test_checkout_validates_amount_interval_currency_quantity_and_mode(self):
        for field, value in [('unit_amount', 100), ('currency', 'eur'), ('livemode', True), ('active', False)]:
            with self.subTest(field=field):
                self.stripe.catalog['trace'] = {**price('trace'), field: value}
                self.assert_error('billing_unavailable', lambda: self.service.checkout(USER, 'member@example.test', 'trace'))
        malformed = price('trace')
        malformed['recurring']['interval'] = 'year'
        self.assertIsNone(price_plan(malformed, CFG))
        self.assertEqual(self.stripe.calls.count('create_checkout'), 0)

    def test_checkout_repeated_calls_reuse_current_session(self):
        self.stripe.current = []
        first = self.service.checkout(USER, 'member@example.test', 'trace')
        second = self.service.checkout(USER, 'member@example.test', 'trace')
        self.assertEqual(first, second)
        self.assertEqual(self.stripe.calls.count('create_checkout'), 1)
        self.assertIn('retrieve_checkout', self.stripe.calls)

    def test_checkout_switch_expires_existing_before_new_session(self):
        self.stripe.current = []
        self.service.checkout(USER, 'member@example.test', 'trace')
        self.service.checkout(USER, 'member@example.test', 'supporter')
        self.assertEqual(self.stripe.calls.count('create_checkout'), 2)
        self.assertIn('expire_checkout', self.stripe.calls)

    def test_checkout_failed_response_recovers_without_duplicate_session(self):
        self.stripe.current = []
        self.stripe.after_checkout = lambda: setattr(self.store, 'fail_save', True)
        with self.assertRaises(RuntimeError):
            self.service.checkout(USER, 'member@example.test', 'trace')
        self.store.fail_save = False
        self.stripe.after_checkout = None
        self.service.checkout(USER, 'member@example.test', 'trace')
        self.assertEqual(self.stripe.calls.count('create_checkout'), 1)

    def test_unresolved_checkout_waits_through_unsafe_creation_window_then_retries_at_expiry(self):
        self.stripe.current = []
        pending = {'key': 'original-reservation', 'plan': 'trace', 'expiresAt': NOW + 3600}
        self.store.accounts[USER]['checkout'] = deepcopy(pending)
        for seconds in (29 * 60, 31 * 60, 59 * 60):
            self.clock = NOW + seconds
            self.assert_error('billing_busy', lambda: self.service.checkout(USER, 'member@example.test', 'trace'))
            self.assertEqual(self.store.accounts[USER]['checkout'], pending)
            self.assertNotIn('create_checkout', self.stripe.calls)
        self.clock = pending['expiresAt']
        self.service.checkout(USER, 'member@example.test', 'trace')
        replacement = self.store.accounts[USER]['checkout']
        self.assertNotEqual(replacement['key'], pending['key'])
        self.assertEqual(replacement['expiresAt'], self.clock + 3600)
        self.assertEqual(self.stripe.calls.count('create_checkout'), 1)

    def test_lost_checkout_id_is_recovered_without_creating_with_short_expiry(self):
        self.stripe.current = []
        first = self.service.checkout(USER, 'member@example.test', 'trace')
        pending = self.store.accounts[USER]['checkout']
        identifier = pending.pop('sessionId')
        self.clock = NOW + 31 * 60
        self.stripe.scan_empty = True
        self.assert_error('billing_busy', lambda: self.service.checkout(USER, 'member@example.test', 'trace'))
        self.assertNotIn('sessionId', self.store.accounts[USER]['checkout'])
        self.stripe.scan_empty = False
        self.clock = NOW + 59 * 60
        self.assertEqual(self.service.checkout(USER, 'member@example.test', 'trace'), first)
        self.assertEqual(self.store.accounts[USER]['checkout']['sessionId'], identifier)
        self.assertEqual(self.stripe.calls.count('create_checkout'), 1)

    def test_known_open_checkout_remains_reusable_near_expiry(self):
        self.stripe.current = []
        first = self.service.checkout(USER, 'member@example.test', 'trace')
        self.clock = NOW + 3599
        self.assertEqual(self.service.checkout(USER, 'member@example.test', 'trace'), first)
        self.assertEqual(self.stripe.calls.count('create_checkout'), 1)

    def test_completed_checkout_with_lost_id_is_recovered_after_reservation_expiry(self):
        self.stripe.current = []
        self.service.checkout(USER, 'member@example.test', 'trace')
        self.store.accounts[USER]['checkout'].pop('sessionId')
        next(iter(self.stripe.sessions.values()))['status'] = 'complete'
        self.clock = NOW + 3600
        self.assert_error('payment_processing', lambda: self.service.checkout(USER, 'member@example.test', 'trace'))
        self.assertEqual(self.stripe.calls.count('create_checkout'), 1)

    def test_completed_checkout_allows_repurchase_after_its_exact_subscription_ended(self):
        for terminal in ('canceled', 'incomplete_expired'):
            for lost_id in (False, True):
                with self.subTest(terminal=terminal, lost_id=lost_id):
                    self.setUp()
                    self.stripe.current = []
                    self.service.checkout(USER, 'member@example.test', 'trace')
                    original = next(iter(self.stripe.sessions.values()))
                    ended = subscription('trace', status=terminal, metadata={'trace_subject': USER})
                    original.update(status='complete', subscription=deepcopy(ended))
                    self.stripe.current = [ended]
                    if lost_id:
                        self.store.accounts[USER]['checkout'].pop('sessionId')
                    self.clock = NOW + 31 * 86400
                    self.service.checkout(USER, 'member@example.test', 'supporter')
                    self.assertEqual(self.stripe.calls.count('create_checkout'), 2)
                    self.assertNotEqual(self.store.accounts[USER]['checkout']['sessionId'], original['id'])

    def test_completed_checkout_does_not_assume_missing_or_unbound_subscription_ended(self):
        ended = subscription('trace', status='canceled', metadata={'trace_subject': USER})
        for supplied in (None, 'sub_fixture', {**ended, 'customer': 'cus_foreign'},
                         {**ended, 'metadata': {'trace_subject': OWNER}}, {**ended, 'livemode': True},
                         {**ended, 'status': 'incomplete'}, {**ended, 'id': ''},
                         {**ended, 'items': {'data': []}}):
            with self.subTest(subscription=supplied):
                self.setUp()
                self.stripe.current = []
                self.service.checkout(USER, 'member@example.test', 'trace')
                next(iter(self.stripe.sessions.values())).update(status='complete', subscription=supplied)
                self.clock = NOW + 3600
                self.assert_error('payment_processing', lambda: self.service.checkout(USER, 'member@example.test', 'trace'))
                self.assertEqual(self.stripe.calls.count('create_checkout'), 1)

    def test_lost_checkout_id_recovery_rejects_wrong_bindings_and_ambiguous_matches(self):
        for field, value in (('customer', 'cus_foreign'), ('client_reference_id', OWNER),
                             ('mode', 'payment'), ('livemode', True), ('expires_at', NOW + 7200)):
            with self.subTest(field=field):
                self.setUp()
                self.stripe.current = []
                self.service.checkout(USER, 'member@example.test', 'trace')
                self.store.accounts[USER]['checkout'].pop('sessionId')
                next(iter(self.stripe.sessions.values()))[field] = value
                self.clock = NOW + 31 * 60
                self.assert_error('billing_busy', lambda: self.service.checkout(USER, 'member@example.test', 'trace'))
                self.assertNotIn('sessionId', self.store.accounts[USER]['checkout'])
                self.assertEqual(self.stripe.calls.count('create_checkout'), 1)
        self.setUp()
        self.stripe.current = []
        self.service.checkout(USER, 'member@example.test', 'trace')
        self.store.accounts[USER]['checkout'].pop('sessionId')
        self.stripe.sessions['duplicate'] = {**deepcopy(next(iter(self.stripe.sessions.values()))), 'id': 'cs_other'}
        self.clock = NOW + 31 * 60
        self.assert_error('billing_unavailable', lambda: self.service.checkout(USER, 'member@example.test', 'trace'))
        self.assertNotIn('sessionId', self.store.accounts[USER]['checkout'])
        self.assertEqual(self.stripe.calls.count('create_checkout'), 1)

    def test_saved_checkout_id_is_also_bound_before_returning_its_url(self):
        self.stripe.current = []
        self.service.checkout(USER, 'member@example.test', 'trace')
        next(iter(self.stripe.sessions.values()))['client_reference_id'] = OWNER
        self.assert_error('billing_unavailable', lambda: self.service.checkout(USER, 'member@example.test', 'trace'))
        self.assertEqual(self.stripe.calls.count('create_checkout'), 1)

    def test_duplicate_subscription_rejected(self):
        self.assert_error('subscription_exists', lambda: self.service.checkout(USER, 'member@example.test', 'trace'))
        self.assertNotIn('create_checkout', self.stripe.calls)

    def test_completed_checkout_not_reused_from_cached_stripe_response(self):
        self.stripe.current = []
        self.service.checkout(USER, 'member@example.test', 'trace')
        next(iter(self.stripe.sessions.values()))['status'] = 'complete'
        self.assert_error('payment_processing', lambda: self.service.checkout(USER, 'member@example.test', 'trace'))
        self.assertEqual(self.stripe.calls.count('create_checkout'), 1)

    def test_multiple_active_memberships_fail_closed(self):
        self.stripe.current.append(subscription('trace', id='sub_duplicate'))
        result = self.service.entitlement(USER)
        self.assertFalse(result['traceAccess'])
        self.assertEqual(result['status'], 'subscription_conflict')

    def test_stale_snapshot_requires_fresh_reconciliation_and_outage_denies(self):
        self.assertTrue(self.service.entitlement(USER)['traceAccess'])
        self.stripe.current = [subscription(status='canceled')]
        self.clock += 301
        self.assertFalse(self.service.entitlement(USER)['traceAccess'])
        self.clock += 301
        self.stripe.failure = True
        self.assert_error('billing_unavailable', lambda: self.service.entitlement(USER))

    def test_webhook_signature_checks_raw_body_timestamp_and_mode(self):
        event = webhook()
        event['body'] += ' '
        self.assert_error('invalid_signature', lambda: self.service.handle(event))
        self.assert_error('invalid_signature', lambda: self.service.handle(webhook(timestamp=NOW - 301)))
        self.assert_error('invalid_signature', lambda: self.service.handle(webhook(timestamp=NOW + 301)))
        self.service.config = replace(CFG, stripe_live=True)
        self.assert_error('wrong_billing_mode', lambda: self.service.handle(webhook()))
        self.assertEqual(self.store.events, set())

    def test_duplicate_and_out_of_order_webhooks_use_current_stripe_state(self):
        self.service.handle(webhook())
        self.service.handle(webhook())
        self.assertEqual(self.stripe.calls.count('subscriptions'), 1)
        self.stripe.current = [subscription(status='canceled')]
        self.service.handle(webhook('evt_late', status='active', created=NOW - 5000))
        self.assertFalse(self.service.entitlement(USER)['traceAccess'])

    def test_failed_state_or_receipt_write_is_not_acknowledged(self):
        self.store.fail_save = True
        with self.assertRaises(RuntimeError):
            self.service.handle(webhook())
        self.assertFalse(self.store.events)
        self.store.fail_save = False
        self.store.fail_receipt = True
        with self.assertRaises(RuntimeError):
            self.service.handle(webhook())
        self.assertFalse(self.store.events)
        self.store.fail_receipt = False
        self.service.handle(webhook())
        self.assertTrue(self.store.events)

    def test_concurrent_webhook_cannot_overwrite_locked_account(self):
        with self.store.account_lock(USER, NOW):
            self.assert_error('billing_busy', lambda: self.service.handle(webhook()))
        self.assertFalse(self.store.events)
        self.assertEqual(self.stripe.calls, [])

    def test_link_approval_is_explicit_bound_one_time_and_device_can_unlink(self):
        started = self.service.handle(request('devices/link/start', 'POST', device=True))
        before = self.service.handle(request('devices/status', device=True))
        self.assertFalse(before['linked'])
        self.assertIn('/trace/link?code=', started['verificationUrl'])
        self.service.handle(request('devices/link/approve', 'POST', {'userCode': started['userCode']}))
        after = self.service.handle(request('devices/status', device=True))
        self.assertTrue(after['linked'])
        self.assertFalse(after['opponentDecklists'])
        self.assert_error('invalid_code', lambda: self.service.approve_link(OWNER, started['userCode']))
        self.assert_error('device_already_linked', lambda: self.service.start_link(DEVICE, digest('capture-secret')))
        unlinked = self.service.handle(request('devices/unlink', 'POST', device=True))
        self.assertFalse(unlinked['linked'])
        self.assertFalse(unlinked['traceAccess'])

    def test_rotated_capture_credentials_do_not_inherit_membership(self):
        started = self.service.start_link(DEVICE, digest('capture-secret'))
        self.service.approve_link(OWNER, started['userCode'])
        self.store.owners[OWNER] = True
        self.store.devices[DEVICE]['tokenHash'] = digest('rotated')
        self.assert_error('unauthorized', lambda: self.service.handle(request('devices/status', device=True)))
        event = request('devices/status', device=True)
        event['headers']['authorization'] = 'Bearer rotated'
        result = self.service.handle(event)
        self.assertFalse(result['linked'])
        self.assertFalse(result['admin'])

    def test_expired_and_rotated_pending_link_codes_rejected(self):
        start = self.service.start_link(DEVICE, digest('capture-secret'))
        self.clock += 601
        self.assert_error('invalid_code', lambda: self.service.approve_link(USER, start['userCode']))
        self.clock = NOW
        self.store.devices[DEVICE]['tokenHash'] = digest('changed')
        self.assert_error('invalid_code', lambda: self.service.approve_link(USER, start['userCode']))

    def test_password_accepts_8_to_128_characters_without_composition_requirements(self):
        for password in ('abcdefgh', 'ABCDEFGH', '12345678', '!!!!!!!!', 'a' * 128):
            self.assertEqual(password_value(password), password)
        for password in (None, 12345678, [], '', 'a' * 7, 'a' * 129):
            self.assert_error('invalid_password', lambda: password_value(password))

    def test_link_bruteforce_limits(self):
        for _ in range(12):
            self.assert_error('invalid_code', lambda: self.service.approve_link(USER, 'AAAAAAAAAA'))
        self.assert_error('rate_limited', lambda: self.service.approve_link(USER, 'AAAAAAAAAA'))

    def test_resend_confirmation_returns_generic_success(self):
        result = self.service.handle(request('auth/resend', 'POST', {'email': 'member@example.test'}))
        self.assertEqual(result, {'ok': True})
        self.assertEqual(self.cognito.calls, ['resend'])

    def test_client_billing_fields_never_grant_access(self):
        self.stripe.current = []
        self.service.handle(request('auth/signup', 'POST', {'email': 'member@example.test',
                                 'password': 'SecureOffline123!', 'plan': 'supporter', 'admin': True}))
        self.assertFalse(self.service.entitlement(USER)['traceAccess'])
        self.assertEqual(self.cognito.calls, ['signup'])


if __name__ == '__main__':
    unittest.main()
