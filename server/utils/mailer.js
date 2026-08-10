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

// Resend's HTTPS API, preferred over SMTP whenever a key is present.
// This is not an optimisation: most managed hosts (Render included) firewall
// outbound 25/465/587, so SMTP there fails with a connection timeout that no
// amount of correct credentials will fix. Port 443 is never blocked.
// Resend's SMTP password *is* an API key, so a host configured for Resend SMTP
// already carries everything the API needs. Recognise that rather than making
// people add the same secret a second time under a different name.
const smtpPassIsResendKey = OUTREACH_SMTP_USER === 'resend'
  && /^re_/.test(OUTREACH_SMTP_PASS || '');

const RESEND_KEY = process.env.OUTREACH_RESEND_API_KEY
  || process.env.RESEND_API_KEY
  || (smtpPassIsResendKey ? OUTREACH_SMTP_PASS : '')
  || '';

export const mailerConfigured = () =>
  Boolean(RESEND_KEY || (OUTREACH_SMTP_HOST && OUTREACH_SMTP_USER && OUTREACH_SMTP_PASS));

/** POST to the Resend API, with the error text surfaced rather than swallowed. */
async function resendSend(payload) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${RESEND_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(20000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Resend puts the useful part in `message` — e.g. "The team@menler.in domain
    // is not verified", which is the difference between a config error and a bug.
    throw new Error(body?.message || body?.error?.message || `Resend returned ${res.status}`);
  }
  return body;
}

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
  if (RESEND_KEY) {
    try {
      // Cheap authenticated read — confirms the key works without sending.
      const res = await fetch('https://api.resend.com/domains', {
        headers: { authorization: `Bearer ${RESEND_KEY}` },
        signal: AbortSignal.timeout(15000),
      });
      if (res.status === 401 || res.status === 403) {
        return { ok: false, error: 'Resend rejected the API key.' };
      }
      if (!res.ok) return { ok: false, error: `Resend API returned ${res.status}.` };
      return { ok: true, host: 'Resend API (HTTPS)' };
    } catch (err) {
      return { ok: false, error: `Could not reach the Resend API: ${err?.message || err}` };
    }
  }
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

  if (RESEND_KEY) {
    const out = await resendSend({
      from: `${name} <${addr}>`,
      to: [to],
      subject,
      text,
      ...(html ? { html } : {}),
      reply_to: message.replyTo,
      // List-Unsubscribe and threading both ride as raw headers.
      headers: {
        ...headers,
        ...(inReplyTo ? { 'In-Reply-To': inReplyTo, References: inReplyTo } : {}),
      },
    });
    // Resend's id doubles as the Message-ID we thread follow-ups against.
    return { messageId: out.id };
  }

  if (!transporter) {
    // Dev: log instead of sending, so flows can be exercised without SMTP.
    console.log('\n──── OUTREACH EMAIL (dev — no SMTP configured) ────');
    console.log(`To:      ${to}\nSubject: ${subject}\n\n${text}\n`);
    return { messageId: `dev-${Date.now()}@localhost` };
  }

  const info = await transporter.sendMail(message);
  return { messageId: info.messageId };
}
