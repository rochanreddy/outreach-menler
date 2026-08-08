import dns from 'node:dns/promises';

// ── College contact scraper ──────────────────────────────────────────────────
// Given a college website, find the people you'd actually pitch to: the
// placement cell, the principal, HoDs. Colleges publish these on purpose — the
// crawler only reads public pages, respects robots.txt, identifies itself and
// goes slowly. It never touches login-walled pages or student data.

const UA = 'MenlerBot/1.0 (+https://menler.in; outreach contact discovery)';
const PAGE_TIMEOUT_MS = 12000;
const MAX_PAGES = 16;

/* ── fetching ──────────────────────────────────────────────────────────── */

async function fetchText(url) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), PAGE_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctl.signal,
      redirect: 'follow',
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' },
    });
    if (!res.ok) return '';
    const type = res.headers.get('content-type') || '';
    if (!type.includes('text/html')) return '';
    return await res.text();
  } catch {
    return '';
  } finally {
    clearTimeout(timer);
  }
}

/** Paths robots.txt tells us to stay out of (simple, conservative parse). */
async function disallowedPaths(origin) {
  const txt = await fetchText(`${origin}/robots.txt`);
  if (!txt) return [];
  const out = [];
  let applies = false;
  for (const raw of txt.split('\n')) {
    const line = raw.trim();
    const [keyRaw, ...rest] = line.split(':');
    const key = (keyRaw || '').toLowerCase();
    const value = rest.join(':').trim();
    if (key === 'user-agent') applies = value === '*' || value.toLowerCase().includes('menler');
    else if (applies && key === 'disallow' && value && value !== '/') out.push(value);
    else if (applies && key === 'disallow' && value === '/') out.push('/');
  }
  return out;
}

const isBlocked = (path, disallowed) => disallowed.some((d) => path.startsWith(d));

/* ── extraction ────────────────────────────────────────────────────────── */

const RE_EMAIL = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
// Indian mobiles and landlines.
const RE_PHONE = /(?:\+?91[\s-]?)?[6-9]\d{9}\b|\b0\d{2,4}[\s-]?\d{6,8}\b/g;
const BAD_EMAIL_END = /\.(png|jpe?g|gif|webp|svg|pdf|css|js|ico|woff2?)$/i;

/** Undo the common "tpo[at]college[dot]edu" obfuscation before matching. */
function deobfuscate(html) {
  return html
    .replace(/\s*[[({]\s*at\s*[\])}]\s*/gi, '@')
    .replace(/\s*[[({]\s*dot\s*[\])}]\s*/gi, '.')
    .replace(/\s+at\s+([a-z0-9.-]+)\s+dot\s+/gi, '@$1.');
}

/** Strip tags but keep text order, so names stay near their email. */
const toText = (html) => html
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ');

// What the address itself tells us about the role.
const ROLE_PATTERNS = [
  { re: /^(tpo|placement|placements|training|tnp|careers?|corporate)/i, role: 'Placement Cell', score: 100 },
  { re: /^(principal|director|dean|vc|registrar)/i, role: 'Principal / Dean', score: 80 },
  { re: /^(hod|head)/i, role: 'HOD', score: 70 },
  { re: /^(admission|admissions|enquiry|enquiries)/i, role: 'Admissions', score: 30 },
  { re: /^(info|contact|office|mail|reachus|help)/i, role: 'General', score: 20 },
];

// Designations spelled out in the page text near an address.
const DESIGNATION_RE = /(training\s*(&|and)?\s*placement\s*officer|placement\s*officer|placement\s*head|head\s*of\s*(the\s*)?department|principal|vice[-\s]?principal|director|dean[^.,;]{0,25}|professor\s*(&|and)?\s*head|registrar|t\.?p\.?o\.?)/i;
const NAME_RE = /((?:Dr|Prof|Mr|Mrs|Ms|Shri|Smt)\.?\s+[A-Z][A-Za-z.]+(?:\s+[A-Z][A-Za-z.]+){0,3})/;

function classify(email) {
  const local = email.split('@')[0] || '';
  for (const p of ROLE_PATTERNS) {
    if (p.re.test(local)) return { role: p.role, score: p.score };
  }
  // A personal-looking address (firstname.lastname@) is usually a real person.
  if (/^[a-z]+[._][a-z]+$/i.test(local)) return { role: 'Staff', score: 55 };
  return { role: 'Other', score: 25 };
}

/**
 * Pull contacts out of one page's HTML. Looks at the text around each address
 * for a name and designation so the row is usable, not just an address.
 */
export function extractFromHtml(html, { sourceUrl = '' } = {}) {
  const text = toText(deobfuscate(html));
  const found = new Map();

  for (const match of text.matchAll(RE_EMAIL)) {
    const email = match[0].toLowerCase();
    if (BAD_EMAIL_END.test(email)) continue;
    if (/(example|sentry|wixpress|godaddy|domain|yourdomain|email)\./.test(email)) continue;
    if (found.has(email)) continue;

    // Look at the 220 characters before the address — that's where a college
    // page puts "Dr. Anita Rao, Training & Placement Officer".
    const before = text.slice(Math.max(0, match.index - 220), match.index);
    const near = `${before} ${text.slice(match.index, match.index + 80)}`;

    const { role, score } = classify(email);
    const designation = (before.match(DESIGNATION_RE) || [])[0] || '';
    const name = (before.match(NAME_RE) || [])[1] || '';
    const phone = (near.match(RE_PHONE) || [])[0] || '';

    found.set(email, {
      email,
      name: name.trim(),
      designation: designation.trim() || role,
      role,
      // A spelled-out designation next to the address is strong confirmation.
      score: score + (designation ? 25 : 0) + (name ? 15 : 0),
      phone: phone.replace(/[\s-]/g, ''),
      sourceUrl,
    });
  }
  return [...found.values()];
}

/* ── verification ──────────────────────────────────────────────────────── */

const mxCache = new Map();

/** Does this address's domain actually accept mail? Cheap quality filter. */
export async function hasMx(email) {
  const domain = (email.split('@')[1] || '').toLowerCase();
  if (!domain) return false;
  if (mxCache.has(domain)) return mxCache.get(domain);
  let ok = false;
  try {
    const records = await dns.resolveMx(domain);
    ok = Array.isArray(records) && records.length > 0;
  } catch {
    ok = false;
  }
  mxCache.set(domain, ok);
  return ok;
}

/* ── finding a college's website from its name ─────────────────────────── */

// Aggregator/social results to ignore — we want the college's own site.
const NOT_OFFICIAL = /(careers360|shiksha|collegedunia|collegesearch|getmyuni|wikipedia|facebook|youtube|linkedin|twitter|instagram|justdial|indiamart|quora|targetstudy)/i;

/**
 * Look up a college's official website from its name, so a plain list of
 * college names is enough to start — no hunting for URLs by hand.
 * Uses DuckDuckGo's HTML endpoint (no API key, no JS needed).
 */
export async function findWebsite(collegeName) {
  const name = String(collegeName || '').trim();
  if (!name) return '';
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(`${name} official website`)}`;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 15000);
  try {
    const res = await fetch(url, {
      signal: ctl.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
    });
    if (!res.ok) return '';
    const html = await res.text();
    const hits = [...html.matchAll(/uddg=([^&"]+)/g)].map((m) => {
      try { return decodeURIComponent(m[1]); } catch { return ''; }
    });
    // Prefer .ac.in / .edu.in — that's what Indian colleges use.
    const official = hits.filter((h) => h && !NOT_OFFICIAL.test(h));
    const preferred = official.find((h) => /\.(ac\.in|edu\.in|edu)\b/i.test(h));
    const pick = preferred || official[0] || '';
    if (!pick) return '';
    try { return new URL(pick).origin; } catch { return ''; }
  } catch {
    return '';
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A readable college name from the homepage <title>. Titles are usually
 * "CBIT | Chaitanya Bharathi Institute of Technology, Hyderabad" or
 * "Best Engineering College in Hyderabad | KMIT" — so split on the separators
 * and keep the segment that actually looks like an institution's name, rather
 * than falling back to a bare domain in "{{college}} students".
 */
export function nameFromTitle(html) {
  const raw = (html.match(/<title[^>]*>([\s\S]{0,200}?)<\/title>/i) || [])[1] || '';
  const title = toText(raw).replace(/&[a-z]+;/gi, ' ').trim();
  if (!title) return '';
  const segments = title.split(/\s*[|·—–]\s*|\s+-\s+/).map((s) => s.trim()).filter(Boolean);
  const INSTITUTION = /(institute|college|university|school|academy|polytechnic|vidyalaya|vidhyalaya)/i;
  const MARKETING = /^(best|top|welcome|home|official|no\.?\s*1)\b/i;
  const named = segments.filter((s) => INSTITUTION.test(s) && !MARKETING.test(s));
  // Prefer the longest institution-looking segment — that's the full name
  // rather than an acronym.
  const pick = named.sort((a, b) => b.length - a.length)[0] || '';
  return pick.length > 4 && pick.length < 120 ? pick : '';
}

/* ── crawling ──────────────────────────────────────────────────────────── */

// Pages worth trying directly — where contacts usually live.
const SEED_PATHS = [
  '', '/placements', '/placement', '/training-and-placement', '/training-placement',
  '/tpo', '/contact', '/contact-us', '/placement-cell', '/career', '/administration',
  '/departments', '/department', '/faculty', '/academics', '/staff',
];

// Links whose text/href suggest a contact-bearing page. Department and faculty
// pages matter because that's where HoD addresses (hod.cse@…) are listed —
// only some colleges publish them, but the ones that do publish a whole set.
const LINK_HINT = /(placement|tpo|training|contact|reach|administration|faculty|staff|dean|principal|career|department|dept|hod)/i;
// Second-level: from a departments index, follow the individual departments.
const DEPT_HINT = /(cse|computer|ece|electronic|eee|electrical|mech|civil|\bit\b|information|mba|management|ai|data|hod|head)/i;

/** Collect same-host links from a page that look worth following. */
function candidateLinks(html, origin, hint = LINK_HINT) {
  const out = new Set();
  for (const m of html.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]{0,80}?)<\/a>/gi)) {
    const href = m[1];
    const label = toText(m[2] || '');
    if (!hint.test(href) && !hint.test(label)) continue;
    try {
      const url = new URL(href, origin);
      if (url.origin !== origin) continue;
      if (/\.(pdf|jpe?g|png|zip|docx?)$/i.test(url.pathname)) continue;
      out.add(url.href.split('#')[0]);
    } catch { /* skip bad href */ }
  }
  return [...out];
}

/**
 * Scrape one college site for contacts.
 * Returns { origin, pagesFetched, contacts: [...] } sorted best-first.
 */
export async function scrapeSite(website, { maxPages = MAX_PAGES, politeMs = 700 } = {}) {
  let origin;
  try {
    const u = new URL(/^https?:\/\//i.test(website) ? website : `https://${website}`);
    origin = u.origin;
  } catch {
    return { origin: website, pagesFetched: 0, contacts: [], error: 'Invalid website' };
  }

  const disallowed = await disallowedPaths(origin);
  if (isBlocked('/', disallowed)) {
    return { origin, pagesFetched: 0, contacts: [], error: 'Blocked by robots.txt' };
  }

  const queue = SEED_PATHS.map((p) => `${origin}${p}`);
  const seen = new Set();
  const byEmail = new Map();
  let pagesFetched = 0;
  let discovered = 0;
  let siteTitle = '';

  while (queue.length && pagesFetched < maxPages) {
    const url = queue.shift();
    if (seen.has(url)) continue;
    seen.add(url);

    let path = '/';
    try { path = new URL(url).pathname; } catch { /* keep default */ }
    if (isBlocked(path, disallowed)) continue;

    const html = await fetchText(url);
    if (!html) continue;
    pagesFetched += 1;
    if (!siteTitle) siteTitle = nameFromTitle(html);

    for (const c of extractFromHtml(html, { sourceUrl: url })) {
      const existing = byEmail.get(c.email);
      // Keep the richest version of a repeated address.
      if (!existing || c.score > existing.score) byEmail.set(c.email, c);
    }

    // Two levels of discovery. From the first pages, follow anything that looks
    // contact-bearing; from a departments index, follow the individual
    // department pages — that's where hod.cse@… style addresses live.
    if (discovered < 2) {
      discovered += 1;
      for (const link of candidateLinks(html, origin).slice(0, 8)) {
        if (!seen.has(link)) queue.push(link);
      }
    } else if (/(department|faculty|academics|administration)/i.test(path)) {
      for (const link of candidateLinks(html, origin, DEPT_HINT).slice(0, 6)) {
        if (!seen.has(link)) queue.push(link);
      }
    }
    await new Promise((r) => setTimeout(r, politeMs)); // be a polite guest
  }

  // Prefer addresses on the college's own domain over gmail/yahoo ones.
  const host = origin.replace(/^https?:\/\//, '').replace(/^www\./, '');
  const contacts = [...byEmail.values()].map((c) => ({
    ...c,
    onDomain: c.email.endsWith(`@${host}`) || c.email.includes(host.split('.')[0]),
  }));
  for (const c of contacts) if (c.onDomain) c.score += 20;

  contacts.sort((a, b) => b.score - a.score);
  return { origin, pagesFetched, contacts, siteTitle };
}
