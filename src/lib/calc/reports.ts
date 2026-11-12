import type { ID, MonthKey } from '../types';
import { balancesByAccount, isInternal, isReserve, isSpendable, kindOf, lines, toBase, type Model } from './model';
import { shiftMonth, sum } from '../util';
import { periodEnd } from './period';

export interface CashFlowRow {
  month: MonthKey;
  income: number;
  spending: number;
  net: number;
  reserved: number; // moved into reserve funds (reservation categories)
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
  return lines(m).filter((l) => l.month >= f.from && l.month <= f.to && (!set || set.has(l.tx.accountId)));
}

export function cashFlow(m: Model, f: ReportFilter): CashFlowRow[] {
  const ls = filtered(m, f);
  return monthsBetween(f.from, f.to).map((month) => {
    const ms = ls.filter((l) => l.month === month);
    let income = 0,
      spending = 0,
      reserved = 0;
    for (const l of ms) {
      const k = kindOf(m, l.categoryId);
      if (k === 'reservation') {
        if (l.amount < 0) reserved += -l.amount;
        continue;
      }
      if (isInternal(m, l)) continue;
      if (k === 'income') income += l.amount;
      else if (k === 'expense') spending += -l.amount;
      else if (!l.categoryId) {
        if (l.amount > 0) income += l.amount;
        else spending += -l.amount;
      }
    }
    return { month, income, spending, net: income - spending, reserved };
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
    const bal = balancesByAccount(m, end);
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
