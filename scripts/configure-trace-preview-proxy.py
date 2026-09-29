#!/usr/bin/env python3
"""Create the dedicated Trace proxy secret in Vercel Preview, from private stdin.

Offline by default. --execute requires an explicitly dispatched staging change.
Never reads existing environment values, token files or secret stores. No deploy.
"""
import argparse
import json
from pathlib import Path
import re
import subprocess
import sys

PROJECT = 'prj_xu8lQXM29IgPY7fLDvbkT4qah4Ta'
TEAM = 'team_6rqfBuaO0W1ndg07WpRuoUv0'
KEY = 'TRACE_MEMBERSHIP_PROXY_SECRET'
ROOT = Path(__file__).resolve().parent.parent


def configure(value, runner=None, root=ROOT):
    runner = runner or subprocess.run
    # A generated hex/base64url key is sufficient. Reject whitespace/control
    # characters rather than normalizing an unintended credential silently.
    if not isinstance(value, str) or not re.fullmatch(r'[A-Za-z0-9_-]{43,512}', value):
        raise ValueError('Expected a generated 43–512 character hex or base64url proxy key.')
    project = json.loads((root / '.vercel/project.json').read_text())
    if project.get('projectId') != PROJECT or project.get('orgId') != TEAM:
        raise ValueError('Local Vercel project does not match the staging allowlist.')
    body = {'key': KEY, 'value': value, 'type': 'sensitive', 'target': ['preview']}
    # No upsert, force, branch override, production target or credential-bearing
    # argument. Existing keys are a review-required failure, never overwritten.
    command = ['vercel', 'api', f'/v10/projects/{PROJECT}/env?teamId={TEAM}',
               '--method', 'POST', '--header', 'Content-Type: application/json',
               '--input', '-', '--raw', '--non-interactive']
    try:
        result = runner(command, input=json.dumps(body), text=True, capture_output=True,
                        cwd=root, timeout=45)
        if result.returncode != 0:
            raise RuntimeError('Preview secret creation was not confirmed. Check names/metadata only before retrying; existing variables are not overwritten.')
        response = json.loads(result.stdout)
        created = response.get('created')
        if (response.get('failed') or not isinstance(created, dict)
                or created.get('key') != KEY or created.get('type') != 'sensitive'
                or created.get('target') != ['preview'] or created.get('gitBranch')
                or created.get('customEnvironmentIds')):
            raise RuntimeError('Preview secret response did not confirm the exact target. Inspect names/metadata before proceeding.')
    except (subprocess.TimeoutExpired, OSError, json.JSONDecodeError):
        # A lost response can follow a successful write. Do not print provider
        # output or automatically retry and risk replacing unknown state.
        raise RuntimeError('Preview secret write has an unconfirmed result. Inspect names/metadata only before retrying.') from None
    return {'key': KEY, 'target': ['preview'], 'type': 'sensitive'}


def main(argv=None, stdin=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--execute', action='store_true')
    args = parser.parse_args(argv)
    if not args.execute:
        print('Plan only: create TRACE_MEMBERSHIP_PROXY_SECRET as sensitive in Trace Preview. No stdin read or remote call.')
        return 0
    source = stdin or sys.stdin
    if source.isatty():
        print('Refusing terminal input: supply the generated key through a private pipe.', file=sys.stderr)
        return 1
    try:
        value = source.read(514)
        if value.endswith('\n'):
            value = value[:-1]
        result = configure(value)
    except Exception:
        # Even unexpected CLI exceptions can contain submitted input. Keep the
        # public result constant and discard all subprocess stdout/stderr.
        print('Preview secret creation not confirmed. No provider output shown; inspect names/metadata before retrying.', file=sys.stderr)
        return 1
    print(json.dumps(result))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
