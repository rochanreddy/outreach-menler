import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { DEFAULT_TEMPLATE, TEMPLATES, stepsFrom } from '../templates.js';

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
// `rev` is bumped by the parent whenever recipients are added. Without it this
// only refetched when the campaign id changed, so a freshly added list stayed
// invisible until a manual page refresh.
function Recipients({ id, rev, onChange }) {
  const [rows, setRows] = useState([]);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api.enrollments(id);
      setRows(d.rows || []);
      setErr('');
    } catch (e) {
      // Without this, a dropped session or a sleeping API renders as
      // "Nobody enrolled yet" — indistinguishable from an empty campaign.
      setErr(e.message || 'Could not load recipients.');
    } finally {
      setLoading(false);
    }
  }, [id, rev]);
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
    onChange?.();   // bumps rev, which reloads this table too
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
            {!loading && err && (
              <tr><td colSpan={6} className="empty">Couldn’t load recipients — {err}</td></tr>
            )}
            {!loading && !err && !shown.length && (
              <tr><td colSpan={6} className="empty">
                {rows.length ? 'Nobody in this group yet.' : (
                  <>
                    <b>No recipients yet</b>
                    Use <b>Add recipients</b> just above to put contacts into this campaign.
                  </>
                )}
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
 * A campaign only goes live after four things, in order. Without this the page
 * is a wall of panels with no indication of which one you're supposed to touch.
 */
function NextSteps({ done, go }) {
  const next = done.findIndex((s) => !s.ok);

  return (
    <div className="card">
      <h2>Before this can go live</h2>
      <p className="hint">Each line turns green on its own. Click one to jump straight to it.</p>
      <ol className="guide">
        {done.map((s, i) => (
          <li key={s.label} className={s.ok ? 'done' : i === next ? 'now' : ''}>
            <span className={`guide-mark ${s.ok ? 'guide-mark--done' : i === next ? 'guide-mark--now' : ''}`}>
              {s.ok ? '✓' : i + 1}
            </span>
            <div className="guide-body">
              <b>{s.label}</b>
              {!s.ok && <p className="hint">{s.hint}</p>}
            </div>
            {!s.ok && s.tab && (
              <button className={`btn btn--sm ${i === next ? '' : 'btn--ghost'}`} onClick={() => go(s.tab)}>
                Take me there
              </button>
            )}
          </li>
        ))}
      </ol>
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
      setMsg(`Added ${r.enrolled} recipient${r.enrolled === 1 ? '' : 's'}${r.skipped ? `, skipped ${r.skipped} already on the list` : ''}.`);
      setPreview(null);
      onDone?.();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <div className="card" id="who-gets-this">
      <h2>Add recipients</h2>
      <p className="hint">
        Pick people from your contact database and add them to this campaign.
        <b> Collecting contacts doesn’t email them</b> — this step is what does.
        Leave a box empty to ignore it; unsubscribes, bounces and the do-not-contact
        list are always excluded, and nobody is added twice.
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
        <button className={`btn ${preview ? 'btn--ghost' : ''}`} onClick={check} disabled={busy}>
          {busy ? 'Checking…' : preview ? 'Check again' : 'Preview who matches'}
        </button>
        {preview && (
          <button className="btn btn--go" onClick={commit} disabled={busy || !preview.wouldEnroll}>
            {preview.wouldEnroll
              ? `Add ${preview.wouldEnroll} recipient${preview.wouldEnroll === 1 ? '' : 's'}`
              : 'Nobody new to add'}
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
          {preview.matched === 0 && (
            <p className="hint">
              Nothing matched. Either the filters above are too narrow — clear the role,
              city and state boxes and preview again — or these contacts haven’t been
              imported yet. Check the <b>Contacts</b> page: if it’s empty, go to{' '}
              <b>Find contacts</b>, run a scrape, and click <b>Import the good ones</b> first.
            </p>
          )}
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

// The fields a user actually edits — everything else on the campaign object is
// server-owned (stats, status, timestamps).
const EDITABLE = ['name', 'fromName', 'fromEmail', 'replyTo', 'steps',
  'dailyCap', 'sendWindowStart', 'sendWindowEnd', 'weekdaysOnly'];
const editableOf = (c) => JSON.stringify(EDITABLE.map((k) => c?.[k]));

function Editor({ id, onBack }) {
  const [c, setC] = useState(null);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [testTo, setTestTo] = useState('');
  const [testedAt, setTestedAt] = useState(null);
  const [tab, setTab] = useState('write');
  const [rev, setRev] = useState(0);
  const [saveState, setSaveState] = useState('');   // '' | 'saving' | 'saved'
  const savedRef = useRef('');                      // snapshot of what's on the server

  const load = useCallback(() => {
    api.campaign(id).then((data) => {
      savedRef.current = editableOf(data);
      setC(data);
    }).catch((e) => setErr(e.message));
  }, [id]);
  useEffect(load, [load]);

  // Autosave. Losing typed copy because a Save button went unnoticed is the
  // kind of thing that makes the whole tool feel broken — so edits persist on
  // their own, a moment after you stop typing.
  useEffect(() => {
    if (!c) return undefined;
    const current = editableOf(c);
    if (current === savedRef.current) return undefined;
    setSaveState('saving');
    const t = setTimeout(async () => {
      try {
        const body = Object.fromEntries(EDITABLE.map((k) => [k, c[k]]));
        await api.updateCampaign(id, body);
        savedRef.current = current;
        setSaveState('saved');
        setTimeout(() => setSaveState((s) => (s === 'saved' ? '' : s)), 1800);
      } catch (e) {
        setSaveState('');
        setErr(e.message);
      }
    }, 1200);
    return () => clearTimeout(t);
  }, [c, id]);

  if (err && !c) return <p className="err">{err}</p>;
  if (!c) return <p className="empty">Loading…</p>;

  const set = (k, v) => setC({ ...c, [k]: v });
  const setStep = (i, k, v) => setC({ ...c, steps: c.steps.map((s, j) => (i === j ? { ...s, [k]: v } : s)) });

  const sendTest = () => act(async () => {
    await api.testSend(id, { to: testTo, stepIndex: 0 });
    setTestedAt(Date.now());
  }, 'Test sent — check your inbox, and your spam folder.');

  const act = async (fn, okMsg) => {
    setBusy(true); setErr(''); setMsg('');
    try { const r = await fn(); setMsg(typeof r === 'string' ? r : okMsg); load(); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  const st = c.stats || {};
  const enrolled = st.enrolled || 0;
  const live = c.status === 'active';

  // One source of truth for "is this ready", shared by the wizard tab ticks,
  // the checklist, and the Activate button — so they can never disagree.
  const checks = [
    {
      key: 'write',
      label: 'Write your email',
      hint: 'Every step needs a subject and a body.',
      tab: 'write',
      ok: c.steps?.length > 0 && c.steps.every((s) => s.subject?.trim() && s.body?.trim()),
    },
    {
      key: 'who',
      label: 'Add recipients',
      hint: 'Collecting contacts doesn’t send them anything — they have to be added here.',
      tab: 'who',
      ok: enrolled > 0,
    },
    {
      key: 'test',
      label: 'Send yourself a test',
      hint: 'The only way to catch a broken placeholder before a dean sees it.',
      tab: 'test',
      ok: Boolean(testedAt || c.lastTestAt),
    },
    {
      key: 'from',
      label: 'Set the from-address',
      hint: 'Which mailbox this sends from.',
      tab: 'launch',
      ok: Boolean(c.fromEmail),
    },
  ];
  const blocking = checks.filter((s) => !s.ok);

  const TABS = [
    { key: 'write', n: 1, label: 'Write', ok: checks[0].ok },
    { key: 'who', n: 2, label: `Recipients${enrolled ? ` (${enrolled})` : ''}`, ok: checks[1].ok },
    { key: 'test', n: 3, label: 'Test', ok: checks[2].ok },
    { key: 'launch', n: 4, label: 'Launch', ok: live },
  ];
  const idx = TABS.findIndex((t) => t.key === tab);
  const nextTab = TABS[idx + 1];

  return (
    <>
      <div className="crumb">
        <button className="btn btn--ghost btn--sm" onClick={onBack}>← All campaigns</button>
        <h1>{c.name}</h1>
        <span className={`pill ${live ? 'pill--ok' : c.status === 'paused' ? 'pill--warn' : 'pill--off'}`}>
          {c.status}
        </span>
        {saveState && (
          <span className="muted" style={{ fontSize: 12.5 }}>
            {saveState === 'saving' ? 'Saving…' : '✓ Saved'}
          </span>
        )}
        <div style={{ marginLeft: 'auto' }}>
          {live
            ? <button className="btn btn--warn" disabled={busy}
              onClick={() => act(() => api.setStatus(id, 'paused'), 'Paused.')}>⏸ Pause</button>
            : blocking.length > 0
              ? <button className="btn btn--ghost" onClick={() => setTab('launch')}>
                Finish setup to send
              </button>
              : <button className="btn btn--go" disabled={busy}
                onClick={() => act(() => api.setStatus(id, 'active'), 'Live — sending starts inside your window.')}>
                ▶ Start sending
              </button>}
        </div>
      </div>

      {live && (
        <div className="note note--good">
          <b>This campaign is live.</b> Sending up to {c.dailyCap} a day between{' '}
          {c.sendWindowStart}:00 and {c.sendWindowEnd}:00 IST
          {c.weekdaysOnly ? ', weekdays only' : ''}. Follow-ups stop automatically when someone replies.
        </div>
      )}

      {/* Results first, but only once there's something to report. Showing four
          zeroes to someone still drafting is noise that hides the real task. */}
      {st.sent > 0 && (
        <div className="stats">
          <div className={`stat ${st.replied ? 'stat--go' : ''}`}>
            <span>Replied</span>
            <b>{st.replied || 0}<span> · {pct(st.replied, st.sent)}%</span></b>
          </div>
          <div className="stat">
            <span>Opened</span>
            <b>{st.opened || 0}<span> · {pct(st.opened, st.sent)}%</span></b>
          </div>
          <div className="stat">
            <span>Sent of added</span>
            <b>{st.sent || 0}<span> / {enrolled}</span></b>
          </div>
          <div className={`stat ${(st.bounced || st.unsubscribed) ? 'stat--warn' : 'stat--muted'}`}>
            <span>Bounced · unsubscribed</span>
            <b>{st.bounced || 0}<span> · {st.unsubscribed || 0}</span></b>
          </div>
        </div>
      )}

      <div className="wizard">
        {TABS.map((t) => (
          <button key={t.key} className={tab === t.key ? 'on' : ''} onClick={() => setTab(t.key)}>
            <span className={`w-num ${t.ok ? 'w-num--done' : ''}`}>{t.ok ? '✓' : t.n}</span>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'write' && (
      <div className="card">
        <h2>Your email and its follow-ups</h2>
        <p className="hint">
          Follow-ups only go to people who haven’t replied, and stop the moment they do.
        </p>
        <div className="tpl-bar">
          <span className="hint">Start from a template:</span>
          {TEMPLATES.map((t) => (
            <button key={t.id} className="btn btn--ghost" title={t.blurb}
              onClick={() => {
                const written = c.steps.some((s) => s.subject?.trim() || s.body?.trim());
                // Only nag when there's real work to lose.
                if (written && !window.confirm(`Replace the current emails with the "${t.label}" template?`)) return;
                setC({ ...c, steps: stepsFrom(t) });
              }}>{t.label}</button>
          ))}
        </div>
        <p className="hint" style={{ marginTop: -4, marginBottom: 14 }}>
          These are written and ready to send. Edit the wording to sound like you — then send yourself a test below.
        </p>
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
        </div>
        <p className="hint" style={{ marginTop: 10 }}>
          Changes save automatically. <code>{'{{first_name}}'}</code> <code>{'{{college}}'}</code> <code>{'{{designation}}'}</code>{' '}
          <code>{'{{city}}'}</code> — fallback with a pipe: <code>{'{{first_name|there}}'}</code>.
          The unsubscribe footer is added for you.
        </p>
      </div>
      )}

      {tab === 'who' && (
        <>
          <Enroller id={id} onDone={() => { load(); setRev((v) => v + 1); }} />
          <Recipients id={id} rev={rev} onChange={() => { load(); setRev((v) => v + 1); }} />
        </>
      )}

      {tab === 'test' && (
      <div className="card">
        <h2>Send yourself a test</h2>
        <p className="hint">
          This sends the first email to you, exactly as a recipient would get it —
          placeholders filled, unsubscribe footer attached. It doesn’t touch your recipients.
        </p>
        <div className="row">
          <input className="grow" placeholder="your@email.com" value={testTo}
            onChange={(e) => setTestTo(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && testTo && !busy && sendTest()} />
          <button className="btn" disabled={busy || !testTo} onClick={sendTest}>
            {busy ? 'Sending…' : 'Send me a test'}
          </button>
        </div>

        {(testedAt || c.lastTestAt) && (
          <div className="note note--good" style={{ marginTop: 16, marginBottom: 0 }}>
            <b>Test sent{c.lastTestTo ? ` to ${c.lastTestTo}` : ''}.</b> Open it and check three
            things: your name reads right, the college name reads right, and the unsubscribe
            link at the bottom works. Check the spam folder too — if it landed there, fix that
            before sending to anyone else.
            <div className="row" style={{ marginTop: 12 }}>
              <button className="btn btn--go" onClick={() => setTab('launch')}>
                Looks good — go to sending →
              </button>
              <span className="hint">You can send another test after editing.</span>
            </div>
          </div>
        )}
      </div>
      )}

      {tab === 'launch' && (
      <>
        {/* The actual send control. It used to live only in the page header,
            which scrolls away — so on the one tab whose entire job is "start
            sending", there was no visible way to start sending. */}
        <div className="card launch">
          <h2>{live ? 'This campaign is sending' : 'Start sending'}</h2>
          {live ? (
            <>
              <p className="hint">
                Emails go out on their own — up to {c.dailyCap} a day between {c.sendWindowStart}:00
                and {c.sendWindowEnd}:00 IST{c.weekdaysOnly ? ', weekdays only' : ''}, spaced a few
                seconds apart. Follow-ups stop the moment somebody replies.
              </p>
              <div className="row" style={{ marginTop: 14 }}>
                <button className="btn btn--warn btn--lg" disabled={busy}
                  onClick={() => act(() => api.setStatus(id, 'paused'), 'Paused — nothing more will go out.')}>
                  ⏸ Pause sending
                </button>
                <span className="hint">{st.sent || 0} of {enrolled} sent so far.</span>
              </div>
            </>
          ) : (
            <>
              <p className="hint">
                Nothing has been sent yet. Turning this on hands the campaign to the
                scheduler: it emails your {enrolled || 0} recipient{enrolled === 1 ? '' : 's'} at
                up to {c.dailyCap} a day, between {c.sendWindowStart}:00 and {c.sendWindowEnd}:00 IST
                {c.weekdaysOnly ? ', weekdays only' : ''}. You can pause at any time.
              </p>
              {blocking.length > 0 && (
                <div className="note note--warn" style={{ marginTop: 14, marginBottom: 0 }}>
                  <b>Not ready yet.</b> Finish {blocking.length === 1 ? 'this' : 'these'} first:{' '}
                  {blocking.map((b) => b.label.toLowerCase()).join(', ')}. The checklist below
                  takes you straight to each one.
                </div>
              )}
              <div className="row" style={{ marginTop: 14 }}>
                <button className="btn btn--go btn--lg" disabled={busy || blocking.length > 0}
                  onClick={() => act(() => api.setStatus(id, 'active'), 'Live — sending starts inside your window.')}>
                  ▶ Start sending to {enrolled} recipient{enrolled === 1 ? '' : 's'}
                </button>
              </div>
            </>
          )}
        </div>

        {!live && <NextSteps done={checks} go={setTab} />}
        <div className="card">
          <h2>Sender and pacing</h2>
          <p className="hint">Set once. Slow, steady sending is what keeps you out of spam folders.</p>
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
          </div>
          <p className="hint">
            Saved automatically. Keep it to 20–40 a day on a new domain for the first few
            weeks, then raise it slowly — sudden volume is what gets a domain flagged.
          </p>
        </div>
      </>
      )}

      {/* Always visible: the way forward, so nobody has to guess which tab is next. */}
      <div className="wizard-foot">
        <span className="hint">
          {blocking.length === 0
            ? live ? 'Everything is set — this campaign is sending.' : 'Ready to activate.'
            : `Still to do: ${blocking.map((b) => b.label.toLowerCase()).join(' · ')}`}
        </span>
        {nextTab && (
          <button className="btn btn--ghost" onClick={() => setTab(nextTab.key)}>
            Next: {nextTab.label.replace(/ \(\d+\)$/, '')} →
          </button>
        )}
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
      // Start from a real template, not an empty box — a blank Sequence panel
      // is the single thing people get stuck on here.
      const c = await api.createCampaign({ name, steps: stepsFrom(DEFAULT_TEMPLATE) });
      setName('');
      setOpen(c._id);
    } catch (e) { setErr(e.message); }
  };

  return (
    <>
      <div className="page-head">
        <h1>Campaigns</h1>
        <p>
          A campaign is one email plus its follow-ups, sent to a list of contacts.
          Follow-ups stop by themselves the moment someone replies.
        </p>
      </div>

      <div className="card">
        <h2>Start a new one</h2>
        <p className="hint">Name it after who you’re contacting, so the team can tell them apart later.</p>
        <div className="row">
          <input className="grow" placeholder="e.g. Hyderabad engineering colleges — August"
            value={name} onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && create()} />
          <button className="btn" onClick={create} disabled={!name.trim()}>Create campaign</button>
        </div>
        <p className="hint" style={{ marginTop: 10 }}>
          It opens with a written email already in place — you only edit the wording.
        </p>
      </div>

      {err && <p className="err">{err}</p>}

      <div className="card">
        <h2>Your campaigns</h2>
        <div className="table-wrap">
          <div className="table-scroll">
            <table>
              <thead>
                <tr><th>Name</th><th>Status</th><th>Sent</th><th>Opened</th><th>Replied</th><th /></tr>
              </thead>
              <tbody>
                {!rows.length && (
                  <tr><td colSpan={6} className="empty">
                    <b>No campaigns yet</b>
                    Create one above — it takes about two minutes to get to a test send.
                  </td></tr>
                )}
                {rows.map((r) => (
                  <tr key={r._id} onClick={() => setOpen(r._id)} style={{ cursor: 'pointer' }}>
                    <td><b>{r.name}</b></td>
                    <td>
                      <span className={`pill ${r.status === 'active' ? 'pill--ok' : r.status === 'paused' ? 'pill--warn' : 'pill--off'}`}>
                        {r.status === 'draft' ? 'not sending' : r.status}
                      </span>
                    </td>
                    <td>{r.stats?.sent || 0}<span className="muted"> / {r.stats?.enrolled || 0}</span></td>
                    <td>{r.stats?.opened || 0}</td>
                    <td><b>{r.stats?.replied || 0}</b></td>
                    <td><button className="btn btn--ghost btn--sm">Open</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}
