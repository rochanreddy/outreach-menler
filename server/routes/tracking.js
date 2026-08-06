import { Router } from 'express';

import { Campaign } from '../models/Campaign.js';
import { Contact } from '../models/Contact.js';
import { Enrollment } from '../models/Enrollment.js';
import { Message } from '../models/Message.js';
import { suppress } from '../models/Suppression.js';
import { verifyToken } from '../utils/tokens.js';

// Public (unauthenticated) endpoints hit by recipients' mail clients.
const router = Router();

// 1×1 transparent GIF.
const PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

/* Open tracking — the pixel at the bottom of the HTML body. */
router.get('/open/:token.gif', async (req, res) => {
  const claims = verifyToken(req.params.token);
  if (claims?.m) {
    try {
      const message = await Message.findById(claims.m);
      if (message) {
        message.openCount += 1;
        if (!message.openedAt) {
          message.openedAt = new Date();
          await Campaign.updateOne({ _id: message.campaign }, { $inc: { 'stats.opened': 1 } });
        }
        await message.save();
      }
    } catch { /* never let tracking break the image */ }
  }
  res.setHeader('Content-Type', 'image/gif');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.send(PIXEL);
});

/* Click tracking — redirects to the real destination. */
router.get('/click/:token', async (req, res) => {
  const claims = verifyToken(req.params.token);
  if (!claims?.u) return res.status(400).send('Invalid link.');
  try {
    const message = await Message.findById(claims.m);
    if (message) {
      message.clickCount += 1;
      if (!message.clickedAt) {
        message.clickedAt = new Date();
        await Campaign.updateOne({ _id: message.campaign }, { $inc: { 'stats.clicked': 1 } });
      }
      await message.save();
    }
  } catch { /* still redirect */ }
  res.redirect(302, claims.u);
});

/* Unsubscribe — GET (link) and POST (RFC 8058 one-click) both honoured. */
async function doUnsubscribe(token) {
  const claims = verifyToken(token);
  if (!claims?.c) return false;
  const contact = await Contact.findById(claims.c);
  if (!contact) return false;

  if (!contact.unsubscribed) {
    contact.unsubscribed = true;
    contact.unsubscribedAt = new Date();
    await contact.save();
    await suppress(contact.email, 'unsubscribed');
    // Pull them out of every running sequence immediately.
    const active = await Enrollment.find({ contact: contact._id, status: 'active' });
    for (const e of active) {
      e.status = 'unsubscribed';
      e.stoppedReason = 'unsubscribed';
      e.nextSendAt = null;
      await e.save();
      await Campaign.updateOne({ _id: e.campaign }, { $inc: { 'stats.unsubscribed': 1 } });
    }
  }
  return true;
}

router.get('/unsubscribe/:token', async (req, res) => {
  const ok = await doUnsubscribe(req.params.token);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!doctype html><meta charset="utf-8"/>
<title>Unsubscribed</title>
<div style="font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;max-width:520px;margin:14vh auto;padding:0 24px;color:#1f2430;line-height:1.6;">
  <h1 style="font-size:22px;margin:0 0 10px;">${ok ? 'You’ve been unsubscribed' : 'Link expired'}</h1>
  <p style="color:#6b6880;">${ok
    ? 'You won’t receive any further emails from us. Sorry for the interruption.'
    : 'We couldn’t process that link, but you can reply to any of our emails and we’ll remove you right away.'}</p>
</div>`);
});

router.post('/unsubscribe/:token', async (req, res) => {
  await doUnsubscribe(req.params.token);
  res.json({ ok: true });
});

export default router;
