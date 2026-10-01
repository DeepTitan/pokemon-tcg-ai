"""Reporting retains signed adjustments and exact UTC month boundaries."""
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('affiliate_report', Path(__file__).parents[1] / 'affiliate_report.py')
report = importlib.util.module_from_spec(spec)
spec.loader.exec_module(report)

class AffiliateReportTests(unittest.TestCase):
    def test_december_rollover_and_leap_month_are_exact(self):
        start, end = report.month_bounds('2026-12')
        self.assertEqual(end - start, 31 * 86400)
        self.assertEqual(report.month_bounds('2027-01')[0], end)
        start, end = report.month_bounds('2028-02')
        self.assertEqual(end - start, 29 * 86400)
        for value in ['2026-13', '2026-1', '2026-09-30']:
            with self.assertRaises(ValueError): report.month_bounds(value)

    def test_refund_rows_stay_negative_and_sort_chronologically(self):
        def item(at, delta):
            return {'creator': {'S': 'jakeptcg'}, 'invoiceId': {'S': 'in_fixture'},
                    'subscriptionId': {'S': 'sub_fixture'}, 'recordedAt': {'N': str(at)},
                    'deltaCommissionCents': {'N': str(delta)}}
        rows = report.report_rows([item(200, -150), item(100, 300)])
        self.assertEqual([r['commission_usd'] for r in rows], ['3.00', '-1.50'])
        self.assertEqual(sum(r['delta_cents'] for r in rows), 150)
