#!/usr/bin/env python3
"""Read-only support lookup; requires AWS access and never prints credentials."""
import argparse
import datetime as dt
import json
import subprocess


def aws(*args):
    return json.loads(subprocess.check_output(['aws', *args, '--region', 'us-east-1', '--output', 'json']))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('player', nargs='?', help='Case-insensitive player name')
    parser.add_argument('--device', help='Device ID for installations with no uploaded games')
    args = parser.parse_args()
    if not args.player and not args.device:
        parser.error('provide a player name or --device')
    outputs = aws('cloudformation', 'describe-stacks', '--stack-name', 'trace-production')['Stacks'][0]['Outputs']
    tables = {item['OutputKey']: item['OutputValue'] for item in outputs}
    ids = {args.device} if args.device else set()
    if args.player:
        rows = aws('dynamodb', 'scan', '--table-name', tables['MatchesTable'], '--projection-expression', 'deviceId,localPlayer')['Items']
        ids.update(row['deviceId']['S'] for row in rows if row.get('localPlayer', {}).get('S', '').casefold() == args.player.casefold())
    for device in sorted(ids):
        item = aws('dynamodb', 'get-item', '--table-name', tables['DevicesTable'], '--consistent-read', '--key', json.dumps({'deviceId': {'S': device}}), '--projection-expression', 'deviceId,lastSeenAt,#diagnostics,diagnosticsReceivedAt', '--expression-attribute-names', json.dumps({'#diagnostics': 'diagnostics'})).get('Item', {})
        received = item.get('diagnosticsReceivedAt', {}).get('S')
        age = (dt.datetime.now(dt.timezone.utc) - dt.datetime.fromisoformat(received.replace('Z', '+00:00'))).total_seconds() if received else None
        print(json.dumps({'deviceId': device, 'reportAgeSeconds': age, 'freshness': 'unknown' if age is None else ('recent' if age < 180 else 'stale'), 'item': item}, indent=2))
    if not ids:
        print('No uploaded matches found. Use --device if available.')


if __name__ == '__main__':
    main()
