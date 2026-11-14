// OneDrive sync: one authoritative encrypted snapshot, conditional writes, op replay.
import { db, exportSnapshot, loadSnapshot, applyOps, getKV, setKV } from '../db';
import type { Op, Snapshot } from '../types';
import { decryptJson, encryptJson, type Envelope, type Keyring } from './crypto';
import { buildModel, DEFAULT_SETTINGS } from '../calc/model';
import { opTouchesClosed } from '../calc/yearclose';
import { download, upload, listChildren, PreconditionFailed, AuthRequired, ensureSubfolders, type Location, type DriveItem } from './graph';

export const SNAPSHOT_PATH = 'Data/household.json';
export const KEYRING_PATH = 'Data/keyring.json';

export interface SyncState {
  location?: Location;
  etag?: string | null;
  revision: number;
  appliedOps: string[];
  lastSyncAt?: string;
  lastBackupAt?: string;
  lastReportAt?: string;
  lastReportRevision?: number;
  lastError?: string;
  reportError?: string;
}

export type Phase = 'idle' | 'syncing' | 'publishing' | 'offline' | 'error' | 'locked' | 'signed-out' | 'not-set-up';
export interface Conflict {
  op: Op;
  remote: unknown; // the version on OneDrive that the local edit replaced
}

type Listener = () => void;
const listeners = new Set<Listener>();
export const status = {
  phase: 'not-set-up' as Phase,
  message: '',
  conflicts: [] as Conflict[],
  state: { revision: 0, appliedOps: [] } as SyncState
};
function emit(p: Partial<typeof status>) {
  Object.assign(status, p);
  listeners.forEach((l) => l());
}
export function subscribe(l: Listener) {
  listeners.add(l);
  return () => listeners.delete(l);
}

// ---- key held in memory only after unlock (and as a non-extractable CryptoKey in IndexedDB) ----
let dataKey: CryptoKey | null = null;
let keyring: Keyring | null = null;
export const getKeys = () => ({ dataKey, keyring });
export function setKey(k: CryptoKey | null, ring: Keyring | null) {
  dataKey = k;
  keyring = ring;
}
export async function restoreKey(): Promise<boolean> {
  const k = await getKV<CryptoKey>('sync.key');
  const ring = await getKV<Keyring>('sync.keyring');
  if (k && ring) {
    setKey(k, ring);
    return true;
  }
  return false;
}
export async function persistKey(k: CryptoKey, ring: Keyring) {
  setKey(k, ring);
  await setKV('sync.key', k); // non-extractable: the raw key bytes cannot be read back out
  await setKV('sync.keyring', ring);
}
export async function forgetKey() {
  setKey(null, null);
  await db.kv.delete('sync.key');
  await db.kv.delete('sync.keyring');
}

export async function loadState(): Promise<SyncState> {
  const s = (await getKV<SyncState>('sync.state')) ?? { revision: 0, appliedOps: [] };
  emit({ state: s });
  return s;
}
async function saveState(s: SyncState) {
  await setKV('sync.state', s);
  emit({ state: s });
}

async function readRemote(loc: Location): Promise<{ etag: string; snapshot: Snapshot } | null> {
  const f = await download(loc, SNAPSHOT_PATH);
  if (!f) return null;
  const env = JSON.parse(new TextDecoder().decode(f.body)) as Envelope;
  const snapshot = await decryptJson<Snapshot>(dataKey!, env, keyring ?? undefined);
  return { etag: f.meta.eTag!, snapshot };
}

let running: Promise<void> | null = null;
/** Edits dropped because their year was closed on another device (shown in Years & archive). */
export let droppedForClosed = 0;
let again = false;

/** Sync now. Concurrent calls coalesce into one follow-up run. */
export function syncNow(opts: { publish?: () => Promise<void> } = {}): Promise<void> {
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    try {
      do {
        again = false;
        await syncOnce(opts);
      } while (again);
    } finally {
      running = null;
    }
  })();
  return running;
}

async function syncOnce(opts: { publish?: () => Promise<void> }) {
  const state = await loadState();
  if (!state.location) return emit({ phase: 'not-set-up', message: 'OneDrive sync is not set up' });
  if (!dataKey) return emit({ phase: 'locked', message: 'Enter the household passphrase to sync' });
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return emit({ phase: 'offline', message: 'Offline — changes are kept on this device' });
  emit({ phase: 'syncing', message: 'Syncing…' });
  const loc = state.location;
  try {
    for (let attempt = 0; attempt < 4; attempt++) {
      const pending = await db.pending.orderBy('at').toArray();
      const remote = await readRemote(loc);
      let applied = state.appliedOps;
      let revision = state.revision;
      let changedRemotely = false;

      if (remote && remote.etag !== state.etag) {
        // Someone else saved. Load their snapshot, then replay our retained edits on top.
        changedRemotely = true;
        const already = new Set(remote.snapshot.appliedOps);
        let mine = pending.filter((o) => !already.has(o.opId));
        // edits made on this device to a year that was closed elsewhere in the meantime are not applied
        const remoteModel = buildModel({ ...(remote.snapshot.data as any), settings: remote.snapshot.data.settings?.[0] ?? DEFAULT_SETTINGS, closedYears: remote.snapshot.data.closedYears ?? [] });
        const stale = mine.filter((o) => opTouchesClosed(remoteModel, o));
        if (stale.length) {
          await db.pending.bulkDelete(stale.map((o) => o.opId));
          mine = mine.filter((o) => !stale.includes(o));
          emit({ message: `${stale.length} change${stale.length === 1 ? '' : 's'} to a closed year ${stale.length === 1 ? 'was' : 'were'} not applied` });
          droppedForClosed += stale.length;
        }
        const conflicts = findConflicts(remote.snapshot, mine, state.lastSyncAt);
        await loadSnapshot(remote.snapshot);
        await applyOps(mine);
        // ops that the remote already contains (an earlier upload did land) are done
        const done = pending.filter((o) => already.has(o.opId)).map((o) => o.opId);
        if (done.length) await db.pending.bulkDelete(done);
        applied = remote.snapshot.appliedOps;
        revision = remote.snapshot.revision;
        if (conflicts.length) emit({ conflicts: [...status.conflicts, ...conflicts] });
        state.etag = remote.etag;
      }

      const toSend = await db.pending.orderBy('at').toArray();
      if (!toSend.length && remote) {
        state.revision = revision;
        state.appliedOps = applied;
        state.lastSyncAt = new Date().toISOString();
        state.lastError = undefined;
        await saveState(state);
        if (changedRemotely || state.lastReportRevision !== revision) await publish(opts, state);
        return emit({ phase: 'idle', message: 'Up to date' });
      }

      const nextApplied = [...applied, ...toSend.map((o) => o.opId)].slice(-5000);
      const snap = await exportSnapshot(revision + 1, nextApplied);
      const env = await encryptJson(dataKey!, keyring!.keyId, snap);
      const body = new Blob([JSON.stringify(env)], { type: 'application/json' });
      try {
        const item = await upload(loc, SNAPSHOT_PATH, body, remote ? remote.etag : null);
        await db.pending.bulkDelete(toSend.map((o) => o.opId));
        Object.assign(state, { etag: item.eTag, revision: revision + 1, appliedOps: nextApplied, lastSyncAt: new Date().toISOString(), lastError: undefined });
        await saveState(state);
        await maybeBackup(loc, state, body);
        await publish(opts, state);
        return emit({ phase: 'idle', message: 'Up to date' });
      } catch (e) {
        if (e instanceof PreconditionFailed) continue; // someone saved in between: reload and replay
        throw e;
      }
    }
    throw new Error('OneDrive kept changing while saving. Try again in a moment.');
  } catch (e: any) {
    if (e instanceof AuthRequired) return emit({ phase: 'signed-out', message: e.message });
    if (/no longer in the keyring|OperationError/i.test(String(e?.message ?? e?.name))) {
      // The household key was rotated on another device: a new passphrase is needed.
      const latest = await readKeyring(loc).catch(() => null);
      if (latest && latest.ring.keyId !== keyring?.keyId) {
        await forgetKey();
        return emit({ phase: 'locked', message: 'The household passphrase was changed. Enter the new one to keep syncing.' });
      }
    }
    state.lastError = String(e?.message ?? e);
    await saveState(state);
    emit({ phase: navigator.onLine === false ? 'offline' : 'error', message: state.lastError });
  }
}

/** Local edits to records that someone else also changed since our last sync. */
function findConflicts(remote: Snapshot, mine: Op[], since?: string): Conflict[] {
  if (!since) return [];
  const out: Conflict[] = [];
  for (const op of mine) {
    const rows = (remote.data as any)[op.table] as Array<{ id: string; updatedAt?: string }> | undefined;
    const r = rows?.find((x) => x.id === op.key);
    if (r && r.updatedAt && r.updatedAt > since) out.push({ op, remote: r });
  }
  return out;
}

/** Keep the other person's version of a conflicting record instead of ours. */
export async function keepTheirs(c: Conflict) {
  const { put } = await import('../db');
  if (c.remote) await put(c.op.table, c.remote as any, 'Kept version from OneDrive');
  dismissConflict(c);
}
export function dismissConflict(c: Conflict) {
  emit({ conflicts: status.conflicts.filter((x) => x.op.opId !== c.op.opId) });
}

async function maybeBackup(loc: Location, state: SyncState, body: Blob) {
  const last = state.lastBackupAt ? Date.parse(state.lastBackupAt) : 0;
  if (Date.now() - last < 20 * 3600 * 1000) return;
  const stamp = new Date().toISOString().replace(/[:]/g, '').slice(0, 15);
  try {
    await upload(loc, `Backups/household-${stamp}-r${state.revision}.json`, body);
    state.lastBackupAt = new Date().toISOString();
    await saveState(state);
  } catch {
    /* a missed backup is retried after the next sync */
  }
}

async function publish(opts: { publish?: () => Promise<void> }, state: SyncState) {
  if (!opts.publish) return;
  emit({ phase: 'publishing', message: 'Publishing Excel reports…' });
  try {
    await opts.publish();
    state.lastReportAt = new Date().toISOString();
    state.lastReportRevision = state.revision;
    state.reportError = undefined;
  } catch (e: any) {
    // The previous report stays on OneDrive; we try again on the next sync.
    state.reportError = String(e?.message ?? e);
  }
  await saveState(state);
}

export async function listBackups(): Promise<DriveItem[]> {
  const s = await loadState();
  if (!s.location) return [];
  return (await listChildren(s.location, 'Backups')).filter((x) => x.name.endsWith('.json')).sort((a, b) => (b.lastModifiedDateTime ?? '').localeCompare(a.lastModifiedDateTime ?? ''));
}

/** Restore a backup: it becomes the new household snapshot (a normal conditional save). */
export async function restoreBackup(name: string) {
  const s = await loadState();
  if (!s.location || !dataKey) throw new Error('Sync is not unlocked');
  const f = await download(s.location, `Backups/${name}`);
  if (!f) throw new Error('Backup not found');
  const snap = await decryptJson<Snapshot>(dataKey, JSON.parse(new TextDecoder().decode(f.body)), keyring ?? undefined);
  await db.pending.clear();
  await loadSnapshot(snap);
  // Re-save every record as a fresh op so the restore is uploaded like any other change.
  const { TABLES } = await import('../types');
  const ops: Op[] = [];
  const at = new Date().toISOString();
  for (const t of TABLES) for (const r of (snap.data as any)[t] ?? []) ops.push({ opId: crypto.randomUUID(), table: t, kind: 'put', key: r.id, record: r, at, device: 'restore', label: `Restore ${name}` });
  await db.pending.bulkPut(ops);
  await syncNow();
}

export async function connectLocation(loc: Location) {
  await ensureSubfolders(loc).catch(() => undefined); // editors may lack rights to create folders; ignore
  const s = await loadState();
  await saveState({ ...s, location: loc, etag: undefined, revision: 0, appliedOps: [] });
}
export async function disconnect() {
  const s = await loadState();
  await saveState({ revision: s.revision, appliedOps: [] });
  await forgetKey();
  emit({ phase: 'not-set-up', message: 'OneDrive sync is not set up' });
}

export async function readKeyring(loc: Location): Promise<{ ring: Keyring; etag: string } | null> {
  const f = await download(loc, KEYRING_PATH);
  if (!f) return null;
  return { ring: JSON.parse(new TextDecoder().decode(f.body)), etag: f.meta.eTag! };
}
export async function writeKeyring(loc: Location, ring: Keyring, etag: string | null) {
  await upload(loc, KEYRING_PATH, new Blob([JSON.stringify(ring, null, 2)], { type: 'application/json' }), etag);
}

/** Upload the full current state now (used right after a key rotation). */
export async function forceResave() {
  const all = await exportSnapshot(0, []);
  const ops: Op[] = [];
  const at = new Date().toISOString();
  for (const [t, rows] of Object.entries(all.data)) for (const r of rows as any[]) ops.push({ opId: crypto.randomUUID(), table: t as any, kind: 'put', key: r.id, record: r, at, device: 'rotate' });
  await db.pending.bulkPut(ops);
  const s = await loadState();
  await saveState({ ...s, etag: s.etag }); // keep etag: the next save is still conditional
  return syncNow();
}
