"""AWS and Stripe adapters. Never log credentials, payloads, email addresses, or Stripe errors."""
from contextlib import contextmanager
from decimal import Decimal
import json
import secrets
import time
import urllib.error
import urllib.parse
import urllib.request

import boto3
from boto3.dynamodb.types import TypeSerializer
from botocore.exceptions import ClientError
from botocore.config import Config as AwsConfig

from membership import ApiError, trusted_web_origin


AWS_CONFIG = AwsConfig(connect_timeout=3, read_timeout=5, retries={'max_attempts': 1})
STRIPE_VERSION = '2024-06-20'  # Locks subscription-level current_period_end and invoice fields.


def conditional_error(error):
    return isinstance(error, ClientError) and error.response.get('Error', {}).get('Code') in {
        'ConditionalCheckFailedException', 'TransactionCanceledException'}


class Store:
    def __init__(self, table_name, devices_name, owner_table_name):
        self.db = boto3.resource('dynamodb', config=AWS_CONFIG)
        self.table = self.db.Table(table_name)
        self.devices = self.db.Table(devices_name)
        self.owners = self.db.Table(owner_table_name)
        self.client = boto3.client('dynamodb', config=AWS_CONFIG)
        self.serializer = TypeSerializer()

    def serialized(self, value):
        return {key: self.serializer.serialize(item) for key, item in value.items()}

    def get(self, pk):
        return self.table.get_item(Key={'pk': pk}, ConsistentRead=True).get('Item')

    def account(self, subject):
        return self.get('ACCOUNT#' + subject)

    def remember_account(self, subject, email, discord_required=False):
        # Only genuinely new rows receive the activation requirement. Legacy
        # accounts are exempt, even when this rollout switch is later enabled.
        if not self.account(subject):
            try:
                self.table.put_item(Item={'pk': 'ACCOUNT#' + subject, 'email': email, 'emailVerified': True,
                                          'discordActivationRequired': discord_required},
                                    ConditionExpression='attribute_not_exists(pk)')
            except ClientError as error:
                if not conditional_error(error):
                    raise
        self.table.update_item(Key={'pk': 'ACCOUNT#' + subject},
                               UpdateExpression='SET email = :email, emailVerified = :yes',
                               ExpressionAttributeValues={':email': email, ':yes': True})

    def create_discord_state(self, proof, subject, guild, expires):
        self.table.put_item(Item={'pk': 'DISCORD#' + proof, 'subject': subject, 'guildId': guild, 'ttl': expires},
                            ConditionExpression='attribute_not_exists(pk)')

    def discord_state(self, proof):
        return self.get('DISCORD#' + proof)

    def complete_discord(self, proof, subject, discord_user, guild, lease, now):
        state_update = {'Update': {
            'TableName': self.table.name, 'Key': self.serialized({'pk': 'DISCORD#' + proof}),
            'UpdateExpression': 'SET usedAt = :now, discordUserId = :user',
            'ConditionExpression': '#subject = :subject AND guildId = :guild AND #ttl > :now AND attribute_not_exists(usedAt)',
            'ExpressionAttributeNames': {'#subject': 'subject', '#ttl': 'ttl'},
            'ExpressionAttributeValues': self.serialized({':now': now, ':user': discord_user, ':subject': subject, ':guild': guild}),
        }}
        self.transact([self.lock_check(subject, lease, now), state_update,
                       self.account_update(subject, {'discordUserId': discord_user, 'discordGuildId': guild,
                                                     'discordVerifiedAt': now})])

    def owner_enabled(self, subject):
        item = self.owners.get_item(Key={'ownerSubject': subject}, ConsistentRead=True).get('Item')
        return bool(item and item.get('enabled') is True)

    def capture_device(self, device):
        return self.devices.get_item(Key={'deviceId': device}, ConsistentRead=True).get('Item')

    def guest(self, proof):
        return self.get('GUEST#' + proof)

    def guest_customer_proof(self, customer):
        return (self.get('GUEST_CUSTOMER#' + customer) or {}).get('proof')

    def guest_lock(self, proof, now):
        return self.account_lock('GUEST#' + proof, now)

    def guest_put(self, proof, record):
        return {'Put': {'TableName': self.table.name,
                        'Item': self.serialized({**record, 'pk': 'GUEST#' + proof})}}

    def save_guest(self, proof, record, lease, now):
        self.transact([self.lock_check('GUEST#' + proof, lease, now), self.guest_put(proof, record)])

    def bind_guest_customer(self, proof, record, lease, now):
        self.transact([self.lock_check('GUEST#' + proof, lease, now), self.guest_put(proof, record),
                       {'Put': {'TableName': self.table.name,
                                'Item': self.serialized({'pk': 'GUEST_CUSTOMER#' + record['customerId'], 'proof': proof}),
                                'ConditionExpression': 'attribute_not_exists(pk) OR proof = :proof',
                                'ExpressionAttributeValues': self.serialized({':proof': proof})}}])

    def claim_guest(self, proof, subject, record, snapshot, previous, guest_lease, account_lease, now):
        account_update = self.account_update(subject, {'customerId': record['customerId'], 'snapshot': snapshot})
        update = account_update['Update']
        update['UpdateExpression'] += ' REMOVE checkout'
        update['ConditionExpression'] = 'customerId = :previous' if previous else 'attribute_not_exists(customerId)'
        if previous:
            update['ExpressionAttributeValues'][':previous'] = self.serializer.serialize(previous)
        claimed = {**record, 'claimedBy': subject, 'claimedAt': now, 'ttl': now + 90 * 86400}
        guest_put = self.guest_put(proof, claimed)
        guest_put['Put'].update(
            ConditionExpression='sessionId = :session AND (attribute_not_exists(claimedBy) OR claimedBy = :subject)',
            ExpressionAttributeValues=self.serialized({':session': record['sessionId'], ':subject': subject}))
        items = [self.lock_check('GUEST#' + proof, guest_lease, now), self.lock_check(subject, account_lease, now),
                 account_update, guest_put,
                 {'Put': {'TableName': self.table.name,
                          'Item': self.serialized({'pk': 'CUSTOMER#' + record['customerId'], 'subject': subject}),
                          'ConditionExpression': 'attribute_not_exists(pk) OR #subject = :subject',
                          'ExpressionAttributeNames': {'#subject': 'subject'},
                          'ExpressionAttributeValues': self.serialized({':subject': subject})}}]
        if previous and previous != record['customerId']:
            items.append({'Delete': {'TableName': self.table.name, 'Key': self.serialized({'pk': 'CUSTOMER#' + previous}),
                                    'ConditionExpression': 'attribute_not_exists(pk) OR #subject = :subject',
                                    'ExpressionAttributeNames': {'#subject': 'subject'},
                                    'ExpressionAttributeValues': self.serialized({':subject': subject})}})
        self.transact(items)

    def device_link(self, device):
        return self.get('DEVICE#' + device)

    def customer_subject(self, customer):
        return (self.get('CUSTOMER#' + customer) or {}).get('subject')

    def event_seen(self, identifier):
        return bool(self.get('EVENT#' + identifier))

    @contextmanager
    def account_lock(self, subject, now):
        nonce = secrets.token_urlsafe(24)
        try:
            self.table.put_item(Item={'pk': 'LOCK#' + subject, 'nonce': nonce, 'leaseUntil': now + 90, 'ttl': now + 180},
                                ConditionExpression='attribute_not_exists(pk) OR leaseUntil < :now',
                                ExpressionAttributeValues={':now': now})
        except ClientError as error:
            if conditional_error(error):
                raise ApiError(409, 'billing_busy')
            raise
        try:
            yield nonce
        finally:
            try:
                self.table.delete_item(Key={'pk': 'LOCK#' + subject},
                                       ConditionExpression='nonce = :nonce', ExpressionAttributeValues={':nonce': nonce})
            except ClientError as error:
                if not conditional_error(error):
                    raise

    def lock_check(self, subject, lease, now):
        return {'ConditionCheck': {'TableName': self.table.name, 'Key': self.serialized({'pk': 'LOCK#' + subject}),
                                  'ConditionExpression': 'nonce = :nonce AND leaseUntil > :now',
                                  'ExpressionAttributeValues': self.serialized({':nonce': lease, ':now': now})}}

    def transact(self, items):
        try:
            # Dedicated low-level client: transact writes use explicit AttributeValue maps.
            self.client.transact_write_items(TransactItems=items)
        except ClientError as error:
            if conditional_error(error):
                raise ApiError(409, 'billing_busy')
            raise

    def account_update(self, subject, fields):
        aliases = {'#v' + str(i): key for i, key in enumerate(fields)}
        values = {':v' + str(i): value for i, value in enumerate(fields.values())}
        expression = 'SET ' + ', '.join(f'#v{i} = :v{i}' for i in range(len(fields)))
        return {'Update': {'TableName': self.table.name, 'Key': self.serialized({'pk': 'ACCOUNT#' + subject}),
                           'UpdateExpression': expression, 'ExpressionAttributeNames': aliases,
                           'ExpressionAttributeValues': self.serialized(values)}}

    def save_account(self, subject, fields, lease, now):
        self.transact([self.lock_check(subject, lease, now), self.account_update(subject, fields)])

    def bind_customer(self, subject, customer, lease, now):
        self.transact([
            self.lock_check(subject, lease, now), self.account_update(subject, {'customerId': customer}),
            {'Put': {'TableName': self.table.name, 'Item': self.serialized({'pk': 'CUSTOMER#' + customer, 'subject': subject}),
                     'ConditionExpression': 'attribute_not_exists(pk) OR #subject = :subject',
                     'ExpressionAttributeNames': {'#subject': 'subject'},
                     'ExpressionAttributeValues': self.serialized({':subject': subject})}},
        ])

    def mark_event(self, identifier, subject, lease, now):
        self.transact([self.lock_check(subject, lease, now), {'Put': {'TableName': self.table.name,
                       'Item': self.serialized({'pk': 'EVENT#' + identifier, 'ttl': now + 30 * 86400}),
                       'ConditionExpression': 'attribute_not_exists(pk)'}}])

    def limit(self, key, maximum, seconds, now):
        bucket = str(now // seconds)
        try:
            self.table.update_item(Key={'pk': 'RATE#' + key + '#' + bucket},
                                   UpdateExpression='SET ttl = :ttl ADD attempts :one',
                                   ConditionExpression='attribute_not_exists(attempts) OR attempts < :maximum',
                                   ExpressionAttributeValues={':ttl': now + seconds * 2, ':one': 1, ':maximum': maximum})
        except ClientError as error:
            if conditional_error(error):
                raise ApiError(429, 'rate_limited')
            raise

    def create_link(self, code_hash, device, credential_hash, expires):
        self.table.put_item(Item={'pk': 'LINK#' + code_hash, 'deviceId': device,
                                  'credentialHash': credential_hash, 'expiresAt': expires, 'ttl': expires},
                            ConditionExpression='attribute_not_exists(pk)')

    def approve_link(self, code_hash, subject, now):
        key = 'LINK#' + code_hash
        link = self.get(key)
        if not link or int(link.get('expiresAt', 0)) <= now:
            raise ApiError(400, 'invalid_code')
        if self.device_link(link['deviceId']):
            raise ApiError(409, 'device_already_linked')
        try:
            self.client.transact_write_items(TransactItems=[
                {'Delete': {'TableName': self.table.name, 'Key': self.serialized({'pk': key}),
                            'ConditionExpression': 'expiresAt > :now AND credentialHash = :hash',
                            'ExpressionAttributeValues': self.serialized({':now': now, ':hash': link['credentialHash']})}},
                {'ConditionCheck': {'TableName': self.devices.name,
                                    'Key': self.serialized({'deviceId': link['deviceId']}),
                                    'ConditionExpression': 'tokenHash = :hash',
                                    'ExpressionAttributeValues': self.serialized({':hash': link['credentialHash']})}},
                {'Put': {'TableName': self.table.name,
                         'Item': self.serialized({'pk': 'DEVICE#' + link['deviceId'], 'subject': subject,
                                                  'credentialHash': link['credentialHash'], 'linkedAt': now}),
                         'ConditionExpression': 'attribute_not_exists(pk)'}},
            ])
        except ClientError as error:
            if conditional_error(error):
                raise ApiError(400, 'invalid_code')
            raise

    def unlink(self, device):
        self.table.delete_item(Key={'pk': 'DEVICE#' + device})


class Cognito:
    def __init__(self, config):
        self.config = config
        self.client = boto3.client('cognito-idp', config=AWS_CONFIG)

    def call(self, method, **kwargs):
        try:
            return getattr(self.client, method)(**kwargs)
        except ClientError as error:
            code = error.response.get('Error', {}).get('Code')
            mapped = {'NotAuthorizedException': (401, 'invalid_credentials'),
                      'UserNotFoundException': (401, 'invalid_credentials'),
                      'UserNotConfirmedException': (403, 'email_not_verified'),
                      'CodeMismatchException': (400, 'invalid_code'), 'ExpiredCodeException': (400, 'expired_code'),
                      'InvalidPasswordException': (400, 'invalid_password'),
                      'InvalidParameterException': (400, 'invalid_request'),
                      'UsernameExistsException': (409, 'account_exists'),
                      'LimitExceededException': (429, 'rate_limited'),
                      'TooManyRequestsException': (429, 'rate_limited'),
                      'TooManyFailedAttemptsException': (429, 'rate_limited')}
            status, message = mapped.get(code, (503, 'service_unavailable'))
            raise ApiError(status, message)

    def get_user(self, token):
        return self.call('get_user', AccessToken=token)

    def signup(self, email, password):
        self.call('sign_up', ClientId=self.config.client_id, Username=email, Password=password,
                  UserAttributes=[{'Name': 'email', 'Value': email}])

    def confirm(self, email, code):
        self.call('confirm_sign_up', ClientId=self.config.client_id, Username=email, ConfirmationCode=code,
                  ForceAliasCreation=False)

    def tokens(self, result, refresh=None):
        auth = result.get('AuthenticationResult')
        if not auth or not auth.get('AccessToken') or not (auth.get('RefreshToken') or refresh):
            raise ApiError(401, 'invalid_credentials')
        return {'accessToken': auth['AccessToken'], 'refreshToken': auth.get('RefreshToken') or refresh,
                'expiresIn': auth['ExpiresIn']}

    def login(self, email, password):
        result = self.call('initiate_auth', ClientId=self.config.client_id, AuthFlow='USER_PASSWORD_AUTH',
                           AuthParameters={'USERNAME': email, 'PASSWORD': password})
        return self.tokens(result)

    def refresh(self, token):
        result = self.call('initiate_auth', ClientId=self.config.client_id, AuthFlow='REFRESH_TOKEN_AUTH',
                           AuthParameters={'REFRESH_TOKEN': token})
        return self.tokens(result, token)

    def recover(self, email):
        try:
            self.call('forgot_password', ClientId=self.config.client_id, Username=email)
        except ApiError as error:
            if error.code not in {'invalid_credentials', 'invalid_request'}:
                raise

    def resend(self, email):
        try:
            self.call('resend_confirmation_code', ClientId=self.config.client_id, Username=email)
        except ApiError as error:
            if error.code not in {'invalid_credentials', 'invalid_request'}:
                raise

    def reset(self, email, code, password):
        self.call('confirm_forgot_password', ClientId=self.config.client_id, Username=email,
                  ConfirmationCode=code, Password=password)

    def logout(self, token):
        self.call('global_sign_out', AccessToken=token)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, hdrs, newurl):
        raise urllib.error.HTTPError(req.full_url, code, 'Redirect rejected', hdrs, fp)


class Discord:
    """One-time guild verification. OAuth tokens are used in memory then discarded."""
    def __init__(self, secret_arn, web_origin='https://victoryroad.app'):
        self.secret_arn = secret_arn
        self.callback_url = trusted_web_origin(web_origin) + '/trace/discord/callback'
        self.secrets_client = boto3.client('secretsmanager', config=AWS_CONFIG)
        self.opener = urllib.request.build_opener(NoRedirect())

    def request(self, path, *, token=None, fields=None):
        import re
        if path not in ('/oauth2/token', '/users/@me') and not re.fullmatch(r'/users/@me/guilds/[0-9]{17,20}/member', path):
            raise ApiError(503, 'discord_unavailable')
        headers = {'User-Agent': 'Trace (https://victoryroad.app, 1.0)', 'Accept': 'application/json'}
        if token:
            headers['Authorization'] = 'Bearer ' + token
        encoded = urllib.parse.urlencode(fields).encode() if fields is not None else None
        if encoded is not None:
            headers['Content-Type'] = 'application/x-www-form-urlencoded'
        request = urllib.request.Request('https://discord.com/api/v10' + path, data=encoded, headers=headers)
        try:
            with self.opener.open(request, timeout=5) as response:
                raw = response.read(131073)
            value = json.loads(raw) if len(raw) <= 131072 else None
            if not isinstance(value, dict):
                raise ValueError('invalid response')
            return value
        except urllib.error.HTTPError as error:
            status = error.code
            error.close()
            if path.endswith('/member') and status == 404:
                raise ApiError(403, 'discord_not_joined')
            if path == '/oauth2/token' and status in (400, 401):
                raise ApiError(400, 'discord_state_invalid')
            raise ApiError(503, 'discord_unavailable')
        except (OSError, ValueError, urllib.error.URLError):
            raise ApiError(503, 'discord_unavailable')

    def verify_member(self, code, client_id, guild_id):
        import re
        if not self.secret_arn:
            raise ApiError(503, 'discord_unavailable')
        value = self.secrets_client.get_secret_value(SecretId=self.secret_arn)
        secret = json.loads(value['SecretString']).get('discordClientSecret')
        if not isinstance(secret, str) or not 16 <= len(secret) <= 512 or re.search(r'\s', secret):
            raise ApiError(503, 'discord_unavailable')
        granted = self.request('/oauth2/token', fields={'client_id': client_id, 'client_secret': secret,
                               'grant_type': 'authorization_code', 'code': code, 'redirect_uri': self.callback_url})
        token = granted.get('access_token')
        if (not isinstance(token, str) or not 1 <= len(token) <= 4096 or re.search(r'\s', token)
                or str(granted.get('token_type', '')).lower() != 'bearer'
                or not {'identify', 'guilds.members.read'} <= set(str(granted.get('scope', '')).split())):
            raise ApiError(503, 'discord_unavailable')
        user = self.request('/users/@me', token=token)
        member = self.request('/users/@me/guilds/' + guild_id + '/member', token=token)
        identifier = user.get('id')
        if not isinstance(identifier, str) or not re.fullmatch(r'[0-9]{17,20}', identifier) or (member.get('user') or {}).get('id') != identifier:
            raise ApiError(503, 'discord_unavailable')
        if member.get('pending') is True:
            raise ApiError(403, 'discord_pending')
        return identifier


class Stripe:
    def __init__(self, secret_arn, configuration, live, web_origin='https://victoryroad.app'):
        self.secret_arn, self.configuration, self.live = secret_arn, configuration, live
        origin = trusted_web_origin(web_origin)
        if live and origin != 'https://victoryroad.app':
            raise ApiError(503, 'billing_unavailable')
        self.account_url = origin + '/trace/account'
        self.secrets_client = boto3.client('secretsmanager', config=AWS_CONFIG)
        self._secrets = None
        self._secrets_until = 0
        self.opener = urllib.request.build_opener(NoRedirect())

    def secrets(self):
        if not self._secrets or time.time() >= self._secrets_until:
            if not self.secret_arn:
                raise ApiError(503, 'billing_unavailable')
            value = self.secrets_client.get_secret_value(SecretId=self.secret_arn)
            self._secrets = json.loads(value['SecretString'])
            self._secrets_until = time.time() + 300
            prefix = 'sk_live_' if self.live else 'sk_test_'
            key = self._secrets.get('secretKey', '')
            if not key.startswith(prefix):
                self._secrets = None
                raise ApiError(503, 'billing_unavailable')
        return self._secrets

    def webhook_secret(self):
        value = self.secrets().get('webhookSecret', '')
        if not value.startswith('whsec_'):
            raise ApiError(503, 'billing_unavailable')
        return value

    def proxy_secret(self):
        value = self.secrets().get('webProxySecret', '')
        if not isinstance(value, str) or len(value) < 43 or len(value) > 512:
            raise ApiError(503, 'billing_unavailable')
        return value

    def request(self, method, path, fields=None, idempotency=None):
        if not path.startswith('/v1/') or not re_safe_path(path):
            raise ApiError(503, 'billing_unavailable')
        encoded = urllib.parse.urlencode(fields or {}, doseq=True).encode()
        url = 'https://api.stripe.com' + path
        if method == 'GET' and encoded:
            url += '?' + encoded.decode()
        request = urllib.request.Request(url, data=encoded if method == 'POST' else None, method=method,
                                         headers={'Authorization': 'Bearer ' + self.secrets()['secretKey'],
                                                  'Stripe-Version': STRIPE_VERSION,
                                                  'Content-Type': 'application/x-www-form-urlencoded'})
        if idempotency:
            request.add_header('Idempotency-Key', idempotency)
        try:
            with self.opener.open(request, timeout=8) as response:
                return json.load(response)
        except (urllib.error.URLError, TimeoutError, ValueError):
            raise ApiError(503, 'billing_unavailable')

    def price(self, identifier):
        return self.request('GET', '/v1/prices/' + identifier)

    def create_customer(self, email, subject):
        return self.request('POST', '/v1/customers', {'email': email, 'metadata[trace_subject]': subject},
                            'trace-customer-' + subject)

    def subscriptions(self, customer):
        result = self.request('GET', '/v1/subscriptions', {'customer': customer, 'status': 'all', 'limit': 100,
                                                          'expand[]': 'data.latest_invoice'})
        if result.get('has_more') or not isinstance(result.get('data'), list):
            raise ApiError(503, 'billing_unavailable')
        return result['data']

    def checkout(self, customer, price, subject, key, expires):
        return self.request('POST', '/v1/checkout/sessions', {
            'mode': 'subscription', 'customer': customer, 'client_reference_id': subject,
            'line_items[0][price]': price, 'line_items[0][quantity]': 1,
            'payment_method_types[0]': 'card', 'subscription_data[metadata][trace_subject]': subject,
            'success_url': self.account_url + '?checkout=success', 'cancel_url': self.account_url + '?checkout=cancel',
            'expires_at': expires,
        }, 'trace-checkout-' + key)

    def create_guest_customer(self, proof):
        # Checkout collects the email for this deliberately blank anonymous customer.
        return self.request('POST', '/v1/customers', {'metadata[trace_guest]': proof}, 'trace-guest-customer-' + proof)

    def guest_checkout(self, customer, price, proof, key, expires):
        return self.request('POST', '/v1/checkout/sessions', {
            'mode': 'subscription', 'customer': customer, 'client_reference_id': 'guest_' + proof,
            'line_items[0][price]': price, 'line_items[0][quantity]': 1, 'payment_method_types[0]': 'card',
            'metadata[trace_guest]': proof, 'metadata[trace_reservation]': key,
            'subscription_data[metadata][trace_guest]': proof, 'subscription_data[metadata][trace_reservation]': key,
            'success_url': self.account_url + '?checkout=success', 'cancel_url': self.account_url + '?checkout=cancel',
            'expires_at': expires,
        }, 'trace-guest-checkout-' + key)

    def checkout_sessions(self, customer):
        result = self.request('GET', '/v1/checkout/sessions', {'customer': customer, 'limit': 100})
        if result.get('has_more') or not isinstance(result.get('data'), list):
            raise ApiError(503, 'billing_unavailable')
        return result['data']

    def retrieve_checkout(self, identifier):
        return self.request('GET', '/v1/checkout/sessions/' + identifier,
                            {'expand[]': ['subscription.latest_invoice', 'line_items']})

    def checkout_url(self, session):
        return allowed_url(session.get('url'), 'checkout.stripe.com')

    def expire_checkout(self, identifier):
        return self.request('POST', '/v1/checkout/sessions/' + identifier + '/expire')

    def portal(self, customer):
        if not self.configuration:
            raise ApiError(503, 'billing_unavailable')
        result = self.request('POST', '/v1/billing_portal/sessions', {
            'customer': customer, 'return_url': self.account_url, 'configuration': self.configuration,
        })
        result['url'] = allowed_url(result.get('url'), 'billing.stripe.com')
        return result


def re_safe_path(path):
    import re
    return bool(re.fullmatch(r'/v1/[A-Za-z0-9_/]+', path))


def allowed_url(value, host):
    if not isinstance(value, str):
        raise ApiError(503, 'billing_unavailable')
    parsed = urllib.parse.urlsplit(value)
    if parsed.scheme != 'https' or parsed.netloc != host:
        raise ApiError(503, 'billing_unavailable')
    return value
