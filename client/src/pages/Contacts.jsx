import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { exportToCsv } from '../utils/csv.js';

const PIPELINE = ['new', 'contacted', 'replied', 'meeting', 'won', 'lost', 'unqualified'];
const pillFor = (s) =>
  (['won', 'replied', 'meeting'].includes(s) ? 'pill pill--ok'
    : ['lost', 'unqualified'].includes(s) ? 'pill pill--off' : 'pill');

export default function Contacts() {
  const [view, setView] = useState('institutions');
  const [rows, setRows] = useState([]);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [sup, setSup] = useState([]);
  const [supValue, setSupValue] = useState('');
  const [supMsg, setSupMsg] = useState('');
  const fileRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const qs = new URLSearchParams();
      if (search.trim()) qs.set('search', search.trim());
      if (status && view === 'institutions') qs.set('status', status);
      const q = qs.toString() ? `?${qs}` : '';
      const data = view === 'institutions' ? await api.institutions(q) : await api.contacts(q);
      setRows(data.rows || []);
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }, [view, search, status]);

  useEffect(() => { load(); }, [load]);

  const doImport = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setMsg('');
    setErr('');
    try {
      const r = await api.importCsv(file);
      setMsg(`Imported — ${r.institutions} new colleges, ${r.contacts} new contacts, ${r.skipped} skipped.`);
      load();
    } catch (e2) {
      setErr(e2.message);
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const setInstStatus = async (id, next) => {
    await api.updateInstitution(id, { status: next });
    load();
  };

  const loadSuppressions = useCallback(() => {
    api.suppressions().then((d) => setSup(d.rows || [])).catch(() => {});
  }, []);
  useEffect(() => { loadSuppressions(); }, [loadSuppressions]);

  const addSuppression = async () => {
    const value = supValue.trim();
    if (!value) return;
    setSupMsg(''); setErr('');
    try {
      await api.addSuppression({ value, reason: 'manual' });
      setSupValue('');
      setSupMsg(`${value} will never be emailed.`);
      loadSuppressions();
    } catch (e) { setErr(e.message); }
  };

  const exportCsv = () => {
    if (view === 'institutions') {
      const fields = [
        { label: 'College Name', get: (r) => r.name || '' },
        { label: 'City', get: (r) => r.city || '' },
        { label: 'State', get: (r) => r.state || '' },
        { label: 'Contacts Count', get: (r) => r.contactCount || 0 },
        { label: 'Status', get: (r) => r.status || '' },
        { label: 'Website', get: (r) => r.website || '' },
        { label: 'Domain', get: (r) => r.domain || '' },
      ];
      exportToCsv('colleges_list', fields, rows);
    } else {
      const fields = [
        { label: 'Name', get: (r) => r.name || '' },
        { label: 'Email', get: (r) => r.email || '' },
        { label: 'Designation', get: (r) => r.designation || '' },
        { label: 'College', get: (r) => r.institution?.name || '' },
        { label: 'State', get: (r) => r.institution?.state || '' },
        { label: 'Unsubscribed', get: (r) => (r.unsubscribed ? 'Yes' : 'No') },
        { label: 'Bounced', get: (r) => (r.bounced ? 'Yes' : 'No') },
      ];
      exportToCsv('contacts_list', fields, rows);
    }
  };

  return (
    <>
      <div className="page-head">
        <h1>Contacts</h1>
        <p>
          Everyone you’ve collected, in one place. This is your address book — being
          listed here doesn’t email anyone. To do that, add them to a campaign.
        </p>
      </div>

      {/* Moved here from the old Sending health tab. It belongs with the
          address book anyway — it is a fact about a contact, not about the
          mail server — and it was the one thing on that tab with nowhere
          else to live. */}
      <details className="card">
        <summary style={{ cursor: 'pointer', fontWeight: 700 }}>
          Do-not-contact list {sup.length > 0 && <span className="muted">— {sup.length}</span>}
        </summary>
        <p className="hint" style={{ marginTop: 12 }}>
          Nobody here is ever emailed. Unsubscribes and hard bounces land here on their own
          and are checked before every send — including across re-imports, so a removed
          contact stays removed. Add a whole domain to block an entire college.
        </p>
        <div className="row">
          <input className="grow" placeholder="person@college.edu or college.edu (whole domain)"
            value={supValue} onChange={(e) => setSupValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addSuppression()} />
          <button className="btn" onClick={addSuppression} disabled={!supValue.trim()}>Add</button>
        </div>
        {supMsg && <p className="ok">{supMsg}</p>}
        <div className="table-wrap" style={{ marginTop: 12 }}>
          <table>
            <thead><tr><th>Value</th><th>Kind</th><th>Reason</th></tr></thead>
            <tbody>
              {!sup.length && <tr><td colSpan={3} className="empty">Nobody blocked yet.</td></tr>}
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
      </details>

      <details className="card">
        <summary style={{ cursor: 'pointer', fontWeight: 700 }}>Upload a CSV</summary>
        <p className="hint" style={{ marginTop: 12 }}>
          Columns: <code>college, city, state, website, type, student_count, name, designation,
          department, email, phone, linkedin</code>. One row per person; colleges are matched on
          name + city so several contacts group under one college. Duplicates and anyone on the
          do-not-contact list are skipped automatically.
        </p>
        <div className="row">
          <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={doImport} className="grow" />
        </div>
        {msg && <p className="ok">{msg}</p>}
      </details>

      <div className="card">
        <div className="row" style={{ marginBottom: 14 }}>
          <button className={`btn ${view === 'institutions' ? '' : 'btn--ghost'}`} onClick={() => setView('institutions')}>Colleges</button>
          <button className={`btn ${view === 'contacts' ? '' : 'btn--ghost'}`} onClick={() => setView('contacts')}>Contacts</button>
          <input className="grow" placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} />
          {view === 'institutions' && (
            <select style={{ width: 160 }} value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All statuses</option>
              {PIPELINE.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          )}
          <button className="btn btn--ghost" onClick={exportCsv}>
            📥 Export CSV
          </button>
        </div>

        {err && <p className="err">{err}</p>}

        <div className="table-wrap">
          {view === 'institutions' ? (
            <table>
              <thead>
                <tr><th>College</th><th>City</th><th>State</th><th>Contacts</th><th>Status</th></tr>
              </thead>
              <tbody>
                {loading && <tr><td colSpan={5} className="empty">Loading…</td></tr>}
                {!loading && !rows.length && (
                  <tr><td colSpan={5} className="empty">
                    <b>No colleges yet</b>
                    Go to <b>Find colleges</b> to search for them, or upload a CSV above.
                  </td></tr>
                )}
                {!loading && rows.map((r) => (
                  <tr key={r._id}>
                    <td><b>{r.name}</b></td>
                    <td>{r.city || '—'}</td>
                    <td>{r.state || '—'}</td>
                    <td>{r.contactCount}</td>
                    <td>
                      <select
                        className={pillFor(r.status)}
                        style={{ width: 140, padding: '4px 8px' }}
                        value={r.status}
                        onChange={(e) => setInstStatus(r._id, e.target.value)}
                      >
                        {PIPELINE.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table>
              <thead>
                <tr><th>Name</th><th>Designation</th><th>Email</th><th>College</th><th>State</th></tr>
              </thead>
              <tbody>
                {loading && <tr><td colSpan={5} className="empty">Loading…</td></tr>}
                {!loading && !rows.length && <tr><td colSpan={5} className="empty">No contacts yet.</td></tr>}
                {!loading && rows.map((r) => (
                  <tr key={r._id}>
                    <td>
                      <b>{r.name || '—'}</b>
                      {r.unsubscribed && <> <span className="pill pill--off">unsubscribed</span></>}
                      {r.bounced && <> <span className="pill pill--warn">bounced</span></>}
                    </td>
                    <td>{r.designation || '—'}</td>
                    <td className="muted">{r.email}</td>
                    <td>{r.institution?.name || '—'}</td>
                    <td>{r.institution?.state || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
}
