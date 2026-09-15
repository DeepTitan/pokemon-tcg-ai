# Single-action Trace setup

Implemented in an isolated checkout based on `926ac85` to preserve unrelated workspace changes. Not deployed.

- Keyboard demo and capture disclosure retained.
- One full-width Set up Trace button; no separate update control or skip action.
- Explicit checking, update, restart, close-Live, permission, connecting, error/retry and ready/Done states.
- Escape only dismisses after successful setup.
- Existing capture approval is reused instead of requesting it again.
- Update check failures and declined permissions remain visible, with retry.
- Live process checks guard setup, installation and restart, including Live opening during a download.
- Operation lock prevents duplicate setup on rapid clicks.
- Background update notice is not mounted during setup.

Verification: `npm run tracker:test-setup`, full `npm run tracker:test` and `npm run tracker:build` pass. Browser preview confirms the full-width button responds and failures appear inside the modal. Repository-wide TypeScript checking has existing errors outside the changed implementation; no errors reported for the changed setup files or TrackerApp.

This is not a verification of fresh-install macOS permissions or real Pokémon TCG Live capture. Those still require the interactive remote Mac/test-account environment discussed with the user. No release was triggered and no local capture permissions or upload settings were changed.

Preview: run Vite, then open `/setup-preview.html`. Browser-only setup deliberately reports that capture requires the installed app.
