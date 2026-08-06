import { Campaign } from '../models/Campaign.js';
import { Contact } from '../models/Contact.js';
import { Enrollment } from '../models/Enrollment.js';
import { Institution } from '../models/Institution.js';
import { Message } from '../models/Message.js';
import { isSuppressed, suppress } from '../models/Suppression.js';
import { sendOutreachMail } from './mailer.js';
import {
  buildHtml, buildText, contactVars, fillPlaceholders, unsubscribeHeaders,
} from './render.js';

// ── The sending engine ───────────────────────────────────────────────────────
// A tick runs every minute: find enrolments that are due, and send the next
// step for each — respecting the campaign's daily cap, sending window and
// weekday rule. Pacing is what separates outreach from a spam run, so the
// guards live here rather than being left to whoever starts a campaign.

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** Current time in IST, as a Date whose UTC fields read as IST wall-clock. */
const istNow = () => new Date(Date.now() + IST_OFFSET_MS);
const istDayKey = () => istNow().toISOString().slice(0, 10);

/** Is `campaign` allowed to send at this moment (window + weekday)? */
export function withinSendWindow(campaign, now = istNow()) {
  const hour = now.getUTCHours();          // UTC fields on the shifted date = IST
  const day = now.getUTCDay();             // 0 Sun … 6 Sat
  if (campaign.weekdaysOnly && (day === 0 || day === 6)) return false;
  return hour >= campaign.sendWindowStart && hour < campaign.sendWindowEnd;
}

/** Remaining sends allowed today for this campaign (resets each IST day). */
function remainingToday(campaign) {
  const today = istDayKey();
  if (campaign.sentTodayOn !== today) return campaign.dailyCap;
  return Math.max(0, campaign.dailyCap - campaign.sentToday);
}

async function bumpDailyCounter(campaign) {
  const today = istDayKey();
  if (campaign.sentTodayOn !== today) {
    campaign.sentTodayOn = today;
    campaign.sentToday = 0;
  }
  campaign.sentToday += 1;
  campaign.stats.sent += 1;
}

/** Stop an enrolment for good, with a reason. */
async function stopEnrollment(enrollment, status, reason) {
  enrollment.status = status;
  enrollment.stoppedReason = reason;
  enrollment.nextSendAt = null;
  await enrollment.save();
}

/**
 * Send the next due step for one enrolment.
 * Returns 'sent' | 'skipped' | 'failed'.
 */
export async function sendNextStep(enrollment, campaign) {
  const contact = await Contact.findById(enrollment.contact);
  if (!contact) {
    await stopEnrollment(enrollment, 'stopped', 'contact deleted');
    return 'skipped';
  }

  // Compliance gates — checked at send time, not enrol time, because someone
  // may have unsubscribed while sitting in the queue.
  if (!contact.isSendable()) {
    await stopEnrollment(enrollment, contact.unsubscribed ? 'unsubscribed' : 'bounced', 'contact not sendable');
    return 'skipped';
  }
  if (await isSuppressed(contact.email)) {
    await stopEnrollment(enrollment, 'unsubscribed', 'suppressed');
    return 'skipped';
  }

  const step = campaign.steps[enrollment.stepIndex];
  if (!step) {
    await stopEnrollment(enrollment, 'completed', 'sequence finished');
    return 'skipped';
  }

  const institution = enrollment.institution ? await Institution.findById(enrollment.institution) : null;
  const vars = contactVars(contact, institution);
  const subject = fillPlaceholders(step.subject, vars);
  const bodyText = fillPlaceholders(step.body, vars);

  // Create the Message first so tracking links can carry its id.
  const message = await Message.create({
    campaign: campaign._id,
    enrollment: enrollment._id,
    contact: contact._id,
    institution: institution?._id,
    stepIndex: enrollment.stepIndex,
    to: contact.email,
    subject,
    body: bodyText,
    status: 'sent',
  });

  const signature = process.env.OUTREACH_SIGNATURE || '';
  try {
    const { messageId } = await sendOutreachMail({
      to: contact.email,
      subject,
      text: buildText(bodyText, { contactId: contact._id, senderSignature: signature }),
      html: buildHtml(bodyText, { contactId: contact._id, messageId: message._id, senderSignature: signature }),
      fromName: campaign.fromName,
      fromEmail: campaign.fromEmail,
      replyTo: campaign.replyTo,
      // Follow-ups thread under the first email of the sequence.
      inReplyTo: step.threaded && enrollment.rootMessageId ? enrollment.rootMessageId : undefined,
      headers: unsubscribeHeaders(contact._id),
    });

    message.messageId = messageId;
    await message.save();

    if (!enrollment.rootMessageId) enrollment.rootMessageId = messageId;
    enrollment.sentCount += 1;
    enrollment.lastSentAt = new Date();
    enrollment.stepIndex += 1;

    const nextStep = campaign.steps[enrollment.stepIndex];
    if (nextStep) {
      enrollment.nextSendAt = new Date(Date.now() + nextStep.delayDays * 24 * 60 * 60 * 1000);
    } else {
      enrollment.status = 'completed';
      enrollment.nextSendAt = null;
    }
    await enrollment.save();

    contact.lastSentAt = new Date();
    await contact.save();
    if (institution) {
      institution.lastContactedAt = new Date();
      if (institution.status === 'new') institution.status = 'contacted';
      await institution.save();
    }

    await bumpDailyCounter(campaign);
    await campaign.save();
    return 'sent';
  } catch (err) {
    message.status = 'failed';
    message.error = String(err?.message || err).slice(0, 300);
    await message.save();

    // A hard bounce means the address is dead — suppress it so no campaign
    // ever retries it. Soft failures just retry in an hour.
    const hardBounce = /550|551|553|no such user|does not exist|invalid recipient/i.test(message.error);
    if (hardBounce) {
      contact.bounced = true;
      contact.bounceReason = message.error;
      await contact.save();
      await suppress(contact.email, 'bounced', message.error);
      await stopEnrollment(enrollment, 'bounced', message.error);
      campaign.stats.bounced += 1;
      await campaign.save();
    } else {
      enrollment.nextSendAt = new Date(Date.now() + 60 * 60 * 1000);
      await enrollment.save();
    }
    return 'failed';
  }
}

/**
 * One scheduler tick: walk active campaigns and send whatever is due, within
 * each campaign's pacing rules.
 */
export async function runTick() {
  const campaigns = await Campaign.find({ status: 'active' });
  const summary = { campaigns: campaigns.length, sent: 0, skipped: 0, failed: 0 };

  for (const campaign of campaigns) {
    if (!campaign.steps.length) continue;
    if (!withinSendWindow(campaign)) continue;

    let budget = remainingToday(campaign);
    if (budget <= 0) continue;

    const due = await Enrollment.find({
      campaign: campaign._id,
      status: 'active',
      nextSendAt: { $lte: new Date() },
    }).limit(budget);

    for (const enrollment of due) {
      if (budget <= 0) break;
      const result = await sendNextStep(enrollment, campaign);
      summary[result] = (summary[result] || 0) + 1;
      if (result === 'sent') {
        budget -= 1;
        // Human-ish spacing between sends — bursts look like a blast.
        await new Promise((r) => setTimeout(r, 1500 + Math.random() * 2500));
      }
    }
  }
  return summary;
}

let timer = null;

/** Start the background scheduler (one tick a minute). */
export function startScheduler() {
  if (timer) return;
  const tick = async () => {
    try {
      const s = await runTick();
      if (s.sent || s.failed) console.log('[outreach] tick', s);
    } catch (err) {
      console.error('[outreach] tick failed', err.message);
    }
  };
  timer = setInterval(tick, 60 * 1000);
  setTimeout(tick, 5000); // first run shortly after boot
}
