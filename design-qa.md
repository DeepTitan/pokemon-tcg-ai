# Trace account rows with automatic platform selection

Visual target: selected compact-row concept, revised to keep macOS and Windows equally visible.
Source: /Users/theisaiahw/.codex/generated_images/01a0f04b-8185-7403-b07c-7cdeb1a433b9/exec-b0939aad-3251-4b0e-a66e-0ec055c962f9.png

Implemented locally: compact account rows, lighter UI typography, always-visible platform buttons, one matching installer link, automatic desktop OS selection, explicit neutral choice for phones/unknown systems, and manual overrides retained during account refresh.

Verification: 62 account, checkout, and membership tests pass. Platform cases cover Windows UA and platform hints, macOS, iPad desktop mode, iPhone, Android, Linux/unknown, explicit installer query, and manual switching in both directions. Syntax and whitespace checks pass. The existing local fixture server is running on port 5195.

Visual comparison remains unavailable: the browser tool previously rejected access to this local preview under its URL security policy. No alternate browser mechanism was used. No desktop/mobile screenshot comparison or visual pass is claimed. The user reviewed the running local preview and explicitly approved production release on September 30, 2026 ("looks great lets ship it"). This approval supersedes the automated visual gate for this release; it does not constitute an automated screenshot comparison.

final result: user-approved for release; automated visual comparison blocked

## Production release — September 30, 2026

- Deployed application commit `2810f50` to `https://victoryroad-i8v91ufae-deeptitan-6729s-projects.vercel.app`, aliased by the existing public site.
- Public account URL `https://victoryroad.app/trace/account` returns 200 with private/no-store caching.
- Verified public JS, CSS, download icon, both platform icons, and all three UI font weights match the release bytes.
- Fixed a public-domain proxy limitation discovered after deployment: nested font paths returned 404 while direct origin paths worked. CSS now requests the fonts at the supported flat public asset paths.
- Both signed-out installer endpoints return 303 to sign-in while preserving the selected platform.
- The deployment error-log query returned zero entries at verification time.
- Browser screenshot comparison remains unverified; the user approved the local appearance before release.
