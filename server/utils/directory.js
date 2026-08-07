import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ── College directory ────────────────────────────────────────────────────────
// A master index of Indian colleges, built from Careers360's published XML
// sitemap — the file they explicitly declare in robots.txt for crawlers. Their
// listing *pages* are JavaScript-rendered and their API is robots-disallowed,
// so the sitemap is both the workable route and the sanctioned one.
//
// Each URL slug carries the college name and city, e.g.
//   /colleges/bhoj-reddy-engineering-college-for-women-hyderabad
// which is all we need: the name is enough to resolve the official website
// (see findWebsite) and scrape its real contacts from the college's own site.

const SITEMAP_URL = 'https://www.careers360.com/sitemap-college-view.xml';
const CACHE_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.cache', 'colleges.json');
const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // refresh weekly

let memo = null;

const titleCase = (s) => s.replace(/\b[a-z]/g, (c) => c.toUpperCase());

/** Turn a sitemap URL into { name, city, sourceUrl }. */
function parseEntry(url) {
  const slug = url.split('/').filter(Boolean).pop() || '';
  if (!slug) return null;
  const parts = slug.split('-');
  if (parts.length < 2) return null;
  // The trailing token is the city; two tokens when it's "new-delhi" etc.
  const twoWordCities = new Set(['delhi', 'nagar', 'pradesh', 'nadu', 'bengal', 'kashmir']);
  let cityParts = [parts.pop()];
  if (twoWordCities.has(cityParts[0]) && parts.length > 1) cityParts.unshift(parts.pop());
  const name = titleCase(parts.join(' '));
  const city = titleCase(cityParts.join(' '));
  if (!name || name.length < 4) return null;
  return { name, city, sourceUrl: url };
}

async function download() {
  const res = await fetch(SITEMAP_URL, {
    headers: { 'User-Agent': 'MenlerBot/1.0 (+https://menler.in)' },
  });
  if (!res.ok) throw new Error(`Sitemap fetch failed (${res.status})`);
  const xml = await res.text();
  const entries = [];
  for (const m of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) {
    const parsed = parseEntry(m[1]);
    if (parsed) entries.push(parsed);
  }
  return entries;
}

/** The full index, from memory → disk cache → network (in that order). */
export async function loadDirectory({ force = false } = {}) {
  if (memo && !force) return memo;
  if (!force) {
    try {
      const stat = await fs.stat(CACHE_FILE);
      if (Date.now() - stat.mtimeMs < CACHE_MAX_AGE_MS) {
        memo = JSON.parse(await fs.readFile(CACHE_FILE, 'utf8'));
        return memo;
      }
    } catch { /* no cache yet — fall through and download */ }
  }
  const entries = await download();
  memo = entries;
  await fs.mkdir(path.dirname(CACHE_FILE), { recursive: true });
  await fs.writeFile(CACHE_FILE, JSON.stringify(entries));
  return entries;
}

/**
 * Search the index. `city` matches the parsed city; `q` matches the name —
 * so "engineering" in Hyderabad narrows 546 colleges to the ones worth pitching.
 */
export async function searchDirectory({ q = '', city = '', limit = 100, offset = 0 } = {}) {
  const all = await loadDirectory();
  const qLower = q.trim().toLowerCase();
  const cityLower = city.trim().toLowerCase();

  const matches = all.filter((e) => {
    if (cityLower && e.city.toLowerCase() !== cityLower) return false;
    if (qLower && !e.name.toLowerCase().includes(qLower)) return false;
    return true;
  });

  return {
    total: matches.length,
    indexSize: all.length,
    rows: matches.slice(offset, offset + limit),
  };
}

/** Cities present in the index, biggest first — for the city picker. */
export async function directoryCities(minCount = 20) {
  const all = await loadDirectory();
  const counts = new Map();
  for (const e of all) counts.set(e.city, (counts.get(e.city) || 0) + 1);
  return [...counts.entries()]
    .filter(([, n]) => n >= minCount)
    .sort((a, b) => b[1] - a[1])
    .map(([city, count]) => ({ city, count }));
}
