# Client-close profile history release — November 2, 2026

Source commit: `45283f5`.
Web deployment: `dpl_7me4MgNbZjG3oYJFarK97j29uGT1`, https://victoryroad-r8cgav435-deeptitan-6729s-projects.vercel.app, promoted to the existing Victory Road production target.
Worker snapshot generation: `88df2f175e0f9fd660fcdb59fce105a5513e815562601a54cf72f826830d6d07`.

Added a separately projected `clientExitMatches` collection to the public feed. These unconfirmed records do not enter Trace replay. Profile history merges them chronologically with confirmed ranked games, labels them Client closed, shows a dash for Trace points and the calculated Live Elo adjustment. Tooltips explain the inferred result and calculated before/after ratings. Profile totals are labeled Trace record and Trace matches; the history disclosure explains which records count.

The public allowlist strips private source/deck/log fields from the new collection. Browser validation checks the new collection and refresh fingerprints include history-only changes. Duplicate, conflicting and superseded confirmed outcomes remain protected by the exporter.

Validation:
- Compared 2440 production source projections: 2331 confirmed matches and all Trace replay results unchanged; 32 eligible client-close games included separately.
- Regression checks cover identity, duplicate handling, conflicting ratings, newer observations, confirmed-result precedence, recursive privacy projection and public round trips.
- All 7 snapshot refresh tests passed, including a history-only update and malformed client-close input. Worker/public projection tests, strict frontend TypeScript check, production build and 22 website feed/page/preview tests passed.
- Browser checks against the canonical production site passed at 1280px and 390px with no page errors or horizontal page overflow. Verified oMatt vs g1zm0m0 and isaiahw vs seality5 each display Loss / Client closed / no Trace points / −13 Live Elo.
- Production screenshots and previous worker package are retained in ignored `artifacts/client-close-history-release-20261102/`.

Original archived matches and the Live calculation formula were not altered. Prior worker assets/configuration were retained byte-for-byte. To roll back the web change, promote the previous production deployment; to remove the additional feed collection, restore the prior worker archive with a current revision precondition and invoke rebuild.
