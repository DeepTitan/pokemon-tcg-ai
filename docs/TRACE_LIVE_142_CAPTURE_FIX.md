# TCG Live 1.42 capture recovery (2026-09-10)

## Reproduced locally

- Installed Trace: 0.1.67. TCG Live Player.log: 1.42.0.1208333.
- Client was visually on Decks/Home, with no match in progress.
- After a fresh launch the client held seven established IPv4 connections to
  the current game API addresses, not the two expected by SafeAttachGuard.
- Trace falsely showed its match-protection dialog and deferred attachment.
- Separately, capture could not arm with the client closed: the manager sent
  pokemon_pid=0, but helper 0.1.11 requires both supplied PIDs to belong to the
  approved user. PID zero cannot satisfy that check.

## Change

For macOS pre-launch routing only, pass Trace's owned PID to the existing
helper when there is no game PID. This satisfies the same ownership check and
allows routing to be established before the client opens sockets. The manager
continues tracking routed_pid=0, retaining its existing sticky-route behavior.
An actual game PID is passed unchanged. No certificate or helper replacement
is needed, and no socket-count threshold was raised to force attachment.

The waiting dialog now explains uncertainty instead of asserting a match is
active. If already on Home, quit the game, wait for Trace to be Ready, and
reopen it. Never restart or reroute during a real match.

## Verification

- Targeted Rust regression passed: absent client uses the app PID; present
  client retains its own PID.
- Capture-status frontend regression passed.
- Frontend and native debug app builds passed.
- Launched patched app using the existing profile and approved helper, then
  launched TCG Live. Trace changed from Ready to Live.
- OS connection inspection confirmed seven connections through Trace's local
  listener and upstream sockets in the reserved 49000+ port range.
- No new TLS errors were appended during this startup test.
- Sep 11, user started the requested match against FugitiveBIake. Trace
  immediately added a recording (archive count 58 -> 59), captured Heads,
  both opening hand counts of seven, and advanced from action 1 to action 3
  as the opponent completed their opening selection (hand count six).
- Full-match completion and final-result persistence remain unverified while
  the user plays. No restart, installation, or route reset was performed
  during the match.

This is a local candidate, not a published release. Existing recordings and
the installed production app have not been removed or overwritten.
