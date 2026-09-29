"""Offline guard and mutation-scope checks; no AWS imports or network calls."""
import copy
import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

spec = importlib.util.spec_from_file_location('email_feedback', Path(__file__).with_name('configure-trace-email-feedback.py'))
app = importlib.util.module_from_spec(spec)
spec.loader.exec_module(app)


class FeedbackTests(unittest.TestCase):
    def setUp(self):
        self.pacer = patch.object(app.time, 'sleep')
        self.pacer.start()
        self.addCleanup(self.pacer.stop)
        template = json.loads(app.TEMPLATE.read_text())
        self.template = template
        resources = template['Resources']
        self.attributes = {'ForwardingEnabled': True, 'BounceTopic': '', 'ComplaintTopic': '',
                           'DeliveryTopic': 'existing-delivery-destination'}
        self.subscription = {'Owner': app.ACCOUNT, 'TopicArn': app.TOPIC, 'Protocol': 'email',
                             'Endpoint': app.OWNER, 'SubscriptionArn': app.TOPIC + ':abc-123'}
        self.identity = {'IdentityType': 'DOMAIN', 'VerifiedForSendingStatus': True, 'VerificationStatus': 'SUCCESS',
                         'DkimAttributes': {'Status': 'SUCCESS'}}
        self.account = {'SuppressionAttributes': {'SuppressedReasons': ['BOUNCE', 'COMPLAINT']}}
        self.policy = app.resolved(resources['EmailOperationsPolicy']['Properties']['PolicyDocument'])
        self.writes = []
        self.clients = {
            'sts': SimpleNamespace(get_caller_identity=Mock(return_value={'Account': app.ACCOUNT})),
            'cloudformation': SimpleNamespace(
                describe_stacks=Mock(return_value={'Stacks': [{'StackName': app.STACK, 'StackStatus': 'CREATE_COMPLETE',
                    'StackId': f'arn:aws:cloudformation:{app.REGION}:{app.ACCOUNT}:stack/{app.STACK}/abc-123',
                    'Outputs': [{'OutputKey': 'TopicArn', 'OutputValue': app.TOPIC}]}]}),
                list_stack_resources=Mock(return_value={'StackResourceSummaries': [
                    {'LogicalResourceId': 'EmailOperations', 'PhysicalResourceId': app.TOPIC},
                    *({'LogicalResourceId': key, 'PhysicalResourceId': resources[key]['Properties']['AlarmName']}
                      for key in ('BounceRate', 'ComplaintRate'))]})),
            'sns': SimpleNamespace(
                get_topic_attributes=lambda **kw: {'Attributes': {'Owner': app.ACCOUNT, 'TopicArn': app.TOPIC,
                                                                  'Policy': json.dumps(self.policy)}},
                list_subscriptions_by_topic=lambda **kw: {'Subscriptions': [self.subscription]}),
            'cloudwatch': SimpleNamespace(describe_alarms=Mock(return_value={'MetricAlarms': [
                app.resolved(resources[key]['Properties']) for key in ('BounceRate', 'ComplaintRate')]})),
            'sesv2': SimpleNamespace(get_email_identity=lambda **kw: self.identity, get_account=lambda: self.account),
            'ses': SimpleNamespace(get_identity_notification_attributes=lambda **kw: {'NotificationAttributes': {app.IDENTITY: copy.deepcopy(self.attributes)}},
                                   set_identity_notification_topic=self.set_topic),
        }

    def set_topic(self, **kwargs):
        self.writes.append(kwargs)
        self.attributes[kwargs['NotificationType'] + 'Topic'] = kwargs['SnsTopic']

    def refused_without_writes(self, reason):
        with self.assertRaisesRegex(RuntimeError, reason):
            app.attach(self.clients)
        self.assertEqual(self.writes, [])

    def test_only_two_exact_attachments_and_idempotent_retry(self):
        app.attach(self.clients)
        self.assertEqual(self.writes, [dict(Identity=app.IDENTITY, NotificationType=kind, SnsTopic=app.TOPIC)
                                       for kind in ('Bounce', 'Complaint')])
        self.assertTrue(self.attributes['ForwardingEnabled'])
        self.assertEqual(self.attributes['DeliveryTopic'], 'existing-delivery-destination')
        app.attach(self.clients)
        self.assertEqual(len(self.writes), 2)

    def test_pending_subscription_refuses_all_writes(self):
        self.subscription['SubscriptionArn'] = 'PendingConfirmation'
        self.refused_without_writes('exact_owner_subscription_must_be_confirmed')

    def test_other_recipient_refuses_all_writes(self):
        self.subscription['Endpoint'] = 'someone-else@example.invalid'
        self.refused_without_writes('exact_owner_subscription_must_be_confirmed')

    def test_wrong_account_refuses_before_resource_access(self):
        self.clients['sts'].get_caller_identity.return_value = {'Account': '123456789012'}
        self.refused_without_writes('wrong_aws_account')
        self.clients['cloudformation'].describe_stacks.assert_not_called()

    def test_pending_domain_refuses_all_writes(self):
        self.identity['DkimAttributes']['Status'] = 'PENDING'
        self.refused_without_writes('verified_domain_dkim_required')

    def test_missing_suppression_is_not_silently_enabled(self):
        self.account['SuppressionAttributes']['SuppressedReasons'] = ['BOUNCE']
        self.refused_without_writes('existing_bounce_and_complaint_suppression_required')

    def test_existing_other_topic_is_not_overwritten(self):
        self.attributes['ComplaintTopic'] = app.TOPIC + '-someone-elses'
        self.refused_without_writes('existing_feedback_destination_must_not_be_overwritten')

    def test_headers_and_disabled_forwarding_require_review(self):
        self.attributes['HeadersInBounceNotificationsEnabled'] = True
        self.refused_without_writes('original_headers_must_not_be_enabled')
        self.attributes.pop('HeadersInBounceNotificationsEnabled')
        self.attributes['ForwardingEnabled'] = False
        self.refused_without_writes('email_feedback_forwarding_must_remain_enabled')

    def test_broader_policy_is_not_accepted(self):
        self.policy['Statement'][0]['Condition']['StringEquals']['AWS:SourceArn'] = '*'
        self.refused_without_writes('reviewed_topic_policy_required')

    def test_disabled_alarm_is_not_accepted(self):
        self.clients['cloudwatch'].describe_alarms.return_value['MetricAlarms'][0]['ActionsEnabled'] = False
        self.refused_without_writes('reviewed_alarm_configuration_required')

    def test_midflight_drift_stops_second_write(self):
        original = self.clients['ses'].set_identity_notification_topic
        def changed_destination(**kwargs):
            original(**kwargs)
            self.attributes['ComplaintTopic'] = app.TOPIC + '-changed-during-run'
        self.clients['ses'].set_identity_notification_topic = changed_destination
        with self.assertRaisesRegex(RuntimeError, 'existing_feedback_destination_must_not_be_overwritten'):
            app.attach(self.clients)
        self.assertEqual(len(self.writes), 1)

    def test_template_scope_no_iam_lambda_sender_or_suppression_resource(self):
        resources = self.template['Resources']
        self.assertEqual(len(resources), 5)
        self.assertEqual({r['Type'] for r in resources.values()},
                         {'AWS::SNS::Topic', 'AWS::SNS::Subscription', 'AWS::SNS::TopicPolicy', 'AWS::CloudWatch::Alarm'})
        self.assertTrue(all(r['Condition'] == 'ExactAccountAndRegion' for r in resources.values()))
        self.assertEqual(resources['OwnerSubscription']['Properties']['Endpoint'], app.OWNER)
        self.assertEqual(resources['BounceRate']['Properties']['Threshold'], .05)
        self.assertEqual(resources['ComplaintRate']['Properties']['Threshold'], .001)


if __name__ == '__main__':
    unittest.main()
