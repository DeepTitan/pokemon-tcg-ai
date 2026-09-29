#!/usr/bin/env python3
"""Pro sandbox adapter journey. Offline unless --execute; no Stripe keys required.

Private FIFO protocol: read JSON lines from events, write commands to commands.
Commands: payment-complete, inspect-account, verify-cancellation, cleanup-confirmed, finish, abort,
acknowledge (after a cleanup-required handoff).
--browser-fixture creates only a test login, then waits for browser-complete.
Hosted payment/portal actions belong to the root operator. No browser automation.
"""
import argparse
import datetime as dt
import hashlib
from http.cookies import SimpleCookie
import json
import os
from pathlib import Path
import re
import secrets
import select
import stat
import subprocess
import time
from urllib.parse import parse_qsl, urlsplit

ROOT = Path(__file__).resolve().parent.parent
STACK = 'trace-memberships-staging'
POOL = 'us-east-1_ELXorHpct'
CLIENT = '2js5quloo43e2700j7vki1l9n0'
API = 'https://scn2ntfvfa.execute-api.us-east-1.amazonaws.com'
ORIGIN = 'https://trace-memberships-staging-deeptitan-6729s-projects.vercel.app'
PROJECT = 'prj_xu8lQXM29IgPY7fLDvbkT4qah4Ta'
TEAM = 'team_6rqfBuaO0W1ndg07WpRuoUv0'
PRICES = {'TracePriceId': 'price_1UKplGKoV4rXpeobtpGOjXvt', 'SupporterPriceId': 'price_1UKplmKoV4rXpeobxD2yr9AL'}
PORTAL = 'bpc_1UKpulKoV4rXpeobDUDFzCz9'
ACCESS, REFRESH, PROOF = '__Host-trace-member-access', '__Host-trace-member-refresh', '__Host-trace-checkout'
COOKIE_NAMES = {ACCESS, REFRESH, PROOF}


def require(ok, label):
    if not ok:
        raise RuntimeError(label)


def passed(label):
    print('PASS ' + label, flush=True)


def validate_parameters(params):
    expected = {'Environment': 'staging', 'BillingEnabled': 'true', 'StripeMode': 'test',
                'OwnerSubject': '', 'WebOrigin': ORIGIN, 'StripePortalConfigId': PORTAL, **PRICES}
    require(all(params.get(key) == value for key, value in expected.items()), 'exact sandbox configuration required')


def safe_url(value, kind):
    parsed = urlsplit(value) if isinstance(value, str) else None
    host = 'checkout.stripe.com' if kind == 'checkout' else 'billing.stripe.com'
    require(parsed and parsed.scheme == 'https' and parsed.netloc == host, 'unexpected sandbox provider URL')
    if kind == 'checkout':
        require(re.fullmatch(r'/(?:c/)?pay/cs_test_[A-Za-z0-9_]+', parsed.path), 'unexpected sandbox Checkout path')
    else:
        fields = parse_qsl(parsed.query, keep_blank_values=True)
        path_form = re.fullmatch(r'/p/session/[A-Za-z0-9_-]+', parsed.path) and not parsed.query
        query_form = parsed.path == '/p/session' and len(fields) == 1 and fields[0][0] == 'secret' and re.fullmatch(r'test_[A-Za-z0-9_-]+', fields[0][1])
        require(not parsed.fragment and (path_form or query_form), 'unexpected sandbox portal path')
    return value


class Channel:
    """Only FIFO nodes are created; secret payloads never enter regular files."""
    def __init__(self, folder):
        self.folder = Path(folder)
        require(self.folder.parent.resolve() == Path('/private/tmp') and self.folder.name.startswith('trace-paid-smoke-'), 'private handoff directory required')
        self.folder.mkdir(mode=0o700)
        self.fds = {}
        self.buffer = b''
        for name in ('events', 'commands'):
            path = self.folder / name
            os.mkfifo(path, 0o600)
            info = path.lstat()
            require(stat.S_ISFIFO(info.st_mode) and stat.S_IMODE(info.st_mode) == 0o600 and info.st_uid == os.geteuid(), 'private FIFO ownership')
            self.fds[name] = os.open(path, os.O_RDWR | os.O_NONBLOCK | os.O_NOFOLLOW)

    def emit(self, stage, **data):
        payload = (json.dumps({'stage': stage, **data}) + '\n').encode()
        require(len(payload) <= 4096, 'handoff payload too large')
        require(select.select([], [self.fds['events']], [], 10)[1], 'private event reader unavailable')
        require(os.write(self.fds['events'], payload) == len(payload), 'incomplete private handoff')

    def command(self, allowed, timeout=1800):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if b'\n' not in self.buffer:
                if not select.select([self.fds['commands']], [], [], 1)[0]:
                    continue
                self.buffer += os.read(self.fds['commands'], 4096)
                require(len(self.buffer) <= 4096, 'oversized command')
                continue
            raw, self.buffer = self.buffer.split(b'\n', 1)
            value = json.loads(raw)
            require(isinstance(value, dict) and set(value) == {'command'}, 'invalid control command')
            if value['command'] == 'abort':
                raise RuntimeError('operator aborted; preserve fixture for cleanup')
            require(value['command'] in allowed, 'command is not valid at this stage')
            return value['command']
        raise RuntimeError('operator handoff expired; preserve fixture for cleanup')

    def close(self):
        for name, descriptor in self.fds.items():
            os.close(descriptor)
            (self.folder / name).unlink()
        self.folder.rmdir()


class Purchase:
    def __init__(self, channel, browser_fixture=False, expected_tier='trace'):
        # Root confirmed the default profile's login flow works with this existing
        # CLI-bundled SDK. No credential export or CLI input-file workaround.
        from awscli.botocore.session import Session
        from awscli.botocore.config import Config
        session = Session(profile='default')
        config = Config(retries={'max_attempts': 1}, connect_timeout=5, read_timeout=20, ignore_configured_endpoint_urls=True)
        self.aws = {name: session.create_client(name, region_name='us-east-1', config=config) for name in ('cloudformation', 'cognito-idp', 'dynamodb')}
        self.channel, self.cookies, self.users = channel, {}, []
        self.table = self.proof = self.record = None
        self.purchase_started = False
        self.cleaned = False
        self.browser_fixture, self.browser_proof_hash = browser_fixture, None
        self.expected_tier = expected_tier

    def guard(self):
        cf, cg = self.aws['cloudformation'], self.aws['cognito-idp']
        stack = cf.describe_stacks(StackName=STACK)['Stacks'][0]
        require(stack['StackName'] == STACK and stack['StackStatus'] in ('CREATE_COMPLETE', 'UPDATE_COMPLETE'), 'stable isolated stack')
        require(stack['StackId'].startswith('arn:aws:cloudformation:us-east-1:108241940679:stack/' + STACK + '/'), 'expected staging AWS account')
        validate_parameters({row['ParameterKey']: row.get('ParameterValue', '') for row in stack['Parameters']})
        outputs = {row['OutputKey']: row['OutputValue'] for row in stack['Outputs']}
        require(outputs.get('MembershipApiUrl') == API and outputs.get('UserPoolId') == POOL and outputs.get('UserPoolClientId') == CLIENT, 'fixed staging API/pool/client')
        self.table = outputs['MembershipsTableName']
        require(re.fullmatch(STACK + r'-Accounts-[A-Za-z0-9]+', self.table), 'isolated membership table')
        resources = {row['LogicalResourceId']: row['PhysicalResourceId'] for row in cf.list_stack_resources(StackName=stack['StackId'])['StackResourceSummaries']}
        require(all(resources.get(key) == value for key, value in {'Accounts': self.table, 'UserPool': POOL, 'UserPoolClient': CLIENT, 'MembershipApi': 'scn2ntfvfa'}.items()), 'physical resource ownership')
        pool = cg.describe_user_pool(UserPoolId=POOL)['UserPool']
        require(pool['Name'] == STACK and not pool.get('LambdaConfig') and pool.get('MfaConfiguration') == 'OFF', 'no unexpected user-pool messaging triggers')
        require(pool['Arn'].split(':')[4] == stack['StackId'].split(':')[4], 'same AWS account')
        client = cg.describe_user_pool_client(UserPoolId=POOL, ClientId=CLIENT)['UserPoolClient']
        require(client['UserPoolId'] == POOL and not client.get('ClientSecret') and client.get('EnableTokenRevocation') is True, 'expected Cognito client')
        project = json.loads((ROOT / '.vercel/project.json').read_text())
        require(project.get('projectId') == PROJECT and project.get('orgId') == TEAM, 'expected Vercel project')
        passed('exact staging sandbox guards; owner unset; no credential export')

    def user(self):
        cg = self.aws['cognito-idp']
        item = {'email': 'trace-paid-smoke-' + secrets.token_hex(16) + '@example.invalid', 'password': 'Aa1!' + secrets.token_urlsafe(32)}
        # Track attempted creation so a failure still hands the operator its exact
        # synthetic identifier through the private channel.
        self.users.append(item)
        row = cg.admin_create_user(UserPoolId=POOL, Username=item['email'], MessageAction='SUPPRESS', ForceAliasCreation=False, TemporaryPassword=item['password'], UserAttributes=[{'Name': 'email', 'Value': item['email']}, {'Name': 'email_verified', 'Value': 'true'}])['User']
        attrs = {entry['Name']: entry['Value'] for entry in row['Attributes']}
        require(attrs.get('email') == item['email'] and attrs.get('email_verified') == 'true', 'synthetic account ownership')
        item.update(username=row['Username'], subject=attrs['sub'])
        cg.admin_set_user_password(UserPoolId=POOL, Username=item['username'], Password=item['password'], Permanent=True)
        return item

    def web(self, action, body=None, expected=200, cookies=None):
        require(action in ('account', 'auth/login', 'auth/logout', 'checkout/prepare', 'checkout/guest', 'checkout/status', 'checkout/claim', 'portal'), 'HTTP action allowlist')
        jar = self.cookies if cookies is None else cookies
        config = ['silent', 'show-error', 'include', 'max-time = 30', 'request = ' + json.dumps('GET' if action == 'account' else 'POST'), 'header = "Accept: application/json"']
        if jar:
            config.append('header = ' + json.dumps('Cookie: ' + '; '.join(key + '=' + value for key, value in jar.items())))
        if action != 'account':
            config += ['header = "Content-Type: application/json"', 'header = ' + json.dumps('Origin: ' + ORIGIN), 'data = ' + json.dumps(json.dumps(body or {}))]
        result = subprocess.run(['vercel', 'curl', '/trace/api/' + action, '--deployment', ORIGIN, '--', '--config', '-'], input='\n'.join(config) + '\n', text=True, capture_output=True, cwd=ROOT, timeout=45)
        require(result.returncode == 0, 'protected HTTP execution failed')
        head, separator, content = result.stdout.partition('\n\n')
        require(separator and head.startswith('HTTP/'), 'invalid protected HTTP response')
        status = int(head.splitlines()[0].split()[1])
        require(status == expected, action + ' unexpected HTTP ' + str(status))
        require('no-store' in head.lower(), 'private response cache policy')
        for line in head.splitlines()[1:]:
            if not line.lower().startswith('set-cookie:'):
                continue
            for key, morsel in SimpleCookie(line.split(':', 1)[1].strip()).items():
                require(key in COOKIE_NAMES and morsel['secure'] and morsel['httponly'] and morsel['samesite'] == 'Lax' and morsel['path'] == '/' and not morsel['domain'], 'unexpected cookie boundary')
                if morsel.value:
                    self.cookies[key] = morsel.value
                else:
                    self.cookies.pop(key, None)
        data = json.loads(content)
        require(isinstance(data, dict) and not ({'accessToken', 'refreshToken', 'checkoutToken', 'sessionId', 'customerId'} & set(data)), 'private provider fields exposed in JSON')
        return data

    def item(self, key):
        raw = self.aws['dynamodb'].get_item(TableName=self.table, Key={'pk': {'S': key}}, ConsistentRead=True).get('Item', {})
        def decode(value):
            if 'M' in value:
                return {key: decode(item) for key, item in value['M'].items()}
            if 'N' in value:
                return int(value['N'])
            return value.get('S', value.get('BOOL'))
        return {key: decode(value) for key, value in raw.items()}

    def fixture(self):
        proof_hash = hashlib.sha256(self.proof.encode()).hexdigest() if self.proof else self.browser_proof_hash
        if proof_hash:
            self.record = self.item('GUEST#' + proof_hash)
        return {'membershipTable': self.table, 'users': [{key: row[key] for key in ('email', 'username', 'subject') if key in row} for row in self.users],
                'guestProofHash': proof_hash,
                'customerId': (self.record or {}).get('customerId'), 'sessionId': (self.record or {}).get('sessionId')}

    def login(self, user):
        require(self.web('auth/login', {'email': user['email'], 'password': user['password']}) == {'authenticated': True}, 'redacted successful login')

    def assert_paid(self, account, expected_tier='trace'):
        require(expected_tier in ('trace', 'supporter'), 'unknown expected paid tier')
        deck_study = expected_tier == 'supporter'
        require(account.get('plan') == expected_tier and account.get('status') == 'active' and account.get('traceAccess') is True and account.get('admin') is False and account.get('opponentDecklists') is deck_study, 'paid tier boundary')
        require(dt.datetime.fromisoformat(account.get('expiresAt', '').replace('Z', '+00:00')) > dt.datetime.now(dt.timezone.utc), 'future paid period')
        require(account.get('capabilities') == {'recordMatches': True, 'leaderboard': True, 'recentReplayDays': 7, 'fullHistory': True, 'expandedSharing': True, 'opponentDecklists': deck_study, 'freeSharesPerWindow': 1, 'shareWindowDays': 7}, 'exact paid capabilities')

    def run(self):
        self.guard()
        self.main_user = self.user()
        if self.browser_fixture:
            self.channel.emit('browser-fixture-ready', expectedTier=self.expected_tier, login={'email': self.main_user['email'], 'password': self.main_user['password']}, fixture=self.fixture())
            self.channel.command({'browser-complete'})
            self.login(self.main_user)
            self.assert_paid(self.web('account'), self.expected_tier)
            customer = self.item('ACCOUNT#' + self.main_user['subject']).get('customerId')
            require(isinstance(customer, str) and re.fullmatch(r'cus_[A-Za-z0-9]+', customer), 'browser fixture customer binding')
            self.browser_proof_hash = self.item('GUEST_CUSTOMER#' + customer).get('proof')
            require(bool(re.fullmatch(r'[a-f0-9]{64}', self.browser_proof_hash or '')), 'browser guest purchase ownership')
            fixture = self.fixture()
            require(fixture['customerId'] == customer and self.record.get('claimedBy') == self.main_user['subject'], 'browser claim ownership')
            passed('browser fixture has the expected active paid tier; browser interaction evidence is supplied separately')
            self.channel.emit('browser-account-verified', fixture=fixture)
            return self.finish_purchase()
        require(self.web('checkout/prepare') == {'ready': True}, 'purchase preparation')
        self.proof = self.cookies.get(PROOF)
        require(bool(re.fullmatch(r'[a-f0-9]{64}', self.proof or '')), 'strong purchase cookie')
        self.web('checkout/prepare')
        require(self.cookies.get(PROOF) == self.proof, 'purchase proof must not rotate')
        self.purchase_started = True
        url = safe_url(self.web('checkout/guest', {'plan': 'trace'})['url'], 'checkout')
        require(self.web('checkout/guest', {'plan': 'trace'}).get('url') == url, 'open same-plan checkout must be reused')
        require(self.web('checkout/status').get('state') == 'open', 'open purchase state')
        passed('guest preparation, stable proof, same-session retry and open status')
        self.channel.emit('payment-ready', checkoutUrl=url, login={'email': self.main_user['email'], 'password': self.main_user['password']}, fixture=self.fixture())
        self.channel.command({'payment-complete'})
        purchase = self.web('checkout/status')
        require(purchase == {'state': 'paid', 'plan': 'trace', 'expiresAt': None}, 'authoritative paid Pro purchase required')
        require(self.web('checkout/guest', {'plan': 'trace'}) == {'accountRequired': True}, 'paid purchase cannot create duplicate checkout')
        self.web('checkout/claim', expected=401)
        wrong = self.user()
        self.login(wrong)
        require(self.web('checkout/claim', expected=409).get('code') == 'checkout_email_mismatch', 'verified wrong email cannot claim purchase')
        require(self.cookies.get(PROOF) == self.proof and self.web('account').get('traceAccess') is False, 'wrong claim cannot clear proof or grant access')
        self.web('auth/logout')
        self.delete_user(wrong)
        self.login(self.main_user)
        require(self.web('account').get('traceAccess') is False, 'payment alone cannot grant the account access')
        self.web('checkout/claim', expected=410, cookies={key: value for key, value in self.cookies.items() if key != PROOF})
        require(self.web('checkout/claim') == {'claimed': True} and PROOF not in self.cookies, 'explicit claim must clear proof after success')
        self.assert_paid(self.web('account'))
        require(self.web('checkout/claim', cookies={**self.cookies, PROOF: self.proof}) == {'claimed': True}, 'lost claim response retry must be safe')
        require(self.web('checkout/guest', {'plan': 'trace'}) == {'accountRequired': True}, 'active membership cannot create duplicate checkout')
        passed('unauthenticated/missing-proof/wrong-email claims denied; explicit Pro claim and retry succeeded')
        portal = safe_url(self.web('portal')['url'], 'portal')
        self.channel.emit('portal-ready', portalUrl=portal, fixture=self.fixture())
        passed('bound portal session ready; cancellation not yet asserted')
        self.finish_purchase()

    def finish_purchase(self):
        while True:
            command = self.channel.command({'inspect-account', 'verify-cancellation', 'cleanup-confirmed', 'finish'})
            if command == 'inspect-account':
                account = self.web('account')
                fields = ('plan', 'status', 'traceAccess', 'admin', 'opponentDecklists', 'expiresAt', 'cancelAtPeriodEnd', 'capabilities')
                self.channel.emit('account-state', account={key: account.get(key) for key in fields})
            elif command == 'verify-cancellation':
                account = self.web('account')
                self.assert_paid(account, self.expected_tier)
                require(account.get('cancelAtPeriodEnd') is True, 'cancellation must retain paid access until period end')
                passed('period-end cancellation confirmed while expected paid access remains')
                self.channel.emit('cancellation-verified')
            elif command == 'cleanup-confirmed':
                self.cleanup_paid()
                self.channel.emit('cleaned')
                self.channel.command({'acknowledge'})
                return
            else:
                self.channel.emit('operator-cleanup-required', fixture=self.fixture())
                print('Fixture retained for operator cleanup; subscription cancellation was not inferred.', flush=True)
                self.channel.command({'acknowledge'})
                return

    def delete_user(self, user):
        cg, db = self.aws['cognito-idp'], self.aws['dynamodb']
        current = cg.admin_get_user(UserPoolId=POOL, Username=user.get('username', user['email']))
        attrs = {row['Name']: row['Value'] for row in current['UserAttributes']}
        require(attrs.get('email') == user['email'] and attrs.get('sub') == user.get('subject'), 'cleanup account ownership')
        key = 'ACCOUNT#' + user['subject']
        row = self.item(key)
        require(not row.get('customerId'), 'refuse deleting customer-bound account before billing cleanup')
        cg.admin_user_global_sign_out(UserPoolId=POOL, Username=current['Username'])
        cg.admin_delete_user(UserPoolId=POOL, Username=current['Username'])
        if row:
            db.delete_item(TableName=self.table, Key={'pk': {'S': key}}, ConditionExpression='email = :email AND attribute_not_exists(customerId)', ExpressionAttributeValues={':email': {'S': user['email']}})
        self.users.remove(user)

    def cleanup_paid(self):
        # The account endpoint caches its Stripe snapshot for 300 seconds.
        # Require a new reconciliation after this operator command, not merely
        # an old Free-looking response. No cache fields are mutated to force it.
        confirmed_at = int(time.time())
        deadline = time.monotonic() + 315
        passed('cleanup requested; waiting for a fresh provider reconciliation (up to 315 seconds)')
        while True:
            account = self.web('account')
            snapshot = self.item('ACCOUNT#' + self.main_user['subject']).get('snapshot') or {}
            synced_at = snapshot.get('syncedAt', 0)
            if isinstance(synced_at, int) and synced_at > confirmed_at:
                break
            require(time.monotonic() < deadline, 'fresh cleanup reconciliation unavailable; retain fixture')
            time.sleep(5)
        require(account.get('plan') == 'none' and account.get('status') == 'none' and account.get('traceAccess') is False, 'paid fixture still has billing state; retain it')
        require(snapshot.get('plan') == 'none' and snapshot.get('status') == 'none' and snapshot.get('expiresAt') == 0, 'provider snapshot still has billing state; retain fixture')
        fixture = self.fixture()
        customer, proof_hash, subject = fixture['customerId'], fixture['guestProofHash'], self.main_user['subject']
        require(customer and (self.record or {}).get('claimedBy') == subject, 'claimed fixture ownership')
        checks = [('CUSTOMER#' + customer, 'subject', subject), ('GUEST_CUSTOMER#' + customer, 'proof', proof_hash), ('GUEST#' + proof_hash, 'claimedBy', subject), ('ACCOUNT#' + subject, 'customerId', customer)]
        for key, field, value in checks:
            require(self.item(key).get(field) == value, 'fixture row ownership mismatch')
        # Atomic removal avoids partially deleting an ownership mapping.
        deletes = [{'Delete': {'TableName': self.table, 'Key': {'pk': {'S': key}}, 'ConditionExpression': '#field = :value', 'ExpressionAttributeNames': {'#field': field}, 'ExpressionAttributeValues': {':value': {'S': value}}}} for key, field, value in checks]
        account_delete = deletes[-1]['Delete']
        account_delete['ConditionExpression'] += ' AND #snapshot.#synced = :synced AND #snapshot.#status = :none AND #snapshot.#plan = :none'
        account_delete['ExpressionAttributeNames'].update({'#snapshot': 'snapshot', '#synced': 'syncedAt', '#status': 'status', '#plan': 'plan'})
        account_delete['ExpressionAttributeValues'].update({':synced': {'N': str(synced_at)}, ':none': {'S': 'none'}})
        self.aws['dynamodb'].transact_write_items(TransactItems=deletes)
        self.web('auth/logout')
        self.delete_user(self.main_user)
        self.cookies.clear()
        self.cleaned = True
        passed('inactive paid fixture ownership rows and synthetic account removed; provider audit objects untouched')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--execute', action='store_true')
    parser.add_argument('--control-dir')
    parser.add_argument('--browser-fixture', action='store_true', help='Create only the suppressed test login; operator starts and claims Checkout in the same browser')
    parser.add_argument('--expected-tier', choices=('trace', 'supporter'), default='trace', help='Browser-fixture expected plan: trace (Pro, default) or supporter (Supporters Club)')
    args = parser.parse_args()
    if args.expected_tier != 'trace' and not args.browser_fixture:
        parser.error('--expected-tier supporter requires --browser-fixture; the adapter purchase remains Pro')
    if not args.execute:
        print('Plan only: guarded Pro sandbox purchase with private FIFOs. No files, provider calls or credentials created.')
        return 0
    require(bool(args.control_dir), 'explicit private control directory required')
    channel = Channel(args.control_dir)
    runner = None
    try:
        runner = Purchase(channel, browser_fixture=args.browser_fixture, expected_tier=args.expected_tier)
        runner.run()
        return 0
    except Exception as error:
        # Provider messages can contain submitted inputs; only controlled local
        # assertion labels or exception class names are emitted publicly.
        print('FAIL ' + (str(error) if type(error) is RuntimeError else type(error).__name__), flush=True)
        if runner is not None:
            try:
                channel.emit('operator-cleanup-required', fixture=runner.fixture())
                print('Waiting for private cleanup handoff acknowledgment.', flush=True)
                channel.command({'acknowledge'})
            except Exception:
                print('Private cleanup handoff unavailable; retain the earlier fixture inventory.', flush=True)
        return 1
    finally:
        channel.close()


if __name__ == '__main__':
    raise SystemExit(main())
