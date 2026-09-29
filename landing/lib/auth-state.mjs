import { createHash, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
export const AUTH_COOKIE = '__Host-trace-auth-step';
const key = (secret) => {
  if (typeof secret !== 'string' || secret.length < 43) throw new Error('Auth unavailable');
  return createHash('sha256').update('trace-auth-state-v1\0' + secret).digest();
};
// Short-lived authenticated encryption: no email, provider session or account state in page JS.
export function sealAuth(value, secret, now = Date.now()) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key(secret), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify({ ...value, expires: now + 15 * 60000 })), cipher.final()]);
  const token = Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url');
  if (token.length > 3800) throw new Error('Auth state too large');
  return token;
}
export function openAuth(token, secret, now = Date.now()) {
  try {
    if (typeof token !== 'string' || token.length > 3800 || !/^[A-Za-z0-9_-]+$/.test(token)) return null;
    const bytes = Buffer.from(token, 'base64url');
    const decipher = createDecipheriv('aes-256-gcm', key(secret), bytes.subarray(0, 12));
    decipher.setAuthTag(bytes.subarray(12, 28));
    const value = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString());
    return Number.isFinite(value.expires) && value.expires > now ? value : null;
  } catch { return null; }
}
export function authContext(raw = {}) {
  return Object.fromEntries(Object.entries({
    plan: ['trace', 'supporter'].includes(raw.plan) ? raw.plan : null,
    userCode: /^[A-Z2-7]{10}$/.test(raw.userCode || '') ? raw.userCode : null,
    download: ['mac', 'windows'].includes(raw.download) ? raw.download : null,
    setup: raw.setup === 'payment' ? 'payment' : null,
  }).filter(([,v]) => v));
}
export function authDestination(context) {
  const safe = authContext(context);
  const query = new URLSearchParams(safe).toString();
  return `/trace/${safe.userCode ? 'connect' : 'account'}${query ? '?' + query : ''}`;
}
