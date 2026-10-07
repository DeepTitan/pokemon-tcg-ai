# Trace study access — September 29, 2026

Free: public game state, own hand, and opponent starting decklists as soon as a complete list and player identity are captured, including during the match; deck and prize counts remain visible. Pro: own decklist, deck contents, and prize inspection. Supporters: Pro plus exclusive Discord access/support and early features/nightly releases. Existing free replay/share limits remain unchanged.

Locked decklist controls open an explanation on hover, keyboard focus or click. Own-deck upgrade panels offer Get Trace Pro. The opponent control opens the captured list during or after the match. Missing or incomplete captures show an unavailable message. Own deck/prize inspection opens the dismissible Pro upgrade dialog with an account-link alternative.

Native IPC and capture events use the validated membership lease to project inventories. Raw stored captures stay intact. Cloud replay reads check current membership and mask inventory if it cannot be verified, without denying recent Free replays. Public replay shares mask deck/prize inventories. Paid content is not added to match summaries.

Verification: browser-only fixture at /study-access-preview.html; tracker production build; native deck_access tests; cloud privacy/freemium tests. No Pokémon client or capture process launched.

Production cloud access controls deployed successfully on September 29, 2026 (`trace-production`, UPDATE_COMPLETE). Production Google OAuth is published for external users and enabled at victoryroad.app; both email-code login and Google login completed in the production browser. Existing signed-in users redirect from the login route to their account. Google requests only sign-in profile/email scopes.

Desktop 0.1.91 published September 29, 2026 at 19:57 UTC. Source `35acb2e52b21ba6e18094a15ed04cf9eca7f2a6c` was fast-forwarded to main and released through its existing signing trust. Workflow `36621511221` succeeded for both platforms, including Apple notarization and trusted Windows publisher verification. The public latest.json reports 0.1.91 with signed macOS Apple-silicon and Windows x64 artifacts. Earlier feature-branch signing failed before publication; no signing permissions were expanded.

Validation: full tracker setup/regression suite passed; native library tests 59 passed/1 ignored; cloud tests 66 passed; website membership tests 30 passed. Production capture and membership endpoints remain paired to their existing stacks. No game client was launched.
