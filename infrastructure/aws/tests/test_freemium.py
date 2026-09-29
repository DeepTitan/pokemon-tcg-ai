"""Free capture/history and transactional sharing policies, entirely offline."""
import datetime as dt
import json
import unittest
from unittest.mock import patch

import test_shared_replay as fixtures

app, decode = fixtures.app, fixtures.decode
NOW = dt.datetime(2026, 9, 28, 12, tzinfo=dt.timezone.utc)


def iso(value):
    return value.isoformat().replace('+00:00', 'Z')


def paid(**changes):
    return {'linked': True, 'traceAccess': True, 'plan': 'trace', 'status': 'active',
            'expiresAt': iso(NOW + dt.timedelta(days=1)),
            'capabilities': {'fullHistory': True, 'expandedSharing': True}, **changes}


class FreemiumTests(unittest.TestCase):
    item = fixtures.SharedReplayTests.item
    upload = fixtures.SharedReplayTests.upload
    share = fixtures.SharedReplayTests.share

    def setUp(self):
        self.addCleanup(patch.stopall)
        patch.object(app, 'utc_now', return_value=NOW).start()
        patch.object(app, 'timestamp', side_effect=lambda: iso(app.utc_now())).start()
        patch.object(app, 'REQUIRE_MEMBERSHIP', True).start()
        self.membership = patch.object(app, 'device_membership', return_value={'linked': False}).start()
        fixtures.SharedReplayTests.setUp(self)
        app.devices.put_item(Item={'deviceId': self.device, 'tokenHash': 'fixture'})

    def age(self, days=8):
        app.matches.items[(self.device, self.match)]['historyStartedAt'] = iso(NOW - dt.timedelta(days=days))

    def new_match(self):
        self.match += '-next'
        self.review = {**self.review, 'id': self.match}
        self.upload()

    def test_recent_replay_remains_available_when_membership_is_offline(self):
        self.membership.side_effect = OSError('offline')
        result = app.get_match(self.device, self.match, {})
        self.assertEqual(result['statusCode'], 200)
        self.assertEqual(decode(result)['review'], app.visible_review(self.review, private_study=False))
        self.membership.assert_called_once()

    def test_own_inventory_requires_pro_while_hand_remains_free(self):
        self.review['decklists'] = [{'playerName': self.review['localPlayer'], 'cards': [], 'total': 60}]
        self.review['turns'][0]['canonical'] = {'playerNames': [self.review['localPlayer']], 'state': {'players': [{'deck': [{'id': 'd', 'name': 'Deck secret'}], 'prizes': [{'id': 'p', 'name': 'Prize secret'}], 'hand': [{'id': 'h', 'name': 'My hand'}]}]}}
        self.upload()
        free = decode(app.get_match(self.device, self.match, {}))['review']
        self.assertNotIn('decklists', free)
        self.assertNotIn('Deck secret', json.dumps(free))
        self.assertNotIn('Prize secret', json.dumps(free))
        self.assertIn('My hand', json.dumps(free))
        self.membership.return_value = paid()
        pro = decode(app.get_match(self.device, self.match, {}))['review']
        self.assertIn('Deck secret', json.dumps(pro))
        self.assertIn('Prize secret', json.dumps(pro))
        self.assertEqual(pro['decklists'], self.review['decklists'])

    def test_old_replay_denied_before_payload_read_but_original_retained(self):
        self.age()
        app.s3.reads.clear()
        result = app.get_match(self.device, self.match, {})
        self.assertEqual(json.loads(result['body']), {'error': 'history_membership_required'})
        self.assertEqual(app.s3.reads, [])
        self.assertEqual(app.stored_review(self.item()), self.review)

    def test_exact_seven_day_boundary_requires_full_history(self):
        self.age(7)
        self.assertEqual(app.get_match(self.device, self.match, {})['statusCode'], 403)
        self.age(7 - 1 / 86400)
        self.assertEqual(app.get_match(self.device, self.match, {})['statusCode'], 200)

    def test_old_replay_uses_fresh_explicit_premium_capability(self):
        self.age()
        for entitlement in (paid(), paid(plan='supporter'), paid(plan='supporter', status='admin', admin=True, expiresAt=None)):
            self.membership.return_value = entitlement
            self.assertEqual(app.get_match(self.device, self.match, {})['statusCode'], 200)
        for entitlement in (paid(linked=False), paid(expiresAt=iso(NOW)), paid(status='past_due'),
                            paid(capabilities={}), paid(capabilities={'fullHistory': 'true'})):
            self.membership.return_value = entitlement
            self.assertEqual(app.get_match(self.device, self.match, {})['statusCode'], 403)

    def test_legacy_age_survives_reupload_and_later_client_timestamp(self):
        legacy = app.matches.items[(self.device, self.match)]
        legacy.pop('historyStartedAt')
        legacy['updatedAt'] = iso(NOW - dt.timedelta(days=8))
        self.review['importedAt'] = iso(NOW)
        self.upload()
        self.assertEqual(self.item()['historyStartedAt'], iso(NOW - dt.timedelta(days=8)))
        self.assertEqual(app.get_match(self.device, self.match, {})['statusCode'], 403)
        self.upload()
        self.assertEqual(self.item()['historyStartedAt'], iso(NOW - dt.timedelta(days=8)))

    def test_initial_old_import_is_not_treated_as_a_new_game(self):
        self.review['importedAt'] = iso(NOW - dt.timedelta(days=30))
        self.new_match()
        self.assertEqual(app.get_match(self.device, self.match, {})['statusCode'], 403)

    def test_missing_or_future_legacy_age_cannot_unlock_free_replay(self):
        for value in (None, 'invalid', iso(NOW + dt.timedelta(days=30))):
            with self.subTest(value=value):
                self.assertFalse(app.is_recent_match({'importedAt': value}))

    def test_free_summary_index_keeps_all_time_records_without_billing(self):
        self.age()
        result = app.list_matches(self.device)
        self.assertEqual(len(json.loads(result['body'])['matches']), 1)
        self.membership.assert_not_called()

    def test_free_new_share_once_then_same_match_reuses_link(self):
        first = self.share()
        self.assertEqual(first['statusCode'], 200)
        device = dict(app.devices.items[(self.device,)])
        self.assertEqual(self.share(), first)
        self.assertEqual(len(app.shares.items), 1)
        self.assertEqual(app.devices.items[(self.device,)], device)
        self.new_match()
        result = app.share_match(self.device, self.match, {'body': '{}'})
        self.assertEqual(result['statusCode'], 403)
        self.assertEqual(json.loads(result['body']), {'error': 'share_limit_reached',
                                                     'nextShareAt': iso(NOW + dt.timedelta(days=7))})
        self.assertNotIn('shareId', self.item())
        self.assertEqual(len(app.shares.items), 1)

    def test_allowance_resets_after_a_rolling_seven_days(self):
        self.share()
        app.utc_now.return_value = NOW + dt.timedelta(days=7)
        self.new_match()
        self.assertEqual(self.share()['statusCode'], 200)
        self.assertEqual(len(app.shares.items), 2)

    def test_paid_shares_do_not_consume_or_reset_free_allowance(self):
        self.membership.return_value = paid()
        self.share()
        self.new_match()
        self.age()
        self.assertEqual(self.share()['statusCode'], 200)
        self.assertNotIn('lastFreeShareAt', app.devices.items[(self.device,)])

    def test_billing_outage_preserves_free_share_but_denies_old_new_share(self):
        self.membership.side_effect = OSError('offline')
        self.assertEqual(self.share()['statusCode'], 200)
        self.new_match()
        self.age()
        result = app.share_match(self.device, self.match, {'body': '{}'})
        self.assertEqual(result['statusCode'], 503)
        self.assertNotIn('shareId', self.item())

    def test_existing_old_link_still_reusable_without_membership(self):
        first = self.share()
        self.age()
        self.membership.reset_mock()
        self.assertEqual(self.share(), first)
        self.membership.assert_not_called()
        self.assertEqual(app.get_shared_match(self.share_id)['statusCode'], 200)

    def test_dropped_prepare_response_recovers_same_reserved_link(self):
        with patch.object(app, 'prepare_shared_replay', side_effect=OSError('synthetic failure')):
            with self.assertRaises(OSError):
                self.share()
        reserved = self.item()['shareId']
        device = dict(app.devices.items[(self.device,)])
        self.assertEqual(self.share()['statusCode'], 200)
        self.assertEqual(self.share_id, reserved)
        self.assertEqual(app.devices.items[(self.device,)], device)

    def test_concurrent_same_match_retries_reuse_winners_reservation(self):
        results = []
        app.dynamodb_client.before_commit = lambda: results.append(self.share())
        self.assertEqual(self.share(), results[0])
        self.assertEqual(len(app.shares.items), 1)

    def test_concurrent_different_matches_cannot_both_consume_allowance(self):
        first = self.match
        self.new_match()
        second = self.match
        winners = []
        app.dynamodb_client.before_commit = lambda: winners.append(app.share_match(self.device, first, {'body': '{}'}))
        result = app.share_match(self.device, second, {'body': '{}'})
        self.assertEqual(winners[0]['statusCode'], 200)
        self.assertEqual(result['statusCode'], 403)
        self.assertEqual(len(app.shares.items), 1)
        self.assertNotIn('shareId', self.item())

    def test_upload_cannot_erase_reserved_share_or_reset_age(self):
        self.share()
        pointer, started = self.share_id, self.item()['historyStartedAt']
        app.utc_now.return_value = NOW + dt.timedelta(days=8)
        self.review['importedAt'] = iso(app.utc_now())
        self.upload()
        self.assertEqual(self.item()['shareId'], pointer)
        self.assertEqual(self.item()['historyStartedAt'], started)

    def test_corrected_upload_does_not_keep_a_stale_rating_or_winner(self):
        self.review.update(localRating=1800, opponentRating=1750)
        self.upload()
        self.assertEqual(self.item()['localRating'], 1800)
        for field in ('localRating', 'opponentRating', 'winner'):
            self.review.pop(field, None)
        self.upload()
        for field in ('localRating', 'opponentRating', 'winner'):
            self.assertNotIn(field, self.item())

    def test_undated_legacy_upload_does_not_refresh_access(self):
        legacy = app.matches.items[(self.device, self.match)]
        for field in ('historyStartedAt', 'updatedAt', 'importedAt'):
            legacy.pop(field, None)
        self.upload()
        self.assertEqual(app.get_match(self.device, self.match, {})['statusCode'], 403)

    def test_reservation_observed_after_metadata_update_is_reused(self):
        self.share()
        pointer = self.share_id
        result, denied = app.reserve_share(self.device, self.match, self.item(), True)
        self.assertIsNone(denied)
        self.assertEqual(result, pointer)
        self.assertEqual(len(app.shares.items), 1)


if __name__ == '__main__':
    unittest.main()
