import json
import unittest
from unittest.mock import Mock, patch
from test_shared_replay import app


def payload():
    return {'schema': 1, 'appVersion': '0.1.33', 'platform': 'windows', 'architecture': 'x86_64',
            'capture': {**{key: False for key in ('permissionReady', 'enabled', 'observerRunning',
                'routeActive', 'clientAttached', 'waitingForMatchEnd', 'matchInProgress', 'hasError')},
                'frameCount': 12, 'operationCount': 4}, 'pendingUploads': 2, 'uploadedMatches': 27}


def event(body):
    return {'rawPath': '/v1/diagnostics', 'requestContext': {'http': {'method': 'POST'}}, 'body': json.dumps(body)}


class DiagnosticsTests(unittest.TestCase):
    def test_authenticated_report_drops_private_fields(self):
        body = payload(); body.update(deviceId='victim', token='secret', logs='private')
        body['capture']['lastError'] = '/private/path'
        with patch.object(app, 'authorize', return_value='device'), patch.object(app, 'devices') as table, patch.object(app, 'timestamp', return_value='server-time'):
            self.assertEqual(app.handler(event(body), None)['statusCode'], 200)
            args = table.update_item.call_args.kwargs
            self.assertEqual(args['Key'], {'deviceId': 'device'})
            self.assertEqual(args['ExpressionAttributeNames'], {'#diagnostics': 'diagnostics'})
            self.assertIn('#diagnostics = :report', args['UpdateExpression'])
            self.assertEqual(args['ExpressionAttributeValues'], {':report': payload(), ':now': 'server-time'})

    def test_unauthorized_cannot_write(self):
        with patch.object(app, 'authorize', return_value=None), patch.object(app, 'devices') as table:
            self.assertEqual(app.handler(event(payload()), None)['statusCode'], 401)
            table.update_item.assert_not_called()

    def test_invalid_reports_never_write(self):
        invalid = [[], {}, {**payload(), 'schema': True}, {**payload(), 'appVersion': 'x' * 65}, {**payload(), 'pendingUploads': -1}, {**payload(), 'pendingUploads': True}]
        for key, value in [('frameCount', -1), ('operationCount', 1.2), ('enabled', 'yes')]:
            body = payload(); body['capture'][key] = value; invalid.append(body)
        with patch.object(app, 'authorize', return_value='device'), patch.object(app, 'devices') as table:
            for body in invalid:
                with self.subTest(body=body):
                    self.assertEqual(app.handler(event(body), None)['statusCode'], 400)
            table.update_item.assert_not_called()

    def test_unknown_queue_counts(self):
        body = payload(); body['pendingUploads'] = None; body['uploadedMatches'] = None
        with patch.object(app, 'devices'):
            self.assertEqual(app.put_diagnostics('device', event(body))['statusCode'], 200)
