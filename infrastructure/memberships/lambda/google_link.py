"""Preserve one Cognito subject when Google users already have a verified local account.
Only Cognito can invoke this trigger. Never trust an email submitted by the website.
"""
import json
import os
import boto3
from botocore.exceptions import ClientError


def link(event, client, pool):
    if event.get('userPoolId') != pool:
        raise ValueError('Unsupported identity source')
    # The pool invokes this hook for native signup and our nested AdminCreateUser too.
    # Leave their verification and confirmation rules unchanged.
    if event.get('triggerSource') in ('PreSignUp_SignUp', 'PreSignUp_AdminCreateUser'):
        return event
    if event.get('triggerSource') != 'PreSignUp_ExternalProvider':
        raise ValueError('Unsupported identity source')
    username = event.get('userName', '')
    provider, _, provider_subject = username.partition('_')
    attrs = event.get('request', {}).get('userAttributes', {})
    email = attrs.get('email', '').strip().lower()
    if provider.lower() != 'google' or not provider_subject or attrs.get('email_verified') not in ('true', True) or '@' not in email:
        raise ValueError('Verified Google identity required')
    try:
        user = client.admin_get_user(UserPoolId=pool, Username=email)
    except ClientError as error:
        if error.response.get('Error', {}).get('Code') != 'UserNotFoundException':
            raise
        try:
            user = client.admin_create_user(UserPoolId=pool, Username=email, MessageAction='SUPPRESS',
                UserAttributes=[{'Name': 'email', 'Value': email}, {'Name': 'email_verified', 'Value': 'true'}])['User']
        except ClientError as error:
            if error.response.get('Error', {}).get('Code') != 'UsernameExistsException':
                raise
            user = client.admin_get_user(UserPoolId=pool, Username=email)
    attributes = {a['Name']: a['Value'] for a in user.get('UserAttributes', user.get('Attributes', []))}
    if not user.get('Enabled', False) or user.get('UserStatus') != 'CONFIRMED' or attributes.get('email_verified') != 'true':
        # Never turn an attacker's unfinished password signup into a verified account.
        raise ValueError('Continue with email to finish this account first')
    if any(identity.get('providerName') == 'Google' and identity.get('userId') == provider_subject
           for identity in json.loads(attributes.get('identities', '[]'))):
        return event
    client.admin_link_provider_for_user(UserPoolId=pool,
        DestinationUser={'ProviderName': 'Cognito', 'ProviderAttributeValue': user['Username']},
        SourceUser={'ProviderName': 'Google', 'ProviderAttributeName': 'Cognito_Subject', 'ProviderAttributeValue': provider_subject})
    return event


def handler(event, context):
    # Native signup needs no network client, including recursive AdminCreateUser calls.
    native = event.get('triggerSource') in ('PreSignUp_SignUp', 'PreSignUp_AdminCreateUser')
    return link(event, None if native else boto3.client('cognito-idp'), os.environ['USER_POOL_ID'])
