"""Paid-tier evidence using synthetic pinned-version Stripe invoices; no provider calls."""
from copy import deepcopy
import unittest
from unittest.mock import Mock

from test_membership import (CFG, NOW, USER, FakeCognito, FakeStore, FakeStripe,
                             MembershipService, price, request, subscription, subscription_snapshot)
from membership import ApiError, PAID_EVIDENCE_VERSION


def failed_upgrade():
    """Synthetic IDs, preserving the pinned Stripe response observed after a portal decline."""
    sub = subscription('trace', collection_method='charge_automatically', pause_collection=None)
    paid = deepcopy(sub['latest_invoice'])
    paid.update(id='in_paid_pro', billing_reason='subscription_create')
    update = deepcopy(subscription('supporter')['latest_invoice'])
    update.update(id='in_unpaid_upgrade', paid=False, status='open', billing_reason='subscription_update')
    debit = update['lines']['data'][0]
    debit.update(type='invoiceitem', proration=True, amount=3998)
    debit['period']['start'] = NOW - 30
    credit = deepcopy(paid['lines']['data'][0])
    credit.update(id='il_pro_credit', type='invoiceitem', proration=True, amount=-1499,
                  proration_details={'credited_items': {'invoice': paid['id'], 'invoice_line_items': ['il_fixture']}})
    credit['period']['start'] = NOW - 30
    update['lines']['data'] = [credit, debit]
    sub.update(latest_invoice=update, pending_update={
        'expires_at': NOW + 23 * 3600, 'subscription_items': [{'id': 'si_fixture', 'price': CFG.prices['supporter']}]})
    return sub, paid


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
        self.assertTrue(account['opponentDecklists'])
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
        self.assertEqual(store.accounts[USER]['snapshot']['paidEvidenceVersion'], PAID_EVIDENCE_VERSION)

    def test_observed_failed_upgrade_keeps_paid_pro_but_never_supporter(self):
        for state in ('open', 'void'):
            with self.subTest(invoice_status=state):
                sub, paid = failed_upgrade()
                sub['latest_invoice']['status'] = state
                if state == 'void':
                    sub['pending_update'] = None  # Stripe drops an expired/abandoned update.
                store, stripe = FakeStore(), FakeStripe()
                stripe.current, stripe.paid_invoices = [sub], Mock(return_value=[paid])
                service = MembershipService(CFG, store, FakeCognito(), stripe, lambda: NOW)
                account = service.handle(request('account'))
                stripe.paid_invoices.assert_called_once_with('cus_fixture', 'sub_fixture')
                self.assertEqual((account['plan'], account['status']), ('trace', 'active'))
                self.assertTrue(account['traceAccess'])
                self.assertTrue(account['capabilities']['fullHistory'])
                self.assertTrue(account['capabilities']['expandedSharing'])
                self.assertTrue(account['opponentDecklists'])
                self.assertTrue(account['capabilities']['opponentDecklists'])
                self.assertEqual(store.accounts[USER]['snapshot']['expiresAt'], sub['current_period_end'])

    def test_current_higher_tier_cannot_use_previous_pro_payment(self):
        sub, paid = failed_upgrade()
        sub['items']['data'][0]['price'] = price('supporter')
        stripe = FakeStripe()
        stripe.paid_invoices = Mock(side_effect=AssertionError('must not fetch fallback for higher tier'))
        service = MembershipService(CFG, FakeStore(), FakeCognito(), stripe, lambda: NOW)
        self.assertEqual(service.paid_snapshot([sub])['status'], 'payment_pending')
        self.assertEqual(subscription_snapshot([sub], CFG, NOW, [paid])['status'], 'payment_pending')

    def test_only_exact_unpaid_update_can_request_prior_evidence(self):
        invoice_changes = [
            {'billing_reason': reason} for reason in ('subscription_cycle', 'subscription_create', 'manual')
        ] + [{'status': state} for state in ('draft', 'uncollectible', 'paid')] + [
            {'paid': True}, {'customer': 'cus_other'}, {'subscription': 'sub_other'},
            {'livemode': True}, {'currency': 'eur'}, {'id': ''},
        ]
        for change in invoice_changes:
            with self.subTest(change=change):
                sub, paid = failed_upgrade()
                sub['latest_invoice'].update(change)
                stripe = FakeStripe()
                stripe.paid_invoices = Mock(side_effect=AssertionError('ineligible fallback lookup'))
                service = MembershipService(CFG, FakeStore(), FakeCognito(), stripe, lambda: NOW)
                self.assertEqual(service.paid_snapshot([sub])['status'], 'payment_pending')
                self.assertEqual(subscription_snapshot([sub], CFG, NOW, [paid])['status'], 'payment_pending')

    def test_expired_paused_and_inactive_subscriptions_never_use_prior_evidence(self):
        changes = [{'status': state} for state in ('past_due', 'unpaid', 'paused', 'canceled', 'incomplete', 'incomplete_expired')]
        changes += [{'current_period_end': NOW}, {'current_period_start': NOW + 1},
                    {'pause_collection': {'behavior': 'void'}}, {'collection_method': 'send_invoice'}]
        for change in changes:
            with self.subTest(change=change):
                sub, paid = failed_upgrade()
                sub.update(change)
                stripe = FakeStripe()
                stripe.paid_invoices = Mock(side_effect=AssertionError('ineligible fallback lookup'))
                service = MembershipService(CFG, FakeStore(), FakeCognito(), stripe, lambda: NOW)
                self.assertNotEqual(service.paid_snapshot([sub])['status'], 'active')
                self.assertNotEqual(subscription_snapshot([sub], CFG, NOW, [paid])['status'], 'active')

    def test_prior_invoice_requires_exact_current_service_evidence(self):
        changes = [
            ('invoice', {'customer': 'cus_other'}), ('invoice', {'subscription': 'sub_other'}),
            ('invoice', {'id': 'in_unpaid_upgrade'}), ('invoice', {'paid': False}),
            ('invoice', {'status': 'void'}), ('invoice', {'livemode': True}), ('invoice', {'currency': 'eur'}),
            ('line', {'subscription_item': 'si_other'}), ('line', {'price': price('supporter')}),
            ('line', {'quantity': 2}), ('line', {'amount': -1}),
            ('line', {'period': {'start': NOW - 60 * 86400, 'end': NOW - 29 * 86400}}),
            ('line', {'period': {'start': NOW + 1, 'end': NOW + 86400}}),
            ('line', {'period': {'start': NOW - 1, 'end': NOW + 100}}),
            ('lines', {'has_more': True}), ('lines', {'data': []}),
        ]
        for where, change in changes:
            with self.subTest(where=where, change=change):
                sub, paid = failed_upgrade()
                target = paid if where == 'invoice' else paid['lines'] if where == 'lines' else paid['lines']['data'][0]
                target.update(change)
                self.assertEqual(subscription_snapshot([sub], CFG, NOW, [paid])['status'], 'payment_pending')

    def test_fallback_rechecks_provider_and_never_extends_current_period(self):
        sub, paid = failed_upgrade()
        store, stripe, clock = FakeStore(), FakeStripe(), [NOW]
        stripe.current, stripe.paid_invoices = [sub], Mock(return_value=[paid])
        service = MembershipService(CFG, store, FakeCognito(), stripe, lambda: clock[0])
        self.assertTrue(service.entitlement(USER)['traceAccess'])
        clock[0] += 301
        stripe.paid_invoices.return_value = []
        self.assertFalse(service.entitlement(USER)['traceAccess'])
        self.assertEqual(stripe.paid_invoices.call_count, 2)
        clock[0] = sub['current_period_end']
        stripe.paid_invoices.return_value = [paid]
        self.assertFalse(service.entitlement(USER)['traceAccess'])
        self.assertEqual(stripe.paid_invoices.call_count, 2)

    def test_provider_failure_cannot_reuse_pre_fix_snapshot(self):
        sub, _ = failed_upgrade()
        store, stripe = FakeStore(), FakeStripe()
        old = {'plan': 'trace', 'status': 'active', 'expiresAt': NOW + 86400,
               'syncedAt': NOW, 'paidEvidenceVersion': PAID_EVIDENCE_VERSION - 1}
        store.accounts[USER]['snapshot'] = deepcopy(old)
        stripe.current, stripe.paid_invoices = [sub], Mock(side_effect=ApiError(503, 'billing_unavailable'))
        service = MembershipService(CFG, store, FakeCognito(), stripe, lambda: NOW)
        with self.assertRaises(ApiError):
            service.entitlement(USER)
        self.assertEqual(store.accounts[USER]['snapshot'], old)

    def test_conflicting_subscription_does_not_search_for_fallback(self):
        sub, _ = failed_upgrade()
        stripe = FakeStripe()
        stripe.paid_invoices = Mock(side_effect=AssertionError('conflicting subscriptions'))
        service = MembershipService(CFG, FakeStore(), FakeCognito(), stripe, lambda: NOW)
        self.assertEqual(service.paid_snapshot([sub, subscription('supporter', id='sub_other')])['status'], 'subscription_conflict')

    def test_claim_recovery_uses_same_paid_pro_boundary(self):
        sub, paid = failed_upgrade()
        sub['metadata'] = {'trace_guest': 'proof', 'trace_reservation': 'key'}
        stripe = FakeStripe()
        stripe.paid_invoices = Mock(return_value=[paid])
        service = MembershipService(CFG, FakeStore(), FakeCognito(), stripe, lambda: NOW)
        record = {'customerId': 'cus_fixture', 'key': 'key', 'plan': 'trace'}
        session = {'status': 'complete', 'payment_status': 'paid', 'subscription': sub}
        self.assertEqual(service.paid_guest_subscription('proof', record, session)['status'], 'active')
        with self.assertRaises(ApiError):
            service.paid_guest_subscription('proof', {**record, 'plan': 'supporter'}, session)

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
