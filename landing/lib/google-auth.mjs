import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { authContext, authDestination } from './auth-state.mjs';
export function googleConfig(domain, clientId, origin) {
  try {
    const url = new URL(domain);
    if (!/^https:\/\/[a-z0-9-]+\.auth\.[a-z0-9-]+\.amazoncognito\.com$/.test(domain) || url.origin !== domain ||
        !/^[a-z0-9]{10,128}$/.test(clientId || '')) return null;
    return { domain, clientId, redirect: origin + '/trace/api/auth/google-callback' };
  } catch { return null; }
}
export function startGoogle(config, context) {
  const state = randomBytes(32).toString('base64url'), verifier = randomBytes(32).toString('base64url');
  const params = new URLSearchParams({ client_id: config.clientId, response_type: 'code', redirect_uri: config.redirect,
    scope: 'openid email aws.cognito.signin.user.admin', identity_provider: 'Google', state,
    code_challenge_method: 'S256', code_challenge: createHash('sha256').update(verifier).digest('base64url') });
  return { url: config.domain + '/oauth2/authorize?' + params, pending: { type: 'google', state, verifier, context: authContext(context) } };
}
export async function finishGoogle(config, pending, params, fetcher = fetch) {
  const state = params.get('state') || '';
  if (pending?.type !== 'google' || typeof pending.state !== 'string' || state.length !== pending.state.length ||
      !timingSafeEqual(Buffer.from(state), Buffer.from(pending.state)) || params.has('error')) throw new Error('Invalid OAuth state');
  const code = params.get('code');
  if (!code || code.length > 4096) throw new Error('Missing OAuth code');
  const response = await fetcher(config.domain + '/oauth2/token', { method: 'POST', redirect: 'error', cache: 'no-store',
    signal: AbortSignal.timeout(15000), headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', client_id: config.clientId, redirect_uri: config.redirect,
      code, code_verifier: pending.verifier }).toString() });
  if (!response.ok) throw new Error('OAuth exchange failed');
  const token = await response.json();
  return { tokens: { accessToken: token.access_token, refreshToken: token.refresh_token, expiresIn: token.expires_in }, next: authDestination(pending.context) };
}
