"""New and existing prices, cadence switches, and exact paid-service evidence."""
from copy import deepcopy
from dataclasses import replace
import unittest
from test_membership import (CFG, NOW, USER, FakeCognito, FakeStore, FakeStripe,
                             MembershipService, ApiError, price, request, subscription)
from test_guest_checkout import GuestStore, GuestStripe, TOKEN
from membership import price_plan, subscription_snapshot, checkout_digest

CONFIG = replace(CFG, trace_annual_price='price_annual', legacy_trace_price='price_legacy',
                 previous_trace_price='price_previous_month', previous_trace_annual_price='price_previous_year')


def annual_price():
    value = price('trace')
    value.update(id=CONFIG.trace_annual_price, unit_amount=4999)
    value['recurring']['interval'] = 'year'
    return value


def legacy_price():
    return {**price('trace'), 'id': CONFIG.legacy_trace_price, 'unit_amount': 1499}


def previous_price(interval):
    value = annual_price() if interval == 'year' else price('trace')
    value.update(id=CONFIG.previous_trace_annual_price if interval == 'year' else CONFIG.previous_trace_price,
                 unit_amount=5000 if interval == 'year' else 500)
    return value


def priced_subscription(value):
    sub = subscription('trace')
    sub['items']['data'][0]['price'] = deepcopy(value)
    sub['latest_invoice']['lines']['data'][0]['price'] = deepcopy(value)
    return sub


class PricingTests(unittest.TestCase):
    def service(self, guest=False):
        store, stripe = (GuestStore(), GuestStripe()) if guest else (FakeStore(), FakeStripe())
        stripe.current = []
        stripe.catalog.update(annual=annual_price(), legacy=legacy_price(),
                              previous_month=previous_price("month"), previous_year=previous_price("year"))
        return MembershipService(CONFIG, store, FakeCognito(), stripe, clock=lambda: NOW), store, stripe

    def test_exact_prices_and_intervals_are_required(self):
        for value in (price('trace'), annual_price(), legacy_price(), previous_price('month'),
                      previous_price('year'), price('supporter')):
            with self.subTest(price=value['id']):
                self.assertIsNotNone(price_plan(value, CONFIG))
                for field, invalid in (('unit_amount', 1), ('currency', 'eur'), ('livemode', True)):
                    self.assertIsNone(price_plan({**value, field: invalid}, CONFIG))
                wrong = deepcopy(value)
                wrong['recurring']['interval'] = 'month' if value['recurring']['interval'] == 'year' else 'year'
                self.assertIsNone(price_plan(wrong, CONFIG))
        self.assertEqual(CONFIG.checkout_price('trace', 'month'), 'price_trace')
        self.assertEqual(CONFIG.checkout_price('trace', 'year'), 'price_annual')

    def test_annual_and_legacy_subscribers_keep_paid_access(self):
        for value in (annual_price(), legacy_price(), previous_price('month'), previous_price('year')):
            sub = priced_subscription(value)
            self.assertEqual(subscription_snapshot([sub], CONFIG, NOW)['plan'], 'trace')
            # A paid invoice for another price on the same plan is insufficient.
            sub['latest_invoice']['lines']['data'][0]['price'] = price('trace')
            self.assertNotEqual(subscription_snapshot([sub], CONFIG, NOW)['status'], 'active')

    def test_invalid_cadence_never_creates_checkout(self):
        svc, store, stripe = self.service()
        for plan, interval in (('trace', 'week'), ('supporter', 'year'), ('trace', None), ('trace', {})):
            with self.assertRaises(ApiError):
                svc.checkout(USER, 'member@example.test', plan, billing_interval=interval)
        self.assertNotIn('create_checkout', stripe.calls)

    def test_http_yearly_request_pins_price_and_reuses_same_session(self):
        svc, store, stripe = self.service()
        event = request('checkout', 'POST', {'plan': 'trace', 'billingInterval': 'year'})
        self.assertEqual(svc.handle(event), svc.handle(event))
        pending = store.account(USER)['checkout']
        self.assertEqual(pending['priceId'], 'price_annual')
        self.assertEqual(pending['billingInterval'], 'year')
        self.assertEqual(stripe.calls.count('create_checkout'), 1)
        svc.checkout(USER, 'member@example.test', 'trace')
        self.assertEqual(stripe.calls.count('expire_checkout'), 1)
        self.assertEqual(store.account(USER)['checkout']['priceId'], 'price_trace')

    def test_guest_switches_cadence_without_duplicate_payable_sessions(self):
        svc, store, stripe = self.service(guest=True)
        svc.guest_checkout('trace', TOKEN)
        svc.guest_checkout('trace', TOKEN, billing_interval='year')
        svc.guest_checkout('trace', TOKEN, billing_interval='year')
        self.assertEqual(stripe.calls.count('create_guest_checkout'), 2)
        self.assertEqual(stripe.calls.count('expire_checkout'), 1)
        record = store.guest(checkout_digest(TOKEN))
        self.assertEqual(record['priceId'], 'price_annual')
        active = [s for s in stripe.sessions.values() if s['status'] == 'open']
        self.assertEqual(len(active), 1)
        self.assertEqual(active[0]['line_items']['data'][0]['price']['unit_amount'], 4999)

    def test_guest_lost_creation_response_recovers_original_annual_price(self):
        svc, store, stripe = self.service(guest=True)
        def fail():
            raise OSError('lost response')
        stripe.after_guest_checkout = fail
        with self.assertRaises(OSError):
            svc.guest_checkout('trace', TOKEN, billing_interval='year')
        stripe.after_guest_checkout = None
        stripe.scan_empty = True
        svc.guest_checkout('trace', TOKEN, billing_interval='year')
        self.assertEqual(stripe.calls.count('create_guest_checkout'), 1)
        self.assertEqual(store.guest(checkout_digest(TOKEN))['priceId'], 'price_annual')
        self.assertEqual(svc.guest_status(TOKEN)['billingInterval'], 'year')

    def test_legacy_reservation_recovers_old_price_before_starting_new_offer(self):
        svc, store, stripe = self.service(guest=True)
        # Seed a pre-rollout reservation without a pinned priceId.
        proof = checkout_digest(TOKEN)
        store.guests[proof] = {'customerId': 'cus_old', 'plan': 'trace', 'key': 'old-key',
                               'expiresAt': NOW + 3600, 'claimExpiresAt': NOW + 86400}
        svc.guest_checkout('trace', TOKEN)
        old = stripe.sessions['old-key']
        self.assertEqual(old['line_items']['data'][0]['price']['unit_amount'], 1499)
        self.assertEqual(old['status'], 'expired')
        self.assertEqual(store.guest(proof)['priceId'], 'price_trace')

    def test_previous_offer_reservation_recovers_then_replaces_at_new_price(self):
        for interval in ('month', 'year'):
            with self.subTest(interval=interval):
                svc, store, stripe = self.service(guest=True)
                proof = checkout_digest(TOKEN)
                old_price = previous_price(interval)
                store.guests[proof] = {
                    'customerId': 'cus_old', 'plan': 'trace', 'key': 'old-key',
                    'priceId': old_price['id'], 'billingInterval': interval,
                    'expiresAt': NOW + 3600, 'claimExpiresAt': NOW + 86400}
                svc.guest_checkout('trace', TOKEN, billing_interval=interval)
                old = stripe.sessions['old-key']
                self.assertEqual(old['line_items']['data'][0]['price'], old_price)
                self.assertEqual(old['status'], 'expired')
                self.assertEqual(store.guest(proof)['priceId'], CONFIG.checkout_price('trace', interval))
                active = [s for s in stripe.sessions.values() if s['status'] == 'open']
                self.assertEqual(len(active), 1)
                self.assertEqual(active[0]['line_items']['data'][0]['price']['unit_amount'],
                                 4999 if interval == 'year' else 499)

    def test_signed_in_session_price_must_match_reserved_cadence(self):
        svc, store, stripe = self.service()
        svc.checkout(USER, 'member@example.test', 'trace', billing_interval='year')
        session = next(iter(stripe.sessions.values()))
        session['line_items']['data'][0]['price'] = price('trace')
        with self.assertRaises(ApiError):
            svc.checkout(USER, 'member@example.test', 'trace', billing_interval='year')
        self.assertEqual(stripe.calls.count('create_checkout'), 1)

    def test_guest_session_price_must_match_reserved_cadence(self):
        svc, store, stripe = self.service(guest=True)
        svc.guest_checkout('trace', TOKEN, billing_interval='year')
        session = next(iter(stripe.sessions.values()))
        session['line_items']['data'][0]['price'] = price('trace')
        with self.assertRaises(ApiError):
            svc.guest_status(TOKEN)


if __name__ == '__main__':
    unittest.main()
