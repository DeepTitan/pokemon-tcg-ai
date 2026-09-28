#!/usr/bin/env python3
"""Validate offline by default; deploy only with --execute. No secret retrieval or Stripe writes."""
import argparse
import json
from pathlib import Path
import re
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parent
PARAMETERS = {'Environment', 'CaptureDevicesTableName', 'BillingEnabled', 'StripeMode', 'StripeSecretArn',
              'TracePriceId', 'SupporterPriceId', 'StripePortalConfigId', 'OwnerSubject'}


def validate(config, allow_live=False):
    if not isinstance(config, dict) or set(config) != {'stackName', 'region', 'profile', 'artifactBucket', 'parameters'}:
        raise ValueError('Use the complete config.example.json shape; raw secrets are not configuration fields.')
    params = config['parameters']
    if not isinstance(params, dict) or set(params) != PARAMETERS or any(not isinstance(v, str) for v in params.values()):
        raise ValueError('Configuration needs exactly the documented string parameters.')
    for name, pattern in {'stackName': r'[A-Za-z][A-Za-z0-9-]{0,127}', 'region': r'[a-z]{2}-[a-z]+-\d',
                          'profile': r'[A-Za-z0-9_.-]+', 'artifactBucket': r'[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]'}.items():
        if not isinstance(config[name], str) or not re.fullmatch(pattern, config[name]):
            raise ValueError(f'Invalid {name}.')
    if params['BillingEnabled'] not in {'true', 'false'} or params['StripeMode'] not in {'test', 'live'}:
        raise ValueError('Invalid BillingEnabled or StripeMode.')
    if params['OwnerSubject'] and not re.fullmatch(r'[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}', params['OwnerSubject']):
        raise ValueError('OwnerSubject must be the verified Cognito UUID, never an email/name.')
    if params['BillingEnabled'] == 'true':
        for name in ('StripeSecretArn', 'TracePriceId', 'SupporterPriceId', 'StripePortalConfigId'):
            if not params[name]:
                raise ValueError(f'Billing needs {name}.')
        if params['TracePriceId'] == params['SupporterPriceId']:
            raise ValueError('Plan prices must differ.')
    if params['StripeMode'] == 'live' and params['BillingEnabled'] == 'true' and not allow_live:
        raise ValueError('Live billing additionally requires --allow-live-billing after end-to-end sandbox verification.')
    if any(value.startswith(('sk_', 'rk_', 'whsec_')) for value in params.values()):
        raise ValueError('Raw Stripe secrets must never appear in this file.')
    return params


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('config', type=Path)
    parser.add_argument('--execute', action='store_true')
    parser.add_argument('--allow-live-billing', action='store_true')
    args = parser.parse_args()
    config = json.loads(args.config.read_text())
    params = validate(config, args.allow_live_billing)
    subprocess.run(['python3', '-m', 'unittest', 'discover', '-s', str(ROOT / 'tests'), '-v'], check=True)
    if not args.execute:
        print(f'Validated {config["stackName"]}. No cloud changes made. Use --execute to deploy.')
        return
    aws = ['aws', '--profile', config['profile'], '--region', config['region']]
    with tempfile.TemporaryDirectory(prefix='trace-membership-deploy-') as directory:
        packaged = Path(directory) / 'packaged.yml'
        subprocess.run(aws + ['cloudformation', 'package', '--template-file', str(ROOT / 'template.yml'),
                             '--s3-bucket', config['artifactBucket'], '--output-template-file', str(packaged)], check=True)
        subprocess.run(aws + ['cloudformation', 'deploy', '--template-file', str(packaged),
                             '--stack-name', config['stackName'], '--capabilities', 'CAPABILITY_IAM',
                             '--no-fail-on-empty-changeset', '--parameter-overrides'] +
                             [f'{key}={value}' for key, value in params.items()], check=True)
    subprocess.run(aws + ['cloudformation', 'describe-stacks', '--stack-name', config['stackName'],
                         '--query', 'Stacks[0].Outputs', '--output', 'json'], check=True)


if __name__ == '__main__':
    main()
