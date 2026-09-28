import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
// Browser session boundary for Trace membership. Tokens are never sent to page JS.
export const ACCESS_COOKIE = '__Host-trace-member-access';
export const REFRESH_COOKIE = '__Host-trace-member-refresh';
export const CHECKOUT_COOKIE = '__Host-trace-checkout';
export const DISCORD_COOKIE = '__Host-trace-discord';
export const DISCORD_JOIN_URL = 'https://discord.gg/bxKJGB9dSY';
const GUEST_ACTIONS = new Set(['checkout/guest', 'checkout/status', 'checkout/claim']);
const validCheckoutToken = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const pendingCookies = new WeakMap();
const resolvedSessions = new WeakMap();
function writeCookies(response, values) {
  const pending = pendingCookies.get(response) || new Map();
  for (const value of values) pending.set(value.slice(0, value.indexOf('=')), value);
  pendingCookies.set(response, pending);
  response.setHeader('Set-Cookie', [...pending.values()]);
}
export const DOWNLOADS = Object.freeze({
  mac: 'https://github.com/DeepTitan/pokemon-tcg-ai/releases/latest/download/Trace_aarch64.dmg',
  windows: 'https://github.com/DeepTitan/pokemon-tcg-ai/releases/latest/download/Trace_x64-setup.exe',
});
const ACTIONS = new Map([
  ['auth/signup', 'POST'], ['auth/resend', 'POST'], ['auth/confirm', 'POST'], ['auth/login', 'POST'],
  ['auth/refresh', 'POST'], ['auth/recover', 'POST'], ['auth/reset', 'POST'],
  ['auth/logout', 'POST'], ['account', 'GET'], ['checkout', 'POST'],
  ['portal', 'POST'], ['devices/link/approve', 'POST'],
  ['checkout/prepare', 'POST'], ['checkout/guest', 'POST'], ['checkout/status', 'POST'], ['checkout/claim', 'POST'],
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
  const supplied = object(value.capabilities) ? value.capabilities : {};
  const knownStatus = ['none', 'active', 'trialing', 'past_due', 'unpaid', 'paused', 'incomplete', 'incomplete_expired', 'canceled'].includes(value.status) || admin;
  const recordMatches = knownStatus && supplied.recordMatches === true;
  const supporter = traceAccess && value.plan === 'supporter';
  return {
    email: value.email, plan: value.plan, status: value.status.slice(0, 40), admin,
    traceAccess, opponentDecklists: traceAccess && (value.plan === 'supporter' || admin) && value.opponentDecklists === true,
    expiresAt: typeof value.expiresAt === 'string' && Number.isFinite(Date.parse(value.expiresAt)) ? value.expiresAt : null,
    cancelAtPeriodEnd: value.cancelAtPeriodEnd === true,
    ...(value.activation !== undefined ? { activation: {
      required: value.activation?.required !== false,
      verified: value.activation?.verified === true,
      joinUrl: DISCORD_JOIN_URL,
    } } : {}),
    capabilities: {
      recordMatches, leaderboard: knownStatus && supplied.leaderboard === true,
      recentReplayDays: recordMatches && supplied.recentReplayDays === 7 ? 7 : 0,
      fullHistory: traceAccess && supplied.fullHistory === true,
      expandedSharing: traceAccess && supplied.expandedSharing === true,
      opponentDecklists: supporter && supplied.opponentDecklists === true,
      freeSharesPerWindow: recordMatches && supplied.freeSharesPerWindow === 1 ? 1 : 0,
      shareWindowDays: recordMatches && supplied.shareWindowDays === 7 ? 7 : 0,
    },
  };
}

function publicPurchase(value) {
  if (!object(value)) return null;
  const { state, plan, expiresAt } = value;
  return ['none', 'open', 'processing', 'paid', 'expired', 'claimed'].includes(state) && ['none', 'trace', 'supporter'].includes(plan) &&
    (expiresAt === null || (typeof expiresAt === 'string' && Number.isFinite(Date.parse(expiresAt))))
    ? { state, plan, expiresAt, ...(value.reason === 'purchase_not_active' ? { reason: 'purchase_not_active' } : {}) } : null;
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
  if (action === 'checkout' || action === 'checkout/guest') {
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
  const codes = new Set(['invalid_request', 'invalid_email', 'invalid_password', 'invalid_code', 'unauthorized', 'invalid_credentials', 'email_not_verified', 'device_already_linked', 'billing_busy', 'subscription_exists', 'rate_limited', 'billing_unavailable', 'service_unavailable', 'checkout_expired', 'payment_processing', 'payment_already_completed', 'purchase_already_claimed', 'checkout_email_mismatch', 'checkout_not_found', 'purchase_not_active', 'discord_required']);
  const code = codes.has(body?.error) ? body.error : undefined;
  const explanation = code === 'invalid_password' ? 'Use 12–128 characters, with uppercase and lowercase letters, a number, and a symbol.' : code === 'invalid_code' ? 'That code is invalid or expired. Check the code and try again.' : code === 'subscription_exists' ? 'You already have a subscription. Use Manage billing to change your plan.' : null;
  const purchaseExplanation = ({
    discord_required: 'Join the Trace Discord and verify your membership in My account before linking the app.',
    purchase_not_active: 'This purchase no longer has an active membership. Check Manage billing or contact support before paying again.',
    checkout_not_found: 'We could not find this purchase. Open the browser you used at checkout, or sign in if you already linked it.',
    checkout_expired: 'This checkout link has expired. If you already paid, sign in or contact support before paying again.',
    payment_processing: 'Your payment is still being confirmed. Please wait a moment, then try again.',
    payment_already_completed: 'Your payment is complete. Open My account to finish setting up your membership.',
    purchase_already_claimed: 'This purchase is already linked to an account. Sign in with the email you used at checkout.',
    checkout_email_mismatch: 'Sign in with the same email you entered at Stripe checkout to link this purchase.',
  })[code];
  return send(response, known[status] ? status : 503, { error: purchaseExplanation || explanation || known[status] || 'Membership services are temporarily unavailable. Please try again.', ...(code ? { code } : {}) });
}

export function createMembershipService({ upstream = process.env.TRACE_MEMBERSHIP_API_URL, proxySecret = process.env.TRACE_MEMBERSHIP_PROXY_SECRET, fetcher = fetch } = {}) {
  const base = membershipUpstream(upstream);
  const guestConfigured = Boolean(base && typeof proxySecret === 'string' && proxySecret.length >= 43 && proxySecret.length <= 512 && !/[\r\n]/.test(proxySecret));
  return {
    configured: Boolean(base), guestConfigured,
    async call(action, { method = 'POST', body, accessToken } = {}) {
      if (!base || (GUEST_ACTIONS.has(action) && !guestConfigured)) return { status: 503, body: {} };
      const response = await fetcher(`${base}/v1/${action}`, {
        method, headers: { 'Content-Type': 'application/json', ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}), ...(GUEST_ACTIONS.has(action) ? { 'x-trace-proxy-key': proxySecret } : {}) },
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
  writeCookies(response, [
    cookie(ACCESS_COOKIE, value.accessToken, value.expiresIn),
    cookie(REFRESH_COOKIE, refreshToken, 30 * 86400),
  ]);
  return value.accessToken;
}

async function withSession(request, response, service, action, method, body) {
  const cookies = readCookies(request.headers?.cookie);
  let accessToken = resolvedSessions.get(request) || (validToken(cookies[ACCESS_COOKIE]) ? cookies[ACCESS_COOKIE] : null);
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
  if (result.status === 401) { resolvedSessions.delete(request); writeCookies(response, clearCookies()); }
  else if (accessToken && result.status >= 200 && result.status < 300) resolvedSessions.set(request, accessToken);
  return result;
}

export function createMembershipHandler({ service = createMembershipService(), origin = process.env.TRACE_WEB_ORIGIN || 'https://victoryroad.app', newCheckoutToken = () => randomBytes(32).toString('hex') } = {}) {
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
        writeCookies(response, clearCookies());
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
      // Establish proof before any payment side effect. The page serializes prepare +
      // checkout with Web Locks, including across tabs. Lost prepare responses are harmless.
      if (action === 'checkout/prepare') {
        if (!service.guestConfigured) return send(response, 503, { error: 'Checkout is not available yet. Please check back soon.' });
        const existingToken = readCookies(request.headers?.cookie)[CHECKOUT_COOKIE];
        if (!validCheckoutToken(existingToken)) {
          const checkoutToken = newCheckoutToken();
          if (!validCheckoutToken(checkoutToken)) return send(response, 503, { error: 'We could not start a secure checkout. Please try again.' });
          writeCookies(response, [cookie(CHECKOUT_COOKIE, checkoutToken, 30 * 86400)]);
        }
        return send(response, 200, { ready: true });
      }
      // Guest checkout proof is browser-bound and server-only. Caller JSON cannot supply it.
      if (GUEST_ACTIONS.has(action)) {
        const checkoutCookies = readCookies(request.headers?.cookie);
        let checkoutToken = validCheckoutToken(checkoutCookies[CHECKOUT_COOKIE]) ? checkoutCookies[CHECKOUT_COOKIE] : null;
        if (action === 'checkout/status' && !checkoutToken) return send(response, 200, { state: 'none', plan: 'none', expiresAt: null });
        if (action === 'checkout/guest') {
          const existing = await withSession(request, response, service, 'account', 'GET');
          let account = null;
          if (existing.status === 200) {
            account = publicAccount(existing.body);
            if (!account) return send(response, 503, { error: 'We could not confirm your membership. Please try again.' });
            if (account.admin || account.traceAccess || !['none', 'canceled', 'incomplete_expired'].includes(account.status)) return send(response, 200, { accountRequired: true });
          } else if (existing.status !== 401) return failure(response, existing.status, 'account', existing.body);
          let openGuest = false;
          if (checkoutToken) {
            if (!service.guestConfigured) return send(response, 503, { error: 'We could not confirm your previous checkout. Please try again before paying.' });
            const status = await service.call('checkout/status', { body: { checkoutToken } });
            if (status.status !== 200) return failure(response, status.status, 'checkout/status', status.body);
            const purchase = publicPurchase(status.body);
            if (!purchase) return send(response, 503, { error: 'We could not confirm your previous checkout. Please try again.' });
            if (['paid', 'processing', 'claimed'].includes(purchase.state)) return send(response, 200, { accountRequired: true });
            if (purchase.state === 'open' || purchase.state === 'expired') {
              openGuest = true;
            }
          }
          if (account && !openGuest) {
            const checkout = await withSession(request, response, service, 'checkout', 'POST', body);
            if (checkout.status < 200 || checkout.status >= 300) return failure(response, checkout.status, 'checkout', checkout.body);
            const target = safeBillingUrl(checkout.body.url, 'checkout');
            return target ? send(response, 200, { url: target }) : send(response, 503, { error: 'We could not open secure billing. Please try again.' });
          }
          if (!service.guestConfigured) return send(response, 503, { error: 'Checkout is not available yet. Please check back soon.' });
          if (!checkoutToken) return send(response, 400, { error: 'Please allow cookies for Victory Road and try again. No checkout has been started.' });
          // Existing open guest checkouts are resumed, including after sign-in.
          // The backend rechecks paid/expired state under its purchase lock.
          const checkout = await service.call(action, { body: { plan: body.plan, checkoutToken } });
          if (checkout.status < 200 || checkout.status >= 300) return failure(response, checkout.status, action, checkout.body);
          const target = safeBillingUrl(checkout.body.url, 'checkout');
          return target ? send(response, 200, { url: target }) : send(response, 503, { error: 'We could not open secure billing. Please try again.' });
        }
        if (!checkoutToken) return send(response, 410, { error: 'Open this page in the browser you used to pay. If you already linked your purchase, sign in.', code: 'checkout_expired' });
        if (!service.guestConfigured) return send(response, 503, { error: 'Purchase confirmation is temporarily unavailable. Please try again.' });
        const result = action === 'checkout/claim'
          ? await withSession(request, response, service, action, 'POST', { checkoutToken })
          : await service.call(action, { body: { checkoutToken } });
        if (result.status < 200 || result.status >= 300) return failure(response, result.status, action, result.body);
        if (action === 'checkout/claim') {
          if (result.body.claimed !== true) return send(response, 503, { error: 'We could not link your purchase. Please try again.' });
          writeCookies(response, [cookie(CHECKOUT_COOKIE, '', 0)]);
          return send(response, 200, { claimed: true });
        }
        const purchase = publicPurchase(result.body);
        return purchase ? send(response, 200, purchase) : send(response, 503, { error: 'We could not confirm this purchase. Please try again.' });
      }
      // Account-page checkout must not bypass an unclaimed or still-open guest purchase.
      if (action === 'checkout') {
        const checkoutToken = readCookies(request.headers?.cookie)[CHECKOUT_COOKIE];
        if (validCheckoutToken(checkoutToken)) {
          if (!service.guestConfigured) return send(response, 503, { error: 'We could not confirm your previous checkout. Please try again before paying.' });
          const status = await service.call('checkout/status', { body: { checkoutToken } });
          if (status.status !== 200) return failure(response, status.status, 'checkout/status', status.body);
          const purchase = publicPurchase(status.body);
          if (!purchase) return send(response, 503, { error: 'We could not confirm your previous checkout. Please try again.' });
          if (['open', 'expired', 'claimed', 'processing', 'paid'].includes(purchase.state)) return send(response, 200, { accountRequired: true });
        }
      }
      let result;
      if (action === 'auth/refresh') {
        const refreshToken = readCookies(request.headers?.cookie)[REFRESH_COOKIE];
        if (!validToken(refreshToken)) return send(response, 401, { error: 'Sign in to continue.' });
        result = await service.call(action, { body: { refreshToken } });
        if (result.status === 200) {
          if (rememberSession(response, result.body, refreshToken)) return send(response, 200, { authenticated: true });
          return send(response, 503, { error: 'We could not refresh your session. Please sign in again.' });
        }
        if (result.status === 401) writeCookies(response, clearCookies());
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
      const needsActivation = account?.activation?.required === true && account.activation.verified !== true;
      const canDownload = !needsActivation && (account?.traceAccess === true || account?.capabilities.recordMatches === true);
      if (result.status === 401 || (account && !canDownload)) {
        if (!wantsDownload) return send(response, result.status === 401 ? 401 : 200, { unlocked: false });
        response.statusCode = 303;
        response.setHeader('Location', `${webOrigin}/trace/${result.status === 401 ? 'login' : 'account'}?download=${platform}`);
        return response.end();
      }
      if (!canDownload) return send(response, 503, { error: 'We could not confirm access. Please try again.' });
      if (!wantsDownload) return send(response, 200, { unlocked: true });
      response.statusCode = 303;
      response.setHeader('Location', DOWNLOADS[platform]);
      response.end();
    } catch { return send(response, 503, { error: 'Downloads are temporarily unavailable. Please try again.' }); }
  };
}

export function safeDiscordUrl(value, origin = 'https://victoryroad.app') {
  try {
    const url = new URL(value);
    if (typeof value !== 'string' || value.length > 4096 || url.origin !== 'https://discord.com' ||
        url.pathname !== '/oauth2/authorize' || url.username || url.password || url.hash) return null;
    const params = url.searchParams;
    if (['state', 'redirect_uri', 'response_type', 'scope', 'client_id'].some((key) => params.getAll(key).length !== 1) ||
        params.get('redirect_uri') !== `${origin}/trace/discord/callback` || params.get('response_type') !== 'code' ||
        !/^\d{1,30}$/.test(params.get('client_id')) || !/^[A-Za-z0-9_-]{32,128}$/.test(params.get('state'))) return null;
    const scopes = params.get('scope').split(/\s+/).sort();
    return scopes.join(' ') === 'guilds.members.read identify' ? url : null;
  } catch { return null; }
}

// The browser follows server redirects; OAuth codes and state never reach page JS.
export function createDiscordHandler({ service = createMembershipService(), origin = process.env.TRACE_WEB_ORIGIN || 'https://victoryroad.app' } = {}) {
  const webOrigin = membershipOrigin(origin);
  const digest = (value) => createHash('sha256').update(value).digest('hex');
  return async function discord(request, response) {
    setPrivateHeaders(response);
    response.setHeader('X-Robots-Tag', 'noindex, nofollow');
    const redirect = (result, context = {}) => {
      const target = new URL('/trace/account', webOrigin || 'https://victoryroad.app');
      target.searchParams.set('discord', result);
      if (/^[A-Z2-7]{10}$/.test(context.userCode || '')) target.searchParams.set('userCode', context.userCode);
      if (['mac', 'windows'].includes(context.download)) target.searchParams.set('download', context.download);
      response.statusCode = 303;
      response.setHeader('Location', target.href);
      response.end();
    };
    if (!['GET', 'POST'].includes(request.method)) {
      response.setHeader('Allow', 'GET, POST');
      return send(response, 405, { error: 'Method not allowed.' });
    }
    if (!webOrigin || !service.configured) return redirect('unavailable');
    try {
      if (request.method === 'POST') {
        if (request.headers?.origin !== webOrigin || ['cross-site', 'none'].includes(request.headers?.['sec-fetch-site']) ||
            !/^application\/x-www-form-urlencoded(?:\s*;|$)/i.test(request.headers?.['content-type'] || '')) {
          return send(response, 403, { error: 'Open My account on Victory Road and try again.' });
        }
        const raw = typeof request.body === 'string' ? Object.fromEntries(new URLSearchParams(request.body)) : request.body;
        const context = object(raw) ? raw : {};
        const result = await withSession(request, response, service, 'discord/start', 'POST', {});
        if (result.status === 401) return redirect('signin', context);
        const target = result.status === 200 ? safeDiscordUrl(result.body.url, webOrigin) : null;
        if (!target) return redirect('unavailable', context);
        const proof = { hash: digest(target.searchParams.get('state')), issuedAt: Date.now(),
          ...(/^[A-Z2-7]{10}$/.test(context.userCode || '') ? { userCode: context.userCode } : {}),
          ...(['mac', 'windows'].includes(context.download) ? { download: context.download } : {}) };
        writeCookies(response, [cookie(DISCORD_COOKIE, encodeURIComponent(JSON.stringify(proof)), 600)]);
        response.statusCode = 303;
        response.setHeader('Location', target.href);
        return response.end();
      }
      const url = new URL(request.url, webOrigin);
      const state = url.searchParams.get('state');
      let proof;
      try { proof = JSON.parse(decodeURIComponent(readCookies(request.headers?.cookie)[DISCORD_COOKIE] || '')); } catch { /* Invalid or expired browser proof. */ }
      if (!object(proof) || !/^[a-f0-9]{64}$/.test(proof.hash || '') || !Number.isFinite(proof.issuedAt) ||
          Date.now() - proof.issuedAt > 600000 || proof.issuedAt > Date.now() + 30000 ||
          url.searchParams.getAll('state').length !== 1 || !/^[A-Za-z0-9_-]{32,128}$/.test(state || '') ||
          !timingSafeEqual(Buffer.from(proof.hash, 'hex'), Buffer.from(digest(state), 'hex'))) return redirect('retry');
      writeCookies(response, [cookie(DISCORD_COOKIE, '', 0)]);
      if (url.searchParams.has('error')) return redirect('canceled', proof);
      const code = url.searchParams.get('code');
      if (url.searchParams.getAll('code').length !== 1 || !/^[A-Za-z0-9._~-]{1,512}$/.test(code || '')) return redirect('retry', proof);
      const result = await withSession(request, response, service, 'discord/complete', 'POST', { code, state });
      if (result.status === 200 && result.body.verified === true) return redirect('verified', proof);
      if (result.status === 401) return redirect('signin', proof);
      const codeMap = { discord_not_joined: 'join', discord_pending: 'pending', discord_state_invalid: 'retry', discord_already_linked: 'linked' };
      return redirect(codeMap[result.body.error] || 'unavailable', proof);
    } catch { return redirect('unavailable'); }
  };
}
