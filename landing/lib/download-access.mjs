import { createHash, createHmac, createPublicKey, randomBytes, timingSafeEqual, verify } from 'node:crypto';

const API = 'https://kjas0lemdf.execute-api.us-east-1.amazonaws.com';
// Public verification key only. The signing key never leaves AWS KMS.
export const DOWNLOAD_PUBLIC_KEY = 'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEM/pHy3oxeBNrY3wH3bg+CYhnd5rftU5ZP8kO7f3smtpqbDamPnxYCnxunAjoHi/XUVNevaocf/AMVD7Rn0Neyg==';
export const BROWSER_COOKIE = '__Host-trace-download-browser';
export const GRANT_COOKIE = '__Host-trace-download-grant';
export const MASTER_COOKIE = '__Host-trace-master-access';
export const DOWNLOADS = Object.freeze({
  mac: 'https://github.com/DeepTitan/pokemon-tcg-ai/releases/latest/download/Trace_aarch64.dmg',
  windows: 'https://github.com/DeepTitan/pokemon-tcg-ai/releases/latest/download/Trace_x64-setup.exe',
});
const THIRTY_DAYS = 30 * 86400;
export const browserSessionHash = (id) => createHash('sha256').update(`trace-download-browser-v1:${id}`).digest('hex');
const cookie = (name, value, age = THIRTY_DAYS) => `${name}=${value}; Path=/; Max-Age=${age}; Secure; HttpOnly; SameSite=Lax`;
const equal = (a, b) => timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());
const masterSignature = (payload, secret) => createHmac('sha256', secret).update(`trace-master-v1:${payload}`).digest('base64url');
function masterGrant(value, browserId, secret, now) {
  if (!secret || !value || !/^[a-f0-9]{64}$/.test(browserId || '')) return null;
  const [expiry, signature, extra] = value.split('.');
  const expiresAt = Number(expiry);
  if (extra || !signature || !Number.isSafeInteger(expiresAt) || expiresAt <= now || expiresAt > now + THIRTY_DAYS) return null;
  return equal(signature, masterSignature(`${browserId}.${expiry}`, secret)) ? { expiresAt } : null;
}

export function verifyDownloadGrant(grant, browserId, key = DOWNLOAD_PUBLIC_KEY, now = Math.floor(Date.now() / 1000)) {
  try {
    if (!/^[a-f0-9]{64}$/.test(browserId || '') || typeof grant !== 'string' || grant.length > 3000) return null;
    const parts = grant.split('.');
    if (parts.length !== 2 || !parts.every((p) => /^[A-Za-z0-9_-]+$/.test(p))) return null;
    const publicKey = createPublicKey({ key: Buffer.from(key, 'base64'), type: 'spki', format: 'der' });
    if (!verify('sha256', Buffer.from(parts[0]), publicKey, Buffer.from(parts[1], 'base64url'))) return null;
    const claims = JSON.parse(Buffer.from(parts[0], 'base64url'));
    if (claims.version !== 1 || claims.product !== 'trace-download' || claims.sessionId !== browserSessionHash(browserId) || !Number.isSafeInteger(claims.issuedAt) || !Number.isSafeInteger(claims.expiresAt) || claims.issuedAt > now + 60 || claims.expiresAt <= now || claims.expiresAt - claims.issuedAt !== THIRTY_DAYS) return null;
    return claims;
  } catch { return null; }
}

function readCookies(header) {
  return Object.fromEntries(String(header || '').split(';').map((part) => {
    const at = part.indexOf('='); return at > 0 ? [part.slice(0, at).trim(), part.slice(at + 1)] : ['', ''];
  }));
}

async function redeemUpstream(code, sessionId) {
  const result = await fetch(`${API}/v1/downloads/redeem`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code, sessionId }), signal: AbortSignal.timeout(9000) });
  return { status: result.status, body: await result.json() };
}

export function createDownloadHandler({ redeem = redeemUpstream, key = DOWNLOAD_PUBLIC_KEY, clock = () => Math.floor(Date.now() / 1000), newBrowser = () => randomBytes(32).toString('hex'), masterPassword = process.env.TRACE_MASTER_PASSWORD, masterSecret = process.env.TRACE_MASTER_COOKIE_SECRET } = {}) {
  return async function handler(request, response) {
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('Vercel-CDN-Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    const json = (status, body) => { response.statusCode = status; response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(body)); };
    const url = new URL(request.url, 'https://victoryroad.app');
    const cookies = readCookies(request.headers?.cookie);
    const browserId = cookies[BROWSER_COOKIE];
    const browserReady = /^[a-f0-9]{64}$/.test(browserId || '');
    const grant = verifyDownloadGrant(cookies[GRANT_COOKIE], browserId, key, clock()) || masterGrant(cookies[MASTER_COOKIE], browserId, masterSecret, clock());
    if (request.method === 'GET') {
      if (url.searchParams.get('action') === 'download') {
        const target = DOWNLOADS[url.searchParams.get('platform')];
        if (!target) return json(400, { error: 'Choose Windows or macOS.' });
        response.statusCode = 302;
        response.setHeader('Location', grant ? target : 'https://victoryroad.app/trace?access=required');
        response.end(); return;
      }
      if (!browserReady) response.setHeader('Set-Cookie', cookie(BROWSER_COOKIE, newBrowser()));
      return json(200, { unlocked: Boolean(grant), expiresAt: grant?.expiresAt || null });
    }
    if (request.method !== 'POST') { response.setHeader('Allow', 'GET, POST'); return json(405, { error: 'Method not allowed.' }); }
    const allowedOrigins = new Set(['https://victoryroad.app', 'https://www.victoryroad.app', 'https://victoryroad-lovat.vercel.app']);
    if (process.env.VERCEL_URL) allowedOrigins.add(`https://${process.env.VERCEL_URL}`);
    if (!allowedOrigins.has(request.headers?.origin) || !String(request.headers?.['content-type'] || '').startsWith('application/json')) return json(403, { error: 'Open the Trace download page and try again.' });
    if (!browserReady) return json(400, { error: 'Please allow cookies for this site, refresh, and try again.' });
    try {
      const input = typeof request.body === 'string' ? JSON.parse(request.body) : request.body;
      const code = input?.code;
      if (typeof code === 'string' && code.length <= 256 && masterPassword && masterSecret && equal(code, masterPassword)) {
        const expiresAt = clock() + THIRTY_DAYS;
        response.setHeader('Set-Cookie', cookie(MASTER_COOKIE, `${expiresAt}.${masterSignature(`${browserId}.${expiresAt}`, masterSecret)}`));
        return json(200, { unlocked: true, expiresAt });
      }
      if (typeof code !== 'string' || !/^[A-Fa-f0-9\s-]{32,80}$/.test(code)) return json(400, { error: 'Enter the full download code from Discord.' });
      const result = await redeem(code, browserSessionHash(browserId));
      if (result.status !== 200) return json(result.status >= 500 ? 503 : result.status, { error: result.status === 409 ? 'This code was already used or replaced. Request a new one in Discord.' : result.status >= 500 ? 'Download access is temporarily unavailable. Please try again.' : 'That code is invalid or expired. Request a new one in Discord.' });
      const verified = verifyDownloadGrant(result.body.grant, browserId, key, clock());
      if (!verified) return json(503, { error: 'We could not confirm access. Please retry with the same code.' });
      response.setHeader('Set-Cookie', cookie(GRANT_COOKIE, result.body.grant, verified.expiresAt - clock()));
      return json(200, { unlocked: true, expiresAt: verified.expiresAt });
    } catch (error) {
      if (error instanceof SyntaxError) return json(400, { error: 'Enter the full download code from Discord.' });
      return json(503, { error: 'Download access is temporarily unavailable. Please retry with the same code.' });
    }
  };
}
