"""Offline privacy boundary tests; all storage/SDK calls are in-memory fakes."""
import copy
import json
import unittest
from unittest.mock import patch
import test_shared_replay as fixtures

app, Table, decode = fixtures.app, fixtures.Table, fixtures.decode


class MembershipPrivacyTests(unittest.TestCase):
    setUp = fixtures.SharedReplayTests.setUp
    item = fixtures.SharedReplayTests.item
    upload = fixtures.SharedReplayTests.upload
    share = fixtures.SharedReplayTests.share
    prepared = fixtures.SharedReplayTests.prepared

    def protected_review(self):
        own = {'playerName': 'Player A', 'playerId': 'a', 'source': 'match-start',
               'cards': [{'cardId': 'own_card', 'count': 60}], 'total': 60}
        opponent = {**own, 'playerName': 'Player B', 'playerId': 'b',
                    'cards': [{'cardId': 'protected_inventory', 'count': 60}]}
        hidden = {'id': 'opponent-1', 'name': 'Protected hidden identity',
                  'reviewSourceId': 'secret_print', 'imageUrl': 'secret_art', 'cardType': 'Pokemon'}
        revealed = {'id': 'revealed-1', 'name': 'Revealed Pokémon', 'cardType': 'Pokemon'}
        self.review.update(decklists=[own, opponent], rawLog='packet containing protected_inventory')
        self.review['turns'][0] = {
            'snapshot': {'players': {'Player A': {}, 'Player B': {
                'deckCards': [hidden, revealed], 'deckCount': 2, 'prizeCards': [hidden],
                'active': revealed, 'discardCards': [revealed],
            }}},
            'canonical': {'playerNames': ['Player A', 'Player B'],
                          'visibility': {'opponent-1': 'hidden', 'revealed-1': 'known'},
                          'state': {'players': [{'hand': [{'id': 'own-1', 'name': 'Own card'}]},
                                                {'deck': [hidden, revealed], 'hand': [hidden], 'prizes': [hidden], 'active': {'card': revealed}}]}},
            'rawPayload': {'players': [{'deckInfo': {'cards': {'protected_inventory': 60}}}]},
        }
        return own

    def test_inventory_and_hidden_identities_omitted_without_destroying_capture(self):
        own = self.protected_review()
        original = copy.deepcopy(self.review)
        self.upload()
        private = decode(app.get_match(self.device, self.match))['review']
        self.assertEqual(private['decklists'], [own])
        self.share()
        public = decode(app.get_shared_match(self.share_id))['review']
        self.assertNotIn('decklists', public)
        for visible in (public, private):
            serialized = json.dumps(visible, ensure_ascii=False)
            for secret in ('protected_inventory', 'Protected hidden identity', 'secret_print', 'secret_art', 'rawPayload'):
                self.assertNotIn(secret, serialized)
            self.assertIn('Revealed Pokémon', serialized)
            self.assertIn('Own card', serialized)
            self.assertEqual(len(visible['turns'][0]['canonical']['state']['players'][1]['deck']), 2)
            self.assertEqual(visible['rawLog'], '')
        self.assertEqual(app.stored_review(self.item()), original)
        self.assertEqual(self.review, original)

    def test_unknown_local_identity_cannot_grant_any_starting_inventory(self):
        self.protected_review()
        self.review.pop('localPlayer')
        visible = app.visible_review(self.review)
        self.assertNotIn('decklists', visible)
        self.assertNotIn('secret_print', json.dumps(visible, ensure_ascii=False))

    def test_legacy_known_marker_does_not_reveal_hidden_deck_inventory(self):
        self.protected_review()
        self.review['turns'][0]['canonical']['visibility']['opponent-1'] = 'known'
        for public in (False, True):
            visible = json.dumps(app.visible_review(self.review, public=public), ensure_ascii=False)
            self.assertNotIn('secret_print', visible)
            self.assertNotIn('Protected hidden identity', visible)
            self.assertIn('Revealed Pokémon', visible)

    def test_hidden_pending_hand_and_selection_copies_are_also_projected(self):
        self.protected_review()
        turn = self.review['turns'][0]
        secret = turn['canonical']['state']['players'][1]['hand'][0]
        turn['canonical']['pendingCards'] = [[], [secret]]
        turn['canonical']['selection'] = {'optionCards': [secret]}
        turn['canonical']['selections'] = [{'optionCards': [secret]}]
        turn['snapshot']['players']['Player B'].update(knownHand=[secret['name']], knownHandCards=[secret])
        for public in (False, True):
            visible = app.visible_review(self.review, public=public)
            self.assertNotIn('secret_print', json.dumps(visible))
            self.assertNotIn('Protected hidden identity', json.dumps(visible))
            self.assertEqual(visible['turns'][0]['snapshot']['players']['Player B']['knownHand'], [])
            self.assertEqual(len(visible['turns'][0]['canonical']['pendingCards'][1]), 1)

    def test_actual_selection_reveal_is_retained(self):
        self.protected_review()
        turn = self.review['turns'][0]
        revealed = {'id': 'recon-option', 'name': 'Revealed choice'}
        turn['canonical']['visibility']['recon-option'] = 'temporarily-revealed'
        turn['canonical']['selections'] = [{'optionCards': [revealed]}]
        self.assertIn('Revealed choice', json.dumps(app.visible_review(self.review, public=True)))

    def test_legacy_full_share_is_rebuilt_before_conditional_response(self):
        self.protected_review()
        self.upload()
        self.share()
        old_etag = '"old-unrestricted-replay"'
        legacy = app.shares.items[(self.share_id,)]['preparedReplay']
        legacy.update(format=1, etag=old_etag)
        result = app.get_shared_match(self.share_id, request_headers={'if-none-match': old_etag})
        self.assertEqual(result['statusCode'], 200)
        self.assertNotIn('decklists', decode(result)['review'])
        self.assertEqual(self.prepared()['format'], 2)
        self.assertNotEqual(result['headers']['etag'], old_etag)

    def test_registration_cannot_replace_an_existing_devices_identity(self):
        app.devices = Table('deviceId')
        event = {'body': json.dumps({'deviceId': self.device})}
        first = app.register(event)
        self.assertEqual(first['statusCode'], 201)
        original = copy.deepcopy(app.devices.items)
        repeat = app.register(event)
        self.assertEqual(repeat['statusCode'], 409)
        self.assertNotIn('token', json.loads(repeat['body']))
        self.assertEqual(app.devices.items, original)

    def test_malformed_optional_replay_fields_do_not_expose_inventory_or_crash(self):
        self.protected_review()
        self.review['turns'] = [
            {'canonical': {'state': 'malformed', 'visibility': [], 'playerNames': False}, 'snapshot': []},
            {'canonical': 'malformed', 'snapshot': {'players': []}},
        ]
        projected = app.visible_review(self.review, public=True)
        self.assertNotIn('decklists', projected)
        self.assertEqual(projected['rawLog'], '')
        self.assertEqual(app.visible_review(None), {})


class MembershipEnforcementTests(unittest.TestCase):
    def check(self, membership):
        with patch.object(app, 'REQUIRE_MEMBERSHIP', True), patch.object(app, 'device_membership', return_value=membership):
            return app.require_membership({})

    def test_paid_plans_and_only_explicit_owner_status_grant_access(self):
        for plan in ('trace', 'supporter'):
            self.assertIsNone(self.check({'linked': True, 'traceAccess': True, 'plan': plan, 'status': 'active',
                                          'expiresAt': '2999-01-01T00:00:00Z', 'capabilities': {'fullHistory': True}}))
        self.assertIsNone(self.check({'linked': True, 'traceAccess': True, 'plan': 'supporter', 'admin': True,
                                     'status': 'admin', 'capabilities': {'fullHistory': True}}))

    def test_expired_unlinked_unpaid_or_ambiguous_state_is_denied(self):
        base = {'linked': True, 'traceAccess': True, 'plan': 'supporter', 'status': 'active'}
        for invalid in ({}, {**base, 'linked': False}, {**base, 'traceAccess': False},
                        {**base, 'status': 'past_due'}, {**base, 'plan': 'unknown'},
                        {**base, 'linked': 'true'}, {**base, 'admin': True, 'status': 'canceled'},
                        {**base, 'admin': False, 'status': 'admin'}):
            with self.subTest(invalid=invalid):
                self.assertEqual(self.check(invalid)['statusCode'], 403)

    def test_outage_or_bad_response_does_not_grant_access(self):
        for invalid in (None, [], 'active'):
            self.assertEqual(self.check(invalid)['statusCode'], 503)
        with patch.object(app, 'REQUIRE_MEMBERSHIP', True), patch.object(app, 'device_membership', side_effect=OSError):
            self.assertEqual(app.require_membership({})['statusCode'], 503)

    def test_rollout_switch_does_not_contact_membership_service_until_enabled(self):
        with patch.object(app, 'REQUIRE_MEMBERSHIP', False), patch.object(app, 'device_membership') as fetch:
            self.assertIsNone(app.require_membership({}))
            fetch.assert_not_called()

    def test_capture_upload_never_depends_on_membership(self):
        event = {'requestContext': {'http': {'method': 'PUT'}}, 'rawPath': '/v1/matches/test',
                 'pathParameters': {'matchId': 'test'}}
        with patch.object(app, 'REQUIRE_MEMBERSHIP', True), patch.object(app, 'authorize', return_value='device'), \
                patch.object(app, 'device_membership', side_effect=OSError) as fetch, \
                patch.object(app, 'put_match', return_value={'statusCode': 200}) as write:
            self.assertEqual(app.handler(event, None)['statusCode'], 200)
            write.assert_called_once()
            fetch.assert_not_called()

    def test_public_share_does_not_require_viewers_to_have_a_membership(self):
        event = {'requestContext': {'http': {'method': 'GET'}}, 'rawPath': '/v1/shares/' + 'a' * 24,
                 'pathParameters': {'shareId': 'a' * 24}}
        with patch.object(app, 'REQUIRE_MEMBERSHIP', True), patch.object(app, 'device_membership') as fetch, \
                patch.object(app, 'get_shared_match', return_value={'statusCode': 200}):
            self.assertEqual(app.handler(event, None)['statusCode'], 200)
            fetch.assert_not_called()


if __name__ == '__main__':
    unittest.main()
