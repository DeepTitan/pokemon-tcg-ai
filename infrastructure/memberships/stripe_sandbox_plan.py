#!/usr/bin/env python3
"""Print an offline Stripe sandbox request plan. Never reads keys or sends requests."""
import argparse
import json
from pathlib import Path
import re
import sys

sys.path.insert(0, str(Path(__file__).parent / 'lambda'))
from membership import EVENT_TYPES, PRICE_AMOUNTS

ORIGIN = 'https://trace-memberships-staging-deeptitan-6729s-projects.vercel.app'
WEBHOOK = 'https://scn2ntfvfa.execute-api.us-east-1.amazonaws.com/v1/webhook'


def resource_id(prefix):
    def validate(value):
        if not re.fullmatch(prefix + r'_[A-Za-z0-9]+', value):
            raise argparse.ArgumentTypeError('Expected a Stripe resource ID, never a key or secret.')
        return value
    return validate


def build_plan(ids):
    requests = []

    def add(name, path, fields):
        requests.append({'step': name, 'method': 'POST', 'path': path,
                         'fields': {**fields, 'metadata[app]': 'trace', 'metadata[environment]': 'staging'}})

    names = {'trace': 'Trace Pro', 'supporter': 'Trace Supporters Club'}
    for plan, name in names.items():
        add(plan + '-product', '/v1/products', {'name': name, 'metadata[plan]': plan})
        add(plan + '-price', '/v1/prices', {
            'product': ids.get(plan + '_product') or '<' + plan + '-product.id>',
            'unit_amount': PRICE_AMOUNTS[plan], 'currency': 'usd', 'billing_scheme': 'per_unit',
            'recurring[interval]': 'month', 'recurring[interval_count]': 1,
            'recurring[usage_type]': 'licensed', 'metadata[plan]': plan,
        })
    add('portal', '/v1/billing_portal/configurations', {
        'business_profile[headline]': 'Manage your Trace plan',
        'default_return_url': ORIGIN + '/trace/account', 'login_page[enabled]': 'false',
        'features[customer_update][enabled]': 'false',
        'features[invoice_history][enabled]': 'true',
        'features[payment_method_update][enabled]': 'true',
        'features[subscription_cancel][enabled]': 'true',
        'features[subscription_cancel][mode]': 'at_period_end',
        'features[subscription_cancel][proration_behavior]': 'none',
        'features[subscription_update][enabled]': 'true',
        'features[subscription_update][default_allowed_updates][0]': 'price',
        'features[subscription_update][proration_behavior]': 'always_invoice',
        **{f'features[subscription_update][products][{i}][product]': ids.get(plan + '_product') or '<' + plan + '-product.id>'
           for i, plan in enumerate(names)},
        **{f'features[subscription_update][products][{i}][prices][0]': ids.get(plan + '_price') or '<' + plan + '-price.id>'
           for i, plan in enumerate(names)},
    })
    add('webhook', '/v1/webhook_endpoints', {
        'url': WEBHOOK, 'api_version': '2024-06-20', 'connect': 'false',
        'description': 'Trace staging membership events',
        **{f'enabled_events[{i}]': event for i, event in enumerate(sorted(EVENT_TYPES))},
    })
    return {'dryRun': True, 'mode': 'sandbox', 'apiHost': 'https://api.stripe.com',
            'headers': {'Stripe-Version': '2024-06-20', 'Content-Type': 'application/x-www-form-urlencoded'},
            'note': 'No requests sent. Resolve resource placeholders from this sandbox only. Persist each created ID and a unique per-step idempotency key before any authorized execution; do not blindly repeat POSTs.',
            'requests': requests}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for plan in ('trace', 'supporter'):
        parser.add_argument('--' + plan + '-product', type=resource_id('prod'))
        parser.add_argument('--' + plan + '-price', type=resource_id('price'))
    print(json.dumps(build_plan(vars(parser.parse_args())), indent=2))


if __name__ == '__main__':
    main()
