import Dexie, { type Table } from 'dexie';
import type { Op, TableName, TableTypes, Snapshot } from './types';
import { TABLES } from './types';
import { uid, nowIso, deviceId } from './util';

interface KV {
  key: string;
  value: unknown;
}

class FinanceDB extends Dexie {
  accounts!: Table<TableTypes['accounts'], string>;
  groups!: Table<TableTypes['groups'], string>;
  categories!: Table<TableTypes['categories'], string>;
  transactions!: Table<TableTypes['transactions'], string>;
  budgetLines!: Table<TableTypes['budgetLines'], string>;
  recurring!: Table<TableTypes['recurring'], string>;
  planned!: Table<TableTypes['planned'], string>;
  scenarios!: Table<TableTypes['scenarios'], string>;
  yearlyItems!: Table<TableTypes['yearlyItems'], string>;
  yearlyFunds!: Table<TableTypes['yearlyFunds'], string>;
  fxRates!: Table<TableTypes['fxRates'], string>;
  reconciliations!: Table<TableTypes['reconciliations'], string>;
  importBatches!: Table<TableTypes['importBatches'], string>;
  monthPlans!: Table<TableTypes['monthPlans'], string>;
  closedYears!: Table<TableTypes['closedYears'], string>;
  settings!: Table<TableTypes['settings'], string>;
  /** Local edits not yet confirmed on OneDrive. Survives reloads and crashes. */
  pending!: Table<Op, string>;
  kv!: Table<KV, string>;

  constructor(name = 'household-finance') {
    super(name);
    this.version(1).stores({
      accounts: 'id, code, type',
      groups: 'id, code',
      categories: 'id, code, groupId',
      transactions: 'id, accountId, date, categoryId, transferId, importBatchId, [accountId+date]',
      budgetLines: 'id, month, categoryId',
      recurring: 'id, accountId, nextDate',
      planned: 'id, date, scenarioId, importBatchId',
      scenarios: 'id',
      yearlyItems: 'id, year',
      yearlyFunds: 'id',
      fxRates: 'id, currency, date',
      reconciliations: 'id, accountId',
      importBatches: 'id',
      settings: 'id',
      pending: 'opId, at',
      kv: 'key'
    });
    this.version(2).stores({ monthPlans: 'id' });
    this.version(3).stores({ closedYears: 'id' });
  }
}

/**
 * Viewing a closed year opens the app with ?archive=YYYY. It then reads a separate,
 * read-only local database holding only that year's archive.
 */
export const ARCHIVE_YEAR: number | null = (() => {
  try {
    const v = new URLSearchParams(location.search).get('archive');
    return v && /^\d{4}$/.test(v) ? Number(v) : null;
  } catch {
    return null;
  }
})();
export const archiveDbName = (year: number) => `household-finance-archive-${year}`;
export const openFinanceDb = (name: string) => new FinanceDB(name);

export const db = new FinanceDB(ARCHIVE_YEAR ? archiveDbName(ARCHIVE_YEAR) : 'household-finance');

export class ReadOnlyError extends Error {
  constructor(msg = 'This is a closed year, opened read-only. Go back to your live data to make changes.') {
    super(msg);
  }
}
export class ClosedYearError extends Error {}

/** Refuse new or changed records that belong to a closed year (the close itself only deletes). */
async function guardClosed(changes: Array<{ table: TableName; put?: any; del?: string }>) {
  const relevant = changes.filter((c) => c.put && (c.table === 'transactions' || c.table === 'budgetLines' || c.table === 'monthPlans' || c.table === 'yearlyItems' || c.table === 'yearlyFunds'));
  if (!relevant.length) return;
  const closed = new Set((await db.closedYears.toArray()).map((c) => c.year));
  for (const c of changes) {
    if (c.table !== 'closedYears') continue;
    if (c.put) closed.add(c.put.year);
    if (c.del) closed.delete(Number(c.del));
  }
  if (!closed.size) return;
  const { monthOfDate } = await import('./calc/period');
  const [settings, monthPlans] = await Promise.all([db.settings.get('settings'), db.monthPlans.toArray()]);
  const mini = { settings: settings ?? { budgetPeriods: 'weeks' }, monthPlans } as any;
  for (const c of relevant) {
    const r = c.put;
    let year: number;
    if (c.table === 'transactions') year = Number((r.budgetMonth || monthOfDate(mini, r.date)).slice(0, 4));
    else if (c.table === 'budgetLines') year = Number(r.month.slice(0, 4));
    else if (c.table === 'monthPlans') year = Number(r.id.slice(0, 4));
    else year = Number(r.year);
    if (closed.has(year)) throw new ClosedYearError(`${year} is closed. Reopen the year under Years & archive before changing it.`);
  }
}

function table<K extends TableName>(name: K): Table<TableTypes[K], string> {
  return (db as unknown as Record<string, Table<TableTypes[K], string>>)[name];
}

/**
 * Every change goes through here: the record is written locally and an op is
 * appended to the pending queue in the same IndexedDB transaction, so a crash
 * can never leave a local edit without its retained op (or vice versa).
 */
export async function commit(
  changes: Array<{ table: TableName; put?: any; del?: string }>,
  label?: string
): Promise<void> {
  if (ARCHIVE_YEAR) throw new ReadOnlyError();
  await guardClosed(changes);
  const at = nowIso();
  const device = deviceId();
  const names = Array.from(new Set(changes.map((c) => c.table)));
  await db.transaction('rw', [...names.map((n) => table(n)), db.pending], async () => {
    for (const c of changes) {
      if (c.put) {
        const rec = { ...c.put, updatedAt: at };
        await table(c.table).put(rec);
        await db.pending.put({ opId: uid(), table: c.table, kind: 'put', key: rec.id, record: rec, at, device, label });
      } else if (c.del) {
        await table(c.table).delete(c.del);
        await db.pending.put({ opId: uid(), table: c.table, kind: 'delete', key: c.del, at, device, label });
      }
    }
  });
}

export const put = <K extends TableName>(t: K, rec: TableTypes[K], label?: string) => commit([{ table: t, put: rec }], label);
export const del = (t: TableName, id: string, label?: string) => commit([{ table: t, del: id }], label);

export async function getKV<T>(key: string): Promise<T | undefined> {
  return (await db.kv.get(key))?.value as T | undefined;
}
export async function setKV(key: string, value: unknown) {
  await db.kv.put({ key, value });
}

export async function exportSnapshot(revision: number, appliedOps: string[]): Promise<Snapshot> {
  const data = {} as Snapshot['data'];
  for (const t of TABLES) (data as any)[t] = await table(t).toArray();
  return {
    format: 'pfm-snapshot',
    version: 1,
    revision,
    savedAt: nowIso(),
    savedBy: deviceId(),
    appliedOps: appliedOps.slice(-5000),
    data
  };
}

/** Replace all local records with a snapshot (pending ops are kept separately). */
export async function loadSnapshot(s: Snapshot) {
  await db.transaction('rw', TABLES.map((t) => table(t)), async () => {
    for (const t of TABLES) {
      await table(t).clear();
      const rows = (s.data as any)[t] ?? [];
      if (rows.length) await table(t).bulkPut(rows);
    }
  });
}

/** Re-apply ops on top of the current local tables (used after loading a newer snapshot). */
export async function applyOps(ops: Op[]) {
  const names = Array.from(new Set(ops.map((o) => o.table)));
  if (!names.length) return;
  await db.transaction('rw', names.map((n) => table(n)), async () => {
    for (const o of ops) {
      if (o.kind === 'put') await table(o.table).put(o.record as any);
      else await table(o.table).delete(o.key);
    }
  });
}

export { table };
