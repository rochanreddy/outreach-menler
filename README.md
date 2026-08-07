# Menler Outreach

Find the right people at colleges, then email them — without doing either by hand.

You collect contacts (placement officers, principals, HoDs), write one pitch,
and the system personalises and paces the sending, chases non-repliers, and stops
the moment someone answers.

**The order you use it:** Find contacts → Colleges & contacts → Campaigns → Sending health.

---

## 1. Find contacts

**What it's for:** getting contacts without building spreadsheets by hand.

Three ways in, top to bottom:

### Browse the college directory
An index of ~40,000 Indian colleges across 393 cities, built from Careers360's
published sitemap. Pick a city, narrow by keyword, select, queue.

> Hyderabad + "engineering" → 76 colleges → *Find contacts for 76 colleges*

### Paste names or websites
One per line, mixed freely. A name is looked up to find the official site first.

```
BVRIT Narsapur
Chaitanya Bharathi Institute of Technology
cbit.ac.in
```

### Upload a CSV
Columns: `college, website, city, state`.

**What happens next.** Each college's own website is crawled — placements page,
contact page, administration, and department pages — for emails, phones, names
and designations. Every address is scored:

| Score | Meaning |
|---|---|
| 100+ | Placement cell / TPO — who you actually want |
| 80 | Principal, dean, director |
| 70 | HoD |
| 20–30 | Generic `info@` / `admissions@` |

Bonus points when a real name or spelled-out designation sits beside the address.
Every address is MX-checked, so dead domains never reach a campaign.

**Then click "Import the good ones"** — keeps everything scoring 60+ with a working
mail domain, skips the junk. Nothing is emailable until you do this.

**Realistic yield** (measured on live sites): ~75% of colleges give at least one
usable contact. Placement/principal addresses are common. HoD addresses are
published by roughly 1 college in 8 — but those publish a whole set at once
(BVRIT alone gave 9). Individual student-counsellor emails are almost never public;
you reach them through the placement officer.

---

## 2. Colleges & contacts

**What it's for:** your address book and your sales pipeline in one place.

Two views:

- **Colleges** — every institution, with its contact count and a **status** you set:
  `new → contacted → replied → meeting → won` (or `lost` / `unqualified`).
  This is how you see which colleges are warm.
- **Contacts** — every person, with their designation, email, and college.
  Anyone unsubscribed or bounced is flagged here.

You can also import a contact CSV directly on this screen if you already have a list.

---

## 3. Campaigns

**What it's for:** writing the pitch once and letting it go out personalised, on a
schedule, with follow-ups.

### Setting one up
1. **Create** — name it something you'll recognise: *"Hyderabad engineering — August"*.
2. **Sender** — from-name, from-address (must be on the outreach domain), and a
   reply-to that a human actually watches.
3. **Pacing** — emails/day, the hours to send between, weekdays only.
   *Start at 20–40/day on a new domain and raise it slowly.*
4. **Sequence** — the first email, then follow-ups with a delay in days.

### Writing the copy
Use placeholders; they're filled per-recipient:

```
Subject: AI workshop for {{college}} students

Hi {{first_name|there}},

I lead AI education at Menler. We run hands-on Claude workshops for
final-year students — {{college}} students would be a strong fit.

Worth a 15-minute call?
```

Available: `{{first_name}}` `{{name}}` `{{college}}` `{{designation}}`
`{{department}}` `{{city}}` `{{state}}`.
Add a fallback with a pipe: `{{first_name|there}}`.

An unsubscribe footer is appended automatically — you don't add it.

### Going live
1. **Send me a test** — always. It's the only way to catch a broken placeholder
   before a dean sees it.
2. **Enrol all sendable contacts** — pulls in your contacts, skipping anyone
   unsubscribed, bounced or suppressed.
3. **Activate.**

From there it runs itself: sends within your window, spaces each email out,
personalises every one. **Follow-ups fire automatically — unless the person
replied, in which case the sequence stops for them.**

When someone replies, open the campaign's enrolment list and mark them replied.
That stops their follow-ups and moves the college to `replied` in the pipeline.

---

## 4. Sending health

**What it's for:** deliverability. This is what decides whether you land in the
inbox or the spam folder.

- **Email transport** — is the sending provider connected and working.
- **Active campaigns** — how many sent today against the cap, and whether each
  campaign is currently inside its sending window.
- **Run a send tick now** — force a send immediately instead of waiting for the
  next minute's cycle. Useful right after activating.
- **Do-not-contact list** — every unsubscribe and hard bounce lands here
  automatically, and it's checked before *every single send*. It survives
  re-imports, so someone removed stays removed. You can also add an address or a
  whole domain by hand.

---

## Setup

### Local
```bash
cd server && npm install && npm run dev     # API on :4200
cd client && npm install && npm run dev     # UI on :5175
```
Copy `server/.env.example` → `server/.env` and fill it in. Log in with
`OUTREACH_USERNAME` / `OUTREACH_PASSWORD`.

With no SMTP configured, **emails print to the server terminal instead of
sending** — so you can build and test the whole flow safely.

### Sending for real
Cold outreach needs its own provider on its own domain — e.g.
`outreach.menler.in` via Instantly, Smartlead or Amazon SES.

**Never point this at the transactional provider that sends certificates and
receipts.** A spam complaint there would take those down too.

Set `OUTREACH_SMTP_*`, `OUTREACH_FROM_EMAIL` and `OUTREACH_REPLY_TO`, then warm
the domain up: 20/day for the first week or two, raising slowly.

### Database
Shares the existing Atlas cluster but only touches `out_*` collections, so it
never collides with the marketing site's leads/orders or the LMS's `lms_*` data.

---

## Where the data comes from

Contacts are read from **colleges' own public websites** — the pages they publish
so people can contact them. The crawler identifies itself, obeys `robots.txt`,
takes one site at a time with delays, and never touches login-walled pages.

Careers360 is used **only as an index of which colleges exist**, via the XML
sitemap they publish for crawlers. No contact data is taken from it.

This is business-to-institution outreach. Personal data about students has no
place in this system — students should come through the consented funnel on
menler.in instead.
