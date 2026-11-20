import { useEffect, useSyncExternalStore } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './db';
import { status, subscribe, syncNow, loadState, restoreKey } from './sync/sync';
import { publishReports } from './publish';

let snapshotCache = { ...status };
function getSnap() {
  if (snapshotCache.phase !== status.phase || snapshotCache.message !== status.message || snapshotCache.conflicts !== status.conflicts || snapshotCache.state !== status.state)
    snapshotCache = { ...status };
  return snapshotCache;
}
export function useSyncStatus() {
  return useSyncExternalStore(subscribe as any, getSnap);
}
export const runSync = () => syncNow({ publish: publishReports });

/** How often to look for changes from other devices while the app is open (minutes, 0 = only on open/return). Per device. */
export const CHECK_OPTIONS: Array<[number, string]> = [[0, 'Only when I open or return to the app'], [1, 'Every minute'], [5, 'Every 5 minutes'], [15, 'Every 15 minutes'], [30, 'Every 30 minutes']];
export function checkEvery(): number {
  const v = Number(localStorage.getItem('pfm.checkEvery') ?? '5');
  return CHECK_OPTIONS.some(([n]) => n === v) ? v : 5;
}
export function setCheckEvery(n: number) {
  try {
    localStorage.setItem('pfm.checkEvery', String(n));
  } catch {}
}

/** Starts sync on open, when the app returns to the foreground, and shortly after edits. */
export function useAutoSync(enabled = true) {
  const pending = useLiveQuery(() => db.pending.count(), []);
  useEffect(() => {
    if (!enabled) return;
    (async () => {
      await restoreKey();
      const s = await loadState();
      if (s.location) runSync();
    })();
    const vis = () => document.visibilityState === 'visible' && runSync();
    const online = () => runSync();
    document.addEventListener('visibilitychange', vis);
    window.addEventListener('online', online);
    // regular check while the app is open and visible: cheap when nothing changed
    const tick = setInterval(() => {
      const every = checkEvery();
      if (!every || document.visibilityState !== 'visible' || !status.state.location) return;
      if (status.phase === 'syncing' || status.phase === 'signed-out' || status.phase === 'locked') return;
      const last = Date.parse(status.state.lastCheckAt ?? status.state.lastSyncAt ?? '') || 0;
      if (Date.now() - last >= every * 60_000 - 5_000) runSync();
    }, 30_000);
    return () => {
      document.removeEventListener('visibilitychange', vis);
      window.removeEventListener('online', online);
      clearInterval(tick);
    };
  }, []);
  useEffect(() => {
    if (!enabled || !pending || !status.state.location) return;
    const h = setTimeout(() => runSync(), 4000);
    return () => clearTimeout(h);
  }, [pending]);
  return pending ?? 0;
}
