#!/usr/bin/env python3
"""Fixed Trace SES feedback attachment. Offline plan by default; no email sends.

--check performs read-only preflight. --execute performs that preflight then
attaches Bounce/Complaint topics. Deploy the separately reviewed stack first.
Run with the AWS CLI Python runtime; credentials remain inside its SDK session.
"""
import argparse
import json
from pathlib import Path
import re
import time

ACCOUNT = '108241940679'
REGION = 'us-east-1'
STACK = 'trace-email-operations'
IDENTITY = 'victoryroad.app'
OWNER = 'williamsbyronik@gmail.com'
TOPIC = f'arn:aws:sns:{REGION}:{ACCOUNT}:{STACK}'
TEMPLATE = Path(__file__).resolve().parents[2] / 'infrastructure/memberships/email-operations.json'


def require(condition, reason):
    if not condition:
        raise RuntimeError(reason)


def notification_guard(attributes):
    require(attributes.get('ForwardingEnabled') is True, 'email_feedback_forwarding_must_remain_enabled')
    for kind in ('Bounce', 'Complaint'):
        require(attributes.get(kind + 'Topic', '') in ('', TOPIC), 'existing_feedback_destination_must_not_be_overwritten')
        require(attributes.get('HeadersIn' + kind + 'NotificationsEnabled', False) is False,
                'original_headers_must_not_be_enabled')


def resolved(value):
    if value == {'Ref': 'EmailOperations'}:
        return TOPIC
    if isinstance(value, dict):
        return {key: resolved(item) for key, item in value.items()}
    if isinstance(value, list):
        return [resolved(item) for item in value]
    return value


def ses_request(client, operation, **kwargs):
    # SES identity notification operations are limited to one call per second.
    time.sleep(1.05)
    return getattr(client, operation)(**kwargs)


def preflight(clients):
    require(clients['sts'].get_caller_identity()['Account'] == ACCOUNT, 'wrong_aws_account')
    stack = clients['cloudformation'].describe_stacks(StackName=STACK)['Stacks']
    require(len(stack) == 1 and stack[0].get('StackName') == STACK
            and re.fullmatch(rf'arn:aws:cloudformation:{REGION}:{ACCOUNT}:stack/{STACK}/[A-Za-z0-9-]+', stack[0].get('StackId', ''))
            and stack[0].get('StackStatus') in ('CREATE_COMPLETE', 'UPDATE_COMPLETE'), 'exact_completed_stack_required')
    outputs = {item['OutputKey']: item['OutputValue'] for item in stack[0].get('Outputs', [])}
    require(outputs.get('TopicArn') == TOPIC, 'unexpected_stack_topic')
    resources = clients['cloudformation'].list_stack_resources(StackName=stack[0]['StackId'])
    require(not resources.get('NextToken'), 'unexpected_stack_resource_pagination')
    physical = {item['LogicalResourceId']: item['PhysicalResourceId'] for item in resources['StackResourceSummaries']}
    require(physical.get('EmailOperations') == TOPIC, 'topic_must_belong_to_exact_stack')
    template = json.loads(TEMPLATE.read_text())['Resources']
    topic = clients['sns'].get_topic_attributes(TopicArn=TOPIC)['Attributes']
    require(topic.get('Owner') == ACCOUNT and topic.get('TopicArn') == TOPIC, 'wrong_topic_owner')
    require(json.loads(topic.get('Policy', '{}')) == resolved(template['EmailOperationsPolicy']['Properties']['PolicyDocument']),
            'reviewed_topic_policy_required')
    subscriptions = clients['sns'].list_subscriptions_by_topic(TopicArn=TOPIC)
    require(not subscriptions.get('NextToken'), 'unexpected_subscription_pagination')
    rows = subscriptions.get('Subscriptions', [])
    require(len(rows) == 1 and rows[0].get('Owner') == ACCOUNT and rows[0].get('TopicArn') == TOPIC
            and rows[0].get('Endpoint') == OWNER and rows[0].get('Protocol') == 'email'
            and re.fullmatch(re.escape(TOPIC) + r':[A-Za-z0-9-]+', rows[0].get('SubscriptionArn', '')),
            'exact_owner_subscription_must_be_confirmed')
    names = [template[key]['Properties']['AlarmName'] for key in ('BounceRate', 'ComplaintRate')]
    alarms = clients['cloudwatch'].describe_alarms(AlarmNames=names)
    require(not alarms.get('NextToken') and not alarms.get('CompositeAlarms'), 'unexpected_alarm_response')
    by_name = {item['AlarmName']: item for item in alarms.get('MetricAlarms', [])}
    require(set(by_name) == set(names), 'both_reputation_alarms_required')
    for key in ('BounceRate', 'ComplaintRate'):
        expected = resolved(template[key]['Properties'])
        alarm = by_name[expected['AlarmName']]
        require(physical.get(key) == expected['AlarmName'], 'alarm_must_belong_to_exact_stack')
        require(not alarm.get('Dimensions') and not alarm.get('Metrics'), 'account_level_reputation_metric_required')
        require(all(alarm.get(field) == value for field, value in expected.items() if field != 'AlarmDescription'),
                'reviewed_alarm_configuration_required')
    identity = clients['sesv2'].get_email_identity(EmailIdentity=IDENTITY)
    require(identity.get('IdentityType') == 'DOMAIN' and identity.get('VerifiedForSendingStatus') is True
            and identity.get('VerificationStatus') == 'SUCCESS'
            and identity.get('DkimAttributes', {}).get('Status') == 'SUCCESS', 'verified_domain_dkim_required')
    account = clients['sesv2'].get_account()
    require(set(account.get('SuppressionAttributes', {}).get('SuppressedReasons', [])) == {'BOUNCE', 'COMPLAINT'},
            'existing_bounce_and_complaint_suppression_required')
    attributes = ses_request(clients['ses'], 'get_identity_notification_attributes', Identities=[IDENTITY]).get('NotificationAttributes', {})
    require(set(attributes) == {IDENTITY}, 'exact_domain_notification_attributes_required')
    notification_guard(attributes[IDENTITY])
    return attributes[IDENTITY]


def attach(clients):
    preflight(clients)
    for kind in ('Bounce', 'Complaint'):
        # Recheck immediately before each write; SES offers no conditional update.
        current = ses_request(clients['ses'], 'get_identity_notification_attributes', Identities=[IDENTITY])['NotificationAttributes'][IDENTITY]
        notification_guard(current)
        if current.get(kind + 'Topic') != TOPIC:
            ses_request(clients['ses'], 'set_identity_notification_topic', Identity=IDENTITY, NotificationType=kind, SnsTopic=TOPIC)
    final = preflight(clients)
    require(all(final.get(kind + 'Topic') == TOPIC for kind in ('Bounce', 'Complaint')), 'feedback_attachment_readback_failed')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument('--check', action='store_true', help='read-only AWS preflight')
    modes.add_argument('--execute', action='store_true', help='attach only exact Bounce/Complaint topics after preflight')
    args = parser.parse_args()
    if not (args.check or args.execute):
        print(json.dumps({'mode': 'offline_plan', 'account': ACCOUNT, 'region': REGION, 'stack': STACK,
                          'identity': IDENTITY, 'topic': TOPIC, 'notificationTypes': ['Bounce', 'Complaint'],
                          'writesRequireExecute': True, 'sendsEmail': False}))
        return
    stage = 'sdk_setup'
    try:
        from awscli.botocore.session import Session
        from awscli.botocore.config import Config
        session = Session(profile='default')
        config = Config(retries={'max_attempts': 1}, connect_timeout=5, read_timeout=20, ignore_configured_endpoint_urls=True)
        clients = {name: session.create_client(name, region_name=REGION, config=config)
                   for name in ('sts', 'cloudformation', 'sns', 'cloudwatch', 'ses', 'sesv2')}
        stage = 'attach' if args.execute else 'preflight'
        (attach if args.execute else preflight)(clients)
        print(json.dumps({'status': 'passed', 'stage': stage, 'emailSentByHelper': False}))
    except Exception as error:
        # Do not print raw provider messages or notification contents.
        reason = str(error) if isinstance(error, RuntimeError) and re.fullmatch(r'[a-z_]+', str(error)) else type(error).__name__
        print(json.dumps({'status': 'failed', 'stage': stage, 'reason': reason}))
        raise SystemExit(1)


if __name__ == '__main__':
    main()
