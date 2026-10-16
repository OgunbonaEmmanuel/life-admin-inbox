import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import {
  Sun,
  CalendarDays,
  Inbox,
  CheckCircle2,
  Settings as SettingsIcon,
  ArrowUpRight,
  Plus,
  Search,
  ArrowRight,
  Upload,
  FileText,
  ShieldCheck,
  ChevronLeft,
  ChevronRight,
  Bell,
  Check,
  AlertCircle,
  LogOut,
  Menu,
  X,
  Download,
  Trash2,
  RotateCcw,
  LoaderCircle,
  Leaf,
} from 'lucide-react';
import type { AppConfig, Snapshot, Task, Document, Profile } from '../shared/types';
import { api, auth, configure, download, request, useDevelopment } from './api';
import {
  Logo,
  Modal,
  Empty,
  PaperIllustration,
  TaskCard,
  localDate,
  formatDate,
  taskDay,
} from './components';
import Auth from './Auth';
import Settings from './Settings';
import SourcePanel from './SourcePanel';
import { unsubscribeBrowser } from './notifications';
type View = 'today' | 'timeline' | 'documents' | 'completed' | 'attention' | 'settings';
const viewTitles: Record<View, string> = {
  today: 'Today',
  timeline: 'Your timeline',
  documents: 'Document inbox',
  completed: 'All taken care of',
  attention: 'A closer look',
  settings: 'Your preferences',
};
function addDays(date: string, days: number) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export default function App() {
  const [config, setConfig] = useState<AppConfig | null>(null),
    [mode, setMode] = useState<'loading' | 'demo' | 'real' | 'auth'>('loading');
  const [data, setData] = useState<Snapshot | null>(null),
    [view, setView] = useState<View>('today'),
    [error, setError] = useState(''),
    [toast, setToast] = useState('');
  const [search, setSearch] = useState(''),
    [category, setCategory] = useState('all'),
    [selected, setSelected] = useState<Task | null>(null),
    [document, setDocument] = useState<Document | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false),
    [file, setFile] = useState<File | null>(null),
    [consent, setConsent] = useState(false),
    [uploading, setUploading] = useState(false),
    [uploadError, setUploadError] = useState('');
  const [mobileNav, setMobileNav] = useState(false),
    [week, setWeek] = useState(0),
    [day, setDay] = useState<string | null>(null),
    [timezone, setTimezone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone),
    [seeding, setSeeding] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const notify = useCallback((message: string) => setToast(message), []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 6500);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;
    fetch('/api/config')
      .then((r) => r.json())
      .then(async (c: AppConfig) => {
        if (!active) return;
        setConfig(c);
        const client = configure(c);
        if (client) {
          const { data: session } = await client.auth.getSession();
          if (active) setMode(session.session ? 'real' : c.development ? 'demo' : 'auth');
          const { data: listener } = client.auth.onAuthStateChange((event, session) => {
            if (event === 'PASSWORD_RECOVERY') {
              setMode('auth');
              return;
            }
            if (session) setMode('real');
            else if (event === 'SIGNED_OUT') setMode('auth');
          });
          unsubscribe = () => listener.subscription.unsubscribe();
        } else setMode(c.development ? 'demo' : 'auth');
      })
      .catch(() =>
        setError('The app could not connect to its server. Restart the server and refresh.'),
      );
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);
  const refresh = useCallback(async () => {
    const next = await api<Snapshot>('/inbox');
    setData(next);
    setError('');
  }, []);
  useEffect(() => {
    if (mode !== 'demo' && mode !== 'real') return;
    useDevelopment(mode === 'demo');
    void refresh().catch((e) => setError(e.message));
    const timer = setInterval(() => void refresh().catch(() => {}), 5000);
    return () => clearInterval(timer);
  }, [mode, refresh]);
  function navigate(next: View) {
    setView(next);
    setDay(null);
    setSearch('');
    setCategory('all');
    setMobileNav(false);
  }
  async function signOut() {
    try {
      await unsubscribeBrowser();
    } catch {
      notify('Browser push unsubscribed locally; server cleanup may need a retry.');
    }
    await auth()?.auth.signOut();
    setMode('auth');
    setData(null);
  }
  async function seed() {
    setSeeding(true);
    try {
      await api('/demo', {});
      await refresh();
      notify('Synthetic examples added. No AI extraction or external notifications were used.');
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setSeeding(false);
    }
  }
  async function complete(task: Task) {
    try {
      await api(
        `/tasks/${task.id}`,
        { state: task.state === 'completed' ? 'open' : 'completed' },
        'PATCH',
      );
      await refresh();
      notify(
        task.state === 'completed'
          ? 'Task reopened.'
          : 'One less thing to think about. Task completed.',
      );
    } catch (e) {
      notify((e as Error).message);
    }
  }
  async function upload() {
    if (!file || !consent) return;
    setUploading(true);
    setUploadError('');
    try {
      const body = new FormData();
      body.append('file', file);
      const result = await (await request('/documents', { method: 'POST', body })).json();
      await refresh();
      setUploadOpen(false);
      setFile(null);
      navigate('documents');
      notify(
        result.duplicate
          ? 'This document is already in your inbox. No duplicate tasks were created.'
          : 'Document uploaded privately. Extraction is queued.',
      );
    } catch (e) {
      setUploadError((e as Error).message);
    } finally {
      setUploading(false);
    }
  }
  function chooseFile(e: ChangeEvent<HTMLInputElement>) {
    setFile(e.target.files?.[0] || null);
    setUploadError('');
  }
  async function onboard() {
    try {
      await api<Profile>('/profile', { timezone, onboarded: true }, 'PATCH');
      await refresh();
      notify('Timezone confirmed. You’re ready for reminders.');
    } catch (e) {
      notify((e as Error).message);
    }
  }
  async function documentAction(doc: Document, action: 'retry' | 'delete') {
    try {
      if (
        action === 'delete' &&
        !window.confirm(
          `Delete “${doc.name}”? This also deletes its tasks and cancels their reminders.`,
        )
      )
        return;
      await api(
        `/documents/${doc.id}${action === 'retry' ? '/retry' : ''}`,
        {},
        action === 'retry' ? 'POST' : 'DELETE',
      );
      setDocument(null);
      await refresh();
      notify(
        action === 'retry'
          ? 'Extraction queued again. Your existing tasks and edits will be preserved.'
          : 'Document removed from your inbox. Private storage cleanup is queued.',
      );
    } catch (e) {
      notify((e as Error).message);
    }
  }
  if (!config || mode === 'loading')
    return (
      <div className="loading-screen">
        <Logo />
        {error ? (
          <p role="alert">{error}</p>
        ) : (
          <>
            <LoaderCircle className="spin" />
            <p>Making a little room…</p>
          </>
        )}
      </div>
    );
  if (mode === 'auth' || location.pathname === '/auth/reset')
    return (
      <Auth
        config={config}
        onDemo={() => {
          history.replaceState({}, '', '/');
          setMode('demo');
        }}
      />
    );
  const zone = data?.profile.timezone || 'Africa/Lagos';
  const today = localDate(zone);
  const tasks = data?.tasks || [],
    docs = data?.documents || [],
    open = tasks.filter((t) => t.state === 'open'),
    attention = open.filter((t) => t.attention.length > 0),
    completed = tasks.filter((t) => t.state === 'completed');
  const filtered = tasks
    .filter((t) =>
      view === 'completed'
        ? ['completed', 'dismissed'].includes(t.state)
        : view === 'attention'
          ? t.state === 'open' && t.attention.length > 0
          : t.state === 'open' &&
            (view === 'today' ? !taskDay(t, zone) || taskDay(t, zone)! <= addDays(today, 7) : true),
    )
    .filter((t) => category === 'all' || t.category === category)
    .filter((t) => !day || taskDay(t, zone) === day)
    .filter((t) =>
      `${t.title} ${t.organization || ''}`.toLowerCase().includes(search.toLowerCase()),
    )
    .sort((a, b) => (taskDay(a, zone) || '9999').localeCompare(taskDay(b, zone) || '9999'));
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(today, week * 7 + i));
  const nav = [
    { id: 'today' as View, label: 'Today', icon: Sun },
    { id: 'timeline' as View, label: 'Timeline', icon: CalendarDays },
    { id: 'documents' as View, label: 'Document inbox', icon: Inbox },
    { id: 'completed' as View, label: 'Completed', icon: CheckCircle2 },
  ];
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <aside className={`sidebar ${mobileNav ? 'open' : ''}`}>
        <Logo />
        <button
          className="mobile-close icon-button"
          aria-label="Close navigation"
          onClick={() => setMobileNav(false)}
        >
          <X />
        </button>
        <div className="space-label">YOUR PERSONAL SPACE</div>
        <nav aria-label="Main navigation">
          {nav.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => navigate(id)}
              className={`nav-item ${view === id ? 'active' : ''}`}
              aria-current={view === id ? 'page' : undefined}
            >
              <Icon size={19} strokeWidth={1.7} />
              <span>{label}</span>
              {id === 'documents' && docs.length > 0 && (
                <span className="nav-count">{docs.length}</span>
              )}
              {id === 'today' && open.filter((t) => taskDay(t, zone) === today).length > 0 && (
                <span className="nav-dot" />
              )}
            </button>
          ))}
        </nav>
        {attention.length > 0 && (
          <button
            className={`nav-item attention-nav ${view === 'attention' ? 'active' : ''}`}
            onClick={() => navigate('attention')}
          >
            <AlertCircle size={18} />
            <span>Needs attention</span>
            <span className="attention-count">{attention.length}</span>
          </button>
        )}
        <div className="sidebar-bottom">
          <div className="little-note">
            <Leaf size={20} />
            <p>
              Less in your head.
              <br />
              More room for life.
            </p>
            <span>We’ll help with the little things.</span>
          </div>
          <button
            className={`nav-item ${view === 'settings' ? 'active' : ''}`}
            onClick={() => navigate('settings')}
          >
            <SettingsIcon size={19} />
            <span>Preferences</span>
          </button>
          <div className="account">
            <span className="avatar">
              {data?.profile.name === 'Your space'
                ? 'Y'
                : data?.profile.name[0].toUpperCase() || 'Y'}
            </span>
            <span>
              <strong>{mode === 'demo' ? 'Local demo' : data?.profile.name || 'Your space'}</strong>
              <small>{mode === 'demo' ? 'Development identity' : 'Private account'}</small>
            </span>
            <button
              className="icon-button"
              aria-label="Sign out or switch account"
              onClick={() => void signOut()}
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>
      {mobileNav && <div className="nav-scrim" onClick={() => setMobileNav(false)} />}
      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-menu"
              aria-label="Open navigation"
              onClick={() => setMobileNav(true)}
            >
              <Menu />
            </button>
            <span>My space</span>
            <ChevronRight size={14} />
            <strong>{viewTitles[view]}</strong>
          </div>
          <div className="topbar-right">
            <span className="private-label">
              <ShieldCheck size={14} /> Private & personal
            </span>
            <button
              className="icon-button notification-button"
              aria-label="View reminder activity"
              onClick={() => navigate('settings')}
            >
              <Bell size={19} />
            </button>
            <span className="top-avatar">{data?.profile.name[0] || 'Y'}</span>
          </div>
        </header>
        {mode === 'demo' && (
          <div className="dev-banner">
            <span className="dev-tag">LOCAL DEMO</span>
            <span>
              Development identity · Synthetic examples are prewritten.{' '}
              {config.openaiConfigured
                ? 'Real uploads use OpenAI.'
                : 'Real extraction needs an OpenAI API key.'}
            </span>
            <button onClick={() => setMode('auth')}>
              Account sign-in <ArrowUpRight size={12} />
            </button>
          </div>
        )}
        <main id="main" className={`main-content ${view === 'settings' ? 'settings-main' : ''}`}>
          {error && (
            <div className="error-banner" role="alert">
              {error}
              <button
                className="button small secondary"
                onClick={() => void refresh().catch((e) => setError(e.message))}
              >
                Try again
              </button>
            </div>
          )}
          {!data ? (
            <div className="loading-content">
              <LoaderCircle className="spin" /> Loading your private inbox…
            </div>
          ) : (
            <>
              {view === 'today' ? (
                <section className="hero">
                  <div>
                    <div className="eyebrow">
                      <span className="tiny-sun">✳</span>{' '}
                      {new Intl.DateTimeFormat('en-GB', {
                        weekday: 'long',
                        day: 'numeric',
                        month: 'long',
                        timeZone: data.profile.timezone,
                      })
                        .format(new Date())
                        .toUpperCase()}
                    </div>
                    <h1>
                      A little less admin.
                      <br />
                      <em>A little more headspace.</em>
                    </h1>
                    <p>Your paperwork, turned into a plan. Let’s take it one thing at a time.</p>
                  </div>
                  <PaperIllustration />
                </section>
              ) : (
                <div className="page-heading">
                  <span className="eyebrow">A LITTLE MORE CLARITY</span>
                  <h1>{viewTitles[view]}</h1>
                  <p>
                    {view === 'documents'
                      ? 'All your paperwork. Every task, with its story attached.'
                      : view === 'timeline'
                        ? 'See what’s ahead, without carrying it all in your head.'
                        : view === 'completed'
                          ? 'The little things you’ve already taken care of.'
                          : view === 'attention'
                            ? 'A few details to clarify. These tasks won’t send reminders yet.'
                            : 'Reminders that fit your day, and a space that stays yours.'}
                  </p>
                </div>
              )}
              {!data.profile.onboarded && (
                <section className="onboarding">
                  <GlobeSmall />
                  <div>
                    <strong>Let’s get your timing right.</strong>
                    <span>
                      Confirm your timezone to enable reminders. Suggested by your browser.
                    </span>
                  </div>
                  <label className="sr-only" htmlFor="onboarding-zone">
                    Your timezone
                  </label>
                  <input
                    id="onboarding-zone"
                    value={timezone}
                    onChange={(e) => setTimezone(e.target.value)}
                  />
                  <button className="button primary small" onClick={() => void onboard()}>
                    Confirm timezone
                  </button>
                </section>
              )}
              {view === 'settings' ? (
                <Settings
                  key={data.profile.email}
                  profile={data.profile}
                  config={config}
                  reminders={data.reminders}
                  onSaved={refresh}
                  notify={notify}
                />
              ) : view === 'documents' ? (
                <>
                  <div className="section-heading">
                    <div className="search-field">
                      <Search size={16} />
                      <input
                        aria-label="Search documents"
                        placeholder="Find a document…"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                      />
                    </div>
                    <button className="button primary" onClick={() => setUploadOpen(true)}>
                      <Plus size={17} /> Add a document
                    </button>
                  </div>
                  <div className="document-grid">
                    {docs
                      .filter((d) => d.name.toLowerCase().includes(search.toLowerCase()))
                      .map((doc) => (
                        <article className="document-card" key={doc.id}>
                          <div className="document-card-top">
                            <span className={`file-icon ${doc.mime.includes('pdf') ? 'pdf' : ''}`}>
                              <FileText size={25} />
                            </span>
                            <span className={`status-pill status-${doc.state}`}>
                              {['queued', 'processing'].includes(doc.state) && (
                                <LoaderCircle size={12} className="spin" />
                              )}
                              {doc.state === 'completed' && <Check size={12} />} {doc.state}
                            </span>
                          </div>
                          <h3>
                            <button onClick={() => setDocument(doc)}>{doc.name}</button>
                          </h3>
                          <p>
                            {doc.synthetic
                              ? 'Synthetic demo document'
                              : `${(doc.size / 1024).toFixed(0)} KB · Private original`}
                          </p>
                          <div className="document-card-footer">
                            <span>
                              {doc.taskCount} task{doc.taskCount !== 1 ? 's' : ''} extracted
                            </span>
                            <button
                              className="icon-button"
                              aria-label={`Inspect ${doc.name}`}
                              onClick={() => setDocument(doc)}
                            >
                              <ArrowUpRight size={18} />
                            </button>
                          </div>
                          {doc.warning && <p className="document-warning">{doc.warning}</p>}
                        </article>
                      ))}
                  </div>
                  {!docs.length && (
                    <Empty title="A fresh start for your paperwork">
                      <p>
                        Add your first bill, appointment or deadline. We’ll look for the things you
                        need to do.
                      </p>
                      <button className="button primary" onClick={() => setUploadOpen(true)}>
                        <Upload size={16} /> Add a document
                      </button>
                      <button
                        className="button text-button"
                        onClick={() => void seed()}
                        disabled={seeding}
                      >
                        Explore synthetic examples <ArrowRight size={15} />
                      </button>
                    </Empty>
                  )}
                </>
              ) : (
                <div className={`content-columns ${view !== 'today' ? 'single-view' : ''}`}>
                  <div className="primary-column">
                    {['today', 'timeline'].includes(view) && (
                      <section className="week-section">
                        <div className="section-heading">
                          <h2>Your week, at a glance</h2>
                          <div className="week-controls">
                            <span>
                              {formatDate(weekDays[0], { month: 'short' })}
                              {week !== 0 ? ' · ' + formatDate(weekDays[0]) : ''}
                            </span>
                            <button
                              className="icon-button"
                              aria-label="Previous week"
                              onClick={() => {
                                setWeek(week - 1);
                                setDay(null);
                              }}
                            >
                              <ChevronLeft size={16} />
                            </button>
                            <button
                              className="icon-button"
                              aria-label="Next week"
                              onClick={() => {
                                setWeek(week + 1);
                                setDay(null);
                              }}
                            >
                              <ChevronRight size={16} />
                            </button>
                          </div>
                        </div>
                        <div className="week-strip">
                          {weekDays.map((date) => {
                            const onDate = open.filter(
                              (t) => taskDay(t, zone) === date && !t.attention.length,
                            );
                            return (
                              <button
                                key={date}
                                className={`day ${date === today ? 'is-today' : ''} ${day === date ? 'selected' : ''}`}
                                aria-pressed={day === date}
                                aria-label={`${formatDate(date, { weekday: 'long', month: 'long', day: 'numeric' })}, ${onDate.length} obligations`}
                                onClick={() => setDay(day === date ? null : date)}
                              >
                                <span>{formatDate(date, { weekday: 'short' })}</span>
                                <strong>{Number(date.slice(-2))}</strong>
                                <span className="day-dots">
                                  {onDate.slice(0, 3).map((t) => (
                                    <i key={t.id} className={t.category} />
                                  ))}
                                  {!onDate.length && <i className="empty-dot" />}
                                </span>
                                {date === today && <small>TODAY</small>}
                              </button>
                            );
                          })}
                        </div>
                        <div className="timeline-legend">
                          <span>
                            <i className="payment" />
                            Payments
                          </span>
                          <span>
                            <i className="appointment" />
                            Appointments
                          </span>
                          <span>
                            <i className="deadline" />
                            Deadlines
                          </span>
                        </div>
                      </section>
                    )}
                    <section className="tasks-section">
                      <div className="section-heading">
                        <h2>
                          {view === 'completed'
                            ? 'Off your list'
                            : view === 'attention'
                              ? 'Worth a closer look'
                              : day
                                ? formatDate(day, {
                                    weekday: 'long',
                                    month: 'long',
                                    day: 'numeric',
                                  })
                                : 'On your radar'}{' '}
                          <span className="count-label">{filtered.length}</span>
                        </h2>
                        {view === 'today' && (
                          <button className="text-link" onClick={() => navigate('timeline')}>
                            View timeline <ArrowUpRight size={14} />
                          </button>
                        )}
                      </div>
                      <div className="task-filters" role="group" aria-label="Filter tasks">
                        {[
                          ['all', 'All tasks'],
                          ['payment', 'Payments'],
                          ['appointment', 'Appointments'],
                          ['deadline', 'Deadlines'],
                        ].map(([key, label]) => (
                          <button
                            key={key}
                            aria-pressed={category === key}
                            className={category === key ? 'active' : ''}
                            onClick={() => setCategory(key)}
                          >
                            {label}
                          </button>
                        ))}
                        {view !== 'today' && (
                          <div className="search-field">
                            <Search size={14} />
                            <input
                              aria-label="Search tasks"
                              placeholder="Find a task…"
                              value={search}
                              onChange={(e) => setSearch(e.target.value)}
                            />
                          </div>
                        )}
                      </div>
                      <div className="task-list">
                        {filtered.map((task) => (
                          <TaskCard
                            key={task.id}
                            task={task}
                            today={today}
                            timezone={zone}
                            onOpen={() => setSelected(task)}
                            onComplete={() => void complete(task)}
                          />
                        ))}
                      </div>
                      {!filtered.length && (
                        <Empty
                          title={
                            tasks.length
                              ? 'A little breathing room'
                              : 'Your next clear step starts here'
                          }
                        >
                          <p>
                            {tasks.length
                              ? 'Nothing to do in this view. Enjoy the space, or take a look at another day.'
                              : 'Add a document and turn scattered paperwork into simple next steps.'}
                          </p>
                          {!tasks.length && (
                            <div className="button-row">
                              <button
                                className="button primary"
                                onClick={() => setUploadOpen(true)}
                              >
                                Add your first document <Plus size={16} />
                              </button>
                              <button
                                className="button text-button"
                                disabled={seeding}
                                onClick={() => void seed()}
                              >
                                {seeding ? 'Adding examples…' : 'Try synthetic examples'}{' '}
                                <ArrowRight size={15} />
                              </button>
                            </div>
                          )}
                        </Empty>
                      )}
                      {view === 'today' && completed.length > 0 && (
                        <button className="completed-summary" onClick={() => navigate('completed')}>
                          <CheckCircle2 size={17} />
                          <span>
                            {completed.length} thing{completed.length === 1 ? '' : 's'} already
                            taken care of
                          </span>
                          <ArrowRight size={15} />
                        </button>
                      )}
                    </section>
                  </div>
                  {view === 'today' && (
                    <aside className="right-column">
                      <section
                        className="upload-card"
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => {
                          e.preventDefault();
                          setFile(e.dataTransfer.files[0] || null);
                          setUploadOpen(true);
                        }}
                      >
                        <div className="upload-icon">
                          <Inbox size={27} strokeWidth={1.4} />
                          <span>+</span>
                        </div>
                        <h2>
                          Paperwork in.
                          <br />
                          <em>Peace of mind out.</em>
                        </h2>
                        <p>
                          A bill, a letter, a screenshot.
                          <br />
                          Drop it here. We’ll find the to-dos.
                        </p>
                        <button className="button primary" onClick={() => setUploadOpen(true)}>
                          <Plus size={17} /> Add a document
                        </button>
                        <small>PDF, DOCX, PNG or JPG · up to 8 MB</small>
                        <div className="upload-privacy">
                          <ShieldCheck size={13} />
                          <span>Private storage · Processed with OpenAI</span>
                        </div>
                      </section>
                      <section className="recent-documents">
                        <div className="section-heading">
                          <h2>Recently added</h2>
                          <button
                            className="icon-button"
                            aria-label="View all documents"
                            onClick={() => navigate('documents')}
                          >
                            <ArrowUpRight size={17} />
                          </button>
                        </div>
                        {docs.slice(0, 3).map((doc) => (
                          <button
                            className="recent-document"
                            key={doc.id}
                            onClick={() => setDocument(doc)}
                          >
                            <span className="mini-file">
                              <FileText size={18} />
                            </span>
                            <span>
                              <strong>{doc.name.replace('SYNTHETIC • ', '')}</strong>
                              <small>
                                {doc.synthetic
                                  ? 'Synthetic example'
                                  : doc.state === 'completed'
                                    ? `${doc.taskCount} tasks found`
                                    : doc.state}
                              </small>
                            </span>
                            <ChevronRight size={14} />
                          </button>
                        ))}
                        {!docs.length && (
                          <p className="muted small-text">Your documents will feel at home here.</p>
                        )}
                      </section>
                      <div className="gentle-note">
                        <span>✳</span>
                        <p>
                          You don’t have to keep
                          <br />
                          it all in your head.
                        </p>
                      </div>
                    </aside>
                  )}
                </div>
              )}
              <footer className="page-footer">
                <span>
                  <Leaf size={13} /> A small space for life’s little things.
                </span>
                <span>Life Admin Inbox</span>
              </footer>
            </>
          )}
        </main>
      </div>
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={18} />
          <span>{toast}</span>
          <button className="icon-button" aria-label="Dismiss message" onClick={() => setToast('')}>
            <X size={16} />
          </button>
        </div>
      )}
      {selected && (
        <SourcePanel
          task={selected}
          document={docs.find((d) => d.id === selected.documentId)}
          onClose={() => setSelected(null)}
          onChanged={refresh}
          notify={notify}
        />
      )}
      {uploadOpen && (
        <Modal
          title="A little less paperwork"
          onClose={() => {
            if (!uploading) {
              setUploadOpen(false);
              setUploadError('');
            }
          }}
        >
          <p className="modal-intro">
            Add a document. Supported tasks are created automatically, with the original always
            close by.
          </p>
          <div className="privacy-disclosure">
            <ShieldCheck size={21} />
            <div>
              <strong>Know where your document goes</strong>
              <p>
                Your original is stored privately. Text and relevant images are sent to OpenAI for
                extraction. Supabase provides production storage and accounts; Render hosts
                processing. This is not offline processing.
              </p>
            </div>
          </div>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />{' '}
            I understand how my document is processed.
          </label>
          <input
            ref={fileInput}
            type="file"
            aria-label="Document file"
            className="sr-only"
            accept=".pdf,.docx,.png,.jpg,.jpeg"
            onChange={chooseFile}
            tabIndex={-1}
          />
          <button
            className="file-picker"
            disabled={!consent || uploading}
            onClick={() => fileInput.current?.click()}
          >
            <Upload size={26} />
            <strong>{file?.name || 'Choose your document'}</strong>
            <span>
              {file
                ? `${(file.size / 1024).toFixed(0)} KB · Click to change`
                : 'PDF, DOCX, PNG or JPEG · 8 MB maximum'}
            </span>
          </button>
          <p className="fine-print">
            Up to 10 PDF pages, 16 MP images and 40,000 extracted characters. Unsupported, malformed
            and encrypted files are rejected.
          </p>
          {!config.openaiConfigured && (
            <div className="inline-notice">
              <AlertCircle size={16} /> OpenAI is not configured. Uploads can be stored, but
              extraction will fail visibly until the owner adds the backend API key.
            </div>
          )}
          {uploadError && (
            <p className="inline-error" role="alert">
              {uploadError}
            </p>
          )}
          <button
            className="button primary full-width"
            disabled={!file || !consent || uploading}
            onClick={() => void upload()}
          >
            {uploading ? (
              <>
                <LoaderCircle size={17} className="spin" /> Validating & uploading…
              </>
            ) : (
              <>
                Upload & find tasks <ArrowRight size={17} />
              </>
            )}
          </button>
          <p className="fine-print">
            Looking around?{' '}
            <a href="/demo/synthetic-bill.pdf" download>
              Download a synthetic bill
            </a>
            ,{' '}
            <a href="/demo/synthetic-school.docx" download>
              school letter
            </a>{' '}
            or{' '}
            <a href="/demo/synthetic-appointment.png" download>
              appointment screenshot
            </a>
            .
          </p>
        </Modal>
      )}
      {document && (
        <Modal title="Your document" onClose={() => setDocument(null)} wide>
          <div className="source-title">
            <span className="file-icon">
              <FileText size={25} />
            </span>
            <div>
              <h3>{document.name}</h3>
              <p>
                {document.state} · {document.taskCount} tasks ·{' '}
                {document.synthetic ? 'Synthetic example' : 'Private original'}
              </p>
            </div>
          </div>
          {document.warning && <div className="inline-notice">{document.warning}</div>}
          <div className="document-sources">
            {document.sources.length ? (
              document.sources.map((s) => (
                <section key={s.id}>
                  <span className="eyebrow">
                    {s.label}
                    {s.ocr ? ' · AI TRANSCRIPTION' : ''}
                  </span>
                  <p>{s.text}</p>
                </section>
              ))
            ) : (
              <p>Supporting content appears after extraction completes.</p>
            )}
          </div>
          <div className="button-row">
            <button
              className="button primary"
              onClick={() =>
                void download(document.id, document.name).catch((e) => notify(e.message))
              }
            >
              <Download size={16} /> Download original
            </button>
            {!document.synthetic && ['failed', 'partial', 'completed'].includes(document.state) && (
              <button
                className="button secondary"
                onClick={() => void documentAction(document, 'retry')}
              >
                <RotateCcw size={16} /> Retry extraction
              </button>
            )}
            <button
              className="button text-button danger"
              onClick={() => void documentAction(document, 'delete')}
            >
              <Trash2 size={16} /> Delete document
            </button>
          </div>
          <p className="fine-print">
            Deleting this document also deletes its tasks and cancels reminders. Private storage
            cleanup is retried in the background.
          </p>
        </Modal>
      )}
    </div>
  );
}
function GlobeSmall() {
  return (
    <span className="onboarding-icon">
      <CalendarDays size={20} />
    </span>
  );
}
