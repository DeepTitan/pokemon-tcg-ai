# Device support status

Run `python3 scripts/diagnostics/device_status.py AudioPusher` with read-only AWS credentials, or use `--device UUID`. All matching recorder devices are returned. The lookup uses existing uploaded player names; a new installation with no uploads needs its device ID.

The desktop sends `/v1/diagnostics` at startup and every 60 seconds after the previous request completes, independently of match uploads or membership. It reports the compiled app version, OS/architecture, capture permission/enabled/observer/route/client/match flags, cumulative process traffic counters, whether capture has an error, and pending/successful upload counts. Database failures report unknown counts rather than zero. Network failures are best-effort, bounded, and retry on the next heartbeat; authentication gets one credential recovery attempt.

The authenticated endpoint overwrites only the latest diagnostic snapshot on the private device record, with a server receipt timestamp. Unknown fields are dropped. No raw error text, packets, local paths, replay contents, or credentials are included. Reports older than three minutes are marked stale; they do not prove that the app is closed or offline. Older clients have unknown status until updated. No public diagnostic read endpoint is added.

A recent heartbeat with missing permission or an inactive observer/route narrows capture setup problems. An attached client with counters advancing shows traffic reaching capture. A growing upload queue points toward sync trouble. Counters reset on app restart. Compare reports over time; an idle game alone is not evidence of broken capture.

Deployment requires the updated backend Lambda and POST route, then a signed desktop release carrying this client change. Deploy the backend first. Preserve the deployed match stream, membership settings and unrelated release work; do not deploy the parent workspace or replace the production stack from a stale template. This change does not retrofit diagnostics into already installed clients.

## Fix Trace

Settings now includes Fix Trace. It uses the existing updater instance to check for signed updates and offers installation through the existing controls. When current (or when the update service cannot be reached), it invokes the native repair command. The command refuses capture changes while TCG Live is running, requests missing capture permission, rechecks the game process after permission dialogs, requests a safe reconnect through the existing capture manager, and releases retry delays for pending uploads. One bounded upload sweep runs; remaining queued uploads are reported and continue in the background. Recording preferences are retained as enabled after successful repair startup. No archive, credentials, or capture history is deleted. OS permission dialogs still require the player's approval. This is not proof of end-to-end game traffic: readiness is verified locally and the player must open TCG Live for the next capture.

Validation: `npm run tracker:test-setup`, `npm run tracker:build`, and `cargo test --manifest-path src-tauri/Cargo.toml --lib --no-default-features`. The desktop socket tests require loopback access. Production availability requires shipping a new desktop build; a website deploy alone cannot add this button.
