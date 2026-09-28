"""Membership policy. No AWS/Stripe imports; all effects are injected and tested offline."""
import base64
import datetime as dt
import hashlib
import hmac
import json
import re
import secrets
import time
from dataclasses import dataclass
from urllib.parse import urlencode


ACCOUNT_URL = 'https://victoryroad.app/trace/account'
LINK_URL = 'https://victoryroad.app/trace/link'
PRICE_AMOUNTS = {'trace': 1499, 'supporter': 3999}
DEVICE_ID = re.compile(r'^[A-Za-z0-9._-]{16,128}$')
SUBJECT = re.compile(r'^[A-Za-z0-9_-]{1,128}$')
# Cognito subjects are UUIDs; pattern also permits synthetic nonproduction test subjects.
CHECKOUT_TOKEN = re.compile(r'^[A-Za-z0-9_-]{43,128}$')
GUEST_RETENTION_SECONDS = 90 * 86400
LINK_CODE = re.compile(r'^[A-Z2-7]{10}$')
EVENT_TYPES = frozenset({
    'checkout.session.completed', 'checkout.session.async_payment_succeeded',
    'checkout.session.async_payment_failed', 'customer.subscription.created',
    'customer.subscription.updated', 'customer.subscription.deleted',
    'customer.subscription.paused', 'customer.subscription.resumed',
    'invoice.paid', 'invoice.payment_failed', 'invoice.payment_action_required',
})


class ApiError(Exception):
    def __init__(self, status, code):
        super().__init__(code)
        self.status, self.code = status, code


@dataclass(frozen=True)
class Config:
    pool_id: str
    client_id: str
    region: str
    owner_subject: str = ''
    billing_enabled: bool = False
    stripe_live: bool = False
    trace_price: str = ''
    supporter_price: str = ''

    @property
    def prices(self):
        return {'trace': self.trace_price, 'supporter': self.supporter_price}


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def iso_timestamp(value):
    return dt.datetime.fromtimestamp(int(value), dt.timezone.utc).isoformat().replace('+00:00', 'Z')


def headers(event):
    return {str(k).lower(): str(v) for k, v in (event.get('headers') or {}).items()}


def raw_body(event):
    value = event.get('body') or ''
    if not isinstance(value, str) or len(value) > 1_400_000:
        raise ApiError(413, 'request_too_large')
    try:
        raw = base64.b64decode(value, validate=True) if event.get('isBase64Encoded') else value.encode()
    except (ValueError, UnicodeError):
        raise ApiError(400, 'invalid_request')
    if len(raw) > 1_000_000:
        raise ApiError(413, 'request_too_large')
    return raw


def body(event):
    raw = raw_body(event)
    if len(raw) > 8192:
        raise ApiError(413, 'request_too_large')
    try:
        value = json.loads(raw or b'{}')
    except (ValueError, UnicodeError):
        raise ApiError(400, 'invalid_request')
    if not isinstance(value, dict):
        raise ApiError(400, 'invalid_request')
    return value


def bearer(event):
    value = headers(event).get('authorization', '')
    if not value.startswith('Bearer ') or not 1 <= len(value[7:]) <= 8192:
        raise ApiError(401, 'unauthorized')
    return value[7:]


def email_value(value):
    if not isinstance(value, str) or len(value) > 254 or not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', value):
        raise ApiError(400, 'invalid_email')
    return value.strip().lower()


def password_value(value):
    if not isinstance(value, str) or not 12 <= len(value) <= 128 or not all((
        re.search(r'[A-Z]', value), re.search(r'[a-z]', value), re.search(r'[0-9]', value), re.search(r'[^A-Za-z0-9\s]', value),
    )):
        raise ApiError(400, 'invalid_password')
    return value


def checkout_digest(value):
    if not isinstance(value, str) or not CHECKOUT_TOKEN.fullmatch(value):
        raise ApiError(400, 'checkout_not_found')
    try:
        decoded = base64.urlsafe_b64decode(value + '=' * (-len(value) % 4))
    except ValueError:
        raise ApiError(400, 'checkout_not_found')
    if len(decoded) < 32:
        raise ApiError(400, 'checkout_not_found')
    return digest(value)


def confirmation_code(value):
    if not isinstance(value, str) or not re.fullmatch(r'[0-9]{6,8}', value.strip()):
        raise ApiError(400, 'invalid_code')
    return value.strip()


def verified_event(raw, signature, secret, now):
    """Stripe v1 signature, exact raw bytes, constant-time compare, five-minute replay window."""
    if not secret or not isinstance(signature, str) or len(signature) > 4096:
        raise ApiError(400, 'invalid_signature')
    parts = [part.split('=', 1) for part in signature.split(',') if '=' in part]
    timestamps = [value for key, value in parts if key.strip() == 't']
    signatures = [value for key, value in parts if key.strip() == 'v1']
    try:
        timestamp = int(timestamps[0]) if len(timestamps) == 1 else 0
    except (ValueError, IndexError):
        timestamp = 0
    if timestamp <= 0 or abs(now - timestamp) > 300:
        raise ApiError(400, 'invalid_signature')
    expected = hmac.new(secret.encode(), str(timestamp).encode() + b'.' + raw, hashlib.sha256).hexdigest()
    if not any(hmac.compare_digest(expected, value) for value in signatures):
        raise ApiError(400, 'invalid_signature')
    try:
        event = json.loads(raw)
    except (ValueError, UnicodeError):
        raise ApiError(400, 'invalid_request')
    if not isinstance(event, dict) or not re.fullmatch(r'evt_[A-Za-z0-9_]+', str(event.get('id', ''))):
        raise ApiError(400, 'invalid_request')
    return event


def price_plan(price, config, require_active=False):
    if not isinstance(price, dict):
        return None
    plan = next((p for p, identifier in config.prices.items() if identifier and price.get('id') == identifier), None)
    recurring = price.get('recurring') or {}
    if not plan or price.get('currency') != 'usd' or price.get('unit_amount') != PRICE_AMOUNTS[plan]:
        return None
    if price.get('type') != 'recurring' or recurring.get('interval') != 'month' or recurring.get('interval_count') != 1:
        return None
    if recurring.get('usage_type') != 'licensed' or price.get('billing_scheme') != 'per_unit':
        return None
    if price.get('livemode') is not config.stripe_live or (require_active and price.get('active') is not True):
        return None
    return plan


def subscription_snapshot(subscriptions, config, now):
    """Unknown/multiple membership subscriptions fail closed, including malformed active prices."""
    candidates = []
    for sub in subscriptions:
        items = (sub.get('items') or {}).get('data') or []
        known = [item for item in items if (item.get('price') or {}).get('id') in config.prices.values()]
        if not known:
            continue  # Unrelated Victory Road subscriptions never grant Trace access.
        if sub.get('status') not in {'canceled', 'incomplete_expired'}:
            candidates.append(sub)
    snapshot = {'plan': 'none', 'status': 'none', 'expiresAt': 0, 'cancelAtPeriodEnd': False, 'syncedAt': now}
    if len(candidates) > 1:
        return {**snapshot, 'status': 'subscription_conflict'}
    if not candidates:
        return snapshot
    sub = candidates[0]
    items = (sub.get('items') or {}).get('data') or []
    plan = price_plan(items[0].get('price'), config) if len(items) == 1 else None
    if not plan or items[0].get('quantity') != 1 or sub.get('livemode') is not config.stripe_live:
        return {**snapshot, 'status': 'invalid_subscription'}
    invoice = sub.get('latest_invoice') or {}
    paid = isinstance(invoice, dict) and invoice.get('paid') is True
    period_end = sub.get('current_period_end')
    if not isinstance(period_end, int) or isinstance(period_end, bool):
        return {**snapshot, 'status': 'invalid_subscription'}
    status = str(sub.get('status', 'none'))
    if status == 'active' and not paid:
        status = 'payment_pending'
    return {**snapshot, 'plan': plan, 'status': status, 'expiresAt': period_end,
            'cancelAtPeriodEnd': sub.get('cancel_at_period_end') is True,
            'subscriptionId': sub.get('id')}


class MembershipService:
    def __init__(self, config, store, cognito, stripe, clock=time.time):
        self.config, self.store, self.cognito, self.stripe, self.clock = config, store, cognito, stripe, clock

    def now(self):
        return int(self.clock())

    def account_identity(self, event):
        token = bearer(event)
        # Routing claims alone are never trusted. GetUser validates the token; these checks
        # prevent a valid token from a different Cognito pool/client from crossing tenants.
        try:
            segment = token.split('.')[1]
            claims = json.loads(base64.urlsafe_b64decode(segment + '=' * (-len(segment) % 4)))
        except (ValueError, IndexError, UnicodeError):
            raise ApiError(401, 'unauthorized')
        issuer = f'https://cognito-idp.{self.config.region}.amazonaws.com/{self.config.pool_id}'
        if not isinstance(claims, dict) or claims.get('iss') != issuer or claims.get('client_id') != self.config.client_id or claims.get('token_use') != 'access':
            raise ApiError(401, 'unauthorized')
        user = self.cognito.get_user(token)
        attrs = {entry['Name']: entry['Value'] for entry in user.get('UserAttributes', [])}
        subject = attrs.get('sub', '')
        if not SUBJECT.fullmatch(subject) or subject != claims.get('sub'):
            raise ApiError(401, 'unauthorized')
        if attrs.get('email_verified') != 'true':
            raise ApiError(403, 'email_not_verified')
        email = email_value(attrs.get('email'))
        self.store.remember_account(subject, email)
        return subject, email

    def device_identity(self, event):
        device = headers(event).get('x-trace-device', '')
        token = bearer(event)
        if not DEVICE_ID.fullmatch(device):
            raise ApiError(401, 'unauthorized')
        record = self.store.capture_device(device)
        credential_hash = digest(token)
        if not record or not hmac.compare_digest(str(record.get('tokenHash', '')), credential_hash):
            raise ApiError(401, 'unauthorized')
        return device, credential_hash

    def require_billing(self):
        if not self.config.billing_enabled or not all(self.config.prices.values()) or len(set(self.config.prices.values())) != 2:
            raise ApiError(503, 'billing_unavailable')

    def entitlement(self, subject=None, email=None):
        now = self.now()
        account = self.store.account(subject) if subject else None
        snapshot = (account or {}).get('snapshot') or {}
        is_owner = bool(subject and self.config.owner_subject and subject == self.config.owner_subject)
        admin = bool(is_owner and (account or {}).get('emailVerified') is True and self.store.owner_enabled(subject))
        if admin:
            return {'email': email or account.get('email'), 'plan': 'supporter', 'traceAccess': True,
                    'opponentDecklists': True, 'admin': True, 'status': 'admin',
                    'expiresAt': None, 'cancelAtPeriodEnd': False}
        # Webhooks normally keep this fresh. Reads repair missed events; stale/failed
        # reconciliation never continues granting paid access from an old snapshot.
        if account and account.get('customerId') and self.config.billing_enabled and now - int(snapshot.get('syncedAt', 0)) > 300:
            with self.store.account_lock(subject, now) as lease:
                account = self.store.account(subject)
                snapshot = self.reconcile(subject, account, lease)
        status = snapshot.get('status', 'none')
        plan = snapshot.get('plan', 'none')
        expires = int(snapshot.get('expiresAt') or 0)
        current = self.config.billing_enabled and now - int(snapshot.get('syncedAt', 0)) <= 300
        allowed = bool(current and plan in PRICE_AMOUNTS and status == 'active' and expires > now)
        return {'email': email or (account or {}).get('email'), 'plan': plan if plan in PRICE_AMOUNTS else 'none',
                'traceAccess': allowed, 'opponentDecklists': allowed and plan == 'supporter', 'admin': False,
                'status': status if current else 'none', 'expiresAt': iso_timestamp(expires) if expires else None,
                'cancelAtPeriodEnd': snapshot.get('cancelAtPeriodEnd') is True}

    def reconcile(self, subject, account, lease):
        self.require_billing()
        subscriptions = self.stripe.subscriptions(account['customerId'])
        if any(sub.get('customer') != account['customerId'] for sub in subscriptions):
            raise ApiError(503, 'billing_unavailable')
        snapshot = subscription_snapshot(subscriptions, self.config, self.now())
        self.store.save_account(subject, {'snapshot': snapshot}, lease, self.now())
        return snapshot

    def checkout(self, subject, email, plan):
        self.require_billing()
        if plan not in PRICE_AMOUNTS:
            raise ApiError(400, 'invalid_plan')
        if subject == self.config.owner_subject and self.store.owner_enabled(subject):
            raise ApiError(409, 'access_already_enabled')
        if price_plan(self.stripe.price(self.config.prices[plan]), self.config, require_active=True) != plan:
            raise ApiError(503, 'billing_unavailable')
        with self.store.account_lock(subject, self.now()) as lease:
            account = self.store.account(subject)
            if not account.get('customerId'):
                customer = self.stripe.create_customer(email, subject)
                self.store.bind_customer(subject, customer['id'], lease, self.now())
                account = self.store.account(subject)
            snapshot = self.reconcile(subject, account, lease)
            if snapshot['status'] not in {'none', 'canceled', 'incomplete_expired'}:
                raise ApiError(409, 'subscription_exists')
            pending = account.get('checkout')
            if pending and int(pending.get('expiresAt', 0)) > self.now():
                # Repeating the exact original idempotency request also recovers a lost
                # Stripe response before the session ID was saved locally.
                identifier = pending.get('sessionId')
                if not identifier:
                    recovered = self.stripe.checkout(account['customerId'], self.config.prices[pending['plan']], subject,
                                                     pending['key'], pending['expiresAt'])
                    identifier = recovered['id']
                    pending = {**pending, 'sessionId': identifier}
                    self.store.save_account(subject, {'checkout': pending}, lease, self.now())
                session = self.stripe.retrieve_checkout(identifier)
                if session.get('status') == 'open':
                    if pending['plan'] == plan and int(session.get('expires_at', 0)) > self.now():
                        return {'url': self.stripe.checkout_url(session)}
                    self.stripe.expire_checkout(session['id'])
                if session.get('status') == 'complete':
                    raise ApiError(409, 'payment_processing')
            pending = {'key': secrets.token_urlsafe(24), 'plan': plan, 'expiresAt': self.now() + 3600}
            self.store.save_account(subject, {'checkout': pending}, lease, self.now())
            session = self.stripe.checkout(account['customerId'], self.config.prices[plan], subject,
                                           pending['key'], pending['expiresAt'])
            self.store.save_account(subject, {'checkout': {**pending, 'sessionId': session['id']}}, lease, self.now())
            return {'url': self.stripe.checkout_url(session)}

    def require_proxy(self, event):
        self.require_billing()
        supplied = headers(event).get('x-trace-proxy-key', '')
        expected = self.stripe.proxy_secret()
        if not supplied or len(supplied) > 512 or not hmac.compare_digest(supplied, expected):
            raise ApiError(401, 'unauthorized')

    def guest_record(self, proof, required=True):
        record = self.store.guest(proof)
        if not record:
            if required:
                raise ApiError(404, 'checkout_not_found')
            return None
        if not record.get('paidAt') and not record.get('claimedBy') and int(record.get('claimExpiresAt', 0)) <= self.now():
            raise ApiError(410, 'checkout_expired')
        return record

    def guest_session(self, proof, record, lease, create=False):
        """Recover the exact reservation, including a lost creation response older than 24h."""
        if not record.get('key'):
            return None
        identifier = record.get('sessionId')
        if not identifier:
            matches = [session for session in self.stripe.checkout_sessions(record['customerId'])
                       if (session.get('metadata') or {}).get('trace_guest') == proof
                       and (session.get('metadata') or {}).get('trace_reservation') == record['key']]
            if len(matches) > 1:
                raise ApiError(503, 'billing_unavailable')
            if matches:
                identifier = matches[0]['id']
            elif create and int(record['expiresAt']) > self.now():
                session = self.stripe.guest_checkout(record['customerId'], self.config.prices[record['plan']],
                                                     proof, record['key'], int(record['expiresAt']))
                identifier = session['id']
            else:
                return None
            record['sessionId'] = identifier
            self.store.save_guest(proof, record, lease, self.now())
        session = self.stripe.retrieve_checkout(identifier)
        metadata = session.get('metadata') or {}
        if (session.get('id') != identifier or session.get('customer') != record['customerId']
                or session.get('client_reference_id') != 'guest_' + proof
                or metadata.get('trace_guest') != proof or metadata.get('trace_reservation') != record['key']
                or session.get('mode') != 'subscription' or session.get('livemode') is not self.config.stripe_live):
            raise ApiError(503, 'billing_unavailable')
        items = (session.get('line_items') or {}).get('data') or []
        if ((session.get('line_items') or {}).get('has_more') or len(items) != 1
                or items[0].get('quantity') != 1 or price_plan(items[0].get('price'), self.config) != record['plan']):
            raise ApiError(503, 'billing_unavailable')
        if session.get('status') == 'complete' and session.get('payment_status') == 'paid' and not record.get('paidAt'):
            record['paidAt'] = self.now()
            record.pop('ttl', None)
            record.pop('claimExpiresAt', None)
            self.store.save_guest(proof, record, lease, self.now())
        return session

    def paid_guest_subscription(self, proof, record, session):
        subscription = session.get('subscription')
        if (session.get('status') != 'complete' or session.get('payment_status') != 'paid'):
            raise ApiError(409, 'payment_processing')
        if not isinstance(subscription, dict):
            raise ApiError(503, 'billing_unavailable')
        if (subscription.get('customer') != record['customerId']
                or (subscription.get('metadata') or {}).get('trace_guest') != proof
                or (subscription.get('metadata') or {}).get('trace_reservation') != record['key']):
            raise ApiError(503, 'billing_unavailable')
        snapshot = subscription_snapshot([subscription], self.config, self.now())
        if snapshot['plan'] != record['plan'] or snapshot['status'] != 'active' or snapshot['expiresAt'] <= self.now():
            raise ApiError(409, 'purchase_not_active')
        return snapshot

    def guest_checkout(self, plan, token):
        self.require_billing()
        proof = checkout_digest(token)
        if plan not in PRICE_AMOUNTS:
            raise ApiError(400, 'invalid_plan')
        if price_plan(self.stripe.price(self.config.prices[plan]), self.config, require_active=True) != plan:
            raise ApiError(503, 'billing_unavailable')
        self.store.limit('guest-checkout:' + proof, 12, 600, self.now())
        with self.store.guest_lock(proof, self.now()) as lease:
            record = self.guest_record(proof, required=False)
            if record and record.get('claimedBy'):
                raise ApiError(409, 'purchase_already_claimed')
            if record and record.get('customerId'):
                previous = self.guest_session(proof, record, lease, create=True)
                if previous and previous.get('status') == 'complete':
                    raise ApiError(409, 'payment_already_completed')
                if previous and previous.get('status') == 'open':
                    if record['plan'] == plan and int(previous.get('expires_at', 0)) > self.now():
                        return {'url': self.stripe.checkout_url(previous)}
                    self.stripe.expire_checkout(previous['id'])
            if not record:
                record = {'createdAt': self.now(), 'claimExpiresAt': self.now() + GUEST_RETENTION_SECONDS,
                          'ttl': self.now() + GUEST_RETENTION_SECONDS}
                self.store.save_guest(proof, record, lease, self.now())
            if not record.get('customerId'):
                customer = self.stripe.create_guest_customer(proof)
                record['customerId'] = customer['id']
                self.store.bind_guest_customer(proof, record, lease, self.now())
            record = {**record, 'plan': plan, 'key': secrets.token_urlsafe(24), 'expiresAt': self.now() + 3600}
            record.pop('sessionId', None)
            self.store.save_guest(proof, record, lease, self.now())
            session = self.guest_session(proof, record, lease, create=True)
            if not session or session.get('status') != 'open':
                raise ApiError(503, 'billing_unavailable')
            return {'url': self.stripe.checkout_url(session)}

    def guest_status(self, token):
        self.require_billing()
        proof = checkout_digest(token)
        with self.store.guest_lock(proof, self.now()) as lease:
            record = self.guest_record(proof, required=False)
            if not record:
                return {'state': 'none', 'plan': 'none', 'expiresAt': None}
            if record.get('claimedBy'):
                return {'state': 'claimed', 'plan': record.get('plan', 'none'), 'expiresAt': None}
            if not record.get('customerId') or not record.get('key'):
                return {'state': 'none', 'plan': 'none', 'expiresAt': None}
            session = self.guest_session(proof, record, lease)
            if not session or session.get('status') == 'expired':
                return {'state': 'expired', 'plan': record['plan'], 'expiresAt': iso_timestamp(record['expiresAt'])}
            if session.get('status') == 'open':
                return {'state': 'open', 'plan': record['plan'], 'expiresAt': iso_timestamp(session['expires_at'])}
            try:
                self.paid_guest_subscription(proof, record, session)
            except ApiError as error:
                if error.code in {'payment_processing', 'purchase_not_active'}:
                    return {'state': 'processing', 'plan': record['plan'], 'expiresAt': None,
                            **({'reason': 'purchase_not_active'} if error.code == 'purchase_not_active' else {})}
                raise
            return {'state': 'paid', 'plan': record['plan'], 'expiresAt': None}

    def retire_unused_customer(self, subject, account, lease):
        """An abandoned account checkout must not strand a legitimate guest purchase."""
        if self.reconcile(subject, account, lease)['status'] != 'none':
            raise ApiError(409, 'subscription_exists')
        for session in self.stripe.checkout_sessions(account['customerId']):
            if session.get('status') != 'open':
                continue
            if session.get('client_reference_id') != subject or session.get('mode') != 'subscription':
                raise ApiError(409, 'subscription_exists')
            self.stripe.expire_checkout(session['id'])
        # A concurrent completion cannot sneak a second subscription in during expiration.
        if self.reconcile(subject, account, lease)['status'] != 'none':
            raise ApiError(409, 'subscription_exists')

    def claim_checkout(self, subject, email, token):
        self.require_billing()
        proof = checkout_digest(token)
        with self.store.guest_lock(proof, self.now()) as guest_lease:
            record = self.guest_record(proof)
            if record.get('claimedBy') and record['claimedBy'] != subject:
                raise ApiError(409, 'purchase_already_claimed')
            if not record.get('customerId') or not record.get('key'):
                raise ApiError(404, 'checkout_not_found')
            session = self.guest_session(proof, record, guest_lease)
            if not session or session.get('status') == 'expired':
                raise ApiError(410, 'checkout_expired')
            snapshot = self.paid_guest_subscription(proof, record, session)
            checkout_email = (session.get('customer_details') or {}).get('email')
            if not isinstance(checkout_email, str) or checkout_email.strip().lower() != email:
                raise ApiError(409, 'checkout_email_mismatch')
            with self.store.account_lock(subject, self.now()) as account_lease:
                account = self.store.account(subject)
                mapped = self.store.customer_subject(record['customerId'])
                if mapped and mapped != subject:
                    raise ApiError(409, 'purchase_already_claimed')
                previous = account.get('customerId')
                if previous and previous != record['customerId']:
                    self.retire_unused_customer(subject, account, account_lease)
                # Re-fetch every subscription for this customer under the account lease:
                # a fresh exact session alone cannot hide a conflicting second subscription.
                subscriptions = self.stripe.subscriptions(record['customerId'])
                if any(sub.get('customer') != record['customerId'] for sub in subscriptions):
                    raise ApiError(503, 'billing_unavailable')
                current = subscription_snapshot(subscriptions, self.config, self.now())
                if (current.get('subscriptionId') != snapshot.get('subscriptionId') or current['status'] != 'active'
                        or current['plan'] != record['plan'] or current['expiresAt'] <= self.now()):
                    raise ApiError(409, 'purchase_not_active')
                self.store.claim_guest(proof, subject, record, current, previous, guest_lease, account_lease, self.now())
            return {'claimed': True}

    def portal(self, subject):
        self.require_billing()
        account = self.store.account(subject)
        if not account or not account.get('customerId'):
            raise ApiError(409, 'no_subscription')
        return {'url': self.stripe.portal(account['customerId'])['url']}

    def start_link(self, device, credential_hash):
        if self.store.device_link(device):
            raise ApiError(409, 'device_already_linked')
        self.store.limit('link-start:' + device, 5, 600, self.now())
        code = ''.join(secrets.choice('ABCDEFGHIJKLMNOPQRSTUVWXYZ234567') for _ in range(10))
        expires = self.now() + 600
        self.store.create_link(digest(code), device, credential_hash, expires)
        display = code[:5] + '-' + code[5:]
        return {'userCode': display, 'verificationUrl': LINK_URL + '?' + urlencode({'code': display}),
                'expiresAt': iso_timestamp(expires)}

    def approve_link(self, subject, user_code):
        self.store.limit('link-approve:' + subject, 12, 600, self.now())
        if not isinstance(user_code, str) or len(user_code) > 32:
            raise ApiError(400, 'invalid_code')
        normalized = re.sub(r'[\s-]', '', user_code).upper()
        if not LINK_CODE.fullmatch(normalized):
            raise ApiError(400, 'invalid_code')
        self.store.approve_link(digest(normalized), subject, self.now())
        return {'linked': True}

    def device_status(self, device, credential_hash):
        linked = self.store.device_link(device)
        valid = linked and hmac.compare_digest(str(linked.get('credentialHash', '')), credential_hash)
        return {**self.entitlement(linked['subject'] if valid else None), 'linked': bool(valid)}

    def webhook(self, event):
        self.require_billing()
        incoming = verified_event(raw_body(event), headers(event).get('stripe-signature', ''),
                                  self.stripe.webhook_secret(), self.now())
        if incoming.get('livemode') is not self.config.stripe_live:
            raise ApiError(400, 'wrong_billing_mode')
        if incoming.get('type') not in EVENT_TYPES:
            return {'received': True}
        if self.store.event_seen(incoming['id']):
            return {'received': True}
        obj = (incoming.get('data') or {}).get('object') or {}
        customer_id = obj.get('customer')
        if not isinstance(customer_id, str) or not re.fullmatch(r'cus_[A-Za-z0-9]+', customer_id):
            raise ApiError(400, 'invalid_request')
        subject = self.store.customer_subject(customer_id)
        if not subject:
            # Keep paid but unclaimed purchases recoverable even when the browser never
            # returns. The guest/customer binding exists before Checkout can be opened.
            proof = self.store.guest_customer_proof(customer_id)
            if proof:
                with self.store.guest_lock(proof, self.now()) as lease:
                    record = self.store.guest(proof)
                    if record and not record.get('claimedBy'):
                        self.guest_session(proof, record, lease)
            # Unrelated film customers still do not grant any membership.
            return {'received': True}
        with self.store.account_lock(subject, self.now()) as lease:
            if not self.store.event_seen(incoming['id']):
                account = self.store.account(subject)
                if not account or account.get('customerId') != customer_id:
                    raise ApiError(503, 'billing_unavailable')
                self.reconcile(subject, account, lease)
                # Acknowledge only after durable entitlement state + receipt. Failed writes
                # return non-2xx so Stripe retries; no event snapshot can roll state back.
                self.store.mark_event(incoming['id'], subject, lease, self.now())
        return {'received': True}

    def auth(self, action, event):
        request = body(event)
        if action == 'logout':
            self.cognito.logout(bearer(event))
            return {'ok': True}
        if action == 'refresh':
            value = request.get('refreshToken')
            if not isinstance(value, str) or not 1 <= len(value) <= 8192:
                raise ApiError(400, 'invalid_request')
            return self.cognito.refresh(value)
        email = email_value(request.get('email'))
        if action == 'signup':
            self.cognito.signup(email, password_value(request.get('password')))
            return {'ok': True, 'confirmationRequired': True}
        if action == 'login':
            password = request.get('password')
            if not isinstance(password, str) or not 1 <= len(password) <= 128:
                raise ApiError(400, 'invalid_password')
            return self.cognito.login(email, password)
        if action == 'confirm':
            self.cognito.confirm(email, confirmation_code(request.get('code')))
        elif action == 'resend':
            self.cognito.resend(email)
        elif action == 'recover':
            self.cognito.recover(email)
        elif action == 'reset':
            self.cognito.reset(email, confirmation_code(request.get('code')), password_value(request.get('password')))
        else:
            raise ApiError(404, 'not_found')
        return {'ok': True}

    def handle(self, event):
        method = event.get('requestContext', {}).get('http', {}).get('method', '')
        path = event.get('rawPath', '')
        if method == 'POST' and path.startswith('/v1/auth/'):
            action = path.removeprefix('/v1/auth/')
            if action not in {'signup', 'confirm', 'resend', 'login', 'refresh', 'recover', 'reset', 'logout'}:
                raise ApiError(404, 'not_found')
            # The website proxy shares egress IPs. Bucket by a hash of the account/token,
            # not that shared IP; Cognito and API Gateway provide additional limits.
            request = body(event)
            identity = str(request.get('email', request.get('refreshToken', bearer(event) if action == 'logout' else 'unknown')))
            self.store.limit('auth:' + digest(identity.lower() if 'email' in request else identity), 30, 300, self.now())
            return self.auth(action, event)
        if method == 'POST' and path == '/v1/webhook':
            return self.webhook(event)
        if method == 'POST' and path in {'/v1/checkout/guest', '/v1/checkout/status', '/v1/checkout/claim'}:
            self.require_proxy(event)
            request = body(event)
            if path.endswith('/guest'):
                return self.guest_checkout(request.get('plan'), request.get('checkoutToken'))
            if path.endswith('/status'):
                return self.guest_status(request.get('checkoutToken'))
            subject, email = self.account_identity(event)
            return self.claim_checkout(subject, email, request.get('checkoutToken'))
        if path in {'/v1/devices/status', '/v1/devices/link/start', '/v1/devices/unlink'}:
            device, credential_hash = self.device_identity(event)
            if method == 'GET' and path.endswith('/status'):
                return self.device_status(device, credential_hash)
            if method == 'POST' and path.endswith('/start'):
                return self.start_link(device, credential_hash)
            if method == 'POST' and path.endswith('/unlink'):
                self.store.unlink(device)
                return self.device_status(device, credential_hash)
            raise ApiError(405, 'method_not_allowed')
        if (method, path) not in {('GET', '/v1/account'), ('POST', '/v1/checkout'),
                                  ('POST', '/v1/portal'), ('POST', '/v1/devices/link/approve')}:
            raise ApiError(404, 'not_found')
        subject, email = self.account_identity(event)
        if path == '/v1/account':
            return self.entitlement(subject, email)
        if path == '/v1/checkout':
            return self.checkout(subject, email, body(event).get('plan'))
        if path == '/v1/portal':
            return self.portal(subject)
        return self.approve_link(subject, body(event).get('userCode'))
