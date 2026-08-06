import crypto from 'node:crypto';

// Short signed tokens for unsubscribe / open / click links. HMAC keeps them
// tamper-proof so nobody can unsubscribe someone else or forge tracking.
const SECRET = () => process.env.OUTREACH_TOKEN_SECRET || process.env.JWT_SECRET || 'dev-secret';

const b64u = (buf) => Buffer.from(buf).toString('base64url');

export function signToken(payload) {
  const body = b64u(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', SECRET()).update(body).digest('base64url').slice(0, 24);
  return `${body}.${sig}`;
}

export function verifyToken(token) {
  const [body, sig] = String(token || '').split('.');
  if (!body || !sig) return null;
  const expected = crypto.createHmac('sha256', SECRET()).update(body).digest('base64url').slice(0, 24);
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  } catch {
    return null;
  }
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}
