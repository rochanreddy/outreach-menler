import mongoose from 'mongoose';

// A person at an institution — placement officer, HOD, dean, principal.
// Sourced from published institutional pages / licensed B2B databases, and
// always reachable in a professional capacity at that institution.
const contactSchema = new mongoose.Schema(
  {
    institution: { type: mongoose.Schema.Types.ObjectId, ref: 'Institution', required: true, index: true },

    name: { type: String, default: '', trim: true },
    firstName: { type: String, default: '' },   // derived on save; used by {{first_name}}
    designation: { type: String, default: '' }, // TPO | HOD-CSE | Dean | Principal…
    department: { type: String, default: '' },

    email: { type: String, required: true, lowercase: true, trim: true, unique: true, index: true },
    phone: { type: String, default: '' },
    linkedinUrl: { type: String, default: '' },  // manually noted only — never scraped

    // Deliverability state. Any of these true → never send.
    unsubscribed: { type: Boolean, default: false, index: true },
    unsubscribedAt: { type: Date, default: null },
    bounced: { type: Boolean, default: false, index: true },
    bounceReason: { type: String, default: '' },

    verified: { type: Boolean, default: false }, // email-verified by the source
    source: { type: String, default: 'manual' },
    tags: { type: [String], default: [] },
    notes: { type: String, default: '' },

    lastSentAt: { type: Date, default: null },
    lastRepliedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

contactSchema.pre('save', function setFirstName(next) {
  if (this.name && !this.firstName) {
    // "Dr. Anita Rao" → "Anita" (drop common honorifics)
    const cleaned = this.name.replace(/^(dr|prof|mr|mrs|ms|shri|smt)\.?\s+/i, '').trim();
    this.firstName = cleaned.split(/\s+/)[0] || '';
  }
  next();
});

/** True when this contact must not receive mail. */
contactSchema.methods.isSendable = function isSendable() {
  return !this.unsubscribed && !this.bounced && Boolean(this.email);
};

export const Contact = mongoose.models.Contact
  || mongoose.model('Contact', contactSchema, 'out_contacts');
