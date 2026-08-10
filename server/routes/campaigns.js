import crypto from 'node:crypto';
import { Router } from 'express';

import { Campaign } from '../models/Campaign.js';
import { Contact } from '../models/Contact.js';
import { Enrollment } from '../models/Enrollment.js';
import { Institution } from '../models/Institution.js';
import { Message } from '../models/Message.js';
import { isSuppressed } from '../models/Suppression.js';
import { requireAuth } from '../middleware/auth.js';
import { runTick, withinSendWindow } from '../utils/engine.js';
import { sendOutreachMail, verifyMailer } from '../utils/mailer.js';
import { buildHtml, buildText, contactVars, fillPlaceholders } from '../utils/render.js';

const router = Router();

/** Escape user input before it becomes a regex. */
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/* ── CRUD ────────────────────────────────────────────────────────────────── */

router.get('/', requireAuth, async (_req, res) => {
  const rows = await Campaign.find().sort('-updatedAt').lean();
  res.json({ rows });
});

router.get('/:id', requireAuth, async (req, res) => {
  const campaign = await Campaign.findById(req.params.id).lean();
  if (!campaign) return res.status(404).json({ error: 'Not found.' });
  const counts = await Enrollment.aggregate([
    { $match: { campaign: campaign._id } },
    { $group: { _id: '$status', n: { $sum: 1 } } },
  ]);
  res.json({ ...campaign, enrollmentsByStatus: Object.fromEntries(counts.map((c) => [c._id, c.n])) });
});

router.post('/', requireAuth, async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.name?.trim()) return res.status(400).json({ error: 'A campaign name is required.' });
    const campaign = await Campaign.create({ ...b, name: b.name.trim(), status: 'draft' });
    res.status(201).json(campaign);
  } catch (err) {
    console.error('campaign create', err);
    res.status(500).json({ error: 'Could not create the campaign.' });
  }
});

router.patch('/:id', requireAuth, async (req, res) => {
  try {
    const allowed = ['name', 'fromName', 'fromEmail', 'replyTo', 'steps',
      'dailyCap', 'sendWindowStart', 'sendWindowEnd', 'weekdaysOnly'];
    const update = {};
    for (const k of allowed) if (k in (req.body || {})) update[k] = req.body[k];
    const campaign = await Campaign.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!campaign) return res.status(404).json({ error: 'Not found.' });
    res.json(campaign);
  } catch (err) {
    console.error('campaign update', err);
    res.status(500).json({ error: 'Could not update.' });
  }
});

/* Activate / pause. Activating is the only thing that lets mail leave. */
router.post('/:id/status', requireAuth, async (req, res) => {
  const { status } = req.body || {};
  if (!['draft', 'active', 'paused', 'done'].includes(status)) {
    return res.status(400).json({ error: 'Unknown status.' });
  }
  const campaign = await Campaign.findById(req.params.id);
  if (!campaign) return res.status(404).json({ error: 'Not found.' });

  if (status === 'active') {
    if (!campaign.steps.length) return res.status(400).json({ error: 'Add at least one step first.' });
    // Empty copy is fine while drafting, but must never go out.
    const blank = campaign.steps.findIndex((s) => !s.subject?.trim() || !s.body?.trim());
    if (blank !== -1) {
      return res.status(400).json({
        error: `Step ${blank + 1} still needs a subject and a body.`,
      });
    }
    if (!campaign.fromEmail) return res.status(400).json({ error: 'Set a from-address first.' });
    const mail = await verifyMailer();
    if (!mail.ok) return res.status(400).json({ error: `Email is not ready: ${mail.error}` });
  }
  campaign.status = status;
  await campaign.save();
  res.json(campaign);
});

/* ── Enrolment ───────────────────────────────────────────────────────────────
 * Adds contacts to a campaign. Filters mirror the contacts list so you can
 * enrol "every TPO in Telangana" without hand-picking. Suppressed / bounced /
 * unsubscribed contacts are never enrolled. */
router.post('/:id/enroll', requireAuth, async (req, res) => {
  try {
    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) return res.status(404).json({ error: 'Not found.' });

    const b = req.body || {};
    let contacts;
    if (Array.isArray(b.contactIds) && b.contactIds.length) {
      contacts = await Contact.find({ _id: { $in: b.contactIds } });
    } else {
      const instFilter = {};
      if (b.state) instFilter.state = new RegExp(esc(b.state), 'i');
      if (b.city) instFilter.city = new RegExp(esc(b.city), 'i');
      if (b.status) instFilter.status = b.status;
      const instIds = Object.keys(instFilter).length
        ? (await Institution.find(instFilter).select('_id').lean()).map((i) => i._id)
        : null;

      const filter = { unsubscribed: false, bounced: false };
      if (instIds) filter.institution = { $in: instIds };
      // Match the role either in the designation text or in the address itself,
      // so "placement" catches both "Training & Placement Officer" and
      // placements@college.edu.
      if (b.role) {
        const rx = new RegExp(esc(b.role), 'i');
        filter.$or = [{ designation: rx }, { email: rx }];
      }
      contacts = await Contact.find(filter).limit(Number(b.limit) || 500);
    }

    // Count-only mode, so you can see who'd be included before committing.
    if (b.dryRun) {
      const already = await Enrollment.countDocuments({
        campaign: campaign._id,
        contact: { $in: contacts.map((c) => c._id) },
      });
      return res.json({
        matched: contacts.length,
        alreadyEnrolled: already,
        wouldEnroll: Math.max(0, contacts.length - already),
        sample: contacts.slice(0, 8).map((c) => ({ email: c.email, designation: c.designation })),
      });
    }

    const out = { enrolled: 0, skipped: 0 };
    for (const contact of contacts) {
      if (!contact.isSendable() || await isSuppressed(contact.email)) { out.skipped += 1; continue; }
      try {
        await Enrollment.create({
          campaign: campaign._id,
          contact: contact._id,
          institution: contact.institution,
          nextSendAt: new Date(),
        });
        out.enrolled += 1;
      } catch (err) {
        out.skipped += 1; // duplicate key = already enrolled
      }
    }
    campaign.stats.enrolled += out.enrolled;
    await campaign.save();
    res.json(out);
  } catch (err) {
    console.error('enroll', err);
    res.status(500).json({ error: 'Could not enrol contacts.' });
  }
});

/**
 * Who's in this campaign and what happened to them — the view you actually
 * work from. Each row carries its send/open history so you can see at a glance
 * who read it and never replied (the people worth a nudge).
 */
router.get('/:id/enrollments', requireAuth, async (req, res) => {
  const filter = { campaign: req.params.id };
  if (req.query.status) filter.status = req.query.status;
  const rows = await Enrollment.find(filter)
    .populate('contact', 'name email designation')
    .populate('institution', 'name city state')
    .sort('-updatedAt').limit(300).lean();

  // Fold each enrolment's messages into a small summary.
  const ids = rows.map((r) => r._id);
  const stats = await Message.aggregate([
    { $match: { enrollment: { $in: ids } } },
    {
      $group: {
        _id: '$enrollment',
        sent: { $sum: { $cond: [{ $eq: ['$status', 'sent'] }, 1, 0] } },
        opens: { $sum: '$openCount' },
        clicks: { $sum: '$clickCount' },
        firstOpenedAt: { $min: '$openedAt' },
        lastSentAt: { $max: '$sentAt' },
      },
    },
  ]);
  const byEnrollment = new Map(stats.map((s) => [String(s._id), s]));

  res.json({
    rows: rows.map((r) => {
      const s = byEnrollment.get(String(r._id)) || {};
      return {
        ...r,
        sentCount: s.sent || 0,
        openCount: s.opens || 0,
        clickCount: s.clicks || 0,
        openedAt: s.firstOpenedAt || null,
        lastSentAt: s.lastSentAt || r.lastSentAt,
      };
    }),
  });
});

/* Mark a reply — stops every follow-up for that contact instantly. */
router.post('/enrollments/:id/replied', requireAuth, async (req, res) => {
  const enrollment = await Enrollment.findById(req.params.id);
  if (!enrollment) return res.status(404).json({ error: 'Not found.' });
  enrollment.status = 'replied';
  enrollment.repliedAt = new Date();
  enrollment.nextSendAt = null;
  await enrollment.save();

  await Campaign.updateOne({ _id: enrollment.campaign }, { $inc: { 'stats.replied': 1 } });
  await Contact.updateOne({ _id: enrollment.contact }, { lastRepliedAt: new Date() });
  await Institution.updateOne(
    { _id: enrollment.institution, status: { $in: ['new', 'contacted'] } },
    { status: 'replied', lastRepliedAt: new Date() },
  );
  res.json({ ok: true });
});

/* ── Preview & test ──────────────────────────────────────────────────────── */

/** Render a step against a real contact — catches broken placeholders early. */
router.post('/:id/preview', requireAuth, async (req, res) => {
  const campaign = await Campaign.findById(req.params.id);
  if (!campaign) return res.status(404).json({ error: 'Not found.' });
  const step = campaign.steps[Number(req.body?.stepIndex) || 0];
  if (!step) return res.status(400).json({ error: 'No such step.' });

  const contact = req.body?.contactId
    ? await Contact.findById(req.body.contactId)
    : await Contact.findOne({ unsubscribed: false, bounced: false });
  if (!contact) return res.status(400).json({ error: 'Add a contact first to preview against.' });

  const institution = await Institution.findById(contact.institution);
  const vars = contactVars(contact, institution);
  res.json({
    to: contact.email,
    subject: fillPlaceholders(step.subject, vars),
    text: buildText(fillPlaceholders(step.body, vars), {
      contactId: contact._id, senderSignature: process.env.OUTREACH_SIGNATURE || '',
    }),
  });
});

/** Send one step to your own inbox — always do this before activating. */
router.post('/:id/test', requireAuth, async (req, res) => {
  try {
    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) return res.status(404).json({ error: 'Not found.' });
    const to = String(req.body?.to || '').trim();
    if (!to) return res.status(400).json({ error: 'Where should the test go?' });
    const step = campaign.steps[Number(req.body?.stepIndex) || 0];
    if (!step) return res.status(400).json({ error: 'No such step.' });

    const sample = {
      first_name: 'Anita', name: 'Dr. Anita Rao', designation: 'Training & Placement Officer',
      department: 'CSE', college: 'Sample Institute of Technology', city: 'Hyderabad',
      state: 'Telangana', email: to,
    };
    const body = fillPlaceholders(step.body, sample);
    const fakeId = 'test000000000000000000000';
    await sendOutreachMail({
      to,
      subject: `[TEST] ${fillPlaceholders(step.subject, sample)}`,
      text: buildText(body, { contactId: fakeId, senderSignature: process.env.OUTREACH_SIGNATURE || '' }),
      html: buildHtml(body, { contactId: fakeId, messageId: fakeId, senderSignature: process.env.OUTREACH_SIGNATURE || '' }),
      fromName: campaign.fromName,
      fromEmail: campaign.fromEmail,
      replyTo: campaign.replyTo,
    });
    campaign.lastTestAt = new Date();
    campaign.lastTestTo = to;
    await campaign.save();
    res.json({ ok: true, lastTestAt: campaign.lastTestAt, lastTestTo: to });
  } catch (err) {
    res.status(500).json({ error: err?.message || 'Test send failed.' });
  }
});

/* ── Ops ─────────────────────────────────────────────────────────────────── */

/** Health: is mail configured, and is each campaign currently allowed to send? */
router.get('/ops/status', requireAuth, async (_req, res) => {
  const mail = await verifyMailer();
  const campaigns = await Campaign.find({ status: 'active' }).lean();
  res.json({
    mail,
    active: campaigns.map((c) => ({
      id: c._id, name: c.name, sendingNow: withinSendWindow(c),
      sentToday: c.sentTodayOn === new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10) ? c.sentToday : 0,
      dailyCap: c.dailyCap,
    })),
  });
});

/** Force a scheduler tick (handy right after activating). */
router.post('/ops/tick', requireAuth, async (_req, res) => {
  res.json(await runTick());
});

/**
 * Tick via a secret URL, for an external scheduler (cron-job.org, GitHub
 * Actions, Render Cron…). On a free host the service sleeps when idle, which
 * would stop the in-process scheduler and silently halt a campaign — pinging
 * this both wakes the service and sends whatever is due.
 *
 * GET so any cron service can call it. Guarded by OUTREACH_CRON_TOKEN, and
 * disabled entirely when that isn't set.
 */
router.get('/ops/cron/:token', async (req, res) => {
  const expected = process.env.OUTREACH_CRON_TOKEN;
  if (!expected) return res.status(404).json({ error: 'Cron trigger is not enabled.' });
  const given = String(req.params.token || '');
  // Constant-time compare so the token can't be guessed by timing.
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ error: 'Bad token.' });
  }
  try {
    res.json({ ok: true, ...(await runTick()) });
  } catch (err) {
    console.error('cron tick failed', err.message);
    res.status(500).json({ error: 'Tick failed.' });
  }
});

/** Everything sent for a campaign — the audit trail. */
router.get('/:id/messages', requireAuth, async (req, res) => {
  const rows = await Message.find({ campaign: req.params.id })
    .populate('contact', 'name email')
    .sort('-sentAt').limit(200).lean();
  res.json({ rows });
});

export default router;
