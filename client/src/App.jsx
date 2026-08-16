import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';
import Contacts from './pages/Contacts.jsx';
import Campaigns from './pages/Campaigns.jsx';
import Finder from './pages/Finder.jsx';
import Home from './pages/Home.jsx';

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
      // Confirm the session cookie actually stuck. Without this a rejected
      // cookie still shows the app, and every action then fails with 401.
      await api.session();
      onIn();
    } catch (e2) {
      setErr(e2.status === 401 && !e2.fromLogin
        ? 'Signed in, but the browser did not keep the session cookie. Check the API URL and that cookies are allowed.'
        : e2.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <form className="card login" onSubmit={submit}>
        <h1>menler <span className="muted">outreach</span></h1>
        <p className="hint">Sign in to find college contacts and run email campaigns.</p>
        <label className="field"><span>Username</span>
          <input value={u} onChange={(e) => setU(e.target.value)} autoFocus />
        </label>
        <label className="field"><span>Password</span>
          <input type="password" value={p} onChange={(e) => setP(e.target.value)} />
        </label>
        <button className="btn btn--lg" style={{ width: '100%', justifyContent: 'center' }} disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        {err && <p className="err">{err}</p>}
      </form>
    </div>
  );
}

/**
 * Tabs are numbered and ordered by the actual workflow. Naming them after
 * features ("Find contacts", "Colleges & contacts", "Campaigns") left no clue
 * that they run in sequence, which is the thing new people get wrong first.
 */
const TABS = [
  { key: 'home', label: 'Home' },
  { key: 'finder', label: 'Find colleges', num: 1 },
  { key: 'contacts', label: 'Contacts', num: 2 },
  { key: 'campaigns', label: 'Campaigns', num: 3 },
];

export default function App() {
  const [authed, setAuthed] = useState(null);
  const [tab, setTab] = useState('home');

  const check = useCallback(() => {
    api.session().then(() => setAuthed(true)).catch(() => setAuthed(false));
  }, []);
  useEffect(check, [check]);

  // Deep-linkable, and the browser back button behaves as people expect.
  useEffect(() => {
    const fromHash = () => {
      const h = window.location.hash.replace('#', '');
      if (TABS.some((t) => t.key === h)) setTab(h);
    };
    fromHash();
    window.addEventListener('hashchange', fromHash);
    return () => window.removeEventListener('hashchange', fromHash);
  }, []);

  const go = (key) => { window.location.hash = key; setTab(key); };

  if (authed === null) return <p className="empty">Loading…</p>;
  if (!authed) return <Login onIn={() => setAuthed(true)} />;

  return (
    <>
      <nav className="nav">
        <span className="nav-brand">menler <span>outreach</span></span>
        <div className="nav-tabs">
          {TABS.map((t) => (
            <button key={t.key} className={`nav-tab ${tab === t.key ? 'on' : ''}`} onClick={() => go(t.key)}>
              {t.num && <span className="nav-num">{t.num}</span>}
              {t.label}
            </button>
          ))}
        </div>
        <button className="nav-out" onClick={async () => { await api.logout(); setAuthed(false); }}>
          Log out
        </button>
      </nav>
      <div className="wrap">
        {tab === 'home' && <Home go={go} />}
        {tab === 'finder' && <Finder go={go} />}
        {tab === 'contacts' && <Contacts go={go} />}
        {tab === 'campaigns' && <Campaigns />}
      </div>
    </>
  );
}
