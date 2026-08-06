import nodemailer from 'nodemailer';

// ── Sending transport ────────────────────────────────────────────────────────
// Cold outreach MUST NOT go through the transactional provider that sends
// certificates/receipts (menler.in). One spam complaint there and the whole
// transactional domain suffers. So this service has its own SMTP credentials
// pointed at a dedicated outreach domain + provider (Instantly, Smartlead,
// Amazon SES, Zoho Campaigns…). Any SMTP provider works — only env changes.

const {
  OUTREACH_SMTP_HOST,
  OUTREACH_SMTP_PORT,
  OUTREACH_SMTP_USER,
  OUTREACH_SMTP_PASS,
  OUTREACH_FROM_NAME,
  OUTREACH_FROM_EMAIL,
  OUTREACH_REPLY_TO,
} = process.env;

export const mailerConfigured = () =>
  Boolean(OUTREACH_SMTP_HOST && OUTREACH_SMTP_USER && OUTREACH_SMTP_PASS);

let transporter = null;
if (mailerConfigured()) {
  const port = Number(OUTREACH_SMTP_PORT || 587);
  transporter = nodemailer.createTransport({
    host: OUTREACH_SMTP_HOST,
    port,
    secure: port === 465,
    auth: { user: OUTREACH_SMTP_USER, pass: OUTREACH_SMTP_PASS },
    // Fail fast rather than hanging the scheduler.
    connectionTimeout: 15000,
    greetingTimeout: 10000,
    socketTimeout: 20000,
  });
}

/** Confirms the SMTP credentials work, without sending anything. */
export async function verifyMailer() {
  if (!transporter) {
    // Outside production, "no SMTP" is the console-logging dev mode — usable, so
    // campaigns can be exercised locally. In production it's a hard stop.
    if (process.env.NODE_ENV !== 'production') {
      return { ok: true, host: 'dev console (no SMTP configured — emails are logged, not sent)' };
    }
    return { ok: false, error: 'No outreach SMTP configured (set OUTREACH_SMTP_*).' };
  }
  try {
    await transporter.verify();
    return { ok: true, host: OUTREACH_SMTP_HOST };
  } catch (err) {
    return { ok: false, error: err?.message || 'SMTP connection failed.' };
  }
}

/**
 * Send one outreach email.
 * `inReplyTo` threads follow-ups under the first message of the sequence.
 * Returns { messageId }.
 */
export async function sendOutreachMail({
  to, subject, text, html, fromName, fromEmail, replyTo, inReplyTo, headers = {},
}) {
  const addr = fromEmail || OUTREACH_FROM_EMAIL;
  const name = fromName || OUTREACH_FROM_NAME || 'Menler';
  if (!addr) throw new Error('No from-address configured.');

  const message = {
    from: `${name} <${addr}>`,
    to,
    subject,
    text,
    ...(html ? { html } : {}),
    replyTo: replyTo || OUTREACH_REPLY_TO || addr,
    headers: {
      // Real one-click unsubscribe — mailbox providers weigh this heavily and
      // it keeps us on the right side of bulk-sender rules.
      ...headers,
    },
    ...(inReplyTo ? { inReplyTo, references: inReplyTo } : {}),
  };

  if (!transporter) {
    // Dev: log instead of sending, so flows can be exercised without SMTP.
    console.log('\n──── OUTREACH EMAIL (dev — no SMTP configured) ────');
    console.log(`To:      ${to}\nSubject: ${subject}\n\n${text}\n`);
    return { messageId: `dev-${Date.now()}@localhost` };
  }

  const info = await transporter.sendMail(message);
  return { messageId: info.messageId };
}
