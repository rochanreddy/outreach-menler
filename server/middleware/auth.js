import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';

// Single-team auth: username/password from env → signed cookie. Same shape as
// the marketing admin panel so the team logs in the way they already know.
export const COOKIE = 'outreach_token';
const SECRET = () => process.env.JWT_SECRET || 'dev-secret';

export function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) { crypto.timingSafeEqual(ba, ba); return false; }
  return crypto.timingSafeEqual(ba, bb);
}

export const signSession = () => jwt.sign({ role: 'admin' }, SECRET(), { expiresIn: '7d' });

export const cookieOptions = () => {
  // In production the UI and API sit on different domains, so the cookie must be
  // SameSite=None — which browsers only accept when it's also Secure. Over plain
  // HTTP in local dev that combination is rejected outright (the cookie silently
  // never gets stored), so dev uses Lax: localhost:5175 → localhost:4200 counts
  // as same-site, since ports don't affect SameSite.
  const isProd = process.env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    sameSite: isProd ? 'none' : 'lax',
    secure: isProd,
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/',
  };
};

export function requireAuth(req, res, next) {
  const token = req.cookies?.[COOKIE];
  try {
    const payload = token ? jwt.verify(token, SECRET()) : null;
    if (payload?.role === 'admin') return next();
  } catch { /* fall through */ }
  return res.status(401).json({ error: 'Not authenticated.' });
}
