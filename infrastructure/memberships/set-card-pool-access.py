#!/usr/bin/env python3
"""Preview or update one verified account's private card-pool flag. Default: read only."""
import argparse
import datetime
import json
import re


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('subject', help='Verified Cognito subject UUID, never a player name')
    parser.add_argument('--enabled', required=True, choices=['true', 'false'])
    parser.add_argument('--execute', action='store_true')
    args = parser.parse_args()
    if not re.fullmatch(r'[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}', args.subject):
        parser.error('Expected a Cognito subject UUID')
    try:
        import botocore.session as session
    except ImportError:
        import awscli.botocore.session as session
    sdk = session.get_session()
    if sdk.create_client('sts', region_name='us-east-1').get_caller_identity()['Account'] != '108241940679':
        raise SystemExit('Unexpected AWS account')
    stack = sdk.create_client('cloudformation', region_name='us-east-1').describe_stacks(
        StackName='trace-memberships-production')['Stacks'][0]
    table = next(x['OutputValue'] for x in stack['Outputs'] if x['OutputKey'] == 'MembershipsTableName')
    db = sdk.create_client('dynamodb', region_name='us-east-1')
    account = db.get_item(TableName=table, Key={'pk': {'S': 'ACCOUNT#' + args.subject}},
                          ConsistentRead=True).get('Item', {})
    if account.get('emailVerified', {}).get('BOOL') is not True:
        raise SystemExit('Account is absent or its email has not been verified')
    key = {'pk': {'S': 'FEATURE#opponent-card-pool#' + args.subject}}
    before = db.get_item(TableName=table, Key=key, ConsistentRead=True).get('Item', {})
    enabled = args.enabled == 'true'
    if args.execute:
        db.put_item(TableName=table, Item={**key, 'enabled': {'BOOL': enabled},
            'updatedAt': {'S': datetime.datetime.now(datetime.timezone.utc).isoformat()}})
    print(json.dumps({'subject': args.subject, 'email': account.get('email', {}).get('S'),
        'previouslyEnabled': before.get('enabled', {}).get('BOOL') is True,
        'enabled': enabled, 'applied': args.execute}))


if __name__ == '__main__':
    main()
