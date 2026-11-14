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
    return () => {
      document.removeEventListener('visibilitychange', vis);
      window.removeEventListener('online', online);
    };
  }, []);
  useEffect(() => {
    if (!enabled || !pending || !status.state.location) return;
    const h = setTimeout(() => runSync(), 4000);
    return () => clearTimeout(h);
  }, [pending]);
  return pending ?? 0;
}
