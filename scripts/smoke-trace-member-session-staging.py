#!/usr/bin/env python3
"""Email-free staging adapter/session smoke. No provider calls without --execute.

Run with the existing AWS CLI's bundled Python (awscli.botocore is required).
One disposable admin-confirmed Cognito user is created with MessageAction=SUPPRESS.
Passwords, session cookies and provider tokens stay in memory/private stdin.
No signup email, recovery email, Stripe, owner switch, device or game is touched.
This is adapter/session evidence, not signup/email-delivery evidence.
"""
import argparse
import email.utils
import hashlib
from http.cookies import SimpleCookie
import json
from pathlib import Path
import re
import secrets
import subprocess
import time

STACK = 'trace-memberships-staging'
REGION = 'us-east-1'
POOL = 'us-east-1_ELXorHpct'
CLIENT = '2js5quloo43e2700j7vki1l9n0'
API = 'https://scn2ntfvfa.execute-api.us-east-1.amazonaws.com'
ORIGIN = 'https://trace-memberships-staging-deeptitan-6729s-projects.vercel.app'
PROJECT = 'prj_xu8lQXM29IgPY7fLDvbkT4qah4Ta'
TEAM = 'team_6rqfBuaO0W1ndg07WpRuoUv0'
ACCESS = '__Host-trace-member-access'
REFRESH = '__Host-trace-member-refresh'
ROOT = Path(__file__).resolve().parent.parent


def require(condition, label):
    if not condition:
        raise RuntimeError(label)


def passed(label):
    print('PASS ' + label, flush=True)


class Smoke:
    def __init__(self, profile):
        # This SDK is already installed as part of the AWS CLI. No secret files
        # or credential-bearing OS arguments are necessary for admin operations.
        from awscli.botocore.session import Session
        session = Session(profile=profile)
        self.cf = session.create_client('cloudformation', region_name=REGION)
        self.cg = session.create_client('cognito-idp', region_name=REGION)
        self.db = session.create_client('dynamodb', region_name=REGION)
        self.email = 'trace-session-smoke-' + secrets.token_hex(16) + '@example.invalid'
        self.password = 'Aa1!' + secrets.token_urlsafe(32)
        self.username = None
        self.subject = None
        self.create_attempted = False
        self.table = None
        self.identities = {self.email.lower()}
        self.buckets = set()
        self.cookies = {}

    def guard(self):
        stacks = self.cf.describe_stacks(StackName=STACK)['Stacks']
        require(len(stacks) == 1, 'exact staging stack')
        stack = stacks[0]
        require(stack['StackName'] == STACK and stack['StackStatus'] in ('CREATE_COMPLETE', 'UPDATE_COMPLETE'), 'stable staging stack')
        params = {item['ParameterKey']: item.get('ParameterValue', '') for item in stack['Parameters']}
        require(all(params.get(key) == value for key, value in {
            'Environment': 'staging', 'BillingEnabled': 'false', 'StripeMode': 'test',
            'OwnerSubject': '', 'WebOrigin': ORIGIN}.items()), 'staging/billing/owner/origin guard')
        outputs = {item['OutputKey']: item['OutputValue'] for item in stack['Outputs']}
        require(outputs.get('UserPoolId') == POOL and outputs.get('UserPoolClientId') == CLIENT and outputs.get('MembershipApiUrl') == API, 'exact staging outputs')
        table = outputs.get('MembershipsTableName', '')
        require(re.fullmatch(STACK + r'-Accounts-[A-Za-z0-9]+', table), 'staging account table prefix')
        physical = {item['LogicalResourceId']: item['PhysicalResourceId'] for item in self.cf.list_stack_resources(StackName=stack['StackId'])['StackResourceSummaries']}
        require(physical.get('Accounts') == table and physical.get('UserPool') == POOL and physical.get('UserPoolClient') == CLIENT and physical.get('MembershipApi') == 'scn2ntfvfa', 'physical resource ownership')
        pool = self.cg.describe_user_pool(UserPoolId=POOL)['UserPool']
        require(pool['Name'] == STACK and not pool.get('LambdaConfig') and pool.get('MfaConfiguration') == 'OFF', 'pool identity and no messaging triggers')
        require(pool['Arn'].split(':')[4] == stack['StackId'].split(':')[4], 'pool AWS account')
        client = self.cg.describe_user_pool_client(UserPoolId=POOL, ClientId=CLIENT)['UserPoolClient']
        require(client['UserPoolId'] == POOL and client['ClientId'] == CLIENT and not client.get('ClientSecret') and client.get('EnableTokenRevocation') is True, 'client identity and revocation')
        require({'ALLOW_USER_PASSWORD_AUTH', 'ALLOW_REFRESH_TOKEN_AUTH'} <= set(client['ExplicitAuthFlows']), 'session auth flows')
        linked = json.loads((ROOT / '.vercel/project.json').read_text())
        require(linked.get('projectId') == PROJECT and linked.get('orgId') == TEAM, 'exact preview project')
        self.table = table
        passed('exact isolated stack, pool, client, preview project; billing off and owner unset')

    def create(self):
        self.create_attempted = True
        result = self.cg.admin_create_user(
            UserPoolId=POOL, Username=self.email, MessageAction='SUPPRESS', ForceAliasCreation=False,
            TemporaryPassword=self.password,
            UserAttributes=[{'Name': 'email', 'Value': self.email}, {'Name': 'email_verified', 'Value': 'true'}])
        user = result['User']
        self.username = user['Username']
        attrs = {item['Name']: item['Value'] for item in user['Attributes']}
        self.subject = attrs.get('sub')
        require(attrs.get('email') == self.email and attrs.get('email_verified') == 'true' and re.fullmatch(r'[a-f0-9-]{36}', self.subject or ''), 'new disposable account identity')
        self.cg.admin_set_user_password(UserPoolId=POOL, Username=self.username, Password=self.password, Permanent=True)
        passed('one disposable admin-confirmed account; invitation suppressed')

    def call(self, action, expected=200, body=None, cookies=None, origin=ORIGIN):
        require(action in ('auth/login', 'auth/refresh', 'auth/logout', 'account', 'download/mac', 'download/windows'), 'HTTP path allowlist')
        path = '/trace/access?action=download&platform=' + action.split('/')[1] if action.startswith('download/') else '/trace/api/' + action
        method = 'GET' if body is None else 'POST'
        sent = dict(self.cookies if cookies is None else cookies)
        self.identities.update(value for value in sent.values() if value)
        config = ['silent', 'show-error', 'include', 'max-time = 30', 'request = ' + json.dumps(method), 'header = "Accept: application/json"']
        if sent:
            config.append('header = ' + json.dumps('Cookie: ' + '; '.join(key + '=' + value for key, value in sent.items())))
        if body is not None:
            config += ['header = "Content-Type: application/json"', 'data = ' + json.dumps(json.dumps(body))]
            if origin is not None:
                config.append('header = ' + json.dumps('Origin: ' + origin))
        # curl does not follow redirects. Credentials only enter private stdin;
        # subprocess diagnostics and response headers are never printed.
        before = int(time.time()) // 300
        result = subprocess.run(['vercel', 'curl', path, '--deployment', ORIGIN, '--', '--config', '-'], input='\n'.join(config) + '\n', text=True, capture_output=True, cwd=ROOT, timeout=45)
        self.buckets.update((before, int(time.time()) // 300))
        require(result.returncode == 0, 'protected request execution')
        head, separator, content = result.stdout.partition('\n\n')
        require(separator and head.startswith('HTTP/'), 'protected response format')
        status = int(head.splitlines()[0].split()[1])
        headers = {}
        received = {}
        for line in head.splitlines()[1:]:
            if ':' not in line:
                continue
            name, value = line.split(':', 1)
            name, value = name.lower(), value.strip()
            if name == 'set-cookie':
                parsed = SimpleCookie(value)
                for key, morsel in parsed.items():
                    require(key in (ACCESS, REFRESH), 'unexpected membership cookie')
                    require(morsel['secure'] and morsel['httponly'] and morsel['samesite'] == 'Lax' and morsel['path'] == '/' and not morsel['domain'], 'secure host-only cookie flags')
                    received[key] = morsel.value
                    if morsel.value:
                        self.identities.add(morsel.value)
            else:
                headers[name] = value
        if headers.get('date'):
            self.buckets.add(int(email.utils.parsedate_to_datetime(headers['date']).timestamp()) // 300)
        require('no-store' in headers.get('cache-control', ''), 'session response must not be cached')
        data = json.loads(content) if content and 'json' in headers.get('content-type', '') else None
        if status != expected:
            diagnostic = {'action': action, 'status': status, 'expected': expected}
            for field in ('date', 'x-vercel-id'):
                value = headers.get(field, '')
                if re.fullmatch(r'[A-Za-z0-9 ,:\-]{1,140}', value):
                    diagnostic[field] = value
            if isinstance(data, dict) and data.get('code') in ('invalid_credentials', 'unauthorized', 'email_not_verified', 'rate_limited', 'service_unavailable'):
                diagnostic['code'] = data['code']
            print('HTTP DIAGNOSTIC ' + json.dumps(diagnostic), flush=True)
            raise RuntimeError('unexpected HTTP status for ' + action + ': ' + str(status))
        if data is not None:
            require(not any(secret in content for secret in self.identities if secret != self.email.lower()), 'token appeared in response JSON')
        return data, received, headers

    def run(self):
        self.guard()
        self.create()
        bad, _, _ = self.call('auth/login', 401, {'email': self.email, 'password': self.password + 'wrong'}, cookies={})
        require(isinstance(bad.get('error'), str), 'wrong password error shape')
        passed('real Cognito rejects wrong password through protected proxy')
        data, cookies, _ = self.call('auth/login', body={'email': self.email, 'password': self.password}, cookies={})
        require(data == {'authenticated': True} and set(cookies) == {ACCESS, REFRESH}, 'login JSON redaction and both cookies')
        self.cookies = cookies
        passed('real sign-in; only Secure HttpOnly cookies, no tokens in JSON')
        account, _, _ = self.call('account')
        require(account.get('email') == self.email and account.get('plan') == 'none' and account.get('status') == 'none', 'free account identity')
        require(all(account.get(key) is False for key in ('traceAccess', 'opponentDecklists', 'admin')), 'no paid or owner privilege')
        require(account.get('capabilities') == {'recordMatches': True, 'leaderboard': True, 'recentReplayDays': 7, 'fullHistory': False, 'expandedSharing': False, 'opponentDecklists': False, 'freeSharesPerWindow': 1, 'shareWindowDays': 7}, 'free capabilities')
        require('activation' not in account, 'no obsolete activation gate')
        passed('verified Free account and exact free capabilities; no paid/owner grant')
        for platform, asset in (('mac', 'Trace_aarch64.dmg'), ('windows', 'Trace_x64-setup.exe')):
            _, _, headers = self.call('download/' + platform, 303)
            require(headers.get('location') == 'https://github.com/DeepTitan/pokemon-tcg-ai/releases/latest/download/' + asset, 'fixed installer redirect')
        passed('Free account receives fixed installer redirects; no installer fetched')
        for origin in (None, 'https://untrusted.example'):
            self.call('auth/logout', 403, {}, origin=origin)
        self.call('account')
        passed('authenticated missing/untrusted Origin blocked without ending session')
        account, renewed, _ = self.call('account', cookies={REFRESH: self.cookies[REFRESH]})
        require(account.get('email') == self.email and set(renewed) == {ACCESS, REFRESH}, 'automatic cookie-only refresh')
        self.cookies = renewed
        passed('missing access cookie refreshes through real Cognito and retries account')
        data, renewed, _ = self.call('auth/refresh', body={})
        require(data == {'authenticated': True} and set(renewed) == {ACCESS, REFRESH}, 'explicit refresh redaction')
        self.cookies = renewed
        passed('explicit refresh keeps credentials out of browser JSON')
        old = dict(self.cookies)
        data, cleared, _ = self.call('auth/logout', body={})
        require(data == {'signedOut': True} and cleared == {ACCESS: '', REFRESH: ''}, 'logout clears both session cookies')
        self.call('account', 401, cookies={ACCESS: old[ACCESS]})
        self.call('auth/refresh', 401, {}, cookies={REFRESH: old[REFRESH]})
        passed('logout revokes access and refresh credentials at Cognito')

    def cleanup(self):
        if not self.create_attempted:
            return
        # Re-read only the unique account created by this run; no scans/deletes of
        # existing users, owner switches, subscriptions, captures or shared data.
        user = self.cg.admin_get_user(UserPoolId=POOL, Username=self.username or self.email)
        attrs = {item['Name']: item['Value'] for item in user['UserAttributes']}
        require(attrs.get('email') == self.email, 'cleanup identity mismatch')
        subject = attrs.get('sub')
        require(subject and (self.subject is None or self.subject == subject), 'cleanup subject mismatch')
        self.cg.admin_user_global_sign_out(UserPoolId=POOL, Username=user['Username'])
        self.cg.admin_delete_user(UserPoolId=POOL, Username=user['Username'])
        key = {'pk': {'S': 'ACCOUNT#' + subject}}
        existing = self.db.get_item(TableName=self.table, Key=key, ConsistentRead=True).get('Item')
        if existing:
            require(existing.get('email', {}).get('S') == self.email and 'customerId' not in existing, 'cleanup account ownership')
            self.db.delete_item(TableName=self.table, Key=key, ConditionExpression='email = :email', ExpressionAttributeValues={':email': {'S': self.email}})
        # Auth rate-limit keys derive only from this newly generated email/tokens.
        for identity in self.identities:
            digest = hashlib.sha256(identity.encode()).hexdigest()
            for bucket in self.buckets:
                self.db.delete_item(TableName=self.table, Key={'pk': {'S': 'RATE#auth:' + digest + '#' + str(bucket)}})
        require(not self.db.get_item(TableName=self.table, Key=key, ConsistentRead=True).get('Item'), 'account cleanup verification')
        try:
            self.cg.admin_get_user(UserPoolId=POOL, Username=user['Username'])
        except self.cg.exceptions.UserNotFoundException:
            passed('disposable Cognito user, account row and own auth-rate rows cleaned up')
        else:
            raise RuntimeError('disposable user remains after cleanup')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--execute', action='store_true')
    parser.add_argument('--profile', default='tcg-training')
    args = parser.parse_args()
    if not args.execute:
        print('Plan only: one SUPPRESS staging user; real protected sign-in/account/refresh/logout; exact cleanup. No calls made.')
        return 0
    runner = Smoke(args.profile)
    success = True
    try:
        runner.run()
    except Exception as error:
        success = False
        # Provider error messages can contain private inputs. Print only our
        # controlled assertion labels; never serialize provider responses.
        print('FAIL ' + (str(error) if type(error) is RuntimeError else type(error).__name__), flush=True)
    finally:
        try:
            runner.cleanup()
        except Exception as error:
            success = False
            print('CLEANUP FAILURE ' + (str(error) if type(error) is RuntimeError else type(error).__name__), flush=True)
    print('Adapter/session test only; no signup email, Stripe, owner, device, game or production operations.', flush=True)
    return 0 if success else 1


if __name__ == '__main__':
    raise SystemExit(main())
