import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';

const BLANK_STEP = { subject: '', body: '', delayDays: 3, threaded: true };

const pct = (n, total) => (total ? Math.round((n / total) * 100) : 0);
const ago = (d) => {
  if (!d) return '—';
  const mins = Math.round((Date.now() - new Date(d)) / 60000);
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
};

const STATUS_PILL = {
  replied: 'pill pill--ok',
  active: 'pill',
  completed: 'pill pill--off',
  unsubscribed: 'pill pill--off',
  bounced: 'pill pill--warn',
  stopped: 'pill pill--off',
};

/** Who's in the campaign and what happened — the day-to-day view. */
function Recipients({ id, onChange }) {
  const [rows, setRows] = useState([]);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api.enrollments(id);
      setRows(d.rows || []);
    } finally {
      setLoading(false);
    }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const shown = rows.filter((r) => {
    if (filter === 'replied') return r.status === 'replied';
    if (filter === 'opened') return r.openCount > 0 && r.status !== 'replied';
    if (filter === 'noreply') return r.sentCount > 0 && !r.openCount && r.status === 'active';
    return true;
  });

  const counts = {
    all: rows.length,
    replied: rows.filter((r) => r.status === 'replied').length,
    opened: rows.filter((r) => r.openCount > 0 && r.status !== 'replied').length,
    noreply: rows.filter((r) => r.sentCount > 0 && !r.openCount && r.status === 'active').length,
  };

  const markReplied = async (e, row) => {
    e.stopPropagation();
    await api.markReplied(row._id);
    load();
    onChange?.();
  };

  const TABS = [
    ['all', 'Everyone'],
    ['replied', 'Replied'],
    ['opened', 'Opened, no reply'],
    ['noreply', 'No response'],
  ];

  return (
    <div className="card">
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>Recipients</h2>
        <span className="row" style={{ gap: 6 }}>
          {TABS.map(([k, label]) => (
            <button key={k} className={`btn ${filter === k ? '' : 'btn--ghost'}`}
              style={{ padding: '6px 12px', fontSize: 12.5 }}
              onClick={() => setFilter(k)}>
              {label} ({counts[k]})
            </button>
          ))}
        </span>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Who</th><th>College</th><th>Status</th><th>Opened</th><th>Last email</th><th /></tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={6} className="empty">Loading…</td></tr>}
            {!loading && !shown.length && (
              <tr><td colSpan={6} className="empty">
                {rows.length ? 'Nobody in this group yet.' : 'Nobody enrolled yet — use “Enrol contacts” below.'}
              </td></tr>
            )}
            {!loading && shown.map((r) => (
              <tr key={r._id}>
                <td>
                  <b>{r.contact?.name || r.contact?.email || '—'}</b>
                  {r.contact?.name && <><br /><span className="muted">{r.contact.email}</span></>}
                </td>
                <td>
                  {r.institution?.name || '—'}
                  {r.institution?.city && <><br /><span className="muted">{r.institution.city}</span></>}
                </td>
                <td><span className={STATUS_PILL[r.status] || 'pill'}>{r.status}</span></td>
                <td>
                  {r.openCount
                    ? <span className="pill pill--ok">{r.openCount}×</span>
                    : <span className="muted">{r.sentCount ? 'not yet' : '—'}</span>}
                  {r.clickCount > 0 && <><br /><span className="muted">{r.clickCount} click{r.clickCount > 1 ? 's' : ''}</span></>}
                </td>
                <td className="muted">
                  {r.sentCount ? `${r.sentCount} sent · ${ago(r.lastSentAt)}` : 'queued'}
                </td>
                <td>
                  {r.status === 'active' && r.sentCount > 0 && (
                    <button className="btn btn--ghost" style={{ padding: '6px 10px', fontSize: 12 }}
                      onClick={(e) => markReplied(e, r)}>
                      They replied
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="hint" style={{ marginTop: 10 }}>
        Opens are a soft signal — image blocking hides plenty of real reads, so treat
        “not yet” as unknown rather than ignored. Marking someone as replied stops
        their follow-ups immediately.
      </p>
    </div>
  );
}

/**
 * Choose who this campaign emails. Defaults to nobody until you preview —
 * "enrol everyone" should be a decision, not the path of least resistance.
 */
function Enroller({ id, onDone }) {
  const [f, setF] = useState({ role: '', city: '', state: '', limit: 200 });
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const set = (k, v) => { setF((p) => ({ ...p, [k]: v })); setPreview(null); setMsg(''); };

  const check = async () => {
    setBusy(true); setErr(''); setMsg('');
    try { setPreview(await api.enroll(id, { ...f, dryRun: true })); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  const commit = async () => {
    setBusy(true); setErr(''); setMsg('');
    try {
      const r = await api.enroll(id, f);
      setMsg(`Enrolled ${r.enrolled}${r.skipped ? `, skipped ${r.skipped}` : ''}.`);
      setPreview(null);
      onDone?.();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <div className="card">
      <h2>Who gets this campaign</h2>
      <p className="hint" style={{ marginTop: 0 }}>
        Leave a box empty to ignore it. People who unsubscribed, bounced, or are on
        the do-not-contact list are always excluded — and nobody is enrolled twice.
      </p>
      <div className="row">
        <label className="field grow"><span>Role — matches designation or address</span>
          <input value={f.role} onChange={(e) => set('role', e.target.value)}
            placeholder="placement · principal · hod" />
        </label>
        <label className="field grow"><span>City</span>
          <input value={f.city} onChange={(e) => set('city', e.target.value)} placeholder="Hyderabad" />
        </label>
        <label className="field grow"><span>State</span>
          <input value={f.state} onChange={(e) => set('state', e.target.value)} placeholder="Telangana" />
        </label>
        <label className="field" style={{ width: 110 }}><span>Max</span>
          <input type="number" min="1" max="500" value={f.limit}
            onChange={(e) => set('limit', Number(e.target.value))} />
        </label>
      </div>

      <div className="row">
        <button className="btn btn--ghost" onClick={check} disabled={busy}>
          {busy ? 'Checking…' : 'Preview who matches'}
        </button>
        {preview && (
          <button className="btn" onClick={commit} disabled={busy || !preview.wouldEnroll}>
            {preview.wouldEnroll
              ? `Enrol ${preview.wouldEnroll} contact${preview.wouldEnroll === 1 ? '' : 's'}`
              : 'Nothing new to enrol'}
          </button>
        )}
      </div>

      {preview && (
        <div style={{ marginTop: 12 }}>
          <p className="hint">
            <b>{preview.matched}</b> match{preview.matched === 1 ? '' : 'es'}
            {preview.alreadyEnrolled ? ` · ${preview.alreadyEnrolled} already in this campaign` : ''}
            {' '}· <b>{preview.wouldEnroll}</b> would be added
          </p>
          {preview.sample?.length > 0 && (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Email</th><th>Designation</th></tr></thead>
                <tbody>
                  {preview.sample.map((s) => (
                    <tr key={s.email}>
                      <td>{s.email}</td>
                      <td className="muted">{s.designation || '—'}</td>
                    </tr>
                  ))}
                  {preview.matched > preview.sample.length && (
                    <tr><td colSpan={2} className="muted">
                      …and {preview.matched - preview.sample.length} more
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {err && <p className="err">{err}</p>}
      {msg && <p className="ok">{msg}</p>}
    </div>
  );
}

function Editor({ id, onBack }) {
  const [c, setC] = useState(null);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [testTo, setTestTo] = useState('');

  const load = useCallback(() => {
    api.campaign(id).then(setC).catch((e) => setErr(e.message));
  }, [id]);
  useEffect(load, [load]);

  if (err && !c) return <p className="err">{err}</p>;
  if (!c) return <p className="empty">Loading…</p>;

  const set = (k, v) => setC({ ...c, [k]: v });
  const setStep = (i, k, v) => setC({ ...c, steps: c.steps.map((s, j) => (i === j ? { ...s, [k]: v } : s)) });

  const save = async () => {
    setBusy(true); setErr(''); setMsg('');
    try {
      await api.updateCampaign(id, {
        name: c.name, fromName: c.fromName, fromEmail: c.fromEmail, replyTo: c.replyTo,
        steps: c.steps, dailyCap: c.dailyCap, sendWindowStart: c.sendWindowStart,
        sendWindowEnd: c.sendWindowEnd, weekdaysOnly: c.weekdaysOnly,
      });
      setMsg('Saved.');
      load();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  const act = async (fn, okMsg) => {
    setBusy(true); setErr(''); setMsg('');
    try { const r = await fn(); setMsg(typeof r === 'string' ? r : okMsg); load(); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  const st = c.stats || {};
  const enrolled = st.enrolled || 0;

  return (
    <>
      <div className="row" style={{ marginBottom: 14 }}>
        <button className="btn btn--ghost" onClick={onBack}>← All campaigns</button>
        <b>{c.name}</b>
        <span className={`pill ${c.status === 'active' ? 'pill--ok' : c.status === 'paused' ? 'pill--warn' : 'pill--off'}`}>
          {c.status}
        </span>
        <div style={{ marginLeft: 'auto' }}>
          {c.status !== 'active'
            ? <button className="btn btn--go" disabled={busy}
              onClick={() => act(() => api.setStatus(id, 'active'), 'Live — sending within its window.')}>▶ Activate</button>
            : <button className="btn btn--warn" disabled={busy}
              onClick={() => act(() => api.setStatus(id, 'paused'), 'Paused.')}>⏸ Pause</button>}
        </div>
      </div>

      {/* The four numbers that actually matter, with progress. */}
      <div className="card">
        <div className="stats">
          <div className="stat"><b>{st.replied || 0}</b><span>Replied · {pct(st.replied, st.sent)}% of sent</span></div>
          <div className="stat" style={{ borderTopColor: 'var(--placed)' }}>
            <b>{st.opened || 0}</b><span>Opened · {pct(st.opened, st.sent)}% of sent</span>
          </div>
          <div className="stat" style={{ borderTopColor: 'var(--ink)' }}>
            <b>{st.sent || 0}<span style={{ fontSize: 15, color: 'var(--muted)' }}> / {enrolled}</span></b>
            <span>Sent of enrolled</span>
          </div>
          <div className="stat" style={{ borderTopColor: 'var(--amber)' }}>
            <b>{(st.bounced || 0) + (st.unsubscribed || 0)}</b>
            <span>{st.bounced || 0} bounced · {st.unsubscribed || 0} unsubscribed</span>
          </div>
        </div>
      </div>

      <Recipients id={id} onChange={load} />

      <div className="card">
        <h2>Sequence</h2>
        {c.steps.map((s, i) => (
          <div className="step" key={i}>
            <div className="step-head">
              <b>{i === 0 ? 'First email' : `Follow-up ${i}`}</b>
              <div className="row">
                {i > 0 && (
                  <label className="row" style={{ gap: 6 }}>
                    <span className="hint">wait</span>
                    <input type="number" min="0" max="60" style={{ width: 70 }}
                      value={s.delayDays} onChange={(e) => setStep(i, 'delayDays', Number(e.target.value))} />
                    <span className="hint">days</span>
                  </label>
                )}
                <button className="btn btn--ghost"
                  onClick={() => setC({ ...c, steps: c.steps.filter((_, j) => j !== i) })}>Remove</button>
              </div>
            </div>
            <label className="field"><span>Subject</span>
              <input value={s.subject} onChange={(e) => setStep(i, 'subject', e.target.value)}
                placeholder="AI workshop for {{college}} students" />
            </label>
            <label className="field"><span>Body</span>
              <textarea value={s.body} onChange={(e) => setStep(i, 'body', e.target.value)}
                placeholder={'Hi {{first_name|there}},\n\n…'} />
            </label>
          </div>
        ))}
        <div className="row">
          <button className="btn btn--ghost" onClick={() => setC({ ...c, steps: [...c.steps, { ...BLANK_STEP }] })}>
            + Add {c.steps.length ? 'follow-up' : 'first email'}
          </button>
          <button className="btn" disabled={busy} onClick={save}>Save</button>
        </div>
        <p className="hint" style={{ marginTop: 10 }}>
          <code>{'{{first_name}}'}</code> <code>{'{{college}}'}</code> <code>{'{{designation}}'}</code>{' '}
          <code>{'{{city}}'}</code> — fallback with a pipe: <code>{'{{first_name|there}}'}</code>.
          The unsubscribe footer is added for you.
        </p>
      </div>

      <div className="card">
        <h2>Send a test</h2>
        <div className="row">
          <input className="grow" placeholder="your@email.com" value={testTo}
            onChange={(e) => setTestTo(e.target.value)} />
          <button className="btn btn--ghost" disabled={busy || !testTo}
            onClick={() => act(() => api.testSend(id, { to: testTo, stepIndex: 0 }), 'Test sent — check your inbox and spam.')}>
            Send me a test
          </button>
        </div>
        <p className="hint">Always test before activating — it's the only way to catch a broken placeholder before a dean sees it.</p>
      </div>

      <Enroller id={id} onDone={load} />

      {/* Set once, then out of the way. */}
      <details className="card">
        <summary style={{ cursor: 'pointer', fontWeight: 600, color: 'var(--muted)' }}>
          Settings — sender &amp; pacing
        </summary>
        <div style={{ marginTop: 16 }}>
          <div className="row">
            <label className="field grow"><span>Campaign name</span>
              <input value={c.name} onChange={(e) => set('name', e.target.value)} />
            </label>
            <label className="field grow"><span>From name</span>
              <input value={c.fromName || ''} onChange={(e) => set('fromName', e.target.value)}
                placeholder="Rochan from Menler" />
            </label>
          </div>
          <div className="row">
            <label className="field grow"><span>From email (outreach domain only)</span>
              <input value={c.fromEmail || ''} onChange={(e) => set('fromEmail', e.target.value)}
                placeholder="rochan@outreach.menler.in" />
            </label>
            <label className="field grow"><span>Reply-to (a watched inbox)</span>
              <input value={c.replyTo || ''} onChange={(e) => set('replyTo', e.target.value)}
                placeholder="partnerships@menler.in" />
            </label>
          </div>
          <div className="row">
            <label className="field" style={{ width: 140 }}><span>Emails per day</span>
              <input type="number" min="1" max="500" value={c.dailyCap}
                onChange={(e) => set('dailyCap', Number(e.target.value))} />
            </label>
            <label className="field" style={{ width: 140 }}><span>From (IST hour)</span>
              <input type="number" min="0" max="23" value={c.sendWindowStart}
                onChange={(e) => set('sendWindowStart', Number(e.target.value))} />
            </label>
            <label className="field" style={{ width: 140 }}><span>Until (IST hour)</span>
              <input type="number" min="1" max="24" value={c.sendWindowEnd}
                onChange={(e) => set('sendWindowEnd', Number(e.target.value))} />
            </label>
            <label className="field" style={{ width: 150 }}><span>Weekdays only</span>
              <select value={c.weekdaysOnly ? 'yes' : 'no'}
                onChange={(e) => set('weekdaysOnly', e.target.value === 'yes')}>
                <option value="yes">Yes</option><option value="no">No</option>
              </select>
            </label>
            <button className="btn" disabled={busy} onClick={save} style={{ alignSelf: 'flex-end', marginBottom: 10 }}>
              Save
            </button>
          </div>
          <p className="hint">Keep it to 20–40/day on a new domain for the first few weeks, then raise slowly.</p>
        </div>
      </details>

      {err && <p className="err">{err}</p>}
      {msg && <p className="ok">{msg}</p>}
    </>
  );
}

export default function Campaigns() {
  const [rows, setRows] = useState([]);
  const [open, setOpen] = useState(null);
  const [name, setName] = useState('');
  const [err, setErr] = useState('');

  const load = useCallback(() => {
    api.campaigns().then((d) => setRows(d.rows || [])).catch((e) => setErr(e.message));
  }, []);
  useEffect(load, [load]);

  if (open) return <Editor id={open} onBack={() => { setOpen(null); load(); }} />;

  const create = async () => {
    if (!name.trim()) return;
    try {
      const c = await api.createCampaign({ name, steps: [{ ...BLANK_STEP }] });
      setName('');
      setOpen(c._id);
    } catch (e) { setErr(e.message); }
  };

  return (
    <>
      <div className="card">
        <h2>New campaign</h2>
        <div className="row">
          <input className="grow" placeholder="e.g. Hyderabad engineering colleges — August"
            value={name} onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && create()} />
          <button className="btn" onClick={create}>Create</button>
        </div>
      </div>

      <div className="card">
        <h2>Campaigns</h2>
        {err && <p className="err">{err}</p>}
        <div className="table-wrap">
          <table>
            <thead><tr><th>Name</th><th>Status</th><th>Sent</th><th>Opened</th><th>Replied</th><th /></tr></thead>
            <tbody>
              {!rows.length && <tr><td colSpan={6} className="empty">No campaigns yet.</td></tr>}
              {rows.map((r) => (
                <tr key={r._id} onClick={() => setOpen(r._id)} style={{ cursor: 'pointer' }}>
                  <td><b>{r.name}</b></td>
                  <td>
                    <span className={`pill ${r.status === 'active' ? 'pill--ok' : r.status === 'paused' ? 'pill--warn' : 'pill--off'}`}>
                      {r.status}
                    </span>
                  </td>
                  <td>{r.stats?.sent || 0}<span className="muted"> / {r.stats?.enrolled || 0}</span></td>
                  <td>{r.stats?.opened || 0}</td>
                  <td><b>{r.stats?.replied || 0}</b></td>
                  <td><button className="btn btn--ghost">Open</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
