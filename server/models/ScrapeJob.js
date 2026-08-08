import mongoose from 'mongoose';

// One scraping run over a list of college websites. Results are held here for
// review — nothing enters the contact database until a human approves it, so a
// bad extraction can't silently end up being emailed.
const resultSchema = new mongoose.Schema(
  {
    website: String,
    collegeName: String,
    siteTitle: String,   // readable name read off the homepage <title>
    city: String,
    state: String,
    status: { type: String, default: 'pending' }, // pending | done | failed | blocked
    pagesFetched: { type: Number, default: 0 },
    error: { type: String, default: '' },
    contacts: {
      type: [{
        email: String,
        name: String,
        designation: String,
        role: String,
        phone: String,
        score: Number,
        onDomain: Boolean,
        hasMx: Boolean,
        sourceUrl: String,
        imported: { type: Boolean, default: false },
      }],
      default: [],
    },
  },
  { _id: false },
);

const scrapeJobSchema = new mongoose.Schema(
  {
    status: { type: String, enum: ['queued', 'running', 'done', 'failed'], default: 'queued', index: true },
    total: { type: Number, default: 0 },
    processed: { type: Number, default: 0 },
    foundContacts: { type: Number, default: 0 },
    importedContacts: { type: Number, default: 0 },
    results: { type: [resultSchema], default: [] },
    startedAt: { type: Date, default: Date.now },
    finishedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

export const ScrapeJob = mongoose.models.ScrapeJob
  || mongoose.model('ScrapeJob', scrapeJobSchema, 'out_scrape_jobs');
