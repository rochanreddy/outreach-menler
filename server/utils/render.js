import { signToken } from './tokens.js';

// ── Personalisation + compliance wrapping ────────────────────────────────────
// Turns a step template into the exact copy that goes on the wire: fills
// {{placeholders}}, appends the unsubscribe footer (legally required for bulk
// mail), and — for the HTML part — adds the open pixel and click tracking.

const API_BASE = () => (process.env.API_PUBLIC_URL || 'http://localhost:4200').replace(/\/+$/, '');

/**
 * Fill {{placeholders}}. Supports a fallback: {{first_name|there}}.
 * Unknown placeholders resolve to their fallback, or '' — never the raw braces,
 * so a typo can't ship "Hi {{frist_name}}" to a dean.
 */
export function fillPlaceholders(template, vars) {
  return String(template || '').replace(/\{\{\s*([\w.]+)\s*(?:\|\s*([^}]*?))?\s*\}\}/g, (_m, key, fallback) => {
    const value = vars[key];
    if (value === undefined || value === null || value === '') return (fallback ?? '').trim();
    return String(value);
  });
}

/** The merge variables available in every template. */
export function contactVars(contact, institution) {
  return {
    first_name: contact.firstName || '',
    name: contact.name || '',
    designation: contact.designation || '',
    department: contact.department || '',
    email: contact.email || '',
    college: institution?.name || '',
    city: institution?.city || '',
    state: institution?.state || '',
    website: institution?.website || '',
  };
}

export const unsubscribeUrl = (contactId) =>
  `${API_BASE()}/track/unsubscribe/${signToken({ c: String(contactId) })}`;

const openPixelUrl = (messageId) =>
  `${API_BASE()}/track/open/${signToken({ m: String(messageId) })}.gif`;

const clickUrl = (messageId, target) =>
  `${API_BASE()}/track/click/${signToken({ m: String(messageId), u: target })}`;

const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Build the plain-text body. Cold outreach performs best as plain text — it
 * reads like a person wrote it, not a newsletter.
 */
export function buildText(body, { contactId, senderSignature = '' }) {
  return `${body.trim()}
${senderSignature ? `\n${senderSignature.trim()}\n` : ''}
—
You're receiving this because you're listed as a point of contact at your institution.
Unsubscribe: ${unsubscribeUrl(contactId)}`;
}

/**
 * HTML twin of the text body, with open + click tracking. Kept deliberately
 * plain (no images, no template chrome) so it still reads as a personal note.
 */
export function buildHtml(body, { contactId, messageId, senderSignature = '' }) {
  const paras = body.trim().split(/\n\s*\n/).map((p) => `<p>${esc(p).replace(/\n/g, '<br/>')}</p>`).join('\n');
  // Rewrite bare links through the click tracker.
  const tracked = paras.replace(/(https?:\/\/[^\s<"]+)/g, (url) =>
    `<a href="${esc(clickUrl(messageId, url))}">${esc(url)}</a>`);

  return `<div style="font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#1f2430;">
${tracked}
${senderSignature ? `<p style="white-space:pre-line;">${esc(senderSignature)}</p>` : ''}
<hr style="border:none;border-top:1px solid #e6e4f0;margin:22px 0 10px;" />
<p style="font-size:12px;color:#8a8798;">
You're receiving this because you're listed as a point of contact at your institution.
<a href="${esc(unsubscribeUrl(contactId))}" style="color:#8a8798;">Unsubscribe</a>
</p>
<img src="${esc(openPixelUrl(messageId))}" width="1" height="1" alt="" style="display:block;border:0;" />
</div>`;
}

/** RFC 8058 one-click unsubscribe headers — real deliverability weight. */
export function unsubscribeHeaders(contactId) {
  return {
    'List-Unsubscribe': `<${unsubscribeUrl(contactId)}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };
}
