import { createHmac, timingSafeEqual } from 'node:crypto';
export const REFERRAL_COOKIE = '__Host-trace-referral';
export const REFERRAL_SECONDS = 86400;
export const creatorCode = value => typeof value === 'string' && value.trim().toLowerCase() === 'jakeptcg' ? 'jakeptcg' : null;
const sign = (payload, secret) => createHmac('sha256', secret).update(`trace-referral-v1.${payload}`).digest('base64url');
export function issueReferral(code, secret, now = Math.floor(Date.now() / 1000)) {
  if (!creatorCode(code) || typeof secret !== 'string' || secret.length < 43) throw new Error('Referral unavailable');
  const payload = Buffer.from(JSON.stringify({ code: creatorCode(code), at: now })).toString('base64url');
  return `${payload}.${sign(payload, secret)}`;
}
export function readReferral(token, secret, now = Math.floor(Date.now() / 1000)) {
  try {
    if (typeof token !== 'string' || token.length > 512 || !/^[\w-]+\.[\w-]+$/.test(token) || typeof secret !== 'string' || secret.length < 43) return null;
    const [payload, signature] = token.split('.'), expected = sign(payload, secret);
    if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
    const value = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return creatorCode(value.code) && Number.isSafeInteger(value.at) && value.at <= now && now < value.at + REFERRAL_SECONDS ? value : null;
  } catch { return null; }
}
