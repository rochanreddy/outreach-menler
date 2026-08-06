import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api.js';

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

  return (
    <>
      <div className="card">
        <h2>Import</h2>
        <p className="hint" style={{ marginTop: 0 }}>
          CSV columns: <code>college, city, state, website, type, student_count, name, designation,
          department, email, phone, linkedin</code>. One row per person; colleges are matched on
          name + city so several contacts group under one college. Duplicates and anyone on the
          do-not-contact list are skipped automatically.
        </p>
        <div className="row">
          <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={doImport} className="grow" />
        </div>
        {msg && <p className="ok">{msg}</p>}
      </div>

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
                {!loading && !rows.length && <tr><td colSpan={5} className="empty">Nothing yet — import a CSV above.</td></tr>}
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
