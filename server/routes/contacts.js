import { Router } from 'express';
import { parse } from 'csv-parse/sync';
import multer from 'multer';

import { Contact } from '../models/Contact.js';
import { Institution, PIPELINE } from '../models/Institution.js';
import { isSuppressed, Suppression, suppress } from '../models/Suppression.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const clampInt = (v, def, min, max) => {
  const n = Number.parseInt(v, 10);
  return Number.isNaN(n) ? def : Math.min(max, Math.max(min, n));
};

/** Stable key so re-importing the same college doesn't duplicate it. */
export const dedupeKey = (name, city = '') =>
  `${String(name).toLowerCase().replace(/[^a-z0-9]+/g, '')}|${String(city).toLowerCase().replace(/[^a-z0-9]+/g, '')}`;

/* ── Institutions ────────────────────────────────────────────────────────── */

router.get('/institutions', requireAuth, async (req, res) => {
  try {
    const limit = clampInt(req.query.limit, 50, 1, 200);
    const page = clampInt(req.query.page, 1, 1, 10000);
    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    if (req.query.state) filter.state = req.query.state;
    if (req.query.search) {
      const rx = new RegExp(esc(req.query.search.trim()), 'i');
      filter.$or = [{ name: rx }, { city: rx }, { state: rx }, { domain: rx }];
    }
    const [rows, total] = await Promise.all([
      Institution.find(filter).sort('-updatedAt').skip((page - 1) * limit).limit(limit).lean(),
      Institution.countDocuments(filter),
    ]);
    // Attach contact counts so the list is useful at a glance.
    const ids = rows.map((r) => r._id);
    const counts = await Contact.aggregate([
      { $match: { institution: { $in: ids } } },
      { $group: { _id: '$institution', n: { $sum: 1 } } },
    ]);
    const byId = new Map(counts.map((c) => [String(c._id), c.n]));
    res.json({
      rows: rows.map((r) => ({ ...r, contactCount: byId.get(String(r._id)) || 0 })),
      total, page, limit,
    });
  } catch (err) {
    console.error('institutions list', err);
    res.status(500).json({ error: 'Could not load institutions.' });
  }
});

router.post('/institutions', requireAuth, async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.name?.trim()) return res.status(400).json({ error: 'A name is required.' });
    const inst = await Institution.create({
      ...b,
      name: b.name.trim(),
      dedupeKey: dedupeKey(b.name, b.city),
      source: b.source || 'manual',
    });
    res.status(201).json(inst);
  } catch (err) {
    console.error('institution create', err);
    res.status(500).json({ error: 'Could not save the institution.' });
  }
});

router.patch('/institutions/:id', requireAuth, async (req, res) => {
  try {
    const allowed = ['name', 'type', 'website', 'domain', 'city', 'state', 'aicteCode',
      'studentCount', 'status', 'owner', 'tags', 'notes'];
    const update = {};
    for (const k of allowed) if (k in (req.body || {})) update[k] = req.body[k];
    if (update.status && !PIPELINE.includes(update.status)) {
      return res.status(400).json({ error: 'Unknown status.' });
    }
    const inst = await Institution.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!inst) return res.status(404).json({ error: 'Not found.' });
    res.json(inst);
  } catch (err) {
    console.error('institution update', err);
    res.status(500).json({ error: 'Could not update.' });
  }
});

/* ── Contacts ────────────────────────────────────────────────────────────── */

router.get('/contacts', requireAuth, async (req, res) => {
  try {
    const limit = clampInt(req.query.limit, 50, 1, 200);
    const page = clampInt(req.query.page, 1, 1, 10000);
    const filter = {};
    if (req.query.institution) filter.institution = req.query.institution;
    if (req.query.sendable === 'true') { filter.unsubscribed = false; filter.bounced = false; }
    if (req.query.search) {
      const rx = new RegExp(esc(req.query.search.trim()), 'i');
      filter.$or = [{ name: rx }, { email: rx }, { designation: rx }, { phone: rx }];
    }
    const [rows, total] = await Promise.all([
      Contact.find(filter).populate('institution', 'name city state status')
        .sort('-updatedAt').skip((page - 1) * limit).limit(limit).lean(),
      Contact.countDocuments(filter),
    ]);
    res.json({ rows, total, page, limit });
  } catch (err) {
    console.error('contacts list', err);
    res.status(500).json({ error: 'Could not load contacts.' });
  }
});

router.post('/contacts', requireAuth, async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.email?.trim() || !b.institution) {
      return res.status(400).json({ error: 'An email and an institution are required.' });
    }
    if (await isSuppressed(b.email)) {
      return res.status(400).json({ error: 'That address is on the do-not-contact list.' });
    }
    const contact = await Contact.create({ ...b, email: b.email.toLowerCase().trim() });
    res.status(201).json(contact);
  } catch (err) {
    if (err?.code === 11000) return res.status(409).json({ error: 'That email already exists.' });
    console.error('contact create', err);
    res.status(500).json({ error: 'Could not save the contact.' });
  }
});

router.patch('/contacts/:id', requireAuth, async (req, res) => {
  try {
    const allowed = ['name', 'designation', 'department', 'phone', 'linkedinUrl', 'tags', 'notes', 'verified'];
    const update = {};
    for (const k of allowed) if (k in (req.body || {})) update[k] = req.body[k];
    const contact = await Contact.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!contact) return res.status(404).json({ error: 'Not found.' });
    res.json(contact);
  } catch (err) {
    console.error('contact update', err);
    res.status(500).json({ error: 'Could not update.' });
  }
});

router.delete('/contacts/:id', requireAuth, async (req, res) => {
  try {
    await Contact.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Could not delete.' });
  }
});

/* ── CSV import ──────────────────────────────────────────────────────────────
 * One row = one contact at one institution. The college is upserted by
 * name+city, so importing several people from the same college groups them.
 * Expected headers (case-insensitive, extras ignored):
 *   college, city, state, website, type, student_count,
 *   name, designation, department, email, phone, linkedin
 */
router.post('/import', requireAuth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Attach a CSV file.' });
    const rows = parse(req.file.buffer.toString('utf8'), {
      columns: (hdrs) => hdrs.map((h) => h.trim().toLowerCase().replace(/\s+/g, '_')),
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
    });

    const result = { rows: rows.length, institutions: 0, contacts: 0, skipped: 0, errors: [] };

    for (const [i, row] of rows.entries()) {
      const collegeName = row.college || row.institution || row.college_name || '';
      const email = String(row.email || '').toLowerCase().trim();
      if (!collegeName || !email || !email.includes('@')) { result.skipped += 1; continue; }
      if (await isSuppressed(email)) { result.skipped += 1; continue; }

      try {
        const key = dedupeKey(collegeName, row.city);
        let inst = await Institution.findOne({ dedupeKey: key });
        if (!inst) {
          inst = await Institution.create({
            name: collegeName.trim(),
            dedupeKey: key,
            city: row.city || '',
            state: row.state || '',
            website: row.website || '',
            domain: (row.website || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, ''),
            type: row.type || '',
            studentCount: Number(row.student_count || 0) || 0,
            source: 'csv',
          });
          result.institutions += 1;
        }

        const existing = await Contact.findOne({ email });
        if (existing) { result.skipped += 1; continue; }

        await Contact.create({
          institution: inst._id,
          name: row.name || '',
          designation: row.designation || row.title || '',
          department: row.department || '',
          email,
          phone: row.phone || row.mobile || '',
          linkedinUrl: row.linkedin || '',
          source: 'csv',
        });
        result.contacts += 1;
      } catch (err) {
        result.skipped += 1;
        if (result.errors.length < 10) result.errors.push(`Row ${i + 2}: ${err.message}`);
      }
    }
    res.json(result);
  } catch (err) {
    console.error('import', err);
    res.status(500).json({ error: 'Import failed — check the CSV format.' });
  }
});

/* ── Suppression list ────────────────────────────────────────────────────── */

router.get('/suppressions', requireAuth, async (req, res) => {
  const rows = await Suppression.find().sort('-createdAt').limit(500).lean();
  res.json({ rows });
});

router.post('/suppressions', requireAuth, async (req, res) => {
  const { value, reason, note } = req.body || {};
  if (!value) return res.status(400).json({ error: 'An email or domain is required.' });
  const row = await suppress(value, reason || 'manual', note || '');
  // Also flag any matching contact so it never gets picked up again.
  await Contact.updateMany({ email: String(value).toLowerCase() }, { unsubscribed: true, unsubscribedAt: new Date() });
  res.status(201).json(row);
});

export default router;
