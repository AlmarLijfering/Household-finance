import { createContext, useContext, useState, type ReactNode } from 'react';
import { NavLink, Route, Routes, Navigate } from 'react-router-dom';
import { Icon, ToastProvider } from './components/ui';
import { ModelCtx, useLiveModel } from './lib/useModel';
import { useAutoSync, useSyncStatus, runSync } from './lib/useSync';
import { TxEditor, type TxDraft } from './components/TxEditor';
import Dashboard from './pages/Dashboard';
import Accounts from './pages/Accounts';
import Register from './pages/Register';
import Transactions from './pages/Transactions';
import Budget from './pages/Budget';
import Yearly from './pages/Yearly';
import RecurringPage from './pages/Recurring';
import Forecast from './pages/Forecast';
import Reports from './pages/Reports';
import ImportPage from './pages/Import';
import Settings from './pages/Settings';
import More from './pages/More';
import Categories from './pages/Categories';
import { DrillProvider } from './components/DrillDown';
import Welcome from './pages/Welcome';
import { ConflictReview } from './components/ConflictReview';
import { cx } from './lib/util';
import Years from './pages/Years';
import { ARCHIVE_YEAR, ReadOnlyError, ClosedYearError } from './lib/db';
import { backToLive } from './lib/archive';
import { useToast } from './components/ui';
import { useEffect } from 'react';

const TxCtx = createContext<(d?: TxDraft) => void>(() => {});
export const useTxEditor = () => useContext(TxCtx);

const NAV: Array<[string, string, string]> = [
  ['/', 'Overview', 'home'],
  ['/accounts', 'Accounts', 'accounts'],
  ['/transactions', 'Transactions', 'list'],
  ['/budget', 'Budget', 'budget'],
  ['/recurring', 'Bills & income', 'repeat'],
  ['/yearly', 'Yearly expenses', 'envelope'],
  ['/forecast', 'Forecast', 'forecast'],
  ['/reports', 'Reports', 'report']
];

function SyncPill() {
  const s = useSyncStatus();
  const tone = s.phase === 'idle' ? 'ok' : s.phase === 'syncing' || s.phase === 'publishing' ? 'busy' : s.phase === 'error' || s.phase === 'signed-out' || s.phase === 'locked' ? 'bad' : '';
  const label =
    s.phase === 'not-set-up'
      ? 'This device only'
      : s.phase === 'idle'
        ? `Synced${s.state.lastSyncAt ? ' ' + new Date(s.state.lastSyncAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : ''}`
        : s.message;
  return (
    <button className="sync-pill" onClick={() => (s.phase === 'not-set-up' ? (location.hash = '#/settings') : runSync())} title={s.message}>
      <span className={cx('dot', tone)} />
      <span>
        {label}
        {s.state.lastReportRevision ? <span className="muted"> · reports r{s.state.lastReportRevision}</span> : null}
      </span>
    </button>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const openTx = useTxEditor();
  const pending = useAutoSync(!ARCHIVE_YEAR);
  const s0 = useSyncStatus();
  const toast = useToast();
  useEffect(() => {
    if (ARCHIVE_YEAR) document.body.classList.add('archive-mode');
    // edits that are not allowed (read-only archive, closed year) explain themselves instead of failing silently
    const h = (e: PromiseRejectionEvent) => {
      if (e.reason instanceof ReadOnlyError || e.reason instanceof ClosedYearError) {
        e.preventDefault();
        toast(e.reason.message);
      }
    };
    window.addEventListener('unhandledrejection', h);
    return () => window.removeEventListener('unhandledrejection', h);
  }, []);
  return (
    <div className="shell">
      <aside className="rail">
        <div className="brand">
          <img src="icon.svg" alt="" />
          Household Finance
        </div>
        <button className="btn good" style={{ justifyContent: 'center' }} onClick={() => openTx()}>
          <Icon name="plus" /> Add transaction
        </button>
        <nav className="nav" aria-label="Main">
          {NAV.map(([to, label, icon]) => (
            <NavLink key={to} to={to} end={to === '/'}>
              <Icon name={icon} /> {label}
            </NavLink>
          ))}
          <div className="nav-sep" />
          <NavLink to="/categories">
            <Icon name="list" /> Categories
          </NavLink>
          <NavLink to="/years">
            <Icon name="archive" /> Years & archive
          </NavLink>
          {!ARCHIVE_YEAR ? (
            <>
              <NavLink to="/import">
                <Icon name="import" /> Import from Excel
              </NavLink>
              <NavLink to="/settings">
                <Icon name="settings" /> Settings & sync
              </NavLink>
            </>
          ) : null}
        </nav>
        <div className="rail-foot">
          {ARCHIVE_YEAR ? (
            <div className="muted small">Viewing the {ARCHIVE_YEAR} archive, read-only</div>
          ) : (
            <>
              <SyncPill />
              {pending && s0.state.location ? <div className="muted small">{pending} change{pending === 1 ? '' : 's'} waiting to sync</div> : null}
            </>
          )}
        </div>
      </aside>
      <main className="main">
        {ARCHIVE_YEAR ? (
          <div className="archive-bar" role="status">
            <Icon name="archive" size={18} />
            <span>
              <b>{ARCHIVE_YEAR} archive</b> · read-only, showing only this closed year
            </span>
            <button className="btn sm" onClick={backToLive}>Back to live data</button>
          </div>
        ) : null}
        {children}
      </main>
      <nav className="tabbar" aria-label="Main">
        <NavLink to="/" end>
          <Icon name="home" />
          Overview
        </NavLink>
        <NavLink to="/accounts">
          <Icon name="accounts" />
          Accounts
        </NavLink>
        <button className="add" onClick={() => openTx()} aria-label="Add transaction">
          <span className="plus">
            <Icon name="plus" />
          </span>
          Add
        </button>
        <NavLink to="/budget">
          <Icon name="budget" />
          Budget
        </NavLink>
        <NavLink to="/more">
          <Icon name="more" />
          More
        </NavLink>
      </nav>
    </div>
  );
}

export default function App() {
  const model = useLiveModel();
  const [draft, setDraft] = useState<TxDraft | null>(null);
  if (!model) return null;
  const fresh = model.groups.length === 0;
  return (
    <ToastProvider>
      <ModelCtx.Provider value={model}>
        <TxCtx.Provider value={(d) => setDraft(d ?? {})}>
          <DrillProvider>
          {fresh ? (
            <Routes>
              <Route path="/import" element={<div className="main" style={{ margin: '0 auto' }}><ImportPage /></div>} />
              <Route path="/settings" element={<div className="main" style={{ margin: '0 auto' }}><Settings /></div>} />
              <Route path="*" element={<Welcome />} />
            </Routes>
          ) : (
            <Shell>
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/accounts" element={<Accounts />} />
                <Route path="/accounts/:id" element={<Register />} />
                <Route path="/transactions" element={<Transactions />} />
                <Route path="/budget" element={<Budget />} />
                <Route path="/yearly" element={<Yearly />} />
                <Route path="/recurring" element={<RecurringPage />} />
                <Route path="/forecast" element={<Forecast />} />
                <Route path="/reports" element={<Reports />} />
                <Route path="/import" element={<ImportPage />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="/more" element={<More />} />
                <Route path="/categories" element={<Categories />} />
                <Route path="/years" element={<Years />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
              <ConflictReview />
            </Shell>
          )}
          </DrillProvider>
          {draft ? <TxEditor draft={draft} onClose={() => setDraft(null)} /> : null}
        </TxCtx.Provider>
      </ModelCtx.Provider>
    </ToastProvider>
  );
}

export { NAV };
