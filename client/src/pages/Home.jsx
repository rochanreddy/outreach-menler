import { useEffect, useState } from 'react';
import { api } from '../api.js';

/**
 * The screen a new team member lands on.
 *
 * It answers three questions in order, because that's the order people ask
 * them: what is this, what's the state of things, and what do I do now.
 * The "what do I do now" list is driven by real counts — a step only shows
 * as done when the data says it is, so it can't drift from reality.
 */
export default function Home({ go }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    Promise.all([
      api.contacts('?limit=1').catch(() => null),
      api.campaigns().catch(() => null),
      api.opsStatus().catch(() => null),
    ]).then(([contacts, campaigns, ops]) => {
      setD({
        contacts: contacts?.total ?? contacts?.rows?.length ?? 0,
        campaigns: campaigns?.rows || [],
        ops,
      });
    }).catch((e) => setErr(e.message));
  }, []);

  if (err) return <div className="note note--bad">Couldn’t load your dashboard — {err}</div>;
  if (!d) return <p className="empty">Loading…</p>;

  const active = d.campaigns.filter((c) => c.status === 'active');
  const sentTotal = d.campaigns.reduce((n, c) => n + (c.stats?.sent || 0), 0);
  const repliedTotal = d.campaigns.reduce((n, c) => n + (c.stats?.replied || 0), 0);
  const enrolledTotal = d.campaigns.reduce((n, c) => n + (c.stats?.enrolled || 0), 0);
  const mailOk = d.ops?.mail?.ok;

  // Each step knows whether it's done, so the list is a live status report
  // rather than static instructions someone has to map onto reality.
  const steps = [
    {
      done: d.contacts > 0,
      title: 'Find colleges and collect contacts',
      body: d.contacts > 0
        ? `${d.contacts} contact${d.contacts === 1 ? '' : 's'} in your database.`
        : 'Pick a city, choose colleges, and let it search their websites for placement, principal and HOD addresses.',
      cta: d.contacts > 0 ? 'Find more' : 'Start here',
      to: 'finder',
    },
    {
      done: d.campaigns.length > 0,
      title: 'Write a campaign',
      body: d.campaigns.length
        ? `${d.campaigns.length} campaign${d.campaigns.length === 1 ? '' : 's'} created.`
        : 'A campaign is your email plus its follow-ups. Templates are written for you — you only edit the wording.',
      cta: d.campaigns.length ? 'Open campaigns' : 'Write one',
      to: 'campaigns',
    },
    {
      done: enrolledTotal > 0,
      title: 'Add recipients to it',
      body: enrolledTotal > 0
        ? `${enrolledTotal} recipient${enrolledTotal === 1 ? '' : 's'} added across your campaigns.`
        : 'Collecting contacts does not send them anything. Open a campaign and add them on the Recipients step.',
      cta: 'Go to campaigns',
      to: 'campaigns',
    },
    {
      done: sentTotal > 0,
      title: 'Test, then turn it on',
      body: sentTotal > 0
        ? `${sentTotal} email${sentTotal === 1 ? '' : 's'} sent so far.`
        : 'Send yourself a test first. Once activated, emails go out automatically inside your sending window.',
      cta: 'Check sending health',
      to: 'ops',
    },
  ];
  const nextIdx = steps.findIndex((s) => !s.done);

  return (
    <>
      <div className="page-head">
        <h1>Outreach</h1>
        <p>
          Find contacts at colleges, then email them a short sequence that stops
          the moment someone replies. Work through the four steps below in order.
        </p>
      </div>

      {!mailOk && (
        <div className="note note--bad">
          <b>Email is not sending.</b> {d.ops?.mail?.error || 'The sending service is not reachable.'}
          {' '}Nothing will go out until this is fixed — see <b>Sending health</b>.
        </div>
      )}

      <div className="stats">
        <div className="stat">
          <b>{d.contacts.toLocaleString('en-IN')}</b>
          <span>Contacts collected</span>
        </div>
        <div className="stat">
          <b>{enrolledTotal.toLocaleString('en-IN')}</b>
          <span>Added to campaigns</span>
        </div>
        <div className="stat stat--go">
          <b>{sentTotal.toLocaleString('en-IN')}</b>
          <span>Emails sent</span>
        </div>
        <div className="stat stat--go">
          <b>{repliedTotal.toLocaleString('en-IN')}</b>
          <span>Replies{sentTotal ? ` · ${Math.round((repliedTotal / sentTotal) * 100)}%` : ''}</span>
        </div>
      </div>

      <div className="card">
        <h2>What to do {nextIdx === -1 ? '' : 'next'}</h2>
        <p className="hint">
          {nextIdx === -1
            ? 'Everything is running. Keep an eye on replies and add new colleges when you need more.'
            : 'These run in order. Each one turns green once it’s genuinely done.'}
        </p>
        <ol className="guide">
          {steps.map((s, i) => (
            <li key={s.title} className={s.done ? 'done' : ''}>
              <span className={`guide-mark ${s.done ? 'guide-mark--done' : i === nextIdx ? 'guide-mark--now' : ''}`}>
                {s.done ? '✓' : i + 1}
              </span>
              <div className="guide-body">
                <b>{s.title}</b>
                <p className="hint">{s.body}</p>
              </div>
              {(i === nextIdx || s.done) && (
                <button className={`btn btn--sm ${i === nextIdx ? '' : 'btn--ghost'}`} onClick={() => go(s.to)}>
                  {s.cta}
                </button>
              )}
            </li>
          ))}
        </ol>
      </div>

      {active.length > 0 && (
        <div className="card">
          <h2>Sending right now</h2>
          <p className="hint">These are live. Pause one from inside the campaign.</p>
          <div className="table-wrap">
            <div className="table-scroll">
              <table>
                <thead><tr><th>Campaign</th><th>Sent</th><th>Replied</th><th /></tr></thead>
                <tbody>
                  {active.map((c) => (
                    <tr key={c._id}>
                      <td><b>{c.name}</b></td>
                      <td>{c.stats?.sent || 0} of {c.stats?.enrolled || 0}</td>
                      <td>{c.stats?.replied || 0}</td>
                      <td><button className="btn btn--ghost btn--sm" onClick={() => go('campaigns')}>Open</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
