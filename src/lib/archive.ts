// Storing and opening closed-year archives.
// OneDrive: Archive/household-YYYY.json, encrypted with the household key (same as the snapshot).
// Without OneDrive sync the archive stays on this device.

import { db, commit, getKV, setKV, archiveDbName, openFinanceDb } from './db';
import { TABLES } from './types';
import type { ClosedYear } from './types';
import type { Model } from './calc/model';
import { planClose, planReopen, validateArchive, type Archive } from './calc/yearclose';
import { encryptJson, decryptJson, type Envelope } from './sync/crypto';
import { download, upload, listChildren, renameItem, PreconditionFailed } from './sync/graph';
import { getKeys, loadState, syncNow } from './sync/sync';
import { deviceId, nowIso } from './util';

const folderPath = (name: string) => `Archive/${name}`;
const localKey = (year: number) => `archive:${year}`;

async function syncedLocation() {
  const s = await loadState();
  return s.location ?? null;
}

/** Bring this device up to date with OneDrive before closing or reopening. */
async function syncFirst() {
  const loc = await syncedLocation();
  if (!loc) return;
  await syncNow();
  const left = await db.pending.count();
  if (left) throw new Error(`${left} change${left === 1 ? '' : 's'} could not be synced yet. Check the sync status and try again.`);
}

function encKey() {
  const { dataKey, keyring } = getKeys();
  if (!dataKey || !keyring) throw new Error('Unlock sync with the household passphrase first (Settings → Sync & sharing).');
  return { dataKey, keyring };
}

/**
 * Close a year: write the archive first (and check it arrived complete), then remove the
 * year from the live data in one local transaction, then sync.
 * If anything fails before the last step, the live data is untouched.
 */
export async function closeYear(mFresh: () => Promise<Model>, year: number): Promise<ClosedYear> {
  await syncFirst();
  const m = await mFresh(); // the data as it is after syncing
  const loc = await syncedLocation();
  const plan = planClose(m, year, deviceId(), loc ? 'onedrive' : 'device');

  if (loc) {
    const { dataKey, keyring } = encKey();
    const env = await encryptJson(dataKey, keyring.keyId, plan.archive);
    const body = new Blob([JSON.stringify(env)], { type: 'application/json' });
    const path = folderPath(plan.summary.fileName);
    let item;
    try {
      item = await upload(loc, path, body, null); // must not exist yet
    } catch (e) {
      if (!(e instanceof PreconditionFailed)) throw e;
      // A file from an earlier, unfinished close or a reopened year: keep it aside, never overwrite.
      await renameItem(loc, path, `household-${year}-set-aside-${nowIso().replace(/[:.]/g, '').slice(0, 15)}.json`);
      item = await upload(loc, path, body, null);
    }
    if (item.size != null && item.size !== body.size) throw new Error('The archive did not arrive complete on OneDrive. Nothing was changed; try again.');
  }
  // keep a local copy too: opening the year later works offline and needs no download
  await setKV(localKey(year), plan.archive);

  await commit(plan.changes, `Close ${year}`);
  if (loc) await syncNow();
  return plan.summary;
}

/** Fetch a closed year's archive (local copy first, then OneDrive). */
export async function fetchArchive(c: ClosedYear): Promise<Archive> {
  const local = await getKV<Archive>(localKey(c.year));
  if (local) return validateArchive(local, c.year);
  const loc = await syncedLocation();
  if (!loc) throw new Error(`The archive of ${c.year} is not on this device${c.storage === 'onedrive' ? ' and OneDrive sync is not set up here' : ''}.`);
  const f = await download(loc, folderPath(c.fileName));
  if (!f) throw new Error(`Archive/${c.fileName} was not found in the household folder on OneDrive.`);
  const { dataKey, keyring } = encKey();
  const archive = validateArchive(await decryptJson<Archive>(dataKey, JSON.parse(new TextDecoder().decode(f.body)) as Envelope, keyring), c.year);
  await setKV(localKey(c.year), archive);
  return archive;
}

/** Load the archive into its own read-only database and open the app on it. */
export async function openArchiveView(c: ClosedYear) {
  const archive = await fetchArchive(c);
  const adb = openFinanceDb(archiveDbName(c.year));
  await adb.open();
  await adb.transaction('rw', TABLES.map((t) => (adb as any)[t]), async () => {
    for (const t of TABLES) {
      await (adb as any)[t].clear();
      const rows = (archive.data as any)[t] ?? [];
      if (rows.length) await (adb as any)[t].bulkPut(rows);
    }
  });
  adb.close();
  const url = new URL(location.href);
  url.search = `?archive=${c.year}`;
  url.hash = '#/budget';
  location.href = url.toString();
}

export function backToLive() {
  const url = new URL(location.href);
  url.search = '';
  url.hash = '#/';
  location.href = url.toString();
}

/** Reopen the most recently closed year. The archive file is kept aside on OneDrive as a backup. */
export async function reopenYear(mFresh: () => Promise<Model>, c: ClosedYear) {
  await syncFirst();
  const archive = await fetchArchive(c);
  const m = await mFresh();
  const changes = planReopen(m, archive);
  await commit(changes, `Reopen ${c.year}`);
  const loc = await syncedLocation();
  if (loc && c.storage === 'onedrive') {
    await renameItem(loc, folderPath(c.fileName), `household-${c.year}-reopened-${nowIso().replace(/[:.]/g, '').slice(0, 15)}.json`).catch(() => undefined);
  }
  await db.kv.delete(localKey(c.year));
  if (loc) await syncNow();
}

/** A year closed without OneDrive: put its archive on OneDrive now that sync is set up. */
export async function uploadDeviceArchive(c: ClosedYear) {
  const loc = await syncedLocation();
  if (!loc) throw new Error('Set up OneDrive sync first.');
  const archive = await getKV<Archive>(localKey(c.year));
  if (!archive) throw new Error(`The archive of ${c.year} is not on this device.`);
  const { dataKey, keyring } = encKey();
  const env = await encryptJson(dataKey, keyring.keyId, archive);
  await upload(loc, folderPath(c.fileName), new Blob([JSON.stringify(env)], { type: 'application/json' }), null);
  await commit([{ table: 'closedYears', put: { ...c, storage: 'onedrive' } }], `Archive ${c.year} uploaded`);
  await syncNow();
}

/** Archive files present in the OneDrive folder (including set-aside copies). */
export async function listArchiveFiles() {
  const loc = await syncedLocation();
  if (!loc) return [];
  return (await listChildren(loc, 'Archive')).filter((x) => x.name.endsWith('.json'));
}
