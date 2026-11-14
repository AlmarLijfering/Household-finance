import { closedBalances, summaryLines } from './yearclose';
import type { ID, MonthKey } from '../types';
import { balancesByAccount, flowKind, isInternal, isReserve, isSpendable, kindOf, lines, toBase, type Model } from './model';
import { shiftMonth, sum } from '../util';
import { periodEnd } from './period';

export interface CashFlowRow {
  month: MonthKey;
  income: number;
  reserved: number; // set aside in reservations and savings
  spending: number; // costs, not counting those paid from reserves
  fromReserves: number; // costs paid from money set aside earlier (already counted in reserved)
  net: number; // what is left: income − reserved − spending
}

export function monthsBetween(from: MonthKey, to: MonthKey): MonthKey[] {
  const out: MonthKey[] = [];
  for (let m = from; m <= to && out.length < 240; m = shiftMonth(m, 1)) out.push(m);
  return out;
}

export interface ReportFilter {
  from: MonthKey;
  to: MonthKey;
  accountIds?: ID[]; // empty/undefined = all
}

function filtered(m: Model, f: ReportFilter) {
  const set = f.accountIds && f.accountIds.length ? new Set(f.accountIds) : null;
  // closed years take part through their monthly totals
  const all = m.closedYears.length ? [...summaryLines(m), ...lines(m)] : lines(m);
  return all.filter((l) => l.month >= f.from && l.month <= f.to && (!set || set.has(l.tx.accountId)));
}

export function cashFlow(m: Model, f: ReportFilter): CashFlowRow[] {
  const ls = filtered(m, f);
  return monthsBetween(f.from, f.to).map((month) => {
    const r: CashFlowRow = { month, income: 0, reserved: 0, spending: 0, fromReserves: 0, net: 0 };
    for (const l of ls) {
      if (l.month !== month) continue;
      const k = flowKind(m, l);
      if (k === 'income') r.income += l.amount;
      else if (k === 'reserved') r.reserved -= l.amount;
      else if (k === 'spending') r.spending -= l.amount;
      else if (k === 'fromReserves') r.fromReserves -= l.amount;
    }
    r.net = r.income - r.reserved - r.spending;
    return r;
  });
}

export function spendingByCategory(m: Model, f: ReportFilter) {
  const ls = filtered(m, f);
  const months = monthsBetween(f.from, f.to);
  const map = new Map<ID | 'none', number[]>();
  for (const l of ls) {
    const k = kindOf(m, l.categoryId);
    if (k !== 'expense' && !(l.categoryId == null && !l.tx.transferId)) continue;
    const i = months.indexOf(l.month);
    if (i < 0) continue;
    const key = l.categoryId ?? 'none';
    const arr = map.get(key) ?? Array(months.length).fill(0);
    arr[i] += -l.amount;
    map.set(key, arr);
  }
  return { months, rows: [...map.entries()].map(([categoryId, values]) => ({ categoryId, values, total: sum(values) })).sort((a, b) => b.total - a.total) };
}

export function incomeByCategory(m: Model, f: ReportFilter) {
  const ls = filtered(m, f);
  const months = monthsBetween(f.from, f.to);
  const map = new Map<ID, number[]>();
  for (const l of ls) {
    if (kindOf(m, l.categoryId) !== 'income') continue;
    const i = months.indexOf(l.month);
    const arr = map.get(l.categoryId!) ?? Array(months.length).fill(0);
    arr[i] += l.amount;
    map.set(l.categoryId!, arr);
  }
  return { months, rows: [...map.entries()].map(([categoryId, values]) => ({ categoryId, values, total: sum(values) })).sort((a, b) => b.total - a.total) };
}

/** Month-end balance per account (base currency) and totals for spendable vs reserves. */
export function balanceHistory(m: Model, f: ReportFilter) {
  const months = monthsBetween(f.from, f.to);
  return months.map((month) => {
    const end = periodEnd(m, month);
    const bal = closedBalances(m, month) ?? balancesByAccount(m, end);
    const perAccount: Record<ID, number> = {};
    let spendable = 0,
      reserves = 0;
    for (const a of m.accounts) {
      if (a.archived) continue;
      const v = toBase(m, bal.get(a.id) ?? 0, a.currency, end);
      perAccount[a.id] = v;
      if (isSpendable(a)) spendable += v;
      if (isReserve(a)) reserves += v;
    }
    return { month, perAccount, spendable, reserves, total: spendable + reserves };
  });
}

// ---------------------------------------------------------------------------------
// Income & spending: income stacked by source, everything that went out as one figure

export const OTHER_INCOME = 'other';
/** Income sources in the order they are stacked (bottom first): your order, then the rest by size. */
export function incomeSources(m: Model, f: ReportFilter): string[] {
  const totals = new Map<string, number>();
  for (const l of filtered(m, f)) {
    if (flowKind(m, l) !== 'income') continue;
    const key = l.categoryId && kindOf(m, l.categoryId) === 'income' ? l.categoryId : OTHER_INCOME;
    totals.set(key, (totals.get(key) ?? 0) + l.amount);
  }
  const order = m.settings.incomeReport?.order ?? [];
  const known = order.filter((k) => totals.has(k));
  const rest = [...totals.keys()].filter((k) => !order.includes(k)).sort((a, b) => (totals.get(b) ?? 0) - (totals.get(a) ?? 0));
  return [...known, ...rest];
}

export interface IncomeOutRow {
  month: MonthKey;
  income: number;
  out: number; // spending + reservations & savings
  spending: number;
  reserved: number;
  left: number;
  [source: string]: number | string;
}
export function incomeOut(m: Model, f: ReportFilter): { rows: IncomeOutRow[]; sources: string[] } {
  const sources = incomeSources(m, f);
  const cf = cashFlow(m, f);
  const ls = filtered(m, f);
  const rows = cf.map((c) => {
    const r: IncomeOutRow = { month: c.month, income: c.income, out: c.spending + c.reserved, spending: c.spending, reserved: c.reserved, left: c.net };
    for (const s of sources) r[s] = 0;
    return r;
  });
  const byMonth = new Map(rows.map((r) => [r.month, r]));
  for (const l of ls) {
    if (flowKind(m, l) !== 'income') continue;
    const r = byMonth.get(l.month);
    if (!r) continue;
    const key = l.categoryId && kindOf(m, l.categoryId) === 'income' ? l.categoryId : OTHER_INCOME;
    r[key] = (r[key] as number) + l.amount;
  }
  return { rows, sources };
}

// ---------------------------------------------------------------------------------
// Category groups: a few categories taken together, over time, with their average

export function groupSeries(m: Model, f: ReportFilter, categoryIds: string[]) {
  const set = new Set(categoryIds);
  const months = monthsBetween(f.from, f.to);
  // income groups count money in; anything else counts money out
  const incomeOnly = categoryIds.length > 0 && categoryIds.every((id) => kindOf(m, id) === 'income');
  const sign = incomeOnly ? 1 : -1;
  const perCat = new Map<string, number[]>();
  for (const l of filtered(m, f)) {
    if (!l.categoryId || !set.has(l.categoryId)) continue;
    if (flowKind(m, l) === 'internal') continue; // the receiving side of a transfer is not counted twice
    const i = months.indexOf(l.month);
    if (i < 0) continue;
    const arr = perCat.get(l.categoryId) ?? Array(months.length).fill(0);
    arr[i] += sign * l.amount;
    perCat.set(l.categoryId, arr);
  }
  const values = months.map((_, i) => sum([...perCat.values()].map((a) => a[i])));
  // months without any booking are left out of the average
  const filled = months.filter((_, i) => [...perCat.values()].some((a) => a[i] !== 0)).length;
  const avg = filled ? Math.round(sum(values) / filled) : 0;
  return {
    months,
    values,
    avg,
    filled,
    total: sum(values),
    incomeOnly,
    perCategory: categoryIds.map((id) => ({ categoryId: id, values: perCat.get(id) ?? Array(months.length).fill(0) }))
  };
}
