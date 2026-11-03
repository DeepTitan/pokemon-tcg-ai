"""Checkout initiated by an authenticated Trace installation.

The purchase account is deliberately separate from a verified email identity.
Paying for an email never signs the installation into that person's account.
"""
import hmac
import secrets

from membership import ApiError, digest, email_value


def purchase_subject(proof):
    return 'purchase_' + proof


def binding(service, device, credential_hash):
    record = service.store.device_purchase(device)
    if record and not hmac.compare_digest(str(record.get('credentialHash', '')), credential_hash):
        raise ApiError(409, 'device_purchase_recovery_required')
    return record


def start(service, device, credential_hash, interval):
    service.require_billing()
    service.config.checkout_price('trace', interval)
    service.store.limit('device-checkout:' + device, 12, 600, service.now())
    linked = service.store.device_link(device)
    if linked:
        if not hmac.compare_digest(str(linked.get('credentialHash', '')), credential_hash):
            raise ApiError(409, 'device_already_linked')
        account = service.store.account(linked['subject'])
        if service.entitlement(linked['subject'])['traceAccess']:
            return service.portal(linked['subject'])
        return service.checkout(linked['subject'], account['email'], 'trace', billing_interval=interval, desktop=True)
    # Persist before opening Stripe. Lost responses, restarts and concurrent clicks
    # must all recover the same customer/reservation, never a second purchase.
    with service.store.account_lock('DEVICE_PURCHASE#' + device, service.now()) as lease:
        record = binding(service, device, credential_hash)
        if not record:
            record = {'proof': digest(secrets.token_urlsafe(32)), 'credentialHash': credential_hash}
            service.store.bind_device_purchase(device, record, lease, service.now())
        proof = record['proof']
        purchase = service.store.guest(proof)
        if purchase and purchase.get('paidAt'):
            return portal(service, device, credential_hash)
        try:
            return service.guest_checkout_proof('trace', proof, billing_interval=interval, desktop=True)
        except ApiError as error:
            if error.code == 'payment_already_completed':
                return portal(service, device, credential_hash)
            raise


def provision(service, proof, record, session, lease):
    """Create the email-based purchase account only from verified provider evidence."""
    if not session or session.get('status') != 'complete' or session.get('payment_status') != 'paid':
        return
    email = email_value((session.get('customer_details') or {}).get('email'))
    # Use the same account lease as entitlement reconciliation so delayed
    # webhook work cannot overwrite a newer subscription snapshot.
    with service.store.account_lock(purchase_subject(proof), service.now()) as account_lease:
        subscriptions = service.stripe.subscriptions(record['customerId'])
        if any(sub.get('customer') != record['customerId'] for sub in subscriptions):
            raise ApiError(503, 'billing_unavailable')
        snapshot = service.paid_snapshot(subscriptions)
        exact = session.get('subscription')
        if not isinstance(exact, dict) or not any(sub.get('id') == exact.get('id') for sub in subscriptions):
            raise ApiError(503, 'billing_unavailable')
        service.store.save_purchase_account(proof, record, email, snapshot, lease, account_lease, service.now())


def status(service, device, credential_hash):
    if not service.config.billing_enabled:
        return None
    record = binding(service, device, credential_hash)
    if not record:
        return None
    proof = record['proof']
    if not service.store.account(purchase_subject(proof)):
        with service.store.guest_lock(proof, service.now()) as lease:
            purchase = service.store.guest(proof)
            if not purchase:
                return None
            session = service.guest_session(proof, purchase, lease)
            provision(service, proof, purchase, session, lease)
    if not service.store.account(purchase_subject(proof)):
        return None
    # Never read the claimed account's entitlements here: it may be an owner or
    # have unrelated purchases. This installation receives only its own purchase.
    result = service.entitlement(purchase_subject(proof))
    return {**result, 'linked': True, 'purchaseAccount': True}


def portal(service, device, credential_hash):
    service.require_billing()
    linked = service.store.device_link(device)
    if linked and hmac.compare_digest(str(linked.get('credentialHash', '')), credential_hash):
        return service.portal(linked['subject'])
    record = binding(service, device, credential_hash)
    purchase = service.store.guest(record['proof']) if record else None
    if not purchase or not purchase.get('paidAt') or not purchase.get('customerId'):
        raise ApiError(409, 'no_subscription')
    return {'url': service.stripe.portal(purchase['customerId'])['url']}


def recover(service, subject, email):
    """Called only after Cognito proves mailbox ownership; no browser proof needed."""
    if not service.config.billing_enabled:
        return
    proofs = service.store.purchases_for_email(email)
    candidates = [proof for proof in proofs if (service.store.guest(proof) or {}).get('claimedBy') in (None, subject)]
    account = service.store.account(subject)
    if not candidates:
        return
    if (account or {}).get('customerId') and service.entitlement(subject, email)['traceAccess']:
        return
    if len(candidates) != 1:
        raise ApiError(409, 'multiple_purchases')
    if (account or {}).get('customerId') == (service.store.guest(candidates[0]) or {}).get('customerId'):
        return
    try:
        service.claim_checkout_proof(subject, email, candidates[0])
    except ApiError as error:
        if error.code not in {'purchase_not_active', 'purchase_already_claimed', 'subscription_exists'}:
            raise
