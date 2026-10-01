#!/usr/bin/env python3
"""Read-only monthly creator commission report. Uses existing operator AWS authentication.

No customer emails, Stripe secrets, payouts or subscription mutations.
"""
import argparse
import csv
import datetime as dt
import json
import re
import subprocess
import sys


def month_bounds(value):
    if not re.fullmatch(r'\d{4}-\d{2}', value):
        raise ValueError('Use YYYY-MM (UTC).')
    start = dt.datetime.strptime(value, '%Y-%m').replace(tzinfo=dt.timezone.utc)
    end = start.replace(year=start.year + 1, month=1) if start.month == 12 else start.replace(month=start.month + 1)
    return int(start.timestamp()), int(end.timestamp())


def report_rows(items):
    rows = []
    for item in items:
        def read(name):
            raw = item.get(name, {})
            return int(raw['N']) if 'N' in raw else raw.get('S', '')
        rows.append({'date_utc': dt.datetime.fromtimestamp(read('recordedAt'), dt.timezone.utc).isoformat(),
                     'creator': read('creator'), 'invoice': read('invoiceId'), 'subscription': read('subscriptionId'),
                     'commission_usd': f"{read('deltaCommissionCents') / 100:.2f}",
                     'delta_cents': read('deltaCommissionCents')})
    return sorted(rows, key=lambda row: (row['date_utc'], row['invoice']))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--stack', required=True, choices=['trace-memberships-staging', 'trace-memberships-production'])
    parser.add_argument('--month', required=True, help='YYYY-MM in UTC; includes refund/dispute adjustments recorded this month')
    parser.add_argument('--creator', default='jakeptcg', choices=['jakeptcg'])
    parser.add_argument('--profile', default='default')
    args = parser.parse_args()
    start, end = month_bounds(args.month)
    aws = ['aws', '--profile', args.profile, '--region', 'us-east-1']
    def call(*command):
        return json.loads(subprocess.check_output(aws + list(command) + ['--output', 'json']))
    resources = call('cloudformation', 'describe-stack-resources', '--stack-name', args.stack)['StackResources']
    table = next(r['PhysicalResourceId'] for r in resources if r['LogicalResourceId'] == 'Accounts')
    result = call('dynamodb', 'scan', '--table-name', table, '--consistent-read',
                  '--filter-expression', 'begins_with(#pk, :prefix) AND creator = :creator AND recordedAt >= :start AND recordedAt < :end',
                  '--projection-expression', 'creator, invoiceId, subscriptionId, recordedAt, deltaCommissionCents',
                  '--expression-attribute-names', json.dumps({'#pk': 'pk'}),
                  '--expression-attribute-values', json.dumps({':prefix': {'S': 'AFFILIATE_ENTRY#'}, ':creator': {'S': args.creator},
                                                              ':start': {'N': str(start)}, ':end': {'N': str(end)}}))
    rows = report_rows(result['Items'])
    writer = csv.DictWriter(sys.stdout, fieldnames=['date_utc', 'creator', 'invoice', 'subscription', 'commission_usd'])
    writer.writeheader()
    for row in rows:
        writer.writerow({key: value for key, value in row.items() if key != 'delta_cents'})
    print(f"{args.month} UTC · {args.creator} · {len(rows)} adjustments · net commission ${sum(r['delta_cents'] for r in rows) / 100:.2f}", file=sys.stderr)
    print('Read-only report; no payout has been made. Deduct any amounts already paid for this period.', file=sys.stderr)


if __name__ == '__main__':
    main()
