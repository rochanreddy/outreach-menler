import mongoose from 'mongoose';

// One email we actually sent. The audit trail — proves what went to whom, and
// carries the open/click/reply/bounce signals back.
const messageSchema = new mongoose.Schema(
  {
    campaign: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign', index: true },
    enrollment: { type: mongoose.Schema.Types.ObjectId, ref: 'Enrollment', index: true },
    contact: { type: mongoose.Schema.Types.ObjectId, ref: 'Contact', index: true },
    institution: { type: mongoose.Schema.Types.ObjectId, ref: 'Institution', index: true },

    stepIndex: { type: Number, default: 0 },
    to: { type: String, default: '' },
    subject: { type: String, default: '' },
    body: { type: String, default: '' },        // rendered copy, as sent

    messageId: { type: String, default: '', index: true }, // RFC Message-ID
    status: { type: String, enum: ['sent', 'failed'], default: 'sent', index: true },
    error: { type: String, default: '' },

    sentAt: { type: Date, default: Date.now, index: true },
    openedAt: { type: Date, default: null },
    openCount: { type: Number, default: 0 },
    clickedAt: { type: Date, default: null },
    clickCount: { type: Number, default: 0 },
    repliedAt: { type: Date, default: null },
    bouncedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

export const Message = mongoose.models.Message
  || mongoose.model('Message', messageSchema, 'out_messages');
