"""Offline creator attribution, webhook ordering, money and reversal coverage."""
import base64
from copy import deepcopy
import hashlib
import hmac
import json
import unittest
from test_guest_checkout import GuestStore, GuestStripe, PROXY, TOKEN
from test_membership import CFG, NOW, USER, FakeCognito, MembershipService, ApiError, price, request
from affiliates import AffiliateLedger, attribution, checkout_fields, referral


def signed(at=NOW, creator='jakeptcg'):
    payload = base64.urlsafe_b64encode(json.dumps({'code': creator, 'at': at}, separators=(',', ':')).encode()).decode().rstrip('=')
    signature = base64.urlsafe_b64encode(hmac.new(PROXY.encode(), ('trace-referral-v1.' + payload).encode(), hashlib.sha256).digest()).decode().rstrip('=')
    return payload + '.' + signature


class LedgerStore(GuestStore):
    def __init__(self):
        super().__init__()
        self.records, self.entries = {}, []
        self.fail_ledger = False

    def get(self, key):
        return deepcopy(self.records.get(key))

    def save_affiliate_record(self, key, record, lease, now):
        assert self.locks.get(key) is lease
        if self.fail_ledger:
            raise RuntimeError('Synthetic atomic write failure')
        self.records[key] = deepcopy(record)

    def save_affiliate_invoice(self, key, record, delta, lease, now):
        self.save_affiliate_record(key, record, lease, now)
        if delta:
            self.entries.append({'deltaCommissionCents': delta, 'recordedAt': now, 'invoiceId': record['invoiceId']})


class LedgerStripe(GuestStripe):
    def __init__(self):
        super().__init__()
        self.invoice = {'id': 'in_first', 'customer': 'cus_fixture', 'subscription': 'sub_fixture',
                        'status': 'paid', 'paid': True, 'livemode': False, 'currency': 'usd',
                        'total': 1499, 'total_excluding_tax': 1499, 'amount_paid': 1499,
                        'status_transitions': {'paid_at': NOW + 60}, 'charge': 'ch_fixture',
                        'lines': {'has_more': False, 'data': [{'price': price('trace'), 'subscription': 'sub_fixture'}]}}
        self.first = deepcopy(self.invoice)
        self.charge = {'id': 'ch_fixture', 'invoice': 'in_first', 'customer': 'cus_fixture', 'currency': 'usd',
                       'livemode': False, 'paid': True, 'captured': True, 'amount_captured': 1499,
                       'amount_refunded': 0, 'disputed': False}
        self.session = {'id': 'cs_fixture', 'customer': 'cus_fixture', 'subscription': 'sub_fixture',
                        'status': 'complete', 'payment_status': 'paid', 'mode': 'subscription', 'livemode': False,
                        'invoice': 'in_first', 'metadata': {'trace_affiliate_version': '1', 'trace_creator': 'jakeptcg',
                        'trace_referred_at': str(NOW)}, 'custom_fields': [{'key': 'creator', 'type': 'text', 'text': {'value': 'jakeptcg'}}]}
        self.disputes = []
        self.session_reads = 0

    def affiliate_invoice(self, identifier):
        return deepcopy(self.invoice if identifier == self.invoice['id'] else self.first)

    def affiliate_charge(self, identifier):
        return deepcopy(self.charge)

    def affiliate_sessions(self, subscription):
        self.session_reads += 1
        return [deepcopy(self.session)]

    def affiliate_disputes(self, charge):
        return deepcopy(self.disputes)


class AffiliateTests(unittest.TestCase):
    def setUp(self):
        self.store, self.stripe = LedgerStore(), LedgerStripe()
        self.now = NOW + 60
        self.service = MembershipService(CFG, self.store, FakeCognito(), self.stripe, lambda: self.now)
        self.ledger = AffiliateLedger(self.service)

    def apply(self):
        self.ledger.reconcile_invoice(self.stripe.invoice['id'])
        return self.store.get('AFFILIATE_INVOICE#' + self.stripe.invoice['id'])

    def test_signed_referral_has_exact_day_window_and_rejects_forgery(self):
        self.assertEqual(referral(signed(), PROXY, NOW)['code'], 'jakeptcg')
        self.assertIsNotNone(referral(signed(), PROXY, NOW + 86399))
        for value, clock in [(signed(), NOW + 86400), (signed(), NOW - 1), (signed(creator='unknown'), NOW),
                              (signed() + 'x', NOW), ('invalid', NOW), ('x' * 1000, NOW)]:
            self.assertIsNone(referral(value, PROXY, clock))

    def test_prefilled_code_does_not_extend_link_deadline(self):
        self.assertEqual(attribution(self.stripe.session, NOW + 86399)['source'], 'link')
        self.assertIsNone(attribution(self.stripe.session, NOW + 86400))
        self.assertIsNone(attribution(self.stripe.session, NOW - 1))
        self.stripe.session['metadata'] = {'trace_affiliate_version': '1'}
        self.stripe.session['custom_fields'][0]['text']['value'] = ' JakePTCG '
        self.assertEqual(attribution(self.stripe.session, NOW + 1000000), {'creator': 'jakeptcg', 'source': 'code'})
        self.stripe.session['custom_fields'][0]['text']['value'] = 'bad-code'
        self.assertIsNone(attribution(self.stripe.session, NOW))

    def test_optional_stripe_field_and_legacy_reservations(self):
        self.assertEqual(checkout_fields(None), {})
        self.assertEqual(checkout_fields({})['custom_fields[0][optional]'], 'true')
        self.assertNotIn('custom_fields[0][text][default_value]', checkout_fields({}))
        self.assertEqual(checkout_fields({'code': 'jakeptcg', 'at': NOW})['custom_fields[0][text][default_value]'], 'jakeptcg')

    def test_guest_and_signed_in_checkout_store_trusted_referral(self):
        self.stripe.current = []
        self.service.checkout(USER, 'member@example.test', 'trace', signed())
        self.assertEqual(self.store.accounts[USER]['checkout']['affiliate'], {'version': 1, 'code': 'jakeptcg', 'at': NOW})
        self.service.guest_checkout('supporter', TOKEN, signed())
        self.assertEqual(next(iter(self.store.guests.values()))['affiliate']['code'], 'jakeptcg')

    def test_twenty_percent_per_payment_renewals_survive_cookie_expiry(self):
        self.assertEqual(self.apply()['commissionCents'], 300)
        self.now += 31 * 86400
        self.stripe.invoice['id'] = 'in_renewal'
        self.stripe.invoice['status_transitions']['paid_at'] = self.now
        self.stripe.charge['invoice'] = 'in_renewal'
        self.assertEqual(self.apply()['commissionCents'], 300)
        self.assertEqual(sum(e['deltaCommissionCents'] for e in self.store.entries), 600)
        self.assertEqual(self.stripe.session_reads, 1)

    def test_paid_timestamp_not_delayed_webhook_arrival_controls_window(self):
        self.now += 5 * 86400
        self.assertEqual(self.apply()['commissionCents'], 300)
        self.store.records.clear()
        self.stripe.invoice['status_transitions']['paid_at'] = NOW + 86400
        self.assertIsNone(self.apply())

    def test_duplicate_events_and_partial_full_refunds_do_not_double_count(self):
        self.apply(); self.apply()
        self.assertEqual(len(self.store.entries), 1)
        self.stripe.charge['amount_refunded'] = 750
        self.assertEqual(self.apply()['commissionCents'], 150)
        self.apply()
        self.stripe.charge['amount_refunded'] = 1499
        self.assertEqual(self.apply()['commissionCents'], 0)
        self.apply()
        self.assertEqual([e['deltaCommissionCents'] for e in self.store.entries], [300, -150, -150])

    def test_discounted_pretax_cash_receipts_and_refund_proportions(self):
        self.stripe.invoice.update(total=1100, total_excluding_tax=1000, amount_paid=1100)
        self.stripe.charge['amount_captured'] = 1100
        self.assertEqual(self.apply()['commissionCents'], 200)
        self.stripe.charge['amount_refunded'] = 550
        self.assertEqual(self.apply()['commissionCents'], 100)

    def test_supporter_rate_is_eight_dollars_at_full_price(self):
        self.stripe.invoice.update(total=3999, total_excluding_tax=3999, amount_paid=3999)
        self.stripe.invoice['lines']['data'][0]['price'] = price('supporter')
        self.stripe.charge['amount_captured'] = 3999
        self.assertEqual(self.apply()['commissionCents'], 800)

    def test_dispute_holds_commission_and_winning_restores_once(self):
        self.apply()
        self.stripe.charge['disputed'] = True
        self.stripe.disputes = [{'status': 'needs_response'}]
        self.assertEqual(self.apply()['commissionCents'], 0)
        self.stripe.disputes = [{'status': 'won'}]
        self.assertEqual(self.apply()['commissionCents'], 300)
        self.apply()
        self.assertEqual([e['deltaCommissionCents'] for e in self.store.entries], [300, -300, 300])

    def test_credit_notes_reduce_balance_and_void_restores_without_double_refund(self):
        self.apply()
        self.stripe.invoice['post_payment_credit_notes_amount'] = 750
        self.ledger.handle_event({'type': 'credit_note.created', 'data': {'object': {
            'customer': 'cus_fixture', 'invoice': 'in_first'}}})
        self.assertEqual(self.apply()['commissionCents'], 150)
        self.stripe.charge['amount_refunded'] = 750
        self.assertEqual(self.apply()['commissionCents'], 150)
        self.stripe.invoice['post_payment_credit_notes_amount'] = 0
        self.assertEqual(self.apply()['commissionCents'], 150)
        self.stripe.charge['amount_refunded'] = 0
        self.ledger.handle_event({'type': 'credit_note.voided', 'data': {'object': {
            'customer': 'cus_fixture', 'invoice': 'in_first'}}})
        self.assertEqual(self.apply()['commissionCents'], 300)
        self.assertEqual([e['deltaCommissionCents'] for e in self.store.entries], [300, -150, 150])

    def test_credit_balance_zero_totals_and_out_of_band_do_not_earn(self):
        self.stripe.invoice['charge'] = None
        self.assertEqual(self.apply()['commissionCents'], 0)
        self.stripe.invoice.update(total=0, total_excluding_tax=0, amount_paid=0)
        self.assertEqual(self.apply()['commissionCents'], 0)
        self.assertEqual(self.store.entries, [])

    def test_unrelated_wrong_mode_legacy_and_mixed_invoices_fail_closed(self):
        self.stripe.invoice['livemode'] = True
        self.assertIsNone(self.apply())
        self.stripe.invoice['livemode'] = False
        self.stripe.session['metadata'] = {}
        self.assertIsNone(self.apply())
        self.stripe.session['metadata'] = {'trace_affiliate_version': '1'}
        self.stripe.invoice['lines']['data'].append({'price': {'id': 'price_film'}})
        with self.assertRaises(ApiError): self.apply()
        self.assertEqual(self.store.entries, [])

    def test_checkout_invoice_order_and_failed_persistence_retry(self):
        self.stripe.session['status'] = 'open'
        with self.assertRaises(ApiError): self.apply()
        self.assertEqual(self.store.records, {})
        self.stripe.session['status'] = 'complete'
        self.store.fail_ledger = True
        with self.assertRaises(RuntimeError): self.apply()
        self.assertEqual(self.store.entries, [])
        self.store.fail_ledger = False
        self.assertEqual(self.apply()['commissionCents'], 300)

    def test_signed_webhook_retries_read_current_charge_and_rejects_bad_signature(self):
        self.stripe.current = []
        value = {'id': 'evt_affiliate', 'type': 'invoice.paid', 'livemode': False, 'data': {'object': deepcopy(self.stripe.invoice)}}
        def event():
            raw = json.dumps(value)
            signature = hmac.new(self.stripe.webhook_secret().encode(), f'{self.now}.{raw}'.encode(), hashlib.sha256).hexdigest()
            return {'body': raw, 'headers': {'stripe-signature': f't={self.now},v1={signature}'}}
        self.service.webhook(event())
        self.assertEqual(len(self.store.entries), 1)
        value.update(id='evt_refund', type='charge.refunded')
        value['data']['object'] = deepcopy(self.stripe.charge)  # stale event still says no refund
        self.stripe.charge['amount_refunded'] = 1499
        self.service.webhook(event()); self.service.webhook(event())
        self.assertEqual(sum(e['deltaCommissionCents'] for e in self.store.entries), 0)
        bad = event(); bad['headers']['stripe-signature'] = 't=1,v1=bad'
        with self.assertRaises(ApiError): self.service.webhook(bad)


if __name__ == '__main__':
    unittest.main()
