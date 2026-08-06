import mongoose from 'mongoose';

// One contact's journey through one campaign. The scheduler works off this:
// "who is due right now?" = { status: 'active', nextSendAt: { $lte: now } }.
const enrollmentSchema = new mongoose.Schema(
  {
    campaign: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign', required: true, index: true },
    contact: { type: mongoose.Schema.Types.ObjectId, ref: 'Contact', required: true, index: true },
    institution: { type: mongoose.Schema.Types.ObjectId, ref: 'Institution', index: true },

    status: {
      type: String,
      enum: ['active', 'replied', 'completed', 'bounced', 'unsubscribed', 'stopped'],
      default: 'active',
      index: true,
    },
    stepIndex: { type: Number, default: 0 },     // next step to send
    nextSendAt: { type: Date, default: () => new Date(), index: true },

    // Threading: every follow-up references the first message so it lands in
    // the same conversation instead of starting a new one.
    rootMessageId: { type: String, default: '' },

    sentCount: { type: Number, default: 0 },
    lastSentAt: { type: Date, default: null },
    repliedAt: { type: Date, default: null },
    stoppedReason: { type: String, default: '' },
  },
  { timestamps: true },
);

// A contact is only ever in a campaign once.
enrollmentSchema.index({ campaign: 1, contact: 1 }, { unique: true });
// The scheduler's hot path.
enrollmentSchema.index({ status: 1, nextSendAt: 1 });

export const Enrollment = mongoose.models.Enrollment
  || mongoose.model('Enrollment', enrollmentSchema, 'out_enrollments');
