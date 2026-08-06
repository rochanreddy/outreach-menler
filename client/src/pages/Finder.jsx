import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api.js';

// Find contacts on college websites, review what came back, then approve the
// good ones into the contact database. Nothing is emailable until it's approved.
export default function Finder() {
  const [sites, setSites] = useState('');
  const [job, setJob] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const fileRef = useRef(null);

  const loadJobs = useCallback(() => {
    api.scrapeJobs().then((d) => setJobs(d.rows || [])).catch(() => {});
  }, []);
  useEffect(loadJobs, [loadJobs]);

  // Poll while a run is in progress.
  useEffect(() => {
    if (!job || job.status === 'done' || job.status === 'failed') return undefined;
    const t = setInterval(() => {
      api.scrapeJob(job._id).then(setJob).catch(() => {});
    }, 2500);
    return () => clearInterval(t);
  }, [job]);

  const start = async (file) => {
    setBusy(true); setErr(''); setMsg('');
    try {
      const list = sites.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
      const { id } = file ? await api.scrapeUpload(file) : await api.scrapeRun(list);
      const full = await api.scrapeJob(id);
      setJob(full);
      setSites('');
      loadJobs();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const importGood = async () => {
    setBusy(true); setErr(''); setMsg('');
    try {
      const r = await api.scrapeImport(job._id, { minScore: 60 });
      setMsg(`Imported ${r.contacts} contacts across ${r.institutions} new colleges (${r.skipped} skipped).`);
      setJob(await api.scrapeJob(job._id));
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  const done = job && job.status === 'done';
  const pct = job && job.total ? Math.round((job.processed / job.total) * 100) : 0;

  return (
    <>
      <div className="card">
        <h2>Find contacts</h2>
        <p className="hint" style={{ marginTop: 0 }}>
          Paste college websites (one per line), or upload a CSV with{' '}
          <code>college, website, city, state</code>. Each site is crawled for its
          placement-cell, principal and HOD contacts — public pages only, one at a
          time, respecting robots.txt.
        </p>
        <textarea
          value={sites}
          onChange={(e) => setSites(e.target.value)}
          placeholder={'cbit.ac.in\ngriet.ac.in\nkmit.in'}
          style={{ minHeight: 110 }}
        />
        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn" disabled={busy || !sites.trim()} onClick={() => start(null)}>
            {busy ? 'Working…' : 'Find contacts'}
          </button>
          <span className="hint">or</span>
          <input ref={fileRef} type="file" accept=".csv" className="grow"
            onChange={(e) => e.target.files?.[0] && start(e.target.files[0])} />
        </div>
        {err && <p className="err">{err}</p>}
        {msg && <p className="ok">{msg}</p>}
      </div>

      {job && (
        <div className="card">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h2 style={{ margin: 0 }}>
              Run · {job.processed}/{job.total} colleges
              {!done && <span className="muted"> — {pct}%</span>}
            </h2>
            {done && (
              <button className="btn btn--go" disabled={busy} onClick={importGood}>
                Import the good ones
              </button>
            )}
          </div>
          <p className="hint">
            Found <b>{job.foundContacts}</b> addresses. “Import the good ones” keeps
            anything scoring 60+ with a working mail domain — placement cells,
            principals and named staff — and drops generic junk.
          </p>

          <div className="table-wrap" style={{ marginTop: 12 }}>
            <table>
              <thead>
                <tr><th>College</th><th>Email</th><th>Who</th><th>Score</th><th /></tr>
              </thead>
              <tbody>
                {job.results.map((r) => (
                  r.contacts.length ? r.contacts.map((c) => (
                    <tr key={`${r.website}-${c.email}`}>
                      <td className="muted">{r.collegeName || r.website}</td>
                      <td><b>{c.email}</b></td>
                      <td>
                        {c.name ? <>{c.name}<br /></> : null}
                        <span className="muted">{c.designation}</span>
                      </td>
                      <td>
                        <span className={`pill ${c.score >= 100 ? 'pill--ok' : c.score >= 60 ? '' : 'pill--off'}`}>
                          {c.score}
                        </span>
                      </td>
                      <td>
                        {c.imported && <span className="pill pill--ok">imported</span>}
                        {!c.hasMx && <span className="pill pill--warn">no mail server</span>}
                      </td>
                    </tr>
                  )) : (
                    <tr key={r.website}>
                      <td className="muted">{r.collegeName || r.website}</td>
                      <td colSpan={4} className="muted">
                        {r.status === 'pending' ? 'waiting…'
                          : r.status === 'blocked' ? 'blocked by robots.txt — skipped'
                            : r.error || 'nothing found'}
                      </td>
                    </tr>
                  )
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="card">
        <h2>Past runs</h2>
        <div className="table-wrap">
          <table>
            <thead><tr><th>When</th><th>Colleges</th><th>Found</th><th>Imported</th><th /></tr></thead>
            <tbody>
              {!jobs.length && <tr><td colSpan={5} className="empty">No runs yet.</td></tr>}
              {jobs.map((j) => (
                <tr key={j._id}>
                  <td className="muted">{new Date(j.createdAt).toLocaleString('en-IN')}</td>
                  <td>{j.total}</td>
                  <td>{j.foundContacts}</td>
                  <td>{j.importedContacts}</td>
                  <td>
                    <button className="btn btn--ghost"
                      onClick={async () => setJob(await api.scrapeJob(j._id))}>Open</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
