# Private opponent card-pool preview — November 2, 2026

Installed local macOS build `0.1.102+cardpool.1`, based on recording/background
source `720730e`. It reuses the opponent decklist control in Trace. The production
membership service returns an independent `opponentCardPool` capability. Only the
verified owner subject has an enabled flag record; the linked local installation
returned true. Everyone else defaults to false. No desktop public release was
published. Account grants/revocations are documented in the membership README.

Validation:

- 160 membership service tests passed, including explicit subject grants,
  revocation, unlinked devices, invalid credentials, unverified accounts, and
  separation from paid/owner privileges.
- Native suite: 84 passed, one existing environment-dependent test ignored.
  Additional private-fixture audit passed across 22 recent captures / 2,992
  messages. No full deck totals or copy counts were invented.
- Full `tracker:test` suite and production frontend/native build passed.
- Browser fixture verified inferred labels, absent copy/count controls, revoked
  access closing the panel, stale async responses being discarded, rejected access,
  and preserved complete decklists.
- Installed application displayed 23 inferred cards for the latest Shuta_Pokeka
  match. Card art loaded, the quantities disclaimer appeared, and no copy action
  was offered. Game was idle during the update and reopened afterward.
- Production capture/membership endpoint pairing passed. Local ad-hoc app
  signature and relocated helper bundle checks passed.
- Repository-wide TypeScript check still reports existing errors in the engine,
  old fixtures, and CaptureSetupModal icon imports; none are in changed files.

The deployed membership source was byte-identical to this branch's base before
patching. Only `membership.py` and `adapters.py` were replaced; configuration,
billing, and unrelated Lambda code were preserved. Deployed code SHA-256:
`8Jb+sJdA7+4i+9e2G1ohU9S14hSWBCR4lX83HRke+ds=`.

Local rollback bundles, private fixture data, build logs, flag verification, and
the installed hover screenshot are retained in `output/opponent-card-pool/` and
are not committed. The prior installed app is retained there as
`Trace-install-previous.app`. Revoke the account flag to disable inference without
changing Free complete-deck access.
