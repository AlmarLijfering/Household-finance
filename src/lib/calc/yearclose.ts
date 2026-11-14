// Closing a year: everything that belongs to the year's budget months moves into an archive,
// the live data keeps opening balances and a small summary. Pure functions; storage is elsewhere.
//
// The budget month decides the year, never the date: a payment dated 25 Dec 2026 that counts
// for January 2027 stays live; one dated 3 Jan 2027 that counts for December 2026 is archived.

import type { Account, BudgetLine, ClosedYear, ID, MonthKey, Snapshot, TableName, Transaction } from '../types';
import { TABLES } from '../types';
import { kindOf, toBase, txBase, type Model } from './model';
import { monthOfDate, periodEnd, periodStart, txMonth } from './period';
import { computeMonth } from './budget';
import { nowIso, shiftMonth } from '../util';

export const ARCHIVE_FORMAT = 'pfm-archive';
export interface Archive {
  format: typeof ARCHIVE_FORMAT;
  version: 1;
  year: number;
  createdAt: string;
  createdBy: string;
  /** Same shape as the household snapshot: the read-only viewer loads it like live data. */
  data: Snapshot['data'];
}

export const yearOfMonth = (m: MonthKey) => Number(m.slice(0, 4));
export const isClosedYear = (m: Model, year: number) => m.closedYears.some((c) => c.year === year);
export const isClosedMonth = (m: Model, month: MonthKey) => isClosedYear(m, yearOfMonth(month));
export const lastClosed = (m: Model): ClosedYear | undefined => m.closedYears[m.closedYears.length - 1];
export const closedSummary = (m: Model, month: MonthKey) => m.closedYears.find((c) => c.year === yearOfMonth(month));

/** Year a transfer pair belongs to: the outgoing side decides, so both sides always move together. */
function pairMonth(m: Model, t: Transaction, byTransfer: Map<ID, Transaction[]>): MonthKey {
  if (!t.transferId) return txMonth(m, t);
  const both = byTransfer.get(t.transferId) ?? [t];
  const out = both.find((x) => x.amount < 0) ?? both[0];
  return txMonth(m, out);
}
function transferIndex(m: Model) {
  const map = new Map<ID, Transaction[]>();
  for (const t of m.transactions) if (t.transferId) map.set(t.transferId, [...(map.get(t.transferId) ?? []), t]);
  return map;
}

export interface YearInfo {
  year: number;
  transactions: number;
  budgetLines: number;
  yearlyItems: number;
  monthPlans: number;
  lastDay: string; // last day of the year's December budget month
  closed: boolean;
}

/** Every year that has data, open or closed, oldest first. */
export function yearsOverview(m: Model): YearInfo[] {
  const map = new Map<number, YearInfo>();
  const get = (y: number) => {
    let e = map.get(y);
    if (!e) map.set(y, (e = { year: y, transactions: 0, budgetLines: 0, yearlyItems: 0, monthPlans: 0, lastDay: periodEnd(m, `${y}-12`), closed: false }));
    return e;
  };
  const tr = transferIndex(m);
  for (const t of m.transactions) get(yearOfMonth(pairMonth(m, t, tr))).transactions++;
  for (const b of m.budgetLines) get(yearOfMonth(b.month)).budgetLines++;
  for (const y of m.yearlyItems) get(y.year).yearlyItems++;
  for (const p of m.monthPlans) if (p.startDate || p.startBaseline || p.startEstimate) get(yearOfMonth(p.id)).monthPlans++;
  for (const c of m.closedYears) {
    const e = get(c.year);
    e.closed = true;
    e.transactions = c.counts.transactions ?? 0;
    e.budgetLines = c.counts.budgetLines ?? 0;
    e.yearlyItems = c.counts.yearlyItems ?? 0;
  }
  return [...map.values()].sort((a, b) => a.year - b.year);
}

export interface CloseCheck {
  ok: boolean;
  problems: string[];
  notes: string[];
}

/**
 * Whether a year can be closed now. Years close in order (oldest first), only after their
 * last budget month has ended, and only when nothing from the year is still waiting to be booked.
 */
export function closeCheck(m: Model, year: number, todayIso: string, pendingChanges = 0): CloseCheck {
  const problems: string[] = [];
  const notes: string[] = [];
  const years = yearsOverview(m);
  if (isClosedYear(m, year)) problems.push(`${year} is already closed.`);
  const earlierOpen = years.filter((y) => y.year < year && !y.closed && (y.transactions || y.budgetLines || y.yearlyItems));
  if (earlierOpen.length) problems.push(`Close ${earlierOpen.map((y) => y.year).join(', ')} first: years close oldest first.`);
  const end = periodEnd(m, `${year}-12`);
  if (end >= todayIso) problems.push(`The December ${year} budget month runs until ${end}. You can close ${year} from the day after.`);
  if (pendingChanges) problems.push(`${pendingChanges} change${pendingChanges === 1 ? '' : 's'} on this device have not reached OneDrive yet. Sync first, so the archive contains everything.`);
  // things that would be split oddly
  const tr = transferIndex(m);
  let crossYearPairs = 0;
  for (const [, both] of tr) if (both.length === 2 && yearOfMonth(txMonth(m, both[0])) !== yearOfMonth(txMonth(m, both[1]))) crossYearPairs++;
  if (crossYearPairs) notes.push(`${crossYearPairs} transfer${crossYearPairs === 1 ? '' : 's'} count for different years on each side. Each stays together with its outgoing side.`);
  const due = m.recurring.filter((r) => r.active && r.nextDate <= end);
  if (due.length) notes.push(`${due.length} bill${due.length === 1 ? '' : 's'} still show a due date in ${year} (${due.slice(0, 3).map((r) => r.name).join(', ')}${due.length > 3 ? '…' : ''}). They stay as they are; record or skip them in the open year.`);
  const unpaidYearly = m.yearlyItems.filter((y) => y.year === year && !y.paid);
  if (unpaidYearly.length) notes.push(`${unpaidYearly.length} yearly expense${unpaidYearly.length === 1 ? ' is' : 's are'} not marked paid. ${unpaidYearly.length === 1 ? 'It' : 'They'} move to the archive as they are.`);
  const keptEarly = m.transactions.filter((t) => t.date <= end && yearOfMonth(pairMonth(m, t, tr)) > year).length;
  if (keptEarly) notes.push(`${keptEarly} transaction${keptEarly === 1 ? '' : 's'} dated in ${year} count for ${year + 1} or later and stay in the live data.`);
  const archivedLate = m.transactions.filter((t) => t.date > end && yearOfMonth(pairMonth(m, t, tr)) === year).length;
  if (archivedLate) notes.push(`${archivedLate} transaction${archivedLate === 1 ? '' : 's'} dated after ${end} count for ${year} and move to the archive.`);
  return { ok: problems.length === 0, problems, notes };
}

export type Change = { table: TableName; put?: any; del?: string };

export interface ClosePlan {
  archive: Archive;
  summary: ClosedYear;
  changes: Change[]; // apply to the live data in one commit
}

/** Build the archive, the summary and the live changes for closing `year`. */
export function planClose(m: Model, year: number, by: string, storage: ClosedYear['storage']): ClosePlan {
  const at = nowIso();
  const first = `${year}-01`;
  const last = `${year}-12`;
  const inYear = (month: MonthKey) => yearOfMonth(month) === year;
  const tr = transferIndex(m);

  const txs = m.transactions.filter((t) => inYear(pairMonth(m, t, tr)));
  const lines = m.budgetLines.filter((b) => inYear(b.month));
  const plans = m.monthPlans.filter((p) => inYear(p.id));
  const yearly = m.yearlyItems.filter((y) => y.year === year);
  const funds = m.yearlyFunds.filter((f) => f.year === year);
  const yearEnd = periodEnd(m, last);
  const planned = m.planned.filter((p) => p.date <= yearEnd);
  const recs = m.reconciliations.filter((r) => r.statementDate <= yearEnd);

  // --- summary ---------------------------------------------------------------
  const moved: Record<ID, number> = {};
  for (const t of txs) moved[t.accountId] = (moved[t.accountId] ?? 0) + t.amount;

  const lineAgg = new Map<string, [MonthKey, ID, ID | null, number, 0 | 1]>();
  for (const t of txs) {
    const month = txMonth(m, t);
    const parts = t.splits?.length ? t.splits.map((s) => ({ categoryId: s.categoryId, amount: s.amount })) : [{ categoryId: t.categoryId, amount: t.amount }];
    const acc = m.accountById.get(t.accountId);
    for (const p of parts) {
      const isTr: 0 | 1 = t.transferId && !p.categoryId ? 1 : 0;
      const key = `${month}|${t.accountId}|${p.categoryId ?? ''}|${isTr}`;
      const e = lineAgg.get(key) ?? [month, t.accountId, p.categoryId, 0, isTr];
      e[3] += toBase(m, p.amount, acc?.currency ?? m.settings.baseCurrency, t.date);
      lineAgg.set(key, e);
    }
  }

  const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
  const budget: ClosedYear['budget'] = [];
  for (const month of months) {
    const mb = computeMonth(m, month);
    const per = new Map<ID, [number, number]>();
    for (const r of mb.lines) {
      const e = per.get(r.line.categoryId) ?? [0, 0];
      e[0] += r.available;
      e[1] += r.actual;
      per.set(r.line.categoryId, e);
    }
    for (const u of mb.unbudgeted) {
      const e = per.get(u.categoryId) ?? [0, 0];
      e[1] += u.actual;
      per.set(u.categoryId, e);
    }
    for (const [cat, [est, act]] of per) if (est || act) budget.push([month, cat, est, act]);
  }

  // month-end balances per account (by date, like the balance history report)
  const balances: ClosedYear['balances'] = [];
  for (const month of months) {
    const end = periodEnd(m, month);
    for (const a of m.accounts) {
      const opened = !a.openingDate || a.openingDate <= end;
      let b = opened ? a.openingBalance : 0;
      let any = opened;
      for (const t of m.transactions) {
        if (t.accountId !== a.id || t.date > end) continue;
        b += t.amount;
        any = true;
      }
      if (any) balances.push([month, a.id, b]);
    }
  }

  // rollover left at the end of the year, so January can still pick it up
  const carryOut: Record<ID, number> = {};
  const dec = computeMonth(m, last);
  for (const r of dec.lines) {
    if (r.line.week) continue;
    const mode = m.categoryById.get(r.line.categoryId)?.rollover ?? 'none';
    if (mode === 'none' || kindOf(m, r.line.categoryId) === 'income') continue;
    carryOut[r.line.categoryId] = (carryOut[r.line.categoryId] ?? 0) + (r.available - r.actual);
  }

  // --- live account changes ----------------------------------------------------
  const nextStart = periodStart(m, `${year + 1}-01`);
  const openingBefore: ClosedYear['openingBefore'] = {};
  const accountPuts: Account[] = [];
  const archivedIds = new Set(txs.map((t) => t.id));
  for (const a of m.accounts) {
    const mv = moved[a.id] ?? 0;
    if (!mv) continue;
    openingBefore[a.id] = { balance: a.openingBalance, date: a.openingDate };
    // the opening date moves to the first open day, or earlier when a kept transaction is dated before it
    let newDate = a.openingDate;
    if (!a.openingDate || a.openingDate < nextStart) {
      const keptFirst = m.transactions.filter((t) => t.accountId === a.id && !archivedIds.has(t.id)).map((t) => t.date).sort()[0];
      newDate = keptFirst && keptFirst < nextStart ? keptFirst : nextStart;
    }
    accountPuts.push({ ...a, openingBalance: a.openingBalance + mv, openingDate: newDate });
  }

  const importBatchIds = Array.from(new Set([...txs, ...lines, ...yearly].map((x: any) => x.importBatchId).filter(Boolean))) as ID[];

  const counts: Record<string, number> = {
    transactions: txs.length,
    budgetLines: lines.length,
    monthPlans: plans.length,
    yearlyItems: yearly.length,
    yearlyFunds: funds.length,
    planned: planned.length,
    reconciliations: recs.length
  };

  const summary: ClosedYear = {
    id: String(year),
    year,
    firstMonth: first,
    lastMonth: last,
    closedAt: at,
    closedBy: by,
    storage,
    fileName: `household-${year}.json`,
    counts,
    moved,
    openingBefore,
    lines: [...lineAgg.values()].filter((l) => l[3] !== 0),
    budget,
    balances,
    carryOut,
    lastMonthLines: m.budgetLines.filter((b) => b.month === last),
    importBatchIds,
    updatedAt: at
  };

  // --- the archive: the year's records plus copies of everything needed to read them ---
  const data = {} as Snapshot['data'];
  for (const t of TABLES) (data as any)[t] = [];
  data.transactions = txs;
  data.budgetLines = lines;
  // the next January's own start date decides where December ends, so it travels along as a copy
  data.monthPlans = [...plans, ...m.monthPlans.filter((p) => p.id === `${year + 1}-01`)];
  data.yearlyItems = yearly;
  data.yearlyFunds = funds;
  data.planned = planned;
  data.reconciliations = recs;
  data.accounts = m.accounts; // as they were before closing: opening balances include earlier closed years
  data.groups = m.groups;
  data.categories = m.categories;
  data.recurring = m.recurring;
  data.scenarios = m.scenarios;
  data.fxRates = m.fxRates;
  data.importBatches = m.importBatches.filter((b) => importBatchIds.includes(b.id));
  data.closedYears = m.closedYears; // earlier summaries, for comparisons inside the archive
  data.settings = [m.settings];

  const archive: Archive = { format: ARCHIVE_FORMAT, version: 1, year, createdAt: at, createdBy: by, data };

  const changes: Change[] = [
    ...txs.map((t) => ({ table: 'transactions' as const, del: t.id })),
    ...lines.map((b) => ({ table: 'budgetLines' as const, del: b.id })),
    ...plans.map((p) => ({ table: 'monthPlans' as const, del: p.id })),
    ...yearly.map((y) => ({ table: 'yearlyItems' as const, del: y.id })),
    ...funds.map((f) => ({ table: 'yearlyFunds' as const, del: f.id })),
    ...planned.map((p) => ({ table: 'planned' as const, del: p.id })),
    ...recs.map((r) => ({ table: 'reconciliations' as const, del: r.id })),
    ...accountPuts.map((a) => ({ table: 'accounts' as const, put: a })),
    { table: 'closedYears', put: summary }
  ];
  return { archive, summary, changes };
}

/** Check an archive file really is the one for this closed year before using it. */
export function validateArchive(a: unknown, year: number): Archive {
  const x = a as Archive;
  if (!x || x.format !== ARCHIVE_FORMAT || x.year !== year || !x.data) throw new Error(`This file is not the archive of ${year}.`);
  return x;
}

/** Changes that bring a closed year back into the live data. Only the most recently closed year can be reopened. */
export function planReopen(m: Model, archive: Archive): Change[] {
  const year = archive.year;
  const last = lastClosed(m);
  if (!last || last.year !== year) throw new Error(last ? `Only the most recently closed year (${last.year}) can be reopened.` : 'No year is closed.');
  const s = last;
  const out: Change[] = [];
  const live = (t: keyof Model, id: string) => (m[t] as any[]).some((x) => x.id === id);
  // records of the year
  for (const t of ['transactions', 'budgetLines', 'yearlyItems', 'yearlyFunds', 'planned', 'reconciliations'] as const)
    for (const r of (archive.data as any)[t] as any[]) out.push({ table: t, put: r });
  for (const p of archive.data.monthPlans) if (yearOfMonth(p.id) === year && !live('monthPlans', p.id)) out.push({ table: 'monthPlans', put: p });
  // things the year refers to that were removed from the live data since
  for (const t of ['accounts', 'groups', 'categories'] as const)
    for (const r of (archive.data as any)[t] as any[]) if (!live(t, r.id)) out.push({ table: t, put: r });
  // opening balances go back to what they were (keeping any edits made since)
  for (const a of m.accounts) {
    const mv = s.moved[a.id] ?? 0;
    const before = s.openingBefore[a.id];
    if (!mv && !before) continue;
    out.push({ table: 'accounts', put: { ...a, openingBalance: a.openingBalance - mv, openingDate: before?.date ?? a.openingDate } });
  }
  for (const a of archive.data.accounts) {
    if (live('accounts', a.id)) continue;
    const i = out.findIndex((c) => c.table === 'accounts' && c.put?.id === a.id);
    if (i >= 0) out[i] = { table: 'accounts', put: a };
  }
  out.push({ table: 'closedYears', del: s.id });
  return out;
}

// ---------------------------------------------------------------------------------
// Summaries used by the live app

/** Lines from closed years for reports: same shape as live lines, with a stand-in transaction. */
export function summaryLines(m: Model) {
  const out: Array<{ tx: Transaction; categoryId: ID | null; amount: number; date: string; month: MonthKey; week: number; closed: true }> = [];
  for (const c of m.closedYears)
    for (const [month, accountId, categoryId, amount, isTr] of c.lines) {
      const date = periodEnd(m, month);
      const tx: Transaction = {
        id: `closed:${c.year}:${month}:${accountId}:${categoryId ?? ''}:${isTr}`,
        accountId,
        date,
        amount,
        categoryId,
        transferId: isTr ? `closed:${c.year}` : undefined,
        payee: `Closed year ${c.year}`,
        status: 'reconciled',
        budgetMonth: month,
        createdAt: c.closedAt,
        updatedAt: c.closedAt
      };
      out.push({ tx, categoryId, amount, date, month, week: 0, closed: true });
    }
  return out;
}

/** Month-end native balances of a closed month, or null when the month is open. */
export function closedBalances(m: Model, month: MonthKey): Map<ID, number> | null {
  const c = closedSummary(m, month);
  if (!c) return null;
  const map = new Map<ID, number>();
  for (const [mm, acc, v] of c.balances) if (mm === month) map.set(acc, v);
  return map;
}

/** Rollover from the last closed month into the first open one. */
export function closedCarry(m: Model, prevMonth: MonthKey, categoryId: ID): number | null {
  const c = closedSummary(m, prevMonth);
  if (!c || c.lastMonth !== prevMonth) return c ? 0 : null;
  return c.carryOut[categoryId] ?? 0;
}

/** Budget lines of a closed month that can be copied (only the last closed month keeps them). */
export function closedMonthLines(m: Model, month: MonthKey): BudgetLine[] {
  const c = closedSummary(m, month);
  return c && c.lastMonth === month ? c.lastMonthLines : [];
}

/** Ops that would change a closed year: dropped when another device replays them after the close. */
export function opTouchesClosed(m: Model, op: { table: TableName; kind: 'put' | 'delete'; key: string; record?: any }): boolean {
  if (!m.closedYears.length) return false;
  const closed = new Set(m.closedYears.map((c) => c.year));
  const r = op.record;
  if (op.kind === 'put' && r) {
    if (op.table === 'transactions') return closed.has(yearOfMonth(r.budgetMonth || monthOfDate(m, r.date)));
    if (op.table === 'budgetLines') return closed.has(yearOfMonth(r.month));
    if (op.table === 'monthPlans') return closed.has(yearOfMonth(r.id));
    if (op.table === 'yearlyItems' || op.table === 'yearlyFunds') return closed.has(Number(r.year));
  }
  return false;
}

export { txBase, shiftMonth };
