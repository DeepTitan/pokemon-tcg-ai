"""Creator attribution and an invoice-level, append-only commission adjustment ledger.

Amounts are integer USD cents. No transfers, payouts or membership grants are made here.
"""
import base64
import hashlib
import hmac
import json
import re
from decimal import Decimal, ROUND_HALF_UP

CREATORS = {'jakeptcg': {'name': 'JakePTCG', 'rateBps': 2000}}
WINDOW = 86400
ADJUSTMENT_EVENTS = frozenset({'charge.refunded', 'charge.dispute.created', 'charge.dispute.updated',
                                'charge.dispute.closed', 'charge.dispute.funds_withdrawn',
                                'charge.dispute.funds_reinstated', 'refund.updated',
                                'credit_note.created', 'credit_note.updated', 'credit_note.voided'})


def code(value):
    normalized = value.strip().lower() if isinstance(value, str) else ''
    return normalized if normalized in CREATORS else None


def referral(token, secret, now):
    try:
        if not isinstance(token, str) or len(token) > 512 or not re.fullmatch(r'[\w-]+\.[\w-]+', token):
            return None
        payload, signature = token.split('.')
        expected = base64.urlsafe_b64encode(hmac.new(secret.encode(), ('trace-referral-v1.' + payload).encode(), hashlib.sha256).digest()).decode().rstrip('=')
        if not hmac.compare_digest(signature, expected):
            return None
        value = json.loads(base64.urlsafe_b64decode(payload + '=' * (-len(payload) % 4)))
        if not code(value.get('code')) or type(value.get('at')) is not int or not value['at'] <= now < value['at'] + WINDOW:
            return None
        return {'code': code(value['code']), 'at': value['at']}
    except (ValueError, TypeError, UnicodeError, AttributeError):
        return None


def checkout_fields(candidate):
    # None means a legacy reservation: preserve its original Stripe idempotent parameters.
    if candidate is None:
        return {}
    fields = {'metadata[trace_affiliate_version]': '1',
              'custom_fields[0][key]': 'creator', 'custom_fields[0][type]': 'text',
              'custom_fields[0][optional]': 'true', 'custom_fields[0][label][type]': 'custom',
              'custom_fields[0][label][custom]': 'Creator code', 'custom_fields[0][text][maximum_length]': 40}
    if code(candidate.get('code')):
        fields.update({'metadata[trace_creator]': candidate['code'],
                       'metadata[trace_referred_at]': str(candidate['at']),
                       'custom_fields[0][text][default_value]': candidate['code']})
    return fields


def attribution(session, paid_at):
    metadata = session.get('metadata') or {}
    if metadata.get('trace_affiliate_version') != '1':
        return None
    entered = next((code((field.get('text') or {}).get('value')) for field in session.get('custom_fields', [])
                    if field.get('key') == 'creator' and field.get('type') == 'text'), None)
    linked = code(metadata.get('trace_creator'))
    # Unchanged prefilled text remains link attribution, so a checkout left open
    # cannot silently extend the 24-hour purchase deadline.
    if entered and entered != linked:
        return {'creator': entered, 'source': 'code'}
    try:
        seen = int(metadata.get('trace_referred_at', 0))
    except (TypeError, ValueError):
        seen = 0
    if linked and seen > 0 and seen <= paid_at < seen + WINDOW:
        return {'creator': linked, 'source': 'link', 'referredAt': seen}
    return None


def identifier(value, prefix):
    value = value.get('id') if isinstance(value, dict) else value
    return value if isinstance(value, str) and re.fullmatch(prefix + r'_[A-Za-z0-9]+', value) else None


def cents(value):
    if isinstance(value, bool) or not isinstance(value, (int, Decimal)) or value != int(value) or value < 0:
        from membership import ApiError
        raise ApiError(503, 'billing_unavailable')
    return int(value)


def rounded(value):
    return int(value.quantize(Decimal('1'), rounding=ROUND_HALF_UP))


class AffiliateLedger:
    def __init__(self, service):
        self.service, self.store, self.stripe = service, service.store, service.stripe
        self.config, self.now = service.config, service.now

    def known_customer(self, customer):
        return bool(identifier(customer, 'cus') and (self.store.customer_subject(customer) or self.store.guest_customer_proof(customer)))

    def handle_event(self, event):
        kind, obj = event.get('type'), (event.get('data') or {}).get('object') or {}
        invoice_id = None
        if kind == 'invoice.paid':
            if not self.known_customer(obj.get('customer')):
                return
            invoice_id = identifier(obj, 'in')
        elif kind == 'checkout.session.completed':
            if not self.known_customer(obj.get('customer')) or (obj.get('metadata') or {}).get('trace_affiliate_version') != '1':
                return
            invoice_id = identifier(obj.get('invoice'), 'in')
        elif kind.startswith('credit_note.'):
            if self.known_customer(obj.get('customer')):
                invoice_id = identifier(obj.get('invoice'), 'in')
        elif kind in ADJUSTMENT_EVENTS:
            charge_id = identifier(obj, 'ch') if kind == 'charge.refunded' else identifier(obj.get('charge'), 'ch')
            if charge_id:
                charge = self.stripe.affiliate_charge(charge_id)
                if charge.get('livemode') is not self.config.stripe_live or not self.known_customer(charge.get('customer')):
                    return
                invoice_id = identifier(charge.get('invoice'), 'in')
        if invoice_id:
            self.reconcile_invoice(invoice_id)

    def subscription_credit(self, invoice):
        from membership import ApiError
        subscription_id = identifier(invoice.get('subscription'), 'sub')
        if not subscription_id:
            return None
        key = 'AFFILIATE_SUB#' + subscription_id
        with self.store.account_lock(key, self.now()) as lease:
            stored = self.store.get(key)
            if stored:
                if stored.get('customerId') != invoice['customer']:
                    raise ApiError(503, 'billing_unavailable')
                return stored if stored.get('creator') else None
            sessions = self.stripe.affiliate_sessions(subscription_id)
            if len(sessions) != 1:
                # Retry absent/eventually visible or ambiguous checkout mappings.
                raise ApiError(503, 'billing_unavailable')
            session = sessions[0]
            if (session.get('customer') != invoice['customer'] or identifier(session.get('subscription'), 'sub') != subscription_id
                    or session.get('livemode') is not self.config.stripe_live or session.get('mode') != 'subscription'
                    or (session.get('metadata') or {}).get('trace_affiliate_version') != '1'):
                return None
            if session.get('status') != 'complete' or session.get('payment_status') != 'paid':
                # Invoice can precede checkout completion. Let its webhook retry; never freeze a premature denial.
                raise ApiError(409, 'payment_processing')
            first_id = identifier(session.get('invoice'), 'in')
            if not first_id:
                raise ApiError(503, 'billing_unavailable')
            first = invoice if first_id == invoice['id'] else self.stripe.affiliate_invoice(first_id)
            if (first.get('customer') != invoice['customer'] or identifier(first.get('subscription'), 'sub') != subscription_id
                    or first.get('livemode') is not self.config.stripe_live or first.get('paid') is not True):
                raise ApiError(503, 'billing_unavailable')
            paid_at = cents((first.get('status_transitions') or {}).get('paid_at'))
            chosen = attribution(session, paid_at)
            record = {'pk': key, 'subscriptionId': subscription_id, 'customerId': invoice['customer'],
                      'checkoutId': session['id'], 'qualifiedAt': paid_at,
                      'creator': chosen['creator'] if chosen else '', 'rateBps': CREATORS[chosen['creator']]['rateBps'] if chosen else 0,
                      'source': chosen['source'] if chosen else 'unattributed', 'policyVersion': 1}
            self.store.save_affiliate_record(key, record, lease, self.now())
            return record if chosen else None

    def reconcile_invoice(self, invoice_id):
        from membership import ApiError, price_plan
        lock = 'AFFILIATE_INVOICE#' + invoice_id
        with self.store.account_lock(lock, self.now()) as lease:
            invoice = self.stripe.affiliate_invoice(invoice_id)
            if (invoice.get('id') != invoice_id or invoice.get('livemode') is not self.config.stripe_live
                    or invoice.get('currency') != 'usd' or not self.known_customer(invoice.get('customer'))):
                return
            credit = self.subscription_credit(invoice)
            if not credit:
                return
            if invoice.get('paid') is not True or invoice.get('status') != 'paid':
                return
            lines = invoice.get('lines') or {}
            if lines.get('has_more') or not lines.get('data'):
                raise ApiError(503, 'billing_unavailable')
            plans = {price_plan(line.get('price'), self.config) for line in lines['data']}
            if None in plans or any(identifier(line.get('subscription'), 'sub') != credit['subscriptionId'] for line in lines['data']):
                # Unrelated invoice items must not generate creator revenue.
                raise ApiError(503, 'billing_unavailable')
            total, pretax, paid = cents(invoice.get('total')), cents(invoice.get('total_excluding_tax')), cents(invoice.get('amount_paid'))
            if pretax > total:
                raise ApiError(503, 'billing_unavailable')
            paid_at = cents((invoice.get('status_transitions') or {}).get('paid_at'))
            charge_id = identifier(invoice.get('charge'), 'ch')
            refunded, held, collected = 0, False, 0
            if charge_id:
                # A fresh charge, not a stale webhook or invoice expansion, establishes net receipts.
                charge = self.stripe.affiliate_charge(charge_id)
                if (charge.get('id') != charge_id or identifier(charge.get('invoice'), 'in') != invoice_id
                        or charge.get('customer') != invoice['customer'] or charge.get('livemode') is not self.config.stripe_live
                        or charge.get('currency') != 'usd' or charge.get('paid') is not True or charge.get('captured') is not True):
                    raise ApiError(503, 'billing_unavailable')
                collected = min(paid, total, cents(charge.get('amount_captured')))
                refunded = min(collected, cents(charge.get('amount_refunded')))
                if charge.get('disputed'):
                    held = any(item.get('status') not in {'won', 'warning_closed'} for item in self.stripe.affiliate_disputes(charge_id))
            elif paid and total:
                # Out-of-band and credit-balance payments are not card revenue.
                collected = 0
            gross = Decimal(collected) * pretax / total if total else Decimal(0)
            net = Decimal(max(0, collected - refunded)) * pretax / total if total and not held else Decimal(0)
            # Credits issued without a cash refund still reduce eligible revenue.
            post_credit = cents(invoice.get('post_payment_credit_notes_amount', 0))
            net = max(Decimal(0), net - Decimal(max(0, post_credit - refunded)) * pretax / total) if total else Decimal(0)
            commission = rounded(net * credit['rateBps'] / 10000)
            record = {'pk': lock, 'creator': credit['creator'], 'invoiceId': invoice_id,
                      'subscriptionId': credit['subscriptionId'], 'customerId': invoice['customer'], 'currency': 'usd',
                      'plans': ','.join(sorted(plans)), 'paidAt': paid_at, 'syncedAt': self.now(), 'rateBps': credit['rateBps'],
                      'grossCommissionCents': rounded(gross * credit['rateBps'] / 10000),
                      'commissionCents': commission, 'refundedCents': refunded, 'disputeHeld': held}
            previous = self.store.get(lock) or {}
            delta = commission - int(previous.get('commissionCents', 0))
            self.store.save_affiliate_invoice(lock, record, delta, lease, self.now())
