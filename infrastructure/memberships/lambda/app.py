import json
import os

from membership import ApiError, Config, MembershipService

_service = None


def service():
    global _service
    if _service is None:
        from adapters import Cognito, Store, Stripe
        config = Config(pool_id=os.environ['USER_POOL_ID'], client_id=os.environ['USER_POOL_CLIENT_ID'],
                        region=os.environ['AWS_REGION'], owner_subject=os.environ.get('OWNER_SUBJECT', ''),
                        billing_enabled=os.environ.get('BILLING_ENABLED') == 'true',
                        stripe_live=os.environ.get('STRIPE_MODE') == 'live',
                        trace_price=os.environ.get('TRACE_PRICE_ID', ''),
                        supporter_price=os.environ.get('SUPPORTER_PRICE_ID', ''),
                        web_origin=os.environ.get('WEB_ORIGIN', 'https://victoryroad.app'))
        _service = MembershipService(config,
            Store(os.environ['MEMBERSHIPS_TABLE'], os.environ['CAPTURE_DEVICES_TABLE'], os.environ['OWNER_SWITCH_TABLE']),
            Cognito(config), Stripe(os.environ.get('STRIPE_SECRET_ARN', ''), os.environ.get('STRIPE_PORTAL_CONFIG_ID', ''), config.stripe_live, config.web_origin))
    return _service


def handler(event, context):
    try:
        payload = service().handle(event)
        status = 200
    except ApiError as error:
        status, payload = error.status, {'error': error.code}
    except Exception as error:
        # No exception message/body/header logging: upstream errors may include credentials.
        print(json.dumps({'level': 'error', 'type': type(error).__name__,
                          'requestId': getattr(context, 'aws_request_id', None)}))
        status, payload = 503, {'error': 'service_unavailable'}
    return {'statusCode': status, 'headers': {'Content-Type': 'application/json', 'Cache-Control': 'no-store',
                                             'X-Content-Type-Options': 'nosniff'},
            'body': json.dumps(payload, separators=(',', ':'))}
