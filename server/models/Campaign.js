import mongoose from 'mongoose';

// A sequence of emails sent to enrolled contacts. Step 0 goes out first; each
// later step waits `delayDays` after the previous one and is SKIPPED entirely
// if the contact has replied (that's the whole point of a follow-up).
const stepSchema = new mongoose.Schema(
  {
    // Not required: a draft starts with an empty step you fill in. Both are
    // checked for real when the campaign is activated, which is the point where
    // an empty subject would actually matter.
    subject: { type: String, default: '' },
    body: { type: String, default: '' },     // plain text w/ {{placeholders}}
    delayDays: { type: Number, default: 3, min: 0, max: 60 },
    // Follow-ups usually thread under the first email (better reply rates).
    threaded: { type: Boolean, default: true },
  },
  { _id: false },
);

const campaignSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    status: { type: String, enum: ['draft', 'active', 'paused', 'done'], default: 'draft', index: true },
    fromName: { type: String, default: '' },
    fromEmail: { type: String, default: '' },   // must be on the outreach domain
    replyTo: { type: String, default: '' },

    steps: { type: [stepSchema], default: [] },

    // Throughput guards — the difference between "outreach" and "spam run".
    dailyCap: { type: Number, default: 40, min: 1, max: 500 },
    sendWindowStart: { type: Number, default: 10, min: 0, max: 23 }, // IST hour
    sendWindowEnd: { type: Number, default: 18, min: 1, max: 24 },
    weekdaysOnly: { type: Boolean, default: true },

    sentToday: { type: Number, default: 0 },
    sentTodayOn: { type: String, default: '' },  // YYYY-MM-DD (IST) for the counter reset

    stats: {
      enrolled: { type: Number, default: 0 },
      sent: { type: Number, default: 0 },
      opened: { type: Number, default: 0 },
      clicked: { type: Number, default: 0 },
      replied: { type: Number, default: 0 },
      bounced: { type: Number, default: 0 },
      unsubscribed: { type: Number, default: 0 },
    },
  },
  { timestamps: true },
);

export const Campaign = mongoose.models.Campaign
  || mongoose.model('Campaign', campaignSchema, 'out_campaigns');
