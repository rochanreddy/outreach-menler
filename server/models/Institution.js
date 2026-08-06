import mongoose from 'mongoose';

// A college / university — the ACCOUNT we're selling to. Contacts (HOD, dean,
// TPO…) hang off this. Everything here is institutional, publicly-published
// data; personal student data never belongs in this system.
export const PIPELINE = ['new', 'contacted', 'replied', 'meeting', 'won', 'lost', 'unqualified'];

const institutionSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, index: true },
    // Normalised key for dedupe: lowercased name + city, punctuation stripped.
    dedupeKey: { type: String, index: true },

    type: { type: String, default: '' },        // engineering | management | arts | polytechnic…
    website: { type: String, default: '' },
    domain: { type: String, default: '', index: true }, // menler.edu — used to group contacts
    city: { type: String, default: '', index: true },
    state: { type: String, default: '', index: true },
    aicteCode: { type: String, default: '' },
    studentCount: { type: Number, default: 0 },

    status: { type: String, enum: PIPELINE, default: 'new', index: true },
    owner: { type: String, default: '' },       // which teammate owns the account
    tags: { type: [String], default: [] },
    notes: { type: String, default: '' },

    source: { type: String, default: 'manual' }, // manual | csv | aicte | apollo…
    lastContactedAt: { type: Date, default: null },
    lastRepliedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

institutionSchema.index({ name: 'text', city: 'text', state: 'text' });

export const Institution = mongoose.models.Institution
  || mongoose.model('Institution', institutionSchema, 'out_institutions');
