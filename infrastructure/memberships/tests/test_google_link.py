import importlib.util
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import Mock, patch
from test_adapters import ClientError

spec = importlib.util.spec_from_file_location('google_link_test', Path(__file__).parents[1] / 'lambda/google_link.py')
module = importlib.util.module_from_spec(spec)
with patch.dict(sys.modules, {'boto3': types.SimpleNamespace(client=Mock()), 'botocore.exceptions': types.SimpleNamespace(ClientError=ClientError)}):
    spec.loader.exec_module(module)

class GoogleLinkTests(unittest.TestCase):
    def setUp(self):
        self.client = Mock()
        self.event = {'triggerSource': 'PreSignUp_ExternalProvider', 'userPoolId': 'pool', 'userName': 'Google_123',
                      'request': {'userAttributes': {'email': 'player@gmail.com', 'email_verified': 'true'}}}
        self.user = {'Username': 'original-subject', 'Enabled': True, 'UserStatus': 'CONFIRMED',
                     'UserAttributes': [{'Name':'email_verified','Value':'true'}]}
        self.client.admin_get_user.return_value = self.user

    def test_existing_member_keeps_subject(self):
        module.link(self.event,self.client,'pool')
        self.assertEqual(self.client.admin_link_provider_for_user.call_args.kwargs['DestinationUser']['ProviderAttributeValue'],'original-subject')
        self.client.admin_create_user.assert_not_called()

    def test_unknown_google_player_gets_native_passwordless_account_without_email(self):
        self.client.admin_get_user.side_effect = ClientError('UserNotFoundException')
        self.client.admin_create_user.return_value = {'User':self.user}
        module.link(self.event,self.client,'pool')
        args = self.client.admin_create_user.call_args.kwargs
        self.assertNotIn('TemporaryPassword', args)
        self.assertEqual(args['MessageAction'],'SUPPRESS')

    def test_unverified_disabled_unconfirmed_or_wrong_provider_cannot_link(self):
        for override in [{'Enabled':False},{'UserStatus':'UNCONFIRMED'},{'UserAttributes':[]}]:
            self.client.admin_get_user.return_value = {**self.user,**override}
            with self.assertRaises(ValueError): module.link(self.event,self.client,'pool')
        self.client.admin_get_user.return_value = self.user
        for override in [{'userPoolId':'other'},{'userName':'Unknown_123'},{'request':{'userAttributes':{'email':'x@gmail.com','email_verified':'false'}}}]:
            with self.assertRaises(ValueError): module.link({**self.event,**override},self.client,'pool')
        self.client.admin_link_provider_for_user.assert_not_called()
