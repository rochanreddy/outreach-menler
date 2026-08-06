import mongoose from 'mongoose';

// The do-not-contact list. Checked before EVERY send, and it wins over
// everything else — an unsubscribe must survive re-imports, new campaigns and
// duplicate contact rows, so it's keyed by address/domain rather than contact id.
const suppressionSchema = new mongoose.Schema(
  {
    // Either a full address (person@college.edu) or a bare domain (college.edu)
    // to block an entire institution that asked to be left alone.
    value: { type: String, required: true, lowercase: true, trim: true, unique: true, index: true },
    kind: { type: String, enum: ['email', 'domain'], default: 'email', index: true },
    reason: { type: String, default: '' },       // unsubscribed | bounced | complained | manual
    note: { type: String, default: '' },
  },
  { timestamps: true },
);

/** True when this address (or its domain) is suppressed. */
export async function isSuppressed(email) {
  const addr = String(email || '').toLowerCase().trim();
  if (!addr) return true;
  const domain = addr.split('@')[1] || '';
  const hit = await Suppression.findOne({ value: { $in: [addr, domain].filter(Boolean) } }).lean();
  return Boolean(hit);
}

/** Add to the do-not-contact list (idempotent). */
export async function suppress(value, reason = 'manual', note = '') {
  const v = String(value || '').toLowerCase().trim();
  if (!v) return null;
  return Suppression.findOneAndUpdate(
    { value: v },
    { $setOnInsert: { value: v, kind: v.includes('@') ? 'email' : 'domain', reason, note } },
    { upsert: true, new: true },
  );
}

export const Suppression = mongoose.models.Suppression
  || mongoose.model('Suppression', suppressionSchema, 'out_suppressions');
