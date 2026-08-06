import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';
import Contacts from './pages/Contacts.jsx';
import Campaigns from './pages/Campaigns.jsx';
import Finder from './pages/Finder.jsx';
import Ops from './pages/Ops.jsx';

function Login({ onIn }) {
  const [u, setU] = useState('');
  const [p, setP] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      await api.login(u, p);
      onIn();
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="card login" onSubmit={submit}>
      <h2>Menler outreach</h2>
      <label className="field"><span>Username</span>
        <input value={u} onChange={(e) => setU(e.target.value)} autoFocus />
      </label>
      <label className="field"><span>Password</span>
        <input type="password" value={p} onChange={(e) => setP(e.target.value)} />
      </label>
      <button className="btn" style={{ width: '100%' }} disabled={busy}>
        {busy ? 'Signing in…' : 'Sign in'}
      </button>
      {err && <p className="err">{err}</p>}
    </form>
  );
}

const TABS = [
  { key: 'campaigns', label: 'Campaigns' },
  { key: 'finder', label: 'Find contacts' },
  { key: 'contacts', label: 'Colleges & contacts' },
  { key: 'ops', label: 'Sending health' },
];

export default function App() {
  const [authed, setAuthed] = useState(null);
  const [tab, setTab] = useState('campaigns');

  const check = useCallback(() => {
    api.session().then(() => setAuthed(true)).catch(() => setAuthed(false));
  }, []);
  useEffect(check, [check]);

  if (authed === null) return <p className="empty">Loading…</p>;
  if (!authed) return <Login onIn={() => setAuthed(true)} />;

  return (
    <>
      <nav className="nav">
        <span className="nav-brand">menler · outreach</span>
        {TABS.map((t) => (
          <button key={t.key} className={tab === t.key ? 'on' : ''} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
        <button
          className="right"
          onClick={async () => { await api.logout(); setAuthed(false); }}
        >
          Log out
        </button>
      </nav>
      <div className="wrap">
        {tab === 'campaigns' && <Campaigns />}
        {tab === 'finder' && <Finder />}
        {tab === 'contacts' && <Contacts />}
        {tab === 'ops' && <Ops />}
      </div>
    </>
  );
}
