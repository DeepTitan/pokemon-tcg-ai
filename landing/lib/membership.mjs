// Browser session boundary for Trace membership. Tokens are never sent to page JS.
export const ACCESS_COOKIE = '__Host-trace-member-access';
export const REFRESH_COOKIE = '__Host-trace-member-refresh';
export const DOWNLOADS = Object.freeze({
  mac: 'https://github.com/DeepTitan/pokemon-tcg-ai/releases/latest/download/Trace_aarch64.dmg',
  windows: 'https://github.com/DeepTitan/pokemon-tcg-ai/releases/latest/download/Trace_x64-setup.exe',
});
const ACTIONS = new Map([
  ['auth/signup', 'POST'], ['auth/resend', 'POST'], ['auth/confirm', 'POST'], ['auth/login', 'POST'],
  ['auth/refresh', 'POST'], ['auth/recover', 'POST'], ['auth/reset', 'POST'],
  ['auth/logout', 'POST'], ['account', 'GET'], ['checkout', 'POST'],
  ['portal', 'POST'], ['devices/link/approve', 'POST'],
]);
const PUBLIC_ACTIONS = new Set(['auth/signup', 'auth/resend', 'auth/confirm', 'auth/login', 'auth/recover', 'auth/reset']);
const cookie = (name, value, age) => `${name}=${value}; Path=/; Max-Age=${age}; Secure; HttpOnly; SameSite=Lax`;
const clearCookies = () => [cookie(ACCESS_COOKIE, '', 0), cookie(REFRESH_COOKIE, '', 0)];
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const readCookies = (header) => Object.fromEntries(String(header || '').split(';').map((part) => {
  const index = part.indexOf('=');
  return index > 0 ? [part.slice(0, index).trim(), part.slice(index + 1)] : ['', ''];
}));
const validToken = (value) => typeof value === 'string' && /^[A-Za-z0-9._~+\/-]{1,3800}={0,2}$/.test(value);
const setPrivateHeaders = (response) => {
  response.setHeader('Cache-Control', 'private, no-store');
  response.setHeader('Vercel-CDN-Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('Vary', 'Cookie');
};
const send = (response, status, body) => {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(body));
};

export function membershipOrigin(value = 'https://victoryroad.app') {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.origin !== value) return null;
    return url.origin;
  } catch { return null; }
}

export function membershipUpstream(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return null;
    return url.href.replace(/\/$/, '');
  } catch { return null; }
}

export function safeBillingUrl(value, action) {
  try {
    const url = new URL(value);
    const checkout = action === 'checkout' && url.origin === 'https://checkout.stripe.com' && /^\/(?:c\/)?pay\/[^/]+/.test(url.pathname);
    const portal = action === 'portal' && url.origin === 'https://billing.stripe.com' && url.pathname.startsWith('/p/session/');
    return typeof value === 'string' && value.length <= 8192 && !url.username && !url.password && (checkout || portal) ? url.href : null;
  } catch { return null; }
}

// Entitlements are read from the service every time. Cookie presence is not access.
export function publicAccount(value) {
  if (!object(value) || typeof value.email !== 'string' || value.email.length > 254 ||
      !['none', 'trace', 'supporter'].includes(value.plan) || typeof value.status !== 'string') return null;
  const paid = value.status === 'active' && value.plan !== 'none' && typeof value.expiresAt === 'string' && Date.parse(value.expiresAt) > Date.now();
  const admin = value.admin === true && value.status === 'admin' && value.plan === 'supporter';
  const traceAccess = (paid || admin) && value.traceAccess === true;
  return {
    email: value.email, plan: value.plan, status: value.status.slice(0, 40), admin,
    traceAccess, opponentDecklists: traceAccess && (value.plan === 'supporter' || admin) && value.opponentDecklists === true,
    expiresAt: typeof value.expiresAt === 'string' && Number.isFinite(Date.parse(value.expiresAt)) ? value.expiresAt : null,
    cancelAtPeriodEnd: value.cancelAtPeriodEnd === true,
  };
}

function inputFor(action, raw) {
  const body = typeof raw === 'string' ? JSON.parse(raw) : raw ?? {};
  if (!object(body) || JSON.stringify(body).length > 8192) throw new Error('input');
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  const password = body.password;
  const code = typeof body.code === 'string' ? body.code.trim() : '';
  if (['auth/signup', 'auth/resend', 'auth/confirm', 'auth/login', 'auth/recover', 'auth/reset'].includes(action) &&
      (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) throw new Error('input');
  if (['auth/signup', 'auth/login', 'auth/reset'].includes(action) &&
      (typeof password !== 'string' || password.length < 1 || password.length > 128)) throw new Error('input');
  if (['auth/confirm', 'auth/reset'].includes(action) && !/^\d{6,8}$/.test(code)) throw new Error('input');
  if (action === 'auth/signup' || action === 'auth/login') return { email, password };
  if (action === 'auth/confirm') return { email, code };
  if (action === 'auth/recover' || action === 'auth/resend') return { email };
  if (action === 'auth/reset') return { email, code, password };
  if (action === 'checkout') {
    if (!['trace', 'supporter'].includes(body.plan)) throw new Error('input');
    return { plan: body.plan };
  }
  if (action === 'devices/link/approve') {
    const userCode = typeof body.userCode === 'string' ? body.userCode.replace(/[\s-]/g, '').toUpperCase() : '';
    if (!/^[A-Z2-7]{10}$/.test(userCode)) throw new Error('input');
    return { userCode };
  }
  return {};
}

// Only known public messages cross this boundary; raw provider errors can contain secrets.
function failure(response, status, action, body) {
  const known = {
    400: 'Check the details and try again.',
    401: action === 'auth/login' ? 'We could not sign you in. Check your email and password.' : 'Sign in to continue.',
    403: 'Confirm your email before continuing.',
    404: 'This request is no longer available. Please try again.',
    409: action === 'devices/link/approve' ? 'This app is already linked. Unlink it in Trace before linking another account.' : 'This request cannot be completed right now. Check your account or try signing in.',
    410: 'This code has expired. Request a new code and try again.',
    429: 'Too many attempts. Wait a moment, then try again.',
  };
  const codes = new Set(['invalid_request', 'invalid_email', 'invalid_password', 'invalid_code', 'unauthorized', 'invalid_credentials', 'email_not_verified', 'device_already_linked', 'billing_busy', 'subscription_exists', 'rate_limited', 'billing_unavailable', 'service_unavailable']);
  const code = codes.has(body?.error) ? body.error : undefined;
  const explanation = code === 'invalid_password' ? 'Use 12–128 characters, with uppercase and lowercase letters, a number, and a symbol.' : code === 'invalid_code' ? 'That code is invalid or expired. Check the code and try again.' : code === 'subscription_exists' ? 'You already have a subscription. Use Manage billing to change your plan.' : null;
  return send(response, known[status] ? status : 503, { error: explanation || known[status] || 'Membership services are temporarily unavailable. Please try again.', ...(code ? { code } : {}) });
}

export function createMembershipService({ upstream = process.env.TRACE_MEMBERSHIP_API_URL, fetcher = fetch } = {}) {
  const base = membershipUpstream(upstream);
  return {
    configured: Boolean(base),
    async call(action, { method = 'POST', body, accessToken } = {}) {
      if (!base) return { status: 503, body: {} };
      const response = await fetcher(`${base}/v1/${action}`, {
        method, headers: { 'Content-Type': 'application/json', ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
        ...(method === 'POST' ? { body: JSON.stringify(body ?? {}) } : {}),
        redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15000),
      });
      const text = await response.text();
      if (text.length > 32000) throw new Error('invalid upstream');
      let result;
      try { result = JSON.parse(text); } catch { result = {}; }
      return { status: response.status, body: object(result) ? result : {} };
    },
  };
}

function rememberSession(response, value, previousRefresh) {
  const refreshToken = value?.refreshToken ?? previousRefresh;
  if (!validToken(value?.accessToken) || !validToken(refreshToken) || !Number.isInteger(value?.expiresIn) ||
      value.expiresIn < 30 || value.expiresIn > 86400) return null;
  response.setHeader('Set-Cookie', [
    cookie(ACCESS_COOKIE, value.accessToken, value.expiresIn),
    cookie(REFRESH_COOKIE, refreshToken, 30 * 86400),
  ]);
  return value.accessToken;
}

async function withSession(request, response, service, action, method, body) {
  const cookies = readCookies(request.headers?.cookie);
  let accessToken = validToken(cookies[ACCESS_COOKIE]) ? cookies[ACCESS_COOKIE] : null;
  const refreshToken = validToken(cookies[REFRESH_COOKIE]) ? cookies[REFRESH_COOKIE] : null;
  let result = accessToken ? await service.call(action, { method, body, accessToken }) : { status: 401, body: {} };
  if (result.status === 401 && refreshToken) {
    const refreshed = await service.call('auth/refresh', { body: { refreshToken } });
    if (refreshed.status === 200) {
      accessToken = rememberSession(response, refreshed.body, refreshToken);
      if (!accessToken) return { status: 503, body: {} };
      result = await service.call(action, { method, body, accessToken });
    } else result = refreshed;
  }
  if (result.status === 401) response.setHeader('Set-Cookie', clearCookies());
  return result;
}

export function createMembershipHandler({ service = createMembershipService(), origin = process.env.TRACE_WEB_ORIGIN || 'https://victoryroad.app' } = {}) {
  const allowedOrigin = membershipOrigin(origin);
  return async function membership(request, response) {
    setPrivateHeaders(response);
    const url = new URL(request.url, 'https://victoryroad.app');
    const action = typeof request.query?.action === 'string' ? request.query.action : url.searchParams.get('action') || url.pathname.replace(/^\/trace\/api\//, '');
    const method = ACTIONS.get(action);
    if (!method) return send(response, 404, { error: 'Not found.' });
    if (request.method !== method) {
      response.setHeader('Allow', method);
      return send(response, 405, { error: 'Method not allowed.' });
    }
    if (method === 'POST' && (!allowedOrigin || request.headers?.origin !== allowedOrigin ||
        !/^application\/json(?:\s*;|$)/i.test(String(request.headers?.['content-type'] || '')) ||
        ['cross-site', 'none'].includes(request.headers?.['sec-fetch-site']))) {
      return send(response, 403, { error: 'Open Trace on Victory Road and try again.' });
    }
    try {
      let body;
      try { body = inputFor(action, request.body); } catch { return send(response, 400, { error: 'Check the details and try again.' }); }
      if (action === 'auth/logout') {
        const cookies = readCookies(request.headers?.cookie);
        response.setHeader('Set-Cookie', clearCookies());
        if (service.configured) {
          try {
            let signedOut = false;
            if (validToken(cookies[ACCESS_COOKIE])) {
              const revoked = await service.call(action, { accessToken: cookies[ACCESS_COOKIE] });
              signedOut = revoked.status >= 200 && revoked.status < 300;
            }
            if (!signedOut && validToken(cookies[REFRESH_COOKIE])) {
              const renewed = await service.call('auth/refresh', { body: { refreshToken: cookies[REFRESH_COOKIE] } });
              if (renewed.status === 200 && validToken(renewed.body?.accessToken)) {
                await service.call(action, { accessToken: renewed.body.accessToken });
              }
            }
          } catch { /* Local sign-out succeeds even if provider revocation is unavailable. */ }
        }
        return send(response, 200, { signedOut: true });
      }
      if (!service.configured) return send(response, 503, { error: 'Memberships are not available yet. Please check back soon.' });
      let result;
      if (action === 'auth/refresh') {
        const refreshToken = readCookies(request.headers?.cookie)[REFRESH_COOKIE];
        if (!validToken(refreshToken)) return send(response, 401, { error: 'Sign in to continue.' });
        result = await service.call(action, { body: { refreshToken } });
        if (result.status === 200) {
          if (rememberSession(response, result.body, refreshToken)) return send(response, 200, { authenticated: true });
          return send(response, 503, { error: 'We could not refresh your session. Please sign in again.' });
        }
        if (result.status === 401) response.setHeader('Set-Cookie', clearCookies());
      } else if (PUBLIC_ACTIONS.has(action)) {
        result = await service.call(action, { body });
      } else result = await withSession(request, response, service, action, method, body);
      if (result.status < 200 || result.status >= 300) return failure(response, result.status, action, result.body);
      if (action === 'auth/login') {
        if (!rememberSession(response, result.body)) return send(response, 503, { error: 'We could not start a secure session. Please try again.' });
        return send(response, 200, { authenticated: true });
      }
      if (action === 'account') {
        const account = publicAccount(result.body);
        return account ? send(response, 200, account) : send(response, 503, { error: 'We could not confirm your membership. Please try again.' });
      }
      if (action === 'checkout' || action === 'portal') {
        const target = safeBillingUrl(result.body.url, action);
        return target ? send(response, 200, { url: target }) : send(response, 503, { error: 'We could not open secure billing. Please try again.' });
      }
      if (action === 'devices/link/approve') {
        return result.body.linked === true ? send(response, 200, { linked: true }) : send(response, 503, { error: 'We could not link this app. Please try again.' });
      }
      // Do not pass arbitrary upstream JSON (tokens, user identifiers, debug details) through.
      return send(response, 200, { ok: true });
    } catch { return send(response, 503, { error: 'Membership services are temporarily unavailable. Please try again.' }); }
  };
}

export function createMemberDownloadHandler({ service = createMembershipService(), origin = process.env.TRACE_WEB_ORIGIN || 'https://victoryroad.app' } = {}) {
  const webOrigin = membershipOrigin(origin);
  return async function download(request, response) {
    setPrivateHeaders(response);
    if (request.method !== 'GET') {
      response.setHeader('Allow', 'GET');
      return send(response, 405, { error: 'Sign in with your Trace account to download.' });
    }
    const url = new URL(request.url, 'https://victoryroad.app');
    const wantsDownload = url.searchParams.get('action') === 'download';
    const platform = url.searchParams.get('platform');
    if (wantsDownload && !Object.hasOwn(DOWNLOADS, platform)) return send(response, 400, { error: 'Choose Windows or macOS.' });
    if (!service.configured || !webOrigin) return send(response, 503, { error: 'Downloads are temporarily unavailable. Please try again.' });
    try {
      const result = await withSession(request, response, service, 'account', 'GET');
      const account = result.status === 200 ? publicAccount(result.body) : null;
      if (result.status === 401 || (account && !account.traceAccess)) {
        if (!wantsDownload) return send(response, result.status === 401 ? 401 : 200, { unlocked: false });
        response.statusCode = 303;
        response.setHeader('Location', `${webOrigin}/trace/${result.status === 401 ? 'login' : 'account'}?download=${platform}`);
        return response.end();
      }
      if (!account?.traceAccess) return send(response, 503, { error: 'We could not confirm access. Please try again.' });
      if (!wantsDownload) return send(response, 200, { unlocked: true });
      response.statusCode = 303;
      response.setHeader('Location', DOWNLOADS[platform]);
      response.end();
    } catch { return send(response, 503, { error: 'Downloads are temporarily unavailable. Please try again.' }); }
  };
}
