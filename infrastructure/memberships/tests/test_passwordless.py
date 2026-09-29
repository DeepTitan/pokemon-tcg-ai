import unittest
from unittest.mock import Mock
from test_adapters import adapters, ClientError
from membership import Config, ApiError

class PasswordlessTests(unittest.TestCase):
    def setUp(self):
        self.auth = adapters.Cognito(Config('pool', 'client', 'us-east-1'))
        self.auth.client = Mock()
        self.auth.client.admin_get_user.return_value = {'Enabled': True, 'UserStatus': 'CONFIRMED'}
        self.challenge = {'ChallengeName': 'EMAIL_OTP', 'Session': 'provider-session', 'ChallengeParameters': {'USERNAME': 'stable-subject'}}
        self.auth.client.initiate_auth.return_value = self.challenge
        self.tokens = {'AuthenticationResult': {'AccessToken': 'access', 'RefreshToken': 'refresh', 'ExpiresIn': 3600}}

    def test_existing_account_uses_otp_without_changing_password_or_subject(self):
        step = self.auth.email_start('player@example.test')
        self.assertEqual(step, {'kind': 'signin', 'email': 'player@example.test', 'session': 'provider-session', 'username': 'stable-subject'})
        self.auth.client.admin_set_user_password.assert_not_called()
        self.auth.client.respond_to_auth_challenge.return_value = self.tokens
        self.assertEqual(self.auth.email_finish(step, '123456')['accessToken'], 'access')
        self.assertEqual(self.auth.client.respond_to_auth_challenge.call_args.kwargs['ChallengeResponses']['USERNAME'], 'stable-subject')

    def test_new_account_sends_signup_code_without_a_password_then_auto_signs_in(self):
        self.auth.client.admin_get_user.side_effect = ClientError('UserNotFoundException')
        self.auth.client.sign_up.return_value = {'Session': 'signup-session'}
        step = self.auth.email_start('player@example.test')
        self.assertNotIn('Password', self.auth.client.sign_up.call_args.kwargs)
        self.auth.client.confirm_sign_up.return_value = {'Session': 'confirmed-session'}
        self.auth.client.initiate_auth.return_value = self.tokens
        self.assertEqual(self.auth.email_finish(step, '123456')['accessToken'], 'access')
        self.assertEqual(self.auth.client.initiate_auth.call_args.kwargs['Session'], 'confirmed-session')
        self.auth.client.admin_set_user_password.assert_not_called()

    def test_incomplete_legacy_password_is_removed_before_otp_can_verify_email(self):
        self.auth.client.admin_get_user.return_value = {'Enabled': True, 'UserStatus': 'UNCONFIRMED'}
        step = self.auth.email_start('player@example.test')
        self.auth.client.admin_set_user_password.assert_called_once()
        calls = [entry[0] for entry in self.auth.client.mock_calls]
        self.assertLess(calls.index('admin_set_user_password'), calls.index('initiate_auth'))
        self.assertEqual(step['kind'], 'signin')
        self.auth.client.admin_update_user_attributes.assert_not_called()
        self.auth.client.respond_to_auth_challenge.side_effect = ClientError('CodeMismatchException')
        with self.assertRaises(ApiError): self.auth.email_finish(step, '000000')

    def test_disabled_account_and_delivery_failure_never_report_code_sent(self):
        self.auth.client.admin_get_user.return_value = {'Enabled': False, 'UserStatus': 'CONFIRMED'}
        with self.assertRaises(ApiError): self.auth.email_start('player@example.test')
        self.auth.client.admin_get_user.return_value['Enabled'] = True
        self.auth.client.initiate_auth.side_effect = ClientError('CodeDeliveryFailureException')
        with self.assertRaises(ApiError): self.auth.email_start('player@example.test')

    def test_unexpected_password_challenge_is_not_an_authenticated_session(self):
        self.auth.client.initiate_auth.return_value = {'ChallengeName': 'PASSWORD', 'Session': 'x'}
        with self.assertRaises(ApiError): self.auth.email_start('player@example.test')
