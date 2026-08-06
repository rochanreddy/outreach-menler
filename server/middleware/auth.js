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

export const cookieOptions = () => ({
  httpOnly: true,
  sameSite: 'none',
  secure: process.env.NODE_ENV === 'production',
  maxAge: 7 * 24 * 60 * 60 * 1000,
  path: '/',
});

export function requireAuth(req, res, next) {
  const token = req.cookies?.[COOKIE];
  try {
    const payload = token ? jwt.verify(token, SECRET()) : null;
    if (payload?.role === 'admin') return next();
  } catch { /* fall through */ }
  return res.status(401).json({ error: 'Not authenticated.' });
}
