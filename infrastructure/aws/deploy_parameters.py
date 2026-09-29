#!/usr/bin/env python3
"""Validate capture membership overrides without replacing retained stack parameters."""
import argparse
import json
import os
from pathlib import Path
import re


NAMES = {'TRACE_MEMBERSHIP_API_URL': 'MembershipApiUrl', 'TRACE_REQUIRE_MEMBERSHIP': 'RequireMembership',
         'TRACE_ENVIRONMENT': 'Environment'}


def supplied_overrides(environ):
    result = {parameter: environ[name] for name, parameter in NAMES.items() if name in environ}
    url = result.get('MembershipApiUrl')
    if url is not None and (not isinstance(url, str) or not re.fullmatch(r'|https://[A-Za-z0-9.-]+(?:/[A-Za-z0-9_-]+)*', url)):
        raise ValueError('TRACE_MEMBERSHIP_API_URL must be a fixed HTTPS service URL, without query, credentials or trailing slash.')
    if result.get('RequireMembership', 'false') not in ('true', 'false'):
        raise ValueError('TRACE_REQUIRE_MEMBERSHIP must be explicitly true or false.')
    if 'Environment' in result and not re.fullmatch(r'[a-z0-9-]+', result['Environment']):
        raise ValueError('TRACE_ENVIRONMENT must contain lowercase letters, numbers and hyphens.')
    if environ.get('TRACE_PUBLISH_RELEASE_API', 'false') not in ('true', 'false'):
        raise ValueError('TRACE_PUBLISH_RELEASE_API must be explicitly true or false.')
    return result


def parameter_overrides(existing, environ):
    if not isinstance(existing, list) or any(not isinstance(entry, dict) for entry in existing):
        raise ValueError('Could not read existing capture stack parameters; refusing to guess defaults.')
    retained = {entry['ParameterKey']: entry.get('ParameterValue', '') for entry in existing if 'ParameterKey' in entry}
    supplied = supplied_overrides(environ)
    effective = {'MembershipApiUrl': '', 'RequireMembership': 'false', **retained, **supplied}
    if effective['RequireMembership'] == 'true' and not effective['MembershipApiUrl']:
        raise ValueError('Enforcement requires a supplied or existing MembershipApiUrl. No parameters were changed.')
    # aws cloudformation deploy uses previous values for omitted existing
    # parameters. Never echo/re-submit unrelated or NoEcho parameter values.
    return [f'{key}={value}' for key, value in supplied.items()]


def deployment_settings(existing, environ, stack_name):
    parameter_overrides(existing, environ)
    retained = {entry['ParameterKey']: entry.get('ParameterValue', '') for entry in existing if 'ParameterKey' in entry}
    environment = environ.get('TRACE_ENVIRONMENT', retained.get('Environment'))
    if environment is None:
        if stack_name != 'trace-production':
            raise ValueError('A new noncanonical stack needs an explicit TRACE_ENVIRONMENT (use staging for tests).')
        environment = 'production'
    publish = environ.get('TRACE_PUBLISH_RELEASE_API', 'false') == 'true'
    if publish and (stack_name != 'trace-production' or environment != 'production'):
        raise ValueError('Only the canonical trace-production stack may publish the release API repository variable.')
    return {'environment': environment, 'publishReleaseApi': publish}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('existing', nargs='?', type=Path)
    parser.add_argument('--validate-input', action='store_true')
    parser.add_argument('--stack-name', default='trace-production')
    parser.add_argument('--environment', action='store_true')
    args = parser.parse_args()
    if args.validate_input:
        supplied_overrides(os.environ)
        return
    if args.existing is None:
        parser.error('Pass the existing stack parameter JSON, or --validate-input.')
    existing = json.loads(args.existing.read_text())
    settings = deployment_settings(existing, os.environ, args.stack_name)
    if args.environment:
        print(settings['environment'])
        return
    for override in parameter_overrides(existing, os.environ):
        print(override)


if __name__ == '__main__':
    main()
