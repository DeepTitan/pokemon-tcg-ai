"""Paid-tier evidence using synthetic pinned-version Stripe invoices; no provider calls."""
from copy import deepcopy
import unittest

from test_membership import (CFG, NOW, USER, FakeCognito, FakeStore, FakeStripe,
                             MembershipService, price, request, subscription, subscription_snapshot)


class PaidInvoiceTests(unittest.TestCase):
    def assert_denied(self, sub):
        snapshot = subscription_snapshot([sub], CFG, NOW)
        self.assertEqual(snapshot['status'], 'payment_pending')

    def test_older_pro_invoice_cannot_pay_for_current_supporter_tier(self):
        upgraded = subscription('supporter', latest_invoice=subscription('trace')['latest_invoice'])
        self.assert_denied(upgraded)
        store, stripe = FakeStore(), FakeStripe()
        stripe.current = [upgraded]
        account = MembershipService(CFG, store, FakeCognito(), stripe, lambda: NOW).handle(request('account'))
        self.assertEqual(account['status'], 'payment_pending')
        self.assertFalse(account['traceAccess'])
        self.assertFalse(account['opponentDecklists'])
        self.assertFalse(account['capabilities']['fullHistory'])
        self.assertTrue(account['capabilities']['recordMatches'])

    def test_first_payment_and_regular_renewal_preserve_each_paid_plan(self):
        for plan in ('trace', 'supporter'):
            for reason in ('subscription_create', 'subscription_cycle'):
                with self.subTest(plan=plan, reason=reason):
                    sub = subscription(plan)
                    sub['latest_invoice']['billing_reason'] = reason
                    self.assertEqual(subscription_snapshot([sub], CFG, NOW)['status'], 'active')

    def test_old_recent_snapshot_is_reconciled_before_paid_access(self):
        store, stripe = FakeStore(), FakeStripe()
        store.accounts[USER]['snapshot'] = {'status': 'active', 'plan': 'supporter',
                                           'expiresAt': NOW + 86400, 'syncedAt': NOW}
        stripe.current = [subscription('supporter', latest_invoice=subscription('trace')['latest_invoice'])]
        account = MembershipService(CFG, store, FakeCognito(), stripe, lambda: NOW).entitlement(USER)
        self.assertFalse(account['traceAccess'])
        self.assertIn('subscriptions', stripe.calls)
        self.assertEqual(store.accounts[USER]['snapshot']['paidEvidenceVersion'], 1)

    def test_paid_prorated_upgrade_accepts_current_debit_not_old_tier_credit(self):
        sub = subscription('supporter')
        current = sub['latest_invoice']['lines']['data'][0]
        current.update(type='invoiceitem', proration=True, amount=2000)
        current['period']['start'] = NOW - 30
        credit = deepcopy(current)
        credit.update(id='il_old_credit', price=price('trace'), amount=-750,
                      proration_details={'credited_items': {'invoice': 'in_old', 'invoice_line_items': ['il_old']}})
        sub['latest_invoice'].update(billing_reason='subscription_update', total=1250, amount_paid=1250)
        sub['latest_invoice']['lines']['data'] = [credit, current]
        self.assertEqual(subscription_snapshot([sub], CFG, NOW)['status'], 'active')

    def test_paid_downgrade_with_net_credit_still_establishes_new_pro_service(self):
        sub = subscription('trace')
        current = sub['latest_invoice']['lines']['data'][0]
        current.update(type='invoiceitem', proration=True, amount=750)
        current['period']['start'] = NOW - 30
        credit = deepcopy(current)
        credit.update(id='il_old_credit', price=price('supporter'), amount=-2000)
        sub['latest_invoice'].update(billing_reason='subscription_update', total=-1250, amount_paid=0)
        sub['latest_invoice']['lines']['data'] = [credit, current]
        self.assertEqual(subscription_snapshot([sub], CFG, NOW)['status'], 'active')

    def test_paid_zero_total_renewal_and_zero_cent_proration_are_valid(self):
        sub = subscription()
        sub['latest_invoice'].update(total=0, amount_paid=0)
        self.assertEqual(subscription_snapshot([sub], CFG, NOW)['status'], 'active')
        line = sub['latest_invoice']['lines']['data'][0]
        line.update(type='invoiceitem', proration=True, amount=0)
        line['period']['start'] = NOW - 1
        self.assertEqual(subscription_snapshot([sub], CFG, NOW)['status'], 'active')

    def test_credit_only_or_manual_item_cannot_establish_current_tier(self):
        for change in ({'amount': -1}, {'type': 'invoiceitem', 'proration': False},
                       {'amount': 0, 'proration_details': {'credited_items': {'invoice': 'in_old'}}}):
            with self.subTest(change=change):
                sub = subscription()
                sub['latest_invoice']['lines']['data'][0].update(change)
                self.assert_denied(sub)

    def test_same_price_invoice_from_previous_period_cannot_pay_renewal(self):
        sub = subscription()
        sub['latest_invoice']['lines']['data'][0]['period'] = {
            'start': sub['current_period_start'] - 30 * 86400,
            'end': sub['current_period_start'],
        }
        self.assert_denied(sub)

    def test_invoice_binding_mode_status_and_currency_must_match(self):
        for change in ({'customer': 'cus_other'}, {'subscription': 'sub_other'}, {'livemode': True},
                       {'currency': 'eur'}, {'status': 'open'}, {'paid': False}):
            with self.subTest(change=change):
                sub = subscription()
                sub['latest_invoice'].update(change)
                self.assert_denied(sub)

    def test_invoice_line_binds_current_item_plan_quantity_and_mode(self):
        for change in ({'subscription': 'sub_other'}, {'subscription_item': 'si_other'},
                       {'price': price('trace')}, {'quantity': 2}, {'quantity': True},
                       {'livemode': True}, {'currency': 'eur'}, {'amount': True}, {'amount': '3999'}):
            with self.subTest(change=change):
                sub = subscription()
                sub['latest_invoice']['lines']['data'][0].update(change)
                self.assert_denied(sub)

    def test_future_shortened_and_malformed_coverage_do_not_grant(self):
        for period in ({'start': NOW + 1, 'end': NOW + 86400}, {'start': NOW - 1, 'end': NOW + 10},
                       {'start': NOW - 1, 'end': str(NOW + 86400)}, {'start': False, 'end': NOW + 86400},
                       None):
            with self.subTest(period=period):
                sub = subscription()
                sub['latest_invoice']['lines']['data'][0]['period'] = period
                self.assert_denied(sub)

    def test_missing_or_incomplete_invoice_lines_fail_closed(self):
        for lines in (None, {}, {'has_more': False, 'data': []}, {'has_more': False, 'data': [None]}):
            with self.subTest(lines=lines):
                sub = subscription()
                sub['latest_invoice']['lines'] = lines
                self.assert_denied(sub)
        sub = subscription()
        sub['latest_invoice']['lines']['has_more'] = True
        self.assert_denied(sub)

    def test_missing_expansion_or_item_identity_is_not_paid_evidence(self):
        for invoice in ('in_unexpanded', None, {'paid': True}):
            with self.subTest(invoice=invoice):
                self.assert_denied(subscription(latest_invoice=invoice))
        sub = subscription()
        sub['items']['data'][0].pop('id')
        self.assert_denied(sub)

    def test_expanded_invoice_identity_references_remain_supported(self):
        sub = subscription()
        invoice = sub['latest_invoice']
        for obj, key in ((invoice, 'subscription'), (invoice, 'customer'),
                         (invoice['lines']['data'][0], 'subscription'),
                         (invoice['lines']['data'][0], 'subscription_item')):
            obj[key] = {'id': obj[key]}
        self.assertEqual(subscription_snapshot([sub], CFG, NOW)['status'], 'active')


if __name__ == '__main__':
    unittest.main()
