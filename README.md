# Menler Outreach

B2I (business-to-institution) outbound: a contact database of colleges and their
staff, plus sequenced email campaigns with pacing, tracking, and compliance.

Same stack as the rest of Menler — Express + Mongoose backend, React + Vite admin
UI, deployable to Render + Vercel.

## Scope — read this first

**This system is for institutional contacts only**: placement officers, HODs,
deans, principals — people whose professional contact details their college
publishes so they can be reached.

It is deliberately **not** built to collect or mail individual students. Students
come in through the existing consented funnel (campaign pages → OTP-verified
registration). Cold-mailing students would be a DPDP-Act problem and would burn
the institutional relationships this system exists to build.

There is no LinkedIn scraping here either. `linkedinUrl` is a manual note field.

## Layout

```
server/    Express API + the sending engine
  models/    Institution, Contact, Campaign, Enrollment, Message, Suppression
  routes/    contacts (+import), campaigns, tracking (public)
  utils/     engine (scheduler), mailer, render (personalisation), tokens
client/    React admin UI — Campaigns, Colleges & contacts, Sending health
```

All collections are prefixed `out_`, so this shares the existing Atlas cluster
without colliding with the marketing (`leads`, `orders`) or LMS (`lms_*`) data.

## Local setup

```bash
# backend
cd server && npm install
cp .env.example .env      # fill MONGODB_URI, JWT_SECRET, OUTREACH_USERNAME/PASSWORD
npm run dev               # :4200

# frontend
cd client && npm install
cp .env.example .env      # VITE_API_URL=http://localhost:4200
npm run dev               # :5175
```

Without SMTP configured, emails are **logged to the console** instead of sent, so
the whole flow can be exercised locally. In production, missing SMTP blocks
activation outright.

## How it works

1. **Import** a CSV of colleges + contacts. Colleges are upserted on name+city,
   so several people at one college group under it. Duplicates and anyone on the
   do-not-contact list are skipped.
2. **Build a campaign**: a first email plus follow-ups, each with a delay in days.
   Copy supports `{{first_name}}`, `{{college}}`, `{{designation}}`, `{{city}}`,
   `{{state}}` … with fallbacks (`{{first_name|there}}`).
3. **Enrol** contacts (all sendable, or filtered by state/city/designation).
4. **Activate.** A scheduler tick runs every minute and sends whatever is due,
   respecting the campaign's daily cap, IST sending window and weekday rule, with
   randomised spacing between sends.
5. **Replies stop the sequence.** Mark a reply in the UI (or wire the ESP
   webhook) and every remaining follow-up for that contact is cancelled.

## Deliverability rules (not optional)

- **Use a dedicated outreach domain and provider** — e.g. `outreach.menler.in`
  through Instantly / Smartlead / Amazon SES. **Never** route cold mail through
  the transactional provider that sends certificates, receipts and LMS mail: one
  spam complaint there and those stop landing in inboxes.
- **Warm the domain up.** 20–40/day for the first weeks, then raise slowly. The
  per-campaign `dailyCap` exists to enforce this.
- **Set SPF, DKIM and DMARC** on the outreach domain before the first send.
- Every email carries an unsubscribe link plus RFC 8058 one-click headers.
  Unsubscribes and hard bounces are suppressed permanently and survive re-imports.
- `OUTREACH_SIGNATURE` must include a real postal address.

## Deploying

**Render** (backend) — root `server`, build `npm install`, start `npm start`,
env from `.env.example`. `API_PUBLIC_URL` must be the public Render URL, since
unsubscribe/tracking links are built from it.

**Vercel** (admin UI) — root `client`, env `VITE_API_URL` = the Render URL. Then
set `OUTREACH_APP_URL` on Render to the Vercel URL so CORS allows the cookie.

Run only **one** instance with the scheduler on (`OUTREACH_SCHEDULER=on`); any
extra instances should set it to `off` so nothing double-sends.
