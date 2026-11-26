import { createContext, useContext, useState, type ReactNode } from 'react';
import { NavLink, Route, Routes, Navigate, useLocation } from 'react-router-dom';
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
import { SignInGate } from './components/SignInGate';
import { knownAccount, signIn } from './lib/sync/graph';
import { ARCHIVE_YEAR, ReadOnlyError, ClosedYearError } from './lib/db';
import { backToLive } from './lib/archive';
import { useToast } from './components/ui';
import { useEffect } from 'react';
import { useMenu, type MenuEntry } from './lib/menu';

// in a closed year's read-only view there is nothing to import and no sync to set up
const allowed = (e: MenuEntry) => !ARCHIVE_YEAR || (e.id !== 'import' && e.id !== 'settings');

const TxCtx = createContext<(d?: TxDraft) => void>(() => {});
export const useTxEditor = () => useContext(TxCtx);



/** Top of the menu: who is signed in, or a clear Sign in button when a household is connected but signed out. */
function AccountBox() {
  const s = useSyncStatus();
  if (!s.state.location) return null; // this device only: nothing to sign in to
  const who = knownAccount();
  if (s.phase === 'signed-out' || !who)
    return (
      <div className="acct-box out">
        <button className="btn good" style={{ justifyContent: 'center', width: '100%' }} onClick={() => signIn()}>
          <Icon name="user" /> Sign in
        </button>
        <div className="acct-note">Signed out of Microsoft. Changes stay on this device until you sign in.</div>
      </div>
    );
  const initials = (who.name || who.username).split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((x) => x[0]!.toUpperCase()).join('');
  return (
    <NavLink to="/settings/sync" className="acct-box in" title="Signed in with Microsoft: open Settings & sync">
      <span className="acct-avatar" aria-hidden="true">{initials}</span>
      <span className="acct-text">
        <span className="acct-name">{who.name || who.username}</span>
        <span className="acct-mail">Signed in{who.name ? ` · ${who.username}` : ''}</span>
      </span>
    </NavLink>
  );
}

const when = (iso?: string) => {
  if (!iso) return '';
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  const t = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return sameDay ? `today ${t}` : `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} ${t}`;
};
/** When the household data on OneDrive last changed, and by whom; plus when this device last looked. */
export function HouseholdUpdated({ className = 'hh-updated' }: { className?: string }) {
  const s = useSyncStatus();
  if (!s.state.location || !s.state.remoteUpdatedAt) return null;
  return (
    <div className={className}>
      <div>
        Data updated <b>{when(s.state.remoteUpdatedAt)}</b>
        {s.state.remoteUpdatedBy ? ` by ${s.state.remoteUpdatedBy.split(' ')[0]}` : ''}
      </div>
      {s.state.lastCheckAt ? <div className="hh-checked">Checked {when(s.state.lastCheckAt)}</div> : null}
    </div>
  );
}

function SyncPill() {
  const s = useSyncStatus();
  const tone = s.phase === 'idle' ? 'ok' : s.phase === 'syncing' || s.phase === 'publishing' ? 'busy' : s.phase === 'error' || s.phase === 'signed-out' || s.phase === 'locked' ? 'bad' : '';
  const label =
    s.phase === 'not-set-up'
      ? 'This device only'
      : s.phase === 'idle'
        ? `Synced${s.state.lastSyncAt ? ' ' + new Date(s.state.lastSyncAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : ''}`
        : s.phase === 'signed-out'
          ? 'Signed out · sign in'
          : s.message;
  return (
    <button className="sync-pill" onClick={() => (s.phase === 'not-set-up' ? (location.hash = '#/settings/sync') : s.phase === 'signed-out' ? signIn() : runSync())} title={s.phase === 'signed-out' ? 'Signed out of Microsoft: click to sign in' : s.message}>
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
  const menu = useMenu();
  // phone bar: the items chosen for it (or the first three); everything else is under More
  const bar = menu.bar.filter(allowed);
  // a Settings page that has its own menu item lights up that item, not Settings
  const { pathname } = useLocation();
  const pinnedHere = menu.visible.some((e) => e.id !== 'settings' && e.to === pathname);
  // open the app on the chosen start page
  useEffect(() => {
    const h = location.hash;
    if ((h === '' || h === '#' || h === '#/') && menu.start.to !== '/' && !ARCHIVE_YEAR) location.replace('#' + menu.start.to);
    // only when the app opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
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
        {!ARCHIVE_YEAR ? <AccountBox /> : null}
        <nav className="nav" aria-label="Main">
          {menu.groups.map((g, gi) => {
            const items = g.items.filter(allowed);
            if (!items.length && !g.label) return null;
            return (
              <div key={g.id} className="nav-group">
                {gi > 0 ? <div className="nav-sep" /> : null}
                {g.label ? <div className="nav-head">{g.label}</div> : null}
                {items.map((e) => (
                  <NavLink key={e.id} to={e.to} end={e.to === '/'} className={({ isActive }) => (isActive && !(e.id === 'settings' && pinnedHere) ? 'active' : '')}>
                    <Icon name={e.icon} /> {e.name}
                  </NavLink>
                ))}
              </div>
            );
          })}
        </nav>
        <div className="rail-foot">
          {ARCHIVE_YEAR ? (
            <div className="muted small">Viewing the {ARCHIVE_YEAR} archive, read-only</div>
          ) : (
            <>
              <SyncPill />
              <HouseholdUpdated />
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
      <SignInGate pending={pending} />
      <nav className="tabbar" aria-label="Main">
        {bar.slice(0, 2).map((e) => (
          <NavLink key={e.id} to={e.to} end={e.to === '/'}>
            <Icon name={e.icon} />
            {e.name}
          </NavLink>
        ))}
        <button className="add" onClick={() => openTx()} aria-label="Add transaction">
          <span className="plus">
            <Icon name="plus" />
          </span>
          Add
        </button>
        {bar.slice(2, 3).map((e) => (
          <NavLink key={e.id} to={e.to} end={e.to === '/'}>
            <Icon name={e.icon} />
            {e.name}
          </NavLink>
        ))}
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
  const [draftSeq, setDraftSeq] = useState(0);
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
              <Route path="/settings/:section" element={<div className="main" style={{ margin: '0 auto' }}><Settings /></div>} />
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
                <Route path="/settings/:section" element={<Settings />} />
                <Route path="/more" element={<More />} />
                <Route path="/categories" element={<Categories />} />
                <Route path="/years" element={<Years />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
              <ConflictReview />
            </Shell>
          )}
          </DrillProvider>
          {draft ? <TxEditor key={draftSeq} draft={draft} onClose={() => setDraft(null)} onReplace={(d) => { setDraft(d); setDraftSeq((n) => n + 1); }} /> : null}
        </TxCtx.Provider>
      </ModelCtx.Provider>
    </ToastProvider>
  );
}


