"""Guest checkout proof, binding, recovery and current-payment tests. No external calls."""
from copy import deepcopy
import json
import unittest

from test_membership import (CFG, NOW, OWNER, USER, FakeCognito, FakeStore, FakeStripe,
                             MembershipService, ApiError, digest, price, request, subscription, webhook)

TOKEN = 'd7' * 32
PROXY = 'only-the-web-server-knows-this-fixture-proxy-key-0123456789'


class GuestStore(FakeStore):
    def __init__(self):
        super().__init__()
        self.guests, self.guest_customers = {}, {}
        self.fail_guest = False
        self.fail_claim = False
        self.fail_claim_response = False

    def guest(self, proof):
        return deepcopy(self.guests.get(proof))

    def guest_customer_proof(self, customer):
        return self.guest_customers.get(customer)

    def guest_lock(self, proof, now):
        return self.account_lock('GUEST#' + proof, now)

    def save_guest(self, proof, record, lease, now):
        if self.fail_guest:
            raise RuntimeError('Synthetic guest save failure')
        if self.locks.get('GUEST#' + proof) is not lease:
            raise ApiError(409, 'billing_busy')
        self.guests[proof] = deepcopy(record)

    def bind_guest_customer(self, proof, record, lease, now):
        self.save_guest(proof, record, lease, now)
        self.guest_customers[record['customerId']] = proof

    def claim_guest(self, proof, subject, record, snapshot, previous, guest_lease, account_lease, now):
        if self.fail_claim:
            raise RuntimeError('Synthetic transactional claim failure')
        assert self.locks.get('GUEST#' + proof) is guest_lease
        assert self.locks.get(subject) is account_lease
        assert self.accounts[subject].get('customerId') == previous
        assert self.customers.get(record['customerId']) in (None, subject)
        assert self.guests[proof].get('claimedBy') in (None, subject)
        assert self.guests[proof]['sessionId'] == record['sessionId']
        if previous and previous != record['customerId']:
            assert self.customers.get(previous) in (None, subject)
            self.customers.pop(previous, None)
        self.accounts[subject].update(customerId=record['customerId'], snapshot=deepcopy(snapshot))
        self.accounts[subject].pop('checkout', None)
        self.customers[record['customerId']] = subject
        self.guests[proof] = {**deepcopy(record), 'claimedBy': subject, 'claimedAt': now, 'ttl': now + 90 * 86400}
        if self.fail_claim_response:
            raise RuntimeError('Synthetic lost response after commit')


class GuestStripe(FakeStripe):
    def __init__(self):
        super().__init__()
        self.current = []
        self.by_customer = {}
        self.created_customers = {}
        self.scan_empty = False
        self.fail_subscriptions = False
        self.after_guest_checkout = None
        self.after_expire = None

    def proxy_secret(self):
        return PROXY

    def create_guest_customer(self, proof):
        self.calls.append('create_guest_customer')
        if proof not in self.created_customers:
            self.created_customers[proof] = {'id': 'cus_guest' + str(len(self.created_customers))}
        return deepcopy(self.created_customers[proof])

    def subscriptions(self, customer):
        self.calls.append('subscriptions')
        if self.fail_subscriptions:
            raise ApiError(503, 'billing_unavailable')
        return deepcopy(self.by_customer.get(customer, self.current if customer == 'cus_fixture' else []))

    def guest_checkout(self, customer, identifier, proof, key, expires, affiliate=None):
        if key not in self.sessions:
            self.calls.append('create_guest_checkout')
            plan = next(p for p, value in CFG.prices.items() if value == identifier)
            self.sessions[key] = {
                'id': 'cs_guest' + str(len(self.sessions)), 'status': 'open', 'payment_status': 'unpaid',
                'mode': 'subscription', 'livemode': False, 'customer': customer,
                'client_reference_id': 'guest_' + proof,
                'metadata': {'trace_guest': proof, 'trace_reservation': key},
                'line_items': {'data': [{'price': price(plan), 'quantity': 1}], 'has_more': False},
                'url': 'https://checkout.stripe.com/c/pay/guest', 'expires_at': expires,
            }
        if self.after_guest_checkout:
            self.after_guest_checkout()
        return deepcopy(self.sessions[key])

    def checkout_sessions(self, customer):
        self.calls.append('checkout_sessions')
        return [] if self.scan_empty else deepcopy([s for s in self.sessions.values() if s['customer'] == customer])

    def expire_checkout(self, identifier):
        super().expire_checkout(identifier)
        if self.after_expire:
            self.after_expire()

    def complete(self, proof, email='member@example.test'):
        session = next(s for s in self.sessions.values() if s['metadata']['trace_guest'] == proof and s['status'] == 'open')
        plan = next(p for p, value in CFG.prices.items() if value == session['line_items']['data'][0]['price']['id'])
        sub = subscription(plan, id='sub_guest', customer=session['customer'], metadata=deepcopy(session['metadata']))
        session.update(status='complete', payment_status='paid', customer_details={'email': email}, subscription=sub)
        self.by_customer[session['customer']] = [deepcopy(sub)]
        return session


class GuestCheckoutTests(unittest.TestCase):
    def setUp(self):
        self.store, self.stripe, self.cognito = GuestStore(), GuestStripe(), FakeCognito()
        self.now = NOW
        self.service = MembershipService(CFG, self.store, self.cognito, self.stripe, lambda: self.now)
        self.proof = digest(TOKEN)

    def assert_error(self, code, callback):
        with self.assertRaises(ApiError) as error:
            callback()
        self.assertEqual(error.exception.code, code)

    def event(self, action, body=None):
        result = request('checkout/' + action, 'POST', {'checkoutToken': TOKEN, **(body or {})})
        result['headers']['x-trace-proxy-key'] = PROXY
        return result

    def buy(self):
        self.service.guest_checkout('supporter', TOKEN)
        return self.stripe.complete(self.proof)

    def test_proxy_key_required_for_guest_status_and_claim(self):
        for action in ('guest', 'status', 'claim'):
            event = self.event(action, {'plan': 'supporter'})
            event['headers'].pop('x-trace-proxy-key')
            self.assert_error('unauthorized', lambda: self.service.handle(event))
        self.assertEqual(self.stripe.calls, [])

    def test_unknown_valid_proof_status_safe_none_and_invalid_token_denied(self):
        self.assertEqual(self.service.handle(self.event('status')), {'state': 'none', 'plan': 'none', 'expiresAt': None})
        self.assert_error('checkout_not_found', lambda: self.service.guest_checkout('trace', 'short'))
        self.assert_error('checkout_not_found', lambda: self.service.claim_checkout(USER, 'member@example.test', ''))
        self.assertEqual(self.stripe.calls, [])

    def test_guest_needs_no_account_and_same_token_reuses_session(self):
        first = self.service.handle(self.event('guest', {'plan': 'supporter'}))
        second = self.service.handle(self.event('guest', {'plan': 'supporter'}))
        self.assertEqual(first, second)
        self.assertEqual(self.cognito.calls, [])
        self.assertEqual(self.stripe.calls.count('create_guest_checkout'), 1)
        self.assertNotIn(TOKEN, json.dumps(self.store.guests))
        self.assertEqual(self.service.guest_status(TOKEN)['state'], 'open')

    def test_guest_plan_change_expires_old_checkout_before_new(self):
        self.service.guest_checkout('trace', TOKEN)
        self.service.guest_checkout('supporter', TOKEN)
        self.assertEqual(self.stripe.calls.count('create_guest_checkout'), 2)
        self.assertEqual(self.stripe.calls.count('expire_checkout'), 1)
        self.assertEqual([s['status'] for s in self.stripe.sessions.values()], ['expired', 'open'])

    def test_paid_guest_never_creates_second_checkout(self):
        self.buy()
        self.assert_error('payment_already_completed', lambda: self.service.guest_checkout('trace', TOKEN))
        self.assertEqual(self.stripe.calls.count('create_guest_checkout'), 1)

    def test_lost_creation_response_reuses_original_key_even_when_list_is_empty(self):
        self.stripe.after_guest_checkout = lambda: setattr(self.store, 'fail_guest', True)
        with self.assertRaises(RuntimeError):
            self.service.guest_checkout('trace', TOKEN)
        original_key = self.store.guests[self.proof]['key']
        self.store.fail_guest = False
        self.stripe.after_guest_checkout = None
        self.stripe.scan_empty = True
        self.service.guest_checkout('trace', TOKEN)
        self.assertEqual(self.store.guests[self.proof]['key'], original_key)
        self.assertEqual(self.stripe.calls.count('create_guest_checkout'), 1)

    def test_customer_only_partial_record_recovers_without_key_error(self):
        self.store.guests[self.proof] = {'customerId': 'cus_guest0', 'createdAt': NOW, 'claimExpiresAt': NOW + 90 * 86400}
        self.store.guest_customers['cus_guest0'] = self.proof
        result = self.service.guest_checkout('trace', TOKEN)
        self.assertTrue(result['url'].startswith('https://checkout.stripe.com/'))
        self.assertEqual(self.stripe.calls.count('create_guest_customer'), 0)

    def test_unresolved_guest_waits_through_unsafe_creation_window_then_retries_at_expiry(self):
        original = {'customerId': 'cus_guest0', 'createdAt': NOW, 'claimExpiresAt': NOW + 90 * 86400,
                    'key': 'original-reservation', 'plan': 'trace', 'expiresAt': NOW + 3600}
        self.store.guests[self.proof] = deepcopy(original)
        for seconds in (29 * 60, 31 * 60, 59 * 60):
            self.now = NOW + seconds
            self.assert_error('billing_busy', lambda: self.service.guest_checkout('trace', TOKEN))
            self.assertEqual(self.store.guests[self.proof], original)
            self.assertNotIn('create_guest_checkout', self.stripe.calls)
        self.now = original['expiresAt']
        self.service.guest_checkout('trace', TOKEN)
        replacement = self.store.guests[self.proof]
        self.assertNotEqual(replacement['key'], original['key'])
        self.assertEqual(replacement['expiresAt'], self.now + 3600)
        self.assertEqual(self.stripe.calls.count('create_guest_checkout'), 1)

    def test_lost_guest_id_recovers_open_session_even_with_short_remaining_expiry(self):
        first = self.service.guest_checkout('trace', TOKEN)
        identifier = self.store.guests[self.proof].pop('sessionId')
        self.now = NOW + 31 * 60
        self.stripe.scan_empty = True
        self.assert_error('billing_busy', lambda: self.service.guest_checkout('trace', TOKEN))
        self.assertNotIn('sessionId', self.store.guests[self.proof])
        self.stripe.scan_empty = False
        self.now = NOW + 59 * 60
        self.assertEqual(self.service.guest_checkout('trace', TOKEN), first)
        self.assertEqual(self.store.guests[self.proof]['sessionId'], identifier)
        self.assertEqual(self.stripe.calls.count('create_guest_checkout'), 1)

    def test_known_open_guest_session_remains_reusable_near_expiry(self):
        first = self.service.guest_checkout('trace', TOKEN)
        self.now = NOW + 3599
        self.assertEqual(self.service.guest_checkout('trace', TOKEN), first)
        self.assertEqual(self.stripe.calls.count('create_guest_checkout'), 1)

    def test_lost_session_id_recovers_paid_session_after_checkout_and_idempotency_expiry(self):
        self.buy()
        self.store.guests[self.proof].pop('sessionId')
        self.now += 2 * 86400
        self.assert_error('payment_already_completed', lambda: self.service.guest_checkout('supporter', TOKEN))
        self.assertEqual(self.stripe.calls.count('create_guest_checkout'), 1)
        self.assertIn('sessionId', self.store.guests[self.proof])

    def test_status_exposes_no_email_customer_session_or_proof_and_paid_retained(self):
        self.buy()
        result = self.service.guest_status(TOKEN)
        self.assertEqual(result, {'state': 'paid', 'plan': 'supporter', 'expiresAt': None})
        record = self.store.guests[self.proof]
        self.assertNotIn('ttl', record)
        self.assertNotIn('claimExpiresAt', record)
        self.assertTrue(record['paidAt'])

    def test_paid_webhook_retains_unclaimed_purchase_without_browser_return(self):
        session = self.buy()
        # A verified webhook is exercised through core handler after substituting its
        # synthetic customer ID before signing using the existing helper's signature.
        from test_membership import SECRET
        import hashlib
        import hmac
        event = webhook()
        value = json.loads(event['body'])
        value['data']['object']['customer'] = session['customer']
        event['body'] = json.dumps(value)
        signature = hmac.new(SECRET.encode(), str(NOW).encode() + b'.' + event['body'].encode(), hashlib.sha256).hexdigest()
        event['headers']['stripe-signature'] = f't={NOW},v1={signature}'
        self.assertEqual(self.service.handle(event), {'received': True})
        self.assertNotIn('ttl', self.store.guests[self.proof])
        self.assertNotIn('claimedBy', self.store.guests[self.proof])
        self.assertFalse(self.service.entitlement(USER)['traceAccess'])

    def test_claim_requires_verified_matching_checkout_email(self):
        self.buy()
        self.cognito.verified = False
        self.assert_error('email_not_verified', lambda: self.service.handle(self.event('claim')))
        self.cognito.verified = True
        self.assert_error('checkout_email_mismatch', lambda: self.service.claim_checkout(USER, 'other@example.test', TOKEN))
        self.assertNotIn('claimedBy', self.store.guests[self.proof])

    def test_paid_claim_binds_customer_and_snapshot_atomically_then_retry_is_safe(self):
        session = self.buy()
        result = self.service.handle(self.event('claim'))
        self.assertEqual(result, {'claimed': True})
        self.assertEqual(self.store.customers[session['customer']], USER)
        self.assertNotIn('cus_fixture', self.store.customers)
        self.assertFalse(self.service.entitlement(USER)['opponentDecklists'])
        self.assertEqual(self.service.handle(self.event('claim')), {'claimed': True})
        self.assertEqual(self.service.guest_status(TOKEN)['state'], 'claimed')
        self.assert_error('purchase_already_claimed', lambda: self.service.claim_checkout(OWNER, 'member@example.test', TOKEN))

    def test_failed_claim_transaction_leaves_purchase_claimable_without_partial_grant(self):
        self.buy()
        self.store.fail_claim = True
        with self.assertRaises(RuntimeError):
            self.service.handle(self.event('claim'))
        self.assertNotIn('claimedBy', self.store.guests[self.proof])
        self.assertEqual(self.store.accounts[USER]['customerId'], 'cus_fixture')
        self.assertFalse(self.service.entitlement(USER)['traceAccess'])
        self.store.fail_claim = False
        self.assertEqual(self.service.handle(self.event('claim')), {'claimed': True})

    def test_lost_response_after_atomic_claim_recovers_idempotently(self):
        self.buy()
        self.store.fail_claim_response = True
        with self.assertRaises(RuntimeError):
            self.service.handle(self.event('claim'))
        self.assertTrue(self.service.entitlement(USER)['traceAccess'])
        self.store.fail_claim_response = False
        self.assertEqual(self.service.handle(self.event('claim')), {'claimed': True})

    def test_abandoned_old_account_checkout_expires_before_customer_replaced(self):
        self.buy()
        self.stripe.current = [subscription(status='canceled')]
        self.stripe.sessions['old'] = {'id': 'cs_old', 'customer': 'cus_fixture', 'status': 'open',
                                      'client_reference_id': USER, 'mode': 'subscription'}
        self.service.handle(self.event('claim'))
        self.assertEqual(self.stripe.sessions['old']['status'], 'expired')
        self.assertNotIn('cus_fixture', self.store.customers)
        self.assertEqual(self.store.accounts[USER]['customerId'], 'cus_guest0')

    def test_existing_active_membership_never_overwritten_by_duplicate_guest_purchase(self):
        self.buy()
        self.stripe.current = [subscription()]
        self.assert_error('subscription_exists', lambda: self.service.handle(self.event('claim')))
        self.assertEqual(self.store.accounts[USER]['customerId'], 'cus_fixture')
        self.assertNotIn('claimedBy', self.store.guests[self.proof])

    def test_old_checkout_completing_during_retirement_does_not_allow_duplicate_binding(self):
        self.buy()
        self.stripe.sessions['old'] = {'id': 'cs_old', 'customer': 'cus_fixture', 'status': 'open',
                                      'client_reference_id': USER, 'mode': 'subscription'}
        self.stripe.after_expire = lambda: setattr(self.stripe, 'current', [subscription()])
        self.assert_error('subscription_exists', lambda: self.service.handle(self.event('claim')))
        self.assertNotIn('claimedBy', self.store.guests[self.proof])

    def test_old_paid_session_canceled_unpaid_or_conflicting_current_subscription_never_grants(self):
        for status in ('canceled', 'past_due', 'unpaid', 'incomplete'):
            with self.subTest(status=status):
                self.setUp()
                session = self.buy()
                session['subscription']['status'] = status
                self.stripe.by_customer[session['customer']][0]['status'] = status
                self.assert_error('purchase_not_active', lambda: self.service.handle(self.event('claim')))
                self.assertNotIn('claimedBy', self.store.guests[self.proof])
        self.setUp()
        session = self.buy()
        self.stripe.by_customer[session['customer']].append(subscription(customer=session['customer'], id='sub_conflict'))
        self.assert_error('purchase_not_active', lambda: self.service.handle(self.event('claim')))

    def test_session_binding_price_livemode_metadata_mismatches_deny_claim(self):
        for field, value in [('customer', 'cus_other'), ('livemode', True), ('client_reference_id', 'guest_other')]:
            with self.subTest(field=field):
                self.setUp()
                session = self.buy()
                session[field] = value
                self.assert_error('billing_unavailable', lambda: self.service.handle(self.event('claim')))
                self.assertNotIn('claimedBy', self.store.guests[self.proof])
        self.setUp()
        session = self.buy()
        session['line_items']['data'][0]['price']['unit_amount'] = 1
        self.assert_error('billing_unavailable', lambda: self.service.handle(self.event('claim')))

    def test_prior_tier_paid_invoice_cannot_be_claimed_as_supporter(self):
        session = self.buy()
        prior_invoice = subscription('trace', id=session['subscription']['id'],
                                     customer=session['customer'])['latest_invoice']
        session['subscription']['latest_invoice'] = prior_invoice
        self.stripe.by_customer[session['customer']][0]['latest_invoice'] = deepcopy(prior_invoice)
        self.assert_error('purchase_not_active', lambda: self.service.handle(self.event('claim')))
        self.assertNotIn('claimedBy', self.store.guests[self.proof])
        self.assertEqual(self.store.accounts[USER]['customerId'], 'cus_fixture')

    def test_complete_purchase_with_inactive_billing_blocks_repurchase(self):
        for status in ('canceled', 'past_due', 'unpaid', 'paused'):
            with self.subTest(status=status):
                self.setUp()
                session = self.buy()
                session['subscription']['status'] = status
                result = self.service.guest_status(TOKEN)
                self.assertEqual(result, {'state': 'processing', 'plan': 'supporter',
                                          'expiresAt': None, 'reason': 'purchase_not_active'})
                self.assert_error('payment_already_completed', lambda: self.service.guest_checkout('trace', TOKEN))
                self.assertEqual(self.stripe.calls.count('create_guest_checkout'), 1)

    def test_foreign_customer_binding_and_guest_lock_deny_claim(self):
        session = self.buy()
        self.store.customers[session['customer']] = OWNER
        self.assert_error('purchase_already_claimed', lambda: self.service.handle(self.event('claim')))
        self.store.customers.pop(session['customer'])
        with self.store.guest_lock(self.proof, NOW):
            self.assert_error('billing_busy', lambda: self.service.handle(self.event('claim')))
        self.assertNotIn('claimedBy', self.store.guests[self.proof])

    def test_expired_unpaid_record_does_not_start_another_charge(self):
        self.service.guest_checkout('trace', TOKEN)
        self.now += 91 * 86400
        self.assert_error('checkout_expired', lambda: self.service.guest_checkout('trace', TOKEN))
        self.assertEqual(self.stripe.calls.count('create_guest_checkout'), 1)


if __name__ == '__main__':
    unittest.main()
