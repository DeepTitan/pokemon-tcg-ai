"""Pay once and activate the initiating installation, without a browser return or OTP."""
from copy import deepcopy
from dataclasses import replace
import unittest

from test_guest_checkout import GuestStore, GuestStripe
from test_membership import CFG, NOW, USER, OWNER, DEVICE, FakeCognito, MembershipService, ApiError, digest, request, subscription, token
from device_checkout import purchase_subject


class DeviceCheckoutTests(unittest.TestCase):
    def setUp(self):
        self.store, self.stripe, self.cognito = GuestStore(), GuestStripe(), FakeCognito()
        self.now = NOW
        self.service = MembershipService(CFG, self.store, self.cognito, self.stripe, lambda: self.now)

    def error(self, code, work):
        with self.assertRaises(ApiError) as caught:
            work()
        self.assertEqual(caught.exception.code, code)

    def start(self, interval='month'):
        return self.service.handle(request('devices/checkout', 'POST', {'billingInterval': interval}, device=True))

    def status(self):
        return self.service.handle(request('devices/status', device=True))

    def pay(self, email='member@example.test'):
        self.start()
        proof = self.store.device_purchases[DEVICE]['proof']
        return proof, self.stripe.complete(proof, email)

    def test_pay_and_unlock_without_account_login_code_or_browser_return(self):
        self.start()
        self.assertFalse(self.status()['traceAccess'])
        proof = self.store.device_purchases[DEVICE]['proof']
        self.stripe.complete(proof)
        # A fresh service models reopening Trace; nothing lives in a browser/session.
        self.service = MembershipService(CFG, self.store, self.cognito, self.stripe, lambda: self.now)
        status = self.status()
        self.assertTrue(status['traceAccess'])
        self.assertTrue(status['capabilities']['fullHistory'])
        self.assertTrue(status['purchaseAccount'])
        self.assertEqual(status['email'], 'member@example.test')
        self.assertFalse(self.store.accounts[purchase_subject(proof)]['emailVerified'])
        self.assertEqual(self.cognito.calls, [])
        self.assertEqual(self.store.codes, {})

    def test_retries_and_plan_changes_never_make_parallel_payable_sessions(self):
        self.assertEqual(self.start(), self.start())
        self.assertEqual(self.stripe.calls.count('create_guest_checkout'), 1)
        proof, _ = self.pay()
        self.start()
        self.assertEqual(self.stripe.calls.count('create_guest_checkout'), 1)
        self.assertIn('portal', self.stripe.calls)

    def test_unpaid_expired_or_processing_checkout_does_not_unlock(self):
        self.start()
        session = next(iter(self.stripe.sessions.values()))
        for state, payment in [('open', 'unpaid'), ('expired', 'unpaid'), ('complete', 'unpaid')]:
            session.update(status=state, payment_status=payment)
            self.assertFalse(self.status()['traceAccess'])
            self.assertTrue(self.status()['capabilities']['recordMatches'])

    def test_failed_payment_and_conflicting_subscriptions_do_not_unlock(self):
        proof, session = self.pay()
        customer = session['customer']
        self.stripe.by_customer[customer][0]['status'] = 'past_due'
        self.assertFalse(self.status()['traceAccess'])
        self.now += 301
        self.stripe.by_customer[customer] = [deepcopy(session['subscription']), subscription('trace', id='sub_other', customer=customer)]
        self.assertFalse(self.status()['traceAccess'])

    def test_revocation_and_expiry_do_not_reuse_old_payment(self):
        proof, session = self.pay()
        self.assertTrue(self.status()['traceAccess'])
        self.stripe.by_customer[session['customer']][0]['status'] = 'canceled'
        self.now += 301
        self.assertFalse(self.status()['traceAccess'])

    def test_provider_failure_and_persistence_failure_fail_closed_then_recover(self):
        self.pay()
        self.store.fail_save = True
        with self.assertRaises(RuntimeError): self.status()
        self.store.fail_save = False
        self.assertTrue(self.status()['traceAccess'])
        self.now += 301
        self.stripe.fail_subscriptions = True
        self.error('billing_unavailable', self.status)
        self.stripe.fail_subscriptions = False
        self.assertTrue(self.status()['traceAccess'])

    def test_other_device_and_rotated_credentials_cannot_inherit_purchase(self):
        self.pay()
        self.assertTrue(self.status()['traceAccess'])
        other = 'synthetic-device-000002'
        self.store.devices[other] = {'tokenHash': digest('capture-secret')}
        event = request('devices/status', device=True)
        event['headers']['x-trace-device'] = other
        self.assertFalse(self.service.handle(event)['traceAccess'])
        self.store.devices[DEVICE]['tokenHash'] = digest('new-secret')
        self.error('unauthorized', self.status)
        event['headers'].update({'x-trace-device': DEVICE, 'authorization': 'Bearer new-secret'})
        self.error('device_purchase_recovery_required', lambda: self.service.handle(event))

    def test_paying_with_owner_email_never_grants_owner_account_access(self):
        proof, _ = self.pay('owner@example.test')
        self.store.owners[OWNER] = True
        self.assertTrue(self.status()['traceAccess'])
        self.assertFalse(self.status()['admin'])
        self.assertEqual(self.status()['plan'], 'trace')
        original = self.cognito.get_user
        def owner_user(token):
            result = original(token)
            next(attr for attr in result['UserAttributes'] if attr['Name'] == 'email')['Value'] = 'owner@example.test'
            return result
        self.cognito.get_user = owner_user
        self.service.handle(request('account', account=OWNER))
        self.assertEqual(self.store.guests[proof]['claimedBy'], OWNER)
        self.assertFalse(self.status()['admin'])
        self.assertEqual(self.status()['plan'], 'trace')

    def test_verified_email_signin_recovers_purchase_without_browser_cookie(self):
        proof, session = self.pay()
        self.status()
        self.store.accounts[USER].pop('customerId')
        account = self.service.handle(request('account'))
        self.assertTrue(account['traceAccess'])
        self.assertEqual(self.store.accounts[USER]['customerId'], session['customer'])
        self.assertEqual(self.store.guests[proof]['claimedBy'], USER)
        self.assertTrue(self.status()['traceAccess'])

    def test_other_verified_email_cannot_recover_this_purchase(self):
        self.pay()
        self.status()
        original = self.cognito.get_user
        def other_user(token):
            result = original(token)
            next(attr for attr in result['UserAttributes'] if attr['Name'] == 'email')['Value'] = 'other@example.test'
            return result
        self.cognito.get_user = other_user
        account = self.service.handle(request('account', account=OWNER))
        self.assertFalse(account['traceAccess'])
        self.assertNotIn('customerId', self.store.accounts[OWNER])

    def test_existing_signed_in_subscription_is_not_replaced_or_charged_again(self):
        self.store.links[DEVICE] = {'subject': USER, 'credentialHash': digest('capture-secret')}
        self.stripe.current = [subscription()]
        self.start()
        self.assertEqual(self.store.device_purchases, {})
        self.assertNotIn('create_guest_checkout', self.stripe.calls)
        self.assertIn('portal', self.stripe.calls)

    def test_native_billing_requires_installation_credentials(self):
        event = request('devices/checkout', 'POST')
        self.error('unauthorized', lambda: self.service.handle(event))
        self.error('no_subscription', lambda: self.service.handle(request('devices/portal', 'POST', device=True)))
        self.error('invalid_billing_interval', lambda: self.start('decade'))
        self.assertEqual(self.stripe.calls, [])

    def test_management_available_after_cancelation_without_email_login(self):
        _, session = self.pay()
        self.status()
        self.stripe.by_customer[session['customer']][0]['status'] = 'canceled'
        result = self.service.handle(request('devices/portal', 'POST', device=True))
        self.assertIn('billing.stripe.com', result['url'])
        self.assertEqual(self.cognito.calls, [])

    def test_email_must_be_verified_before_recovering_a_purchase(self):
        self.pay()
        self.status()
        self.cognito.verified = False
        self.error('email_not_verified', lambda: self.service.handle(request('account')))
        self.assertFalse(any(record.get('claimedBy') for record in self.store.guests.values()))

    def test_verified_signin_retires_only_an_unused_prior_customer(self):
        proof, session = self.pay()
        self.status()
        self.service.handle(request('account'))
        self.assertEqual(self.store.accounts[USER]['customerId'], session['customer'])
        self.assertEqual(self.store.guests[proof]['claimedBy'], USER)

    def test_yearly_selection_replaces_only_the_open_monthly_checkout(self):
        self.start()
        self.service.config = replace(CFG, trace_annual_price='price_trace_year')
        annual = deepcopy(self.stripe.catalog['trace'])
        annual.update(id='price_trace_year', unit_amount=4999)
        annual['recurring']['interval'] = 'year'
        self.stripe.catalog['annual'] = annual
        self.start('year')
        self.start('year')
        opened = [s for s in self.stripe.sessions.values() if s['status'] == 'open']
        self.assertEqual(len(opened), 1)
        self.assertEqual(opened[0]['line_items']['data'][0]['price']['id'], 'price_trace_year')
        self.assertEqual(self.stripe.calls.count('create_guest_checkout'), 2)

    def test_portal_upgrade_can_be_recovered_later_with_verified_email(self):
        proof, session = self.pay()
        self.status()
        upgraded = subscription('supporter', id=session['subscription']['id'], customer=session['customer'], metadata=session['metadata'])
        session['subscription'] = upgraded
        self.stripe.by_customer[session['customer']] = [deepcopy(upgraded)]
        result = self.service.handle(request('account'))
        self.assertTrue(result['traceAccess'])
        self.assertEqual(result['plan'], 'supporter')


    def test_linked_free_account_uses_native_return_without_new_guest_identity(self):
        self.store.links[DEVICE] = {'subject': USER, 'credentialHash': digest('capture-secret')}
        self.start()
        self.assertTrue(self.store.accounts[USER]['checkout']['desktop'])
        self.assertEqual(self.store.device_purchases, {})
        self.assertEqual(self.stripe.calls.count('create_checkout'), 1)

    def test_billing_disabled_keeps_free_access_without_provider_calls(self):
        self.pay()
        self.status()
        self.service.config = replace(CFG, billing_enabled=False)
        self.stripe.calls.clear()
        self.assertFalse(self.status()['traceAccess'])
        self.assertTrue(self.service.handle(request('account'))['capabilities']['recordMatches'])
        self.assertEqual(self.stripe.calls, [])



if __name__ == '__main__':
    unittest.main()
