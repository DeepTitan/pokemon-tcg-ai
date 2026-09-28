"""Nonce-bound Discord activation with fake provider/persistence only."""
from dataclasses import replace
import unittest
from urllib.parse import parse_qs, urlsplit

from test_membership import ApiError, CFG, NOW, USER, OWNER, DEVICE, MembershipService, FakeStore, FakeStripe, FakeCognito, digest, request

CLIENT, GUILD, DISCORD_USER = '123456789012345678', '234567890123456789', '345678901234567890'
CONFIG = replace(CFG, discord_required=True, discord_client_id=CLIENT, discord_guild_id=GUILD)


class FakeDiscord:
    def __init__(self):
        self.calls = []
        self.error = None

    def verify_member(self, code, client, guild):
        self.calls.append((code, client, guild))
        if self.error:
            raise self.error
        return DISCORD_USER


class DiscordTests(unittest.TestCase):
    def setUp(self):
        self.store, self.cognito, self.stripe, self.discord = FakeStore(), FakeCognito(), FakeStripe(), FakeDiscord()
        self.now = NOW
        self.service = MembershipService(CONFIG, self.store, self.cognito, self.stripe, lambda: self.now, self.discord)

    def new_account(self):
        self.store.accounts.pop(USER, None)
        return self.service.handle(request('account'))

    def start(self, subject=USER):
        result = self.service.handle(request('discord/start', 'POST', account=subject))
        parts = urlsplit(result['url'])
        self.assertEqual(parts.scheme + '://' + parts.netloc + parts.path, 'https://discord.com/oauth2/authorize')
        query = parse_qs(parts.query)
        self.assertEqual(query['client_id'], [CLIENT])
        self.assertEqual(query['scope'], ['identify guilds.members.read'])
        self.assertEqual(query['redirect_uri'], [CONFIG.web_origin + '/trace/discord/callback'])
        return query['state'][0]

    def complete(self, state, subject=USER):
        return self.service.handle(request('discord/complete', 'POST', {'code': 'synthetic-code', 'state': state}, account=subject))

    def assert_error(self, code, callback):
        with self.assertRaises(ApiError) as caught:
            callback()
        self.assertEqual(caught.exception.code, code)

    def test_legacy_account_exempt_new_account_flagged_without_stopping_recording(self):
        legacy = self.service.handle(request('account'))
        self.assertFalse(legacy['activation']['required'])
        fresh = self.new_account()
        self.assertTrue(fresh['activation']['required'])
        self.assertFalse(fresh['activation']['verified'])
        self.assertTrue(fresh['capabilities']['recordMatches'])
        self.assertTrue(fresh['capabilities']['leaderboard'])
        self.assertFalse(self.service.handle(request('devices/status', device=True))['activation']['required'])

    def test_one_time_verification_and_retry_return_no_tokens(self):
        self.new_account()
        state = self.start()
        self.assertNotIn(state, self.store.discord_states)
        self.assertEqual(self.complete(state), {'verified': True})
        self.assertEqual(self.complete(state), {'verified': True})
        self.assertEqual(len(self.discord.calls), 1)
        activated = self.service.handle(request('account'))
        self.assertTrue(activated['activation']['verified'])
        self.assertNotIn('discordUserId', activated)

    def test_state_is_bound_to_account_and_fixed_guild(self):
        state = self.start()
        self.assert_error('discord_state_invalid', lambda: self.complete(state, OWNER))
        self.store.discord_states[digest(state)]['guildId'] = '456789012345678901'
        self.assert_error('discord_state_invalid', lambda: self.complete(state))
        self.assertEqual(self.discord.calls, [])

    def test_missing_forged_and_expired_nonce_rejected_before_provider(self):
        state = self.start()
        self.assert_error('discord_state_invalid', lambda: self.complete('x' * 43))
        self.now += 600
        self.assert_error('discord_state_invalid', lambda: self.complete(state))
        self.assertEqual(self.discord.calls, [])

    def test_nonmember_pending_or_outage_never_activates(self):
        self.new_account()
        for code in ('discord_not_joined', 'discord_pending', 'discord_unavailable'):
            state = self.start()
            self.discord.error = ApiError(403, code)
            self.assert_error(code, lambda: self.complete(state))
            self.assertFalse(self.service.activation(self.store.account(USER))['verified'])
            self.assertNotIn('usedAt', self.store.discord_states[digest(state)])

    def test_activation_required_before_new_device_link_and_not_for_existing_accounts(self):
        link = self.service.start_link(DEVICE, digest('capture-secret'))
        self.new_account()
        self.assert_error('discord_required', lambda: self.service.approve_link(USER, link['userCode']))
        self.complete(self.start())
        self.assertEqual(self.service.approve_link(USER, link['userCode']), {'linked': True})
        self.store.unlink(DEVICE)
        link = self.service.start_link(DEVICE, digest('capture-secret'))
        self.assertEqual(self.service.approve_link(OWNER, link['userCode']), {'linked': True})

    def test_atomic_failure_never_writes_partial_activation(self):
        self.new_account()
        state = self.start()
        self.store.fail_save = True
        with self.assertRaises(RuntimeError):
            self.complete(state)
        self.assertNotIn('discordVerifiedAt', self.store.account(USER))
        self.assertNotIn('usedAt', self.store.discord_states[digest(state)])

    def test_lost_successful_response_recovers_without_reusing_provider_code(self):
        self.new_account()
        state = self.start()
        self.store.fail_discord_response = True
        with self.assertRaises(RuntimeError):
            self.complete(state)
        self.assertEqual(self.complete(state), {'verified': True})
        self.assertEqual(len(self.discord.calls), 1)

    def test_disabled_unconfigured_or_wrong_provider_origin_fails_closed(self):
        disabled = MembershipService(CFG, self.store, self.cognito, self.stripe, discord=self.discord)
        self.assert_error('discord_unavailable', lambda: disabled.discord_start(USER))
        with self.assertRaises(ApiError):
            MembershipService(replace(CONFIG, web_origin='https://attacker.test'), self.store, self.cognito, self.stripe)
        with self.assertRaises(ApiError):
            MembershipService(replace(CONFIG, stripe_live=True, web_origin='https://trace-staging.vercel.app'), self.store, self.cognito, self.stripe)

    def test_staging_return_origin_is_fixed_by_stack_config(self):
        self.service = MembershipService(replace(CONFIG, web_origin='https://trace-staging.vercel.app'),
                                        self.store, self.cognito, self.stripe, lambda: self.now, self.discord)
        url = self.service.discord_start(USER)['url']
        self.assertEqual(parse_qs(urlsplit(url).query)['redirect_uri'],
                         ['https://trace-staging.vercel.app/trace/discord/callback'])
