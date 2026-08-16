import { useEffect, useState, useCallback } from 'react';
import { api } from '../api.js';
import { exportToCsv } from '../utils/csv.js';

const ago = (d) => {
  if (!d) return '—';
  const mins = Math.round((Date.now() - new Date(d)) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
};

const pct = (n, total) => (total ? Math.round((n / total) * 100) : 0);

const STATUS_PILL = {
  replied: 'pill pill--ok',
  active: 'pill',
  completed: 'pill pill--off',
  unsubscribed: 'pill pill--off',
  bounced: 'pill pill--warn',
  stopped: 'pill pill--off',
};

export default function Home({ go }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [actionMsg, setActionMsg] = useState('');

  const loadData = useCallback(() => {
    setLoading(true);
    Promise.all([
      api.contacts('?limit=1').catch(() => null),
      api.campaigns().catch(() => null),
      api.opsStatus().catch(() => null),
      api.allEnrollments().catch(() => ({ rows: [] })),
      api.allMessages().catch(() => ({ rows: [] })),
    ]).then(([contacts, campaigns, ops, enrollments, messages]) => {
      setD({
        contacts: contacts?.total ?? contacts?.rows?.length ?? 0,
        campaigns: campaigns?.rows || [],
        ops,
        enrollments: enrollments?.rows || [],
        messages: messages?.rows || [],
      });
      setErr('');
    }).catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  if (err) return <div className="note note--bad">Couldn’t load your dashboard — {err}</div>;
  if (!d && loading) return <p className="empty">Loading dashboard…</p>;
  if (!d) return null;

  const mailOk = d.ops?.mail?.ok;

  // Global Campaign Metrics
  const enrolledTotal = d.campaigns.reduce((n, c) => n + (c.stats?.enrolled || 0), 0);
  const sentTotal = d.campaigns.reduce((n, c) => n + (c.stats?.sent || 0), 0);
  const openedTotal = d.campaigns.reduce((n, c) => n + (c.stats?.opened || 0), 0);
  const clickedTotal = d.campaigns.reduce((n, c) => n + (c.stats?.clicked || 0), 0);
  const repliedTotal = d.campaigns.reduce((n, c) => n + (c.stats?.replied || 0), 0);
  const bouncedTotal = d.campaigns.reduce((n, c) => n + (c.stats?.bounced || 0), 0);
  const unsubscribedTotal = d.campaigns.reduce((n, c) => n + (c.stats?.unsubscribed || 0), 0);

  const enrollments = d.enrollments || [];

  // Recipient list filtering
  const searchLower = search.trim().toLowerCase();
  const filteredEnrollments = enrollments.filter((r) => {
    const statusMatch =
      filter === 'all' ? true :
      filter === 'sent' ? r.sentCount > 0 :
      filter === 'opened' ? r.openCount > 0 :
      filter === 'clicked' ? r.clickCount > 0 :
      filter === 'replied' ? r.status === 'replied' :
      filter === 'bounced' ? (r.status === 'bounced' || r.status === 'unsubscribed') :
      filter === 'queued' ? (r.sentCount === 0 && r.status === 'active') : true;

    if (!statusMatch) return false;
    if (!searchLower) return true;

    const contactName = r.contact?.name || '';
    const contactEmail = r.contact?.email || '';
    const collegeName = r.institution?.name || '';
    const campaignName = r.campaign?.name || '';

    return (
      contactName.toLowerCase().includes(searchLower) ||
      contactEmail.toLowerCase().includes(searchLower) ||
      collegeName.toLowerCase().includes(searchLower) ||
      campaignName.toLowerCase().includes(searchLower)
    );
  });

  const recipientCounts = {
    all: enrollments.length,
    sent: enrollments.filter((r) => r.sentCount > 0).length,
    opened: enrollments.filter((r) => r.openCount > 0).length,
    clicked: enrollments.filter((r) => r.clickCount > 0).length,
    replied: enrollments.filter((r) => r.status === 'replied').length,
    bounced: enrollments.filter((r) => r.status === 'bounced' || r.status === 'unsubscribed').length,
    queued: enrollments.filter((r) => r.sentCount === 0 && r.status === 'active').length,
  };

  const handleMarkReplied = async (e, rowId) => {
    e.stopPropagation();
    try {
      await api.markReplied(rowId);
      setActionMsg('Marked as replied — follow-ups stopped.');
      setTimeout(() => setActionMsg(''), 3000);
      loadData();
    } catch (err) {
      alert('Could not mark as replied: ' + err.message);
    }
  };

  /* CSV Export Handlers */
  const exportRecipientsCsv = () => {
    const fields = [
      { label: 'Name', get: (r) => r.contact?.name || '' },
      { label: 'Email', get: (r) => r.contact?.email || '' },
      { label: 'Designation', get: (r) => r.contact?.designation || '' },
      { label: 'College', get: (r) => r.institution?.name || '' },
      { label: 'City', get: (r) => r.institution?.city || '' },
      { label: 'State', get: (r) => r.institution?.state || '' },
      { label: 'Campaign', get: (r) => r.campaign?.name || '' },
      { label: 'Status', get: (r) => r.status || '' },
      { label: 'Emails Sent', get: (r) => r.sentCount || 0 },
      { label: 'Open Count', get: (r) => r.openCount || 0 },
      { label: 'Click Count', get: (r) => r.clickCount || 0 },
      { label: 'First Opened At', get: (r) => r.openedAt ? new Date(r.openedAt).toLocaleString() : '' },
      { label: 'Last Sent At', get: (r) => r.lastSentAt ? new Date(r.lastSentAt).toLocaleString() : '' },
      { label: 'Replied At', get: (r) => r.repliedAt ? new Date(r.repliedAt).toLocaleString() : '' },
    ];
    exportToCsv(`outreach_recipients_${filter}`, fields, filteredEnrollments);
  };

  const exportCampaignsCsv = () => {
    const fields = [
      { label: 'Campaign Name', get: (c) => c.name || '' },
      { label: 'Status', get: (c) => c.status || '' },
      { label: 'Daily Cap', get: (c) => c.dailyCap || 0 },
      { label: 'Enrolled Recipients', get: (c) => c.stats?.enrolled || 0 },
      { label: 'Emails Sent', get: (c) => c.stats?.sent || 0 },
      { label: 'Opened', get: (c) => c.stats?.opened || 0 },
      { label: 'Open Rate (%)', get: (c) => pct(c.stats?.opened || 0, c.stats?.sent || 0) },
      { label: 'Replied', get: (c) => c.stats?.replied || 0 },
      { label: 'Reply Rate (%)', get: (c) => pct(c.stats?.replied || 0, c.stats?.sent || 0) },
      { label: 'Bounced', get: (c) => c.stats?.bounced || 0 },
      { label: 'Unsubscribed', get: (c) => c.stats?.unsubscribed || 0 },
    ];
    exportToCsv('outreach_campaigns_overview', fields, d.campaigns);
  };

  const exportMessagesCsv = () => {
    const fields = [
      { label: 'Recipient Email', get: (m) => m.to || '' },
      { label: 'Contact Name', get: (m) => m.contact?.name || '' },
      { label: 'College Name', get: (m) => m.institution?.name || '' },
      { label: 'Campaign Name', get: (m) => m.campaign?.name || '' },
      { label: 'Subject', get: (m) => m.subject || '' },
      { label: 'Sent At', get: (m) => m.sentAt ? new Date(m.sentAt).toLocaleString() : '' },
      { label: 'Opened', get: (m) => m.openedAt ? 'Yes' : 'No' },
      { label: 'Open Count', get: (m) => m.openCount || 0 },
      { label: 'Opened At', get: (m) => m.openedAt ? new Date(m.openedAt).toLocaleString() : '' },
    ];
    exportToCsv('outreach_sent_messages_log', fields, d.messages);
  };

  const RECIPIENT_TABS = [
    ['all', 'Everyone', recipientCounts.all],
    ['sent', 'Received / Sent', recipientCounts.sent],
    ['opened', 'Opened', recipientCounts.opened],
    ['clicked', 'Clicked', recipientCounts.clicked],
    ['replied', 'Replied', recipientCounts.replied],
    ['bounced', 'Bounced / Unsub', recipientCounts.bounced],
    ['queued', 'Queued', recipientCounts.queued],
  ];

  return (
    <>
      <div className="page-head">
        <h1>Outreach Dashboard</h1>
        <p>
          Live overview of all campaigns, recipient engagement, email opens, replies, and sent activity.
        </p>
      </div>

      {/* The sending status lives here now rather than on its own tab. A
          separate page for it meant the one thing that stops every campaign
          dead was somewhere nobody looked until they wondered why nothing had
          gone out. */}
      {!mailOk && (
        <div className="note note--bad">
          <b>Email is not sending.</b> {d.ops?.mail?.error || 'The sending service is not reachable.'}
          {' '}Nothing will go out until this is fixed. Campaigns stay queued — no email is lost.
        </div>
      )}

      {mailOk && (
        <p className="hint" style={{ marginBottom: 14 }}>
          <span className="pill pill--ok">Sending</span>{' '}
          via {d.ops?.mail?.host}
          {d.ops?.active?.length
            ? ` · ${d.ops.active.length} campaign${d.ops.active.length === 1 ? '' : 's'} live`
            : ' · nothing active right now'}
        </p>
      )}

      {actionMsg && <div className="note note--good">{actionMsg}</div>}

      {/* ── Key Metrics Cards ───────────────────────────────────────────── */}
      <div className="stats">
        <div className="stat">
          <span>Contacts Collected</span>
          <b>{d.contacts.toLocaleString('en-IN')}</b>
        </div>
        <div className="stat">
          <span>Enrolled</span>
          <b>{enrolledTotal.toLocaleString('en-IN')}</b>
        </div>
        <div className={`stat ${sentTotal ? 'stat--go' : 'stat--muted'}`}>
          <span>Emails Sent</span>
          <b>{sentTotal.toLocaleString('en-IN')}</b>
        </div>
        <div className={`stat ${openedTotal ? 'stat--go' : 'stat--muted'}`}>
          <span>Opened</span>
          <b>
            {openedTotal.toLocaleString('en-IN')}
            {sentTotal > 0 && <span> · {pct(openedTotal, sentTotal)}%</span>}
          </b>
        </div>
        <div className={`stat ${clickedTotal ? 'stat--go' : 'stat--muted'}`}>
          <span>Clicked</span>
          <b>
            {clickedTotal.toLocaleString('en-IN')}
            {sentTotal > 0 && <span> · {pct(clickedTotal, sentTotal)}%</span>}
          </b>
        </div>
        <div className={`stat ${repliedTotal ? 'stat--go' : 'stat--muted'}`}>
          <span>Replies</span>
          <b>
            {repliedTotal.toLocaleString('en-IN')}
            {sentTotal > 0 && <span> · {pct(repliedTotal, sentTotal)}%</span>}
          </b>
        </div>
        <div className={`stat ${(bouncedTotal || unsubscribedTotal) ? 'stat--warn' : 'stat--muted'}`}>
          <span>Bounced · Unsub</span>
          <b>
            {bouncedTotal} <span> / {unsubscribedTotal}</span>
          </b>
        </div>
      </div>

      {/* ── All Campaigns Table ─────────────────────────────────────────── */}
      <div className="card">
        <div className="card-head">
          <h2>All Campaigns Overview</h2>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn btn--sm btn--ghost" onClick={exportCampaignsCsv}>
              📥 Export Campaigns CSV
            </button>
            <button className="btn btn--sm btn--ghost" onClick={() => go('campaigns')}>
              Manage Campaigns →
            </button>
          </div>
        </div>
        <div className="table-wrap">
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Campaign</th>
                  <th>Status</th>
                  <th>Sent / Enrolled</th>
                  <th>Opened</th>
                  <th>Replied</th>
                  <th>Bounced</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {!d.campaigns.length && (
                  <tr>
                    <td colSpan={7} className="empty">
                      <b>No campaigns created yet</b>
                      Create your first campaign from the Campaigns tab to start sending.
                    </td>
                  </tr>
                )}
                {d.campaigns.map((c) => {
                  const cSent = c.stats?.sent || 0;
                  const cOpened = c.stats?.opened || 0;
                  const cReplied = c.stats?.replied || 0;
                  return (
                    <tr key={c._id}>
                      <td>
                        <b>{c.name}</b>
                      </td>
                      <td>
                        <span className={`pill ${c.status === 'active' ? 'pill--ok' : c.status === 'paused' ? 'pill--warn' : 'pill--off'}`}>
                          {c.status === 'draft' ? 'draft' : c.status}
                        </span>
                      </td>
                      <td>
                        {cSent} <span className="muted">/ {c.stats?.enrolled || 0}</span>
                      </td>
                      <td>
                        {cOpened} {cSent > 0 && <span className="muted">({pct(cOpened, cSent)}%)</span>}
                      </td>
                      <td>
                        <b>{cReplied}</b> {cSent > 0 && <span className="muted">({pct(cReplied, cSent)}%)</span>}
                      </td>
                      <td>{c.stats?.bounced || 0}</td>
                      <td>
                        <button className="btn btn--ghost btn--sm" onClick={() => go('campaigns')}>
                          Open
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* ── Recipient Activity & Engagement Dashboard ─────────────────── */}
      <div className="card">
        <div className="card-head" style={{ marginBottom: 8 }}>
          <h2>All Recipients & Engagement Details</h2>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn btn--sm btn--go" onClick={exportRecipientsCsv}>
              📥 Download CSV
            </button>
            <input
              type="text"
              placeholder="Search by name, email, college, campaign…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ maxWidth: 280, padding: '6px 12px', fontSize: 13 }}
            />
          </div>
        </div>
        <p className="hint" style={{ marginBottom: 14 }}>
          Complete list of all recipients across your campaigns. Filter by who received, who opened, clicked, or replied, and download to CSV.
        </p>

        {/* Filter Tabs */}
        <div className="row" style={{ gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
          {RECIPIENT_TABS.map(([k, label, count]) => (
            <button
              key={k}
              className={`btn ${filter === k ? '' : 'btn--ghost'}`}
              style={{ padding: '6px 12px', fontSize: 12.5 }}
              onClick={() => setFilter(k)}
            >
              {label} ({count})
            </button>
          ))}
        </div>

        {/* Recipient Details Table */}
        <div className="table-wrap">
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Recipient</th>
                  <th>College / Location</th>
                  <th>Campaign</th>
                  <th>Status</th>
                  <th>Opens & Clicks</th>
                  <th>Emails Sent & Last Activity</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {!filteredEnrollments.length && (
                  <tr>
                    <td colSpan={7} className="empty">
                      {enrollments.length ? (
                        'No recipients found matching the selected filter or search.'
                      ) : (
                        <>
                          <b>No recipients enrolled yet</b>
                          Go to <b>Campaigns</b> → select a campaign → <b>Add recipients</b> to populate your dashboard.
                        </>
                      )}
                    </td>
                  </tr>
                )}
                {filteredEnrollments.map((r) => (
                  <tr key={r._id}>
                    <td>
                      <b>{r.contact?.name || r.contact?.email || '—'}</b>
                      {r.contact?.name && (
                        <>
                          <br />
                          <span className="muted">{r.contact.email}</span>
                        </>
                      )}
                      {r.contact?.designation && (
                        <>
                          <br />
                          <span className="hint">{r.contact.designation}</span>
                        </>
                      )}
                    </td>
                    <td>
                      {r.institution?.name || '—'}
                      {r.institution?.city && (
                        <>
                          <br />
                          <span className="muted">{r.institution.city}{r.institution.state ? `, ${r.institution.state}` : ''}</span>
                        </>
                      )}
                    </td>
                    <td>
                      <span className="pill pill--off">{r.campaign?.name || 'Campaign'}</span>
                    </td>
                    <td>
                      <span className={STATUS_PILL[r.status] || 'pill'}>{r.status}</span>
                    </td>
                    <td>
                      {r.openCount > 0 ? (
                        <span className="pill pill--ok">Opened {r.openCount}×</span>
                      ) : (
                        <span className="muted">{r.sentCount ? 'Not opened' : '—'}</span>
                      )}
                      {r.openedAt && (
                        <>
                          <br />
                          <span className="hint">{ago(r.openedAt)}</span>
                        </>
                      )}
                      {r.clickCount > 0 && (
                        <>
                          <br />
                          <span className="muted">{r.clickCount} click{r.clickCount > 1 ? 's' : ''}</span>
                        </>
                      )}
                    </td>
                    <td>
                      {r.sentCount > 0 ? (
                        <>
                          <b>{r.sentCount} sent</b>
                          <br />
                          <span className="muted">{ago(r.lastSentAt)}</span>
                        </>
                      ) : (
                        <span className="muted">Queued</span>
                      )}
                    </td>
                    <td>
                      {r.status === 'active' && r.sentCount > 0 && (
                        <button
                          className="btn btn--ghost"
                          style={{ padding: '5px 9px', fontSize: 12 }}
                          onClick={(e) => handleMarkReplied(e, r._id)}
                        >
                          They replied
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* ── Recent Email Activity Log (Audit Trail) ────────────────────── */}
      {d.messages && d.messages.length > 0 && (
        <div className="card">
          <div className="card-head">
            <h2>Recent Sent Emails Activity Log</h2>
            <button className="btn btn--sm btn--ghost" onClick={exportMessagesCsv}>
              📥 Export Messages CSV
            </button>
          </div>
          <p className="hint">Audit trail of emails sent across all campaigns.</p>
          <div className="table-wrap">
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>To</th>
                    <th>Subject</th>
                    <th>Campaign</th>
                    <th>Sent At</th>
                    <th>Open Status</th>
                  </tr>
                </thead>
                <tbody>
                  {d.messages.slice(0, 50).map((m) => (
                    <tr key={m._id}>
                      <td>
                        <b>{m.to}</b>
                        {m.contact?.name && <><br /><span className="muted">{m.contact.name}</span></>}
                      </td>
                      <td>{m.subject || '—'}</td>
                      <td><span className="muted">{m.campaign?.name || '—'}</span></td>
                      <td className="muted">{ago(m.sentAt)}</td>
                      <td>
                        {m.openedAt ? (
                          <span className="pill pill--ok">Opened {m.openCount > 1 ? `${m.openCount}×` : ''} ({ago(m.openedAt)})</span>
                        ) : (
                          <span className="muted">Not opened</span>
                        )}
                      </td>
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
