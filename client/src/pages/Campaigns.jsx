import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';

const BLANK_STEP = { subject: '', body: '', delayDays: 3, threaded: true };

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
  const setStep = (i, k, v) => {
    const steps = c.steps.map((s, j) => (i === j ? { ...s, [k]: v } : s));
    setC({ ...c, steps });
  };

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
  return (
    <>
      <div className="row" style={{ marginBottom: 14 }}>
        <button className="btn btn--ghost" onClick={onBack}>← All campaigns</button>
        <span className={`pill ${c.status === 'active' ? 'pill--ok' : c.status === 'paused' ? 'pill--warn' : 'pill--off'}`}>
          {c.status}
        </span>
        <div className="right" style={{ marginLeft: 'auto' }}>
          {c.status !== 'active'
            ? <button className="btn btn--go" disabled={busy} onClick={() => act(() => api.setStatus(id, 'active'), 'Campaign is live — sending within its window.')}>▶ Activate</button>
            : <button className="btn btn--warn" disabled={busy} onClick={() => act(() => api.setStatus(id, 'paused'), 'Paused.')}>⏸ Pause</button>}
        </div>
      </div>

      <div className="card">
        <h2>Stats</h2>
        <div className="stats">
          <div className="stat"><b>{st.enrolled || 0}</b><span>Enrolled</span></div>
          <div className="stat"><b>{st.sent || 0}</b><span>Sent</span></div>
          <div className="stat"><b>{st.opened || 0}</b><span>Opened</span></div>
          <div className="stat"><b>{st.replied || 0}</b><span>Replied</span></div>
          <div className="stat"><b>{st.bounced || 0}</b><span>Bounced</span></div>
          <div className="stat"><b>{st.unsubscribed || 0}</b><span>Unsubscribed</span></div>
        </div>
      </div>

      <div className="card">
        <h2>Sender</h2>
        <div className="row">
          <label className="field grow"><span>Campaign name</span>
            <input value={c.name} onChange={(e) => set('name', e.target.value)} />
          </label>
          <label className="field grow"><span>From name</span>
            <input value={c.fromName || ''} onChange={(e) => set('fromName', e.target.value)} placeholder="Rochan from Menler" />
          </label>
        </div>
        <div className="row">
          <label className="field grow"><span>From email (outreach domain only)</span>
            <input value={c.fromEmail || ''} onChange={(e) => set('fromEmail', e.target.value)} placeholder="rochan@outreach.menler.in" />
          </label>
          <label className="field grow"><span>Reply-to (a watched inbox)</span>
            <input value={c.replyTo || ''} onChange={(e) => set('replyTo', e.target.value)} placeholder="partnerships@menler.in" />
          </label>
        </div>
      </div>

      <div className="card">
        <h2>Pacing</h2>
        <div className="row">
          <label className="field" style={{ width: 150 }}><span>Emails per day</span>
            <input type="number" min="1" max="500" value={c.dailyCap} onChange={(e) => set('dailyCap', Number(e.target.value))} />
          </label>
          <label className="field" style={{ width: 150 }}><span>Send from (IST hour)</span>
            <input type="number" min="0" max="23" value={c.sendWindowStart} onChange={(e) => set('sendWindowStart', Number(e.target.value))} />
          </label>
          <label className="field" style={{ width: 150 }}><span>Send until (IST hour)</span>
            <input type="number" min="1" max="24" value={c.sendWindowEnd} onChange={(e) => set('sendWindowEnd', Number(e.target.value))} />
          </label>
          <label className="field" style={{ width: 160 }}><span>Weekdays only</span>
            <select value={c.weekdaysOnly ? 'yes' : 'no'} onChange={(e) => set('weekdaysOnly', e.target.value === 'yes')}>
              <option value="yes">Yes</option><option value="no">No</option>
            </select>
          </label>
        </div>
        <p className="hint">
          Keep it low on a new domain — 20–40/day for the first few weeks, then raise slowly.
          Blasting a fresh domain is the fastest way into the spam folder.
        </p>
      </div>

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
                    <input
                      type="number" min="0" max="60" style={{ width: 70 }}
                      value={s.delayDays} onChange={(e) => setStep(i, 'delayDays', Number(e.target.value))}
                    />
                    <span className="hint">days</span>
                  </label>
                )}
                <button className="btn btn--ghost" onClick={() => setC({ ...c, steps: c.steps.filter((_, j) => j !== i) })}>Remove</button>
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
          Placeholders: <code>{'{{first_name}}'}</code> <code>{'{{name}}'}</code> <code>{'{{college}}'}</code>{' '}
          <code>{'{{designation}}'}</code> <code>{'{{department}}'}</code> <code>{'{{city}}'}</code>{' '}
          <code>{'{{state}}'}</code>. Add a fallback with a pipe: <code>{'{{first_name|there}}'}</code>.
          An unsubscribe footer is appended automatically.
        </p>
      </div>

      <div className="card">
        <h2>Test &amp; enrol</h2>
        <div className="row">
          <input className="grow" placeholder="your@email.com" value={testTo} onChange={(e) => setTestTo(e.target.value)} />
          <button className="btn btn--ghost" disabled={busy || !testTo}
            onClick={() => act(() => api.testSend(id, { to: testTo, stepIndex: 0 }), 'Test sent — check your inbox (and spam).')}>
            Send me a test
          </button>
          <button className="btn" disabled={busy}
            onClick={() => act(async () => {
              const r = await api.enroll(id, { limit: 500 });
              return `Enrolled ${r.enrolled}, skipped ${r.skipped}.`;
            }, 'Enrolled.')}>
            Enrol all sendable contacts
          </button>
        </div>
        <p className="hint">Always send yourself a test before activating — it's the only way to catch a broken placeholder before a dean sees it.</p>
      </div>

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
          <input className="grow" placeholder="e.g. Telangana engineering colleges — Aug"
            value={name} onChange={(e) => setName(e.target.value)} />
          <button className="btn" onClick={create}>Create</button>
        </div>
      </div>

      <div className="card">
        <h2>Campaigns</h2>
        {err && <p className="err">{err}</p>}
        <div className="table-wrap">
          <table>
            <thead><tr><th>Name</th><th>Status</th><th>Steps</th><th>Sent</th><th>Replied</th><th /></tr></thead>
            <tbody>
              {!rows.length && <tr><td colSpan={6} className="empty">No campaigns yet.</td></tr>}
              {rows.map((r) => (
                <tr key={r._id}>
                  <td><b>{r.name}</b></td>
                  <td><span className={`pill ${r.status === 'active' ? 'pill--ok' : r.status === 'paused' ? 'pill--warn' : 'pill--off'}`}>{r.status}</span></td>
                  <td>{r.steps?.length || 0}</td>
                  <td>{r.stats?.sent || 0}</td>
                  <td>{r.stats?.replied || 0}</td>
                  <td><button className="btn btn--ghost" onClick={() => setOpen(r._id)}>Open</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
