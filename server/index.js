import 'dotenv/config';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import mongoose from 'mongoose';

import { COOKIE, cookieOptions, requireAuth, safeEqual, signSession } from './middleware/auth.js';
import campaignRoutes from './routes/campaigns.js';
import contactRoutes from './routes/contacts.js';
import trackingRoutes from './routes/tracking.js';
import { startScheduler } from './utils/engine.js';

const app = express();
const port = Number(process.env.PORT || 4200); // 4000 marketing, 4100 LMS, 4200 outreach

// The admin UI is a separate origin; cookies need explicit credentials + origin.
const allowed = new Set(
  (process.env.OUTREACH_APP_URL || 'http://localhost:5175')
    .split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean),
);
app.use(cors({
  origin(origin, cb) {
    if (!origin || allowed.has(origin.replace(/\/+$/, ''))) return cb(null, true);
    return cb(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());

app.get('/health', (_req, res) => res.json({ ok: true, service: 'menler-outreach' }));

/* Auth */
app.post('/auth/login', (req, res) => {
  const { username = '', password = '' } = req.body || {};
  const envUser = process.env.OUTREACH_USERNAME;
  const envPass = process.env.OUTREACH_PASSWORD;
  if (!envUser || !envPass) return res.status(500).json({ error: 'Login is not configured.' });
  if (!(safeEqual(username, envUser) && safeEqual(password, envPass))) {
    return res.status(401).json({ error: 'Invalid username or password.' });
  }
  res.cookie(COOKIE, signSession(), cookieOptions());
  res.json({ ok: true });
});
app.post('/auth/logout', (_req, res) => {
  res.clearCookie(COOKIE, { path: '/' });
  res.json({ ok: true });
});
app.get('/auth/session', requireAuth, (_req, res) => res.json({ authenticated: true }));

/* Recipient-facing (public, unauthenticated) */
app.use('/track', trackingRoutes);

/* Admin API */
app.use('/api', contactRoutes);
app.use('/api/campaigns', campaignRoutes);

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('MONGODB_URI is not set — refusing to start.');
  process.exit(1);
}

mongoose.connect(uri)
  .then(() => {
    console.log('MongoDB connected (outreach → out_* collections)');
    app.listen(port, () => {
      console.log(`Menler outreach API on http://localhost:${port}`);
      if (process.env.OUTREACH_SCHEDULER !== 'off') {
        startScheduler();
        console.log('Scheduler started — active campaigns will send within their windows.');
      } else {
        console.log('Scheduler disabled (OUTREACH_SCHEDULER=off).');
      }
    });
  })
  .catch((err) => {
    console.error('MongoDB connection failed:', err.message);
    process.exit(1);
  });
