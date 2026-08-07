import { Router } from 'express';
import { parse } from 'csv-parse/sync';
import multer from 'multer';

import { Contact } from '../models/Contact.js';
import { Institution } from '../models/Institution.js';
import { ScrapeJob } from '../models/ScrapeJob.js';
import { isSuppressed } from '../models/Suppression.js';
import { requireAuth } from '../middleware/auth.js';
import { directoryCities, searchDirectory } from '../utils/directory.js';
import { findWebsite, hasMx, scrapeSite } from '../utils/scraper.js';
import { dedupeKey } from './contacts.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 4 * 1024 * 1024 } });

/**
 * Work through a job's sites one at a time. Deliberately sequential and slow —
 * hammering a few hundred college servers in parallel is both rude and a fast
 * way to get our IP blocked.
 */
async function runJob(jobId) {
  const job = await ScrapeJob.findById(jobId);
  if (!job) return;
  job.status = 'running';
  await job.save();

  for (let i = 0; i < job.results.length; i++) {
    const row = job.results[i];
    try {
      // Only a college name? Find its official site first.
      if (!row.website && row.collegeName) {
        row.website = await findWebsite(row.collegeName);
        if (!row.website) {
          row.status = 'failed';
          row.error = 'Could not find a website for that name';
          job.processed = i + 1;
          job.markModified('results');
          await job.save();
          continue;
        }
      }
      const { contacts, pagesFetched, error } = await scrapeSite(row.website, { maxPages: 16 });
      // Verify each address's domain actually accepts mail before we keep it.
      const checked = [];
      for (const c of contacts.slice(0, 12)) {
        checked.push({ ...c, hasMx: await hasMx(c.email) });
      }
      row.contacts = checked;
      row.pagesFetched = pagesFetched;
      row.status = error ? (/robots/i.test(error) ? 'blocked' : 'failed') : 'done';
      row.error = error || '';
      job.foundContacts += checked.length;
    } catch (err) {
      row.status = 'failed';
      row.error = String(err?.message || err).slice(0, 200);
    }
    job.processed = i + 1;
    job.markModified('results');
    await job.save();
  }

  job.status = 'done';
  job.finishedAt = new Date();
  await job.save();
}

/* Start a scrape. Accepts a JSON list of sites, or a CSV upload with
 * college,website[,city,state] columns. */
router.post('/run', requireAuth, upload.single('file'), async (req, res) => {
  try {
    let rows = [];

    if (req.file) {
      const parsed = parse(req.file.buffer.toString('utf8'), {
        columns: (h) => h.map((x) => x.trim().toLowerCase().replace(/\s+/g, '_')),
        skip_empty_lines: true,
        trim: true,
        relax_column_count: true,
      });
      rows = parsed.map((r) => ({
        collegeName: r.college || r.institution || r.name || '',
        website: r.website || r.url || r.domain || '',
        city: r.city || '',
        state: r.state || '',
      }));
    } else if (Array.isArray(req.body?.sites)) {
      // Each line is either a website or a college name — tell them apart so
      // you can paste whichever list you happen to have.
      const looksLikeSite = (s) => /^https?:\/\//i.test(s) || /^[\w-]+(\.[\w-]+)+$/.test(s.trim());
      rows = req.body.sites.map((s) => (typeof s === 'string'
        ? (looksLikeSite(s)
          ? { website: s.trim(), collegeName: '', city: '', state: '' }
          : { website: '', collegeName: s.trim(), city: '', state: '' })
        : { website: s.website || '', collegeName: s.collegeName || '', city: s.city || '', state: s.state || '' }));
    }

    // A website OR a college name is enough — the name is resolved to a site.
    rows = rows.filter((r) => r.website || r.collegeName).slice(0, 300);
    if (!rows.length) return res.status(400).json({ error: 'Give me at least one website.' });

    const job = await ScrapeJob.create({
      total: rows.length,
      results: rows.map((r) => ({ ...r, status: 'pending' })),
    });

    runJob(job._id).catch((err) => console.error('scrape job failed', err));
    res.status(201).json({ id: job._id, total: rows.length });
  } catch (err) {
    console.error('scrape run', err);
    res.status(500).json({ error: 'Could not start the scrape.' });
  }
});

/* ── College directory (Careers360 sitemap index) ────────────────────────── */

router.get('/directory', requireAuth, async (req, res) => {
  try {
    const out = await searchDirectory({
      q: String(req.query.q || ''),
      city: String(req.query.city || ''),
      limit: Math.min(Number(req.query.limit) || 100, 300),
      offset: Number(req.query.offset) || 0,
    });
    res.json(out);
  } catch (err) {
    console.error('directory search', err);
    res.status(500).json({ error: 'Could not load the college directory.' });
  }
});

router.get('/directory/cities', requireAuth, async (_req, res) => {
  try {
    res.json({ rows: await directoryCities() });
  } catch (err) {
    console.error('directory cities', err);
    res.status(500).json({ error: 'Could not load cities.' });
  }
});

router.get('/jobs', requireAuth, async (_req, res) => {
  const rows = await ScrapeJob.find().select('-results').sort('-createdAt').limit(20).lean();
  res.json({ rows });
});

router.get('/jobs/:id', requireAuth, async (req, res) => {
  const job = await ScrapeJob.findById(req.params.id).lean();
  if (!job) return res.status(404).json({ error: 'Not found.' });
  res.json(job);
});

/**
 * Approve scraped results into the real contact database.
 * `minScore` keeps the junk out; anything without MX is always skipped.
 */
router.post('/jobs/:id/import', requireAuth, async (req, res) => {
  try {
    const job = await ScrapeJob.findById(req.params.id);
    if (!job) return res.status(404).json({ error: 'Not found.' });

    const minScore = Number(req.body?.minScore ?? 60);
    const only = Array.isArray(req.body?.emails) ? new Set(req.body.emails) : null;
    const out = { institutions: 0, contacts: 0, skipped: 0 };

    for (const row of job.results) {
      const wanted = row.contacts.filter((c) => (only ? only.has(c.email) : c.score >= minScore && c.hasMx));
      if (!wanted.length) continue;

      const name = row.collegeName || row.website.replace(/^https?:\/\//, '').replace(/^www\./, '');
      const key = dedupeKey(name, row.city);
      let inst = await Institution.findOne({ dedupeKey: key });
      if (!inst) {
        inst = await Institution.create({
          name,
          dedupeKey: key,
          city: row.city || '',
          state: row.state || '',
          website: row.website,
          domain: row.website.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, ''),
          source: 'scraper',
        });
        out.institutions += 1;
      }

      for (const c of wanted) {
        if (await isSuppressed(c.email)) { out.skipped += 1; continue; }
        if (await Contact.findOne({ email: c.email })) { out.skipped += 1; continue; }
        try {
          await Contact.create({
            institution: inst._id,
            name: c.name || '',
            designation: c.designation || c.role || '',
            email: c.email,
            phone: c.phone || '',
            source: 'scraper',
            notes: `Found on ${c.sourceUrl || row.website}`,
          });
          c.imported = true;
          out.contacts += 1;
        } catch {
          out.skipped += 1;
        }
      }
    }

    job.importedContacts += out.contacts;
    job.markModified('results');
    await job.save();
    res.json(out);
  } catch (err) {
    console.error('scrape import', err);
    res.status(500).json({ error: 'Could not import.' });
  }
});

export default router;
