# Trace apex routing release plan

Prepared locally on 2026-09-28 and published on 2026-09-29. The original preparation used GET requests only; the production checkpoint below records the subsequent authorized publication. The old film checkout was not redeployed to obtain these routes.

## Production checkpoint — 2026-09-29

Live routing version is `578c870d-ca80-414b-bb6e-40d37084ec3e`, with exactly 11 rules and no staged version. All nine original film/public routes retain their definitions and relative order. The stable Trace upstream points to deployment `dpl_FU7u55HPXzfw5hJNhxuPgLdSTfcw` (committed source `110789d00e59b0b126db2891ddc1f105d1003a35`). The unrelated local `landing/training/dashboard.js` edit was excluded from its clean source archive.

The initial 11-rule version `c4b57cb8-ff32-403c-accd-7d0cc98c1810` used `:action*` in the raw project-rule destination. Canonical account requests reached the proxy but returned its JSON 404, while the same request directly to the upstream returned 401. Changing only that destination to `https://victoryroad-lovat.vercel.app/trace/api/$1` restored action dispatch: staged and canonical account GETs return 401, and nested login routes respond correctly. The source stays `/trace/api/:action*`. This is project-rule capture expansion; no application runtime or `vercel.json` rewrite changed. The other 10 rules are unchanged.

Canonical read-only smoke passed 7/7. Empty-body login POSTs return 400 with the canonical Origin and 403 with an untrusted or absent Origin, on both the protected staging alias and canonical site. These checks created no accounts or checkouts and do not establish successful authenticated session/cookie or billing flows. Evidence is in ignored `artifacts/membership/production-route-correction-20260929/`.

## Scope and baseline

The apex project is `prj_UGSMF2MDs5KZ5LlRHdC1MvHEPFMs`, team `team_6rqfBuaO0W1ndg07WpRuoUv0`. Its nine original project rules are saved in `live-baseline.json`. The route version `8873491d-2269-4fa7-aa14-fc889ff753ac` was live, with no staged version, at the initial read. The Trace upstream is `https://victoryroad-lovat.vercel.app`.

Add these rules immediately before existing rule `ca154d6b-73e7-4b69-9708-9e1abec80201` (`/trace/:shareId`). This preserves every existing rule and its relative order:

| Prepared POST body | Source | Upstream path |
| --- | --- | --- |
| `add-membership-api.json` | `/trace/api/:action*` | `/trace/api/$1` |
| `add-member-script.json` | `/trace-member.js` | `/trace-member.js` |

With upstream `cleanUrls: true`, the landing rewrite targets `/` and account aliases target `/trace-account`; `.html` destinations return 404 on Vercel. The direct account artifact has the same private/no-store security headers as its aliases. [Vercel rewrite configuration](https://vercel.com/docs/project-configuration/vercel-json#rewrites) requires extensionless destinations in this mode.

The API uses `path-to-regexp`; the script uses exact matching. No response status, header transform, query transform, condition, or rewrite cache is added. Existing `/trace/:shareId` already handles the one-segment `/trace/account`, `/trace/signup`, `/trace/access`, and `/trace/link` routes; the updated upstream owns their handlers.

## Original pre-addition review commands

The two additions are now live. Do not rerun the additive POSTs below against production. `--current` deliberately checks the original nine-rule baseline and fails against today's 11-rule state. For further changes, retrieve versions first, fetch the live and staged version IDs explicitly, and review against the production checkpoint. An unversioned routes GET can return the staged version when one exists.

Run from the web checkout. These commands only read cloud state and save local JSON:

```sh
mkdir -p artifacts/apex-routing
vercel api '/v1/projects/prj_UGSMF2MDs5KZ5LlRHdC1MvHEPFMs/routes?teamId=team_6rqfBuaO0W1ndg07WpRuoUv0' --method GET --raw > artifacts/apex-routing/current.json
vercel api '/v1/projects/prj_UGSMF2MDs5KZ5LlRHdC1MvHEPFMs/routes/versions?teamId=team_6rqfBuaO0W1ndg07WpRuoUv0&count=20' --method GET --raw > artifacts/apex-routing/versions.json
node scripts/verify-trace-apex-routes.mjs --current artifacts/apex-routing/current.json artifacts/apex-routing/versions.json
```

Stop and re-review if this fails. There is no documented compare-and-swap version parameter for route addition, so coordinate one operator during staging and repeat the version check before promotion. Do not overwrite the full route array. Do not merge somebody else’s staged work into this release.

## Original additive staging commands — already executed

Only after the Trace upstream release is ready, its fixed origin/API configuration is present, and staging is authorized:

```sh
vercel api '/v1/projects/prj_UGSMF2MDs5KZ5LlRHdC1MvHEPFMs/routes?teamId=team_6rqfBuaO0W1ndg07WpRuoUv0' --method POST --input docs/apex-routing/add-membership-api.json --raw > artifacts/apex-routing/add-api-response.json
vercel api '/v1/projects/prj_UGSMF2MDs5KZ5LlRHdC1MvHEPFMs/routes?teamId=team_6rqfBuaO0W1ndg07WpRuoUv0' --method POST --input docs/apex-routing/add-member-script.json --raw > artifacts/apex-routing/add-script-response.json
```

These use explicit project IDs because this checkout is linked to the **Trace upstream**, not the apex project. Running `vercel routes add` against its default link would target the wrong project. The exact POST envelope and position schema were checked against installed Vercel CLI 50.26.1 (`src/util/routes/add-route.ts` in its compiled distribution).

Read the final response’s `version.id` and `version.alias`. Fetch that version explicitly using GET `/v1/projects/PROJECT/routes?teamId=TEAM&versionId=VERSION`, save as `artifacts/apex-routing/staged.json`, then run:

```sh
node scripts/verify-trace-apex-routes.mjs --staged artifacts/apex-routing/staged.json
```

This checks exactly 11 rules, all nine original routes unchanged and in their original order, two expected additions before the catch-all, and no extra transforms. Inspect the staged alias before any promotion. `scripts/verify-trace-apex-routes.mjs` is offline only; it has no cloud mutation code.

## Headers, queries and release verification

External rewrites keep the browser URL on the apex and forward the request to the Trace deployment. The planned routes add no query/header transformations. They deliberately target the Trace **web proxy**, not the membership backend, so browser credentials remain HttpOnly and the proxy secret stays server-side. External rewrites are uncached by default; never enable rewrite caching for membership traffic. API handlers additionally emit private/no-store and no-referrer responses.

The route schema and offline tests establish the intended routing; **real forwarding of POST bodies, cookies, Set-Cookie and query strings still requires a staged/live HTTP test**. Do not mark those checks complete based on local tests. Verify:

| Request | Expected result |
| --- | --- |
| `/trace-member.js` | JavaScript, not film HTML or public replay HTML |
| GET `/trace/api/account` signed out | JSON 401, private/no-store; no credentials in body |
| POST `/trace/api/auth/login` from the configured origin | Body reaches proxy; session set with Secure, HttpOnly, SameSite=Lax, Path=/ and no Domain |
| Same POST with untrusted or absent Origin | 403 before the identity provider; never rewrite Origin to bypass this |
| GET `/trace/access?action=download&platform=mac` signed out | 303 to configured `/trace/login?download=mac`; query preserved |
| `/trace/link?code=ABCDE23456` | Explicit app-link confirmation, never automatic linking |
| Public leaderboard and existing shared replay | Still open without an account |

A routing-test alias is not the production origin. Normal browser mutations on that alias should be rejected unless a separately configured preview backend/web origin is used. Do not relax production CSRF rules to make the test alias work. For provider sandbox tests, set `TRACE_WEB_ORIGIN` and the backend `WebOrigin` to the same dedicated preview origin before exercising authenticated requests. Keep live payments separate.

## Promotion and rollback — separate explicit actions

Only after provider checks and release approval, POST to `/v1/projects/PROJECT/routes/versions?teamId=TEAM` with `{"id":"REVIEWED_STAGED_VERSION","action":"promote"}`. Capture the response and confirm the live version has the expected 11 rules. The installed CLI also supports publishing, but its linked-project context makes the explicit API safer here.

If the new apex routes must be rolled back, re-read live versions and review drift first. `{"id":"8873491d-2269-4fa7-aa14-fc889ff753ac","action":"restore"}` on that same versions endpoint **restores production immediately**; it is not a harmless staging action. A Trace upstream rollback is separate. Do not discard or restore another operator’s work automatically.

## Deployment exclusions reviewed

The current `.vercelignore` excludes infrastructure, native Rust, training/raw data, credentials matching `.env*`/SQLite/PEM, build output, logs, local artifacts, docs and most scripts. This routing plan and its helper are excluded from upload. The five allowed build scripts match imports used by the configured build; `src/engine/types.ts` remains available for tracker types. `landing/training` is deliberately re-included because the public dashboard build copies it. The leaderboard input is `landing/leaderboard/events.json`, not excluded raw `data`. No `.key`, `.p12`, `.pfx`, credential-named, or `.env*` file was found in the checked source inventory (excluded dependencies and build folders were not scanned). No secret values were read.

The `.vercelignore` patterns reduce the upload set; they do not replace the public replay/data allowlists or a final Vercel build. Root owns this manifest and the final deployment review.

## Primary references

- [Vercel project routing rules](https://vercel.com/docs/routing/project-routing-rules): staging, rule order and precedence.
- [Vercel routes CLI](https://vercel.com/docs/cli/routes): route creation and separate publication.
- [Vercel external rewrites](https://vercel.com/docs/routing/rewrites): reverse proxy behavior and caching defaults.
- [Vercel external API origin template](https://vercel.com/templates/cdn/add-api-external-origin-routing-rule): project destination capture example using `$1`; confirmed with the staged HTTP checks above.
- [Vercel route staging API](https://vercel.com/docs/rest-api/project-routes/stage-routing-rules): full-list overwrite/merge semantics; this plan uses additive POST instead.
- [Vercel routing version API](https://vercel.com/docs/rest-api/project-routes/promote-restore-or-discard-a-routing-rule-version): promotion, restore and discard.
