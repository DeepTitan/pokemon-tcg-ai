// Read-only deployment smoke test. Never creates accounts, payments, or captures.
// Does not replace the authenticated Stripe/Cognito/Discord test-mode journey.
const origin = new URL(process.argv[2] || 'https://victoryroad.app');
if (origin.protocol !== 'https:' || origin.pathname !== '/' || origin.search || origin.hash || origin.username || origin.password) {
  throw new Error('Provide an HTTPS origin with no path, credentials, or query.');
}
const checks = [
  ['/trace', async (r) => r.ok && /Start free/.test(await r.text()), 'Free pricing is published'],
  ['/trace/signup', async (r) => r.ok && /trace-member\.js/.test(await r.text()), 'Signup page routes to the account app'],
  ['/trace/link?code=ABCDE-FGHIJ', async (r) => r.ok && /trace-member\.js/.test(await r.text()), 'Desktop account-link URL routes to the account app'],
  ['/trace-member.js', async (r) => r.ok && /javascript/.test(r.headers.get('content-type') || ''), 'Account JavaScript is reachable'],
  ['/trace/api/account', async (r) => r.status === 401 && /json/.test(r.headers.get('content-type') || '') && /no-store/.test(r.headers.get('cache-control') || ''), 'Account API requires sign-in and is not cached'],
  ['/trace/access?action=download&platform=mac', async (r) => [302, 303, 307].includes(r.status) && new URL(r.headers.get('location'), origin).pathname === '/trace/login', 'Signed-out downloads go to sign-in'],
  ['/trace/leaderboard', async (r) => r.ok && /leaderboard/i.test(await r.text()), 'Public leaderboard remains reachable'],
];
let failed = 0;
for (const [path, verify, label] of checks) {
  try {
    const response = await fetch(new URL(path, origin), { redirect: 'manual', signal: AbortSignal.timeout(15000) });
    const passed = await verify(response);
    if (!passed) failed += 1;
    console.log(`${passed ? 'PASS' : 'FAIL'} ${label} (HTTP ${response.status})`);
  } catch (error) {
    failed += 1;
    console.log(`FAIL ${label} (${error.name || 'request error'})`);
  }
}
console.log(`${checks.length - failed}/${checks.length} public checks passed. No account, payment, or capture was created.`);
process.exitCode = failed ? 1 : 0;
