import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';

// Sending health + the do-not-contact list. Deliverability lives or dies here,
// so it gets its own screen rather than being buried in a campaign.
export default function Ops() {
  const [status, setStatus] = useState(null);
  const [sup, setSup] = useState([]);
  const [value, setValue] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const load = useCallback(() => {
    api.opsStatus().then(setStatus).catch((e) => setErr(e.message));
    api.suppressions().then((d) => setSup(d.rows || [])).catch(() => {});
  }, []);
  useEffect(load, [load]);

  const add = async () => {
    if (!value.trim()) return;
    setErr(''); setMsg('');
    try {
      await api.addSuppression({ value: value.trim(), reason: 'manual' });
      setValue('');
      setMsg('Added to the do-not-contact list.');
      load();
    } catch (e) { setErr(e.message); }
  };

  return (
    <>
      <div className="page-head">
        <h1>Sending health</h1>
        <p>Whether email can actually go out, what’s sending now, and who must never be contacted.</p>
      </div>

      <div className="card">
        <h2>Can we send email?</h2>
        {!status && <p className="empty">Checking…</p>}
        {status && (
          status.mail?.ok
            ? (
              <p style={{ marginTop: 8 }}>
                <span className="pill pill--ok">Yes — connected</span>{' '}
                <span className="muted">via {status.mail.host}</span>
              </p>
            )
            : (
              <div className="note note--bad" style={{ marginTop: 8 }}>
                <b>No — nothing can go out.</b> {status.mail?.error}
                <br />
                Campaigns stay queued until this is fixed; no email is lost.
              </div>
            )
        )}
        <p className="hint" style={{ marginTop: 12 }}>
          Ideally this is a <b>dedicated domain for outreach</b> (e.g. outreach.menler.in) rather
          than the one that sends certificates and receipts — a spam complaint against a shared
          domain takes those down with it.
        </p>
      </div>

      <div className="card">
        <h2>Active campaigns</h2>
        {!status?.active?.length && <p className="empty">Nothing is sending right now.</p>}
        {status?.active?.map((c) => (
          <div className="row" key={c.id} style={{ justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
            <b>{c.name}</b>
            <span>
              <span className="muted">{c.sentToday} / {c.dailyCap} today</span>{' '}
              <span className={`pill ${c.sendingNow ? 'pill--ok' : 'pill--off'}`}>
                {c.sendingNow ? 'in window' : 'outside window'}
              </span>
            </span>
          </div>
        ))}
        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn btn--ghost" onClick={async () => {
            setMsg(''); setErr('');
            try { const r = await api.tick(); setMsg(`Tick ran — sent ${r.sent || 0}, skipped ${r.skipped || 0}, failed ${r.failed || 0}.`); load(); }
            catch (e) { setErr(e.message); }
          }}>Run a send tick now</button>
        </div>
      </div>

      <div className="card">
        <h2>Do-not-contact list</h2>
        <div className="row">
          <input className="grow" placeholder="person@college.edu or college.edu (whole domain)"
            value={value} onChange={(e) => setValue(e.target.value)} />
          <button className="btn" onClick={add}>Add</button>
        </div>
        <p className="hint">
          Unsubscribes and hard bounces land here automatically and are checked before every
          single send — including across re-imports, so a removed contact stays removed.
        </p>
        <div className="table-wrap" style={{ marginTop: 12 }}>
          <table>
            <thead><tr><th>Value</th><th>Kind</th><th>Reason</th></tr></thead>
            <tbody>
              {!sup.length && <tr><td colSpan={3} className="empty">Empty.</td></tr>}
              {sup.map((s) => (
                <tr key={s._id}>
                  <td>{s.value}</td>
                  <td><span className="pill">{s.kind}</span></td>
                  <td className="muted">{s.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {err && <p className="err">{err}</p>}
      {msg && <p className="ok">{msg}</p>}
    </>
  );
}
