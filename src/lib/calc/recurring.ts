import type { ISODate, Recurring, Transaction } from '../types';
import { addDays, addMonths, nowIso, uid, shiftMonth, daysBetween } from '../util';
import { monthOfDate, periodEnd, periodStart, txMonth } from './period';
import type { Model } from './model';

export function nextOccurrence(r: Recurring, from: ISODate): ISODate {
  const n = Math.max(1, r.interval || 1);
  switch (r.frequency) {
    case 'weekly':
      return addDays(from, 7 * n);
    case 'monthly':
      return addMonths(from, n);
    case 'quarterly':
      return addMonths(from, 3 * n);
    case 'yearly':
      return addMonths(from, 12 * n);
  }
}

/** All occurrence dates between from and to (inclusive), starting at nextDate. */
export function occurrences(r: Recurring, from: ISODate, to: ISODate, limit = 400): ISODate[] {
  const out: ISODate[] = [];
  if (!r.active) return out;
  let d = r.nextDate;
  let i = 0;
  while (d <= to && i++ < limit) {
    if (r.endDate && d > r.endDate) break;
    if (d >= from) out.push(d);
    d = nextOccurrence(r, d);
  }
  return out;
}

export function signedAmount(r: Recurring) {
  return r.kind === 'income' ? Math.abs(r.amount) : -Math.abs(r.amount);
}

export interface Upcoming {
  rec: Recurring;
  date: ISODate;
  amount: number; // signed, account currency
  overdue: boolean;
}

export function upcoming(m: Model, from: ISODate, to: ISODate, includeOverdue = true): Upcoming[] {
  const out: Upcoming[] = [];
  for (const r of m.recurring) {
    if (!r.active || r.scenarioId) continue;
    if (includeOverdue && r.nextDate < from) out.push({ rec: r, date: r.nextDate, amount: signedAmount(r), overdue: true });
    for (const d of occurrences(r, from, to)) out.push({ rec: r, date: d, amount: signedAmount(r), overdue: false });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.rec.name.localeCompare(b.rec.name));
}

/** Transactions to record when a recurring item is paid, plus the advanced schedule. */
export function postRecurring(r: Recurring, date: ISODate, amountOverride?: number): { txs: Transaction[]; rec: Recurring } {
  const now = nowIso();
  const amt = amountOverride ?? Math.abs(r.amount);
  const txs: Transaction[] = [];
  if (r.kind === 'transfer' && r.toAccountId) {
    const transferId = uid();
    txs.push(
      { id: uid(), accountId: r.accountId, date, amount: -amt, payee: r.payee || r.name, memo: r.name, categoryId: r.categoryId, transferId, transferAccountId: r.toAccountId, status: 'uncleared', createdAt: now, updatedAt: now },
      { id: uid(), accountId: r.toAccountId, date, amount: amt, payee: r.payee || r.name, memo: r.name, categoryId: null, transferId, transferAccountId: r.accountId, status: 'uncleared', createdAt: now, updatedAt: now }
    );
  } else {
    txs.push({
      id: uid(),
      accountId: r.accountId,
      date,
      amount: r.kind === 'income' ? amt : -amt,
      payee: r.payee || r.name,
      memo: r.name,
      categoryId: r.categoryId,
      status: 'uncleared',
      createdAt: now,
      updatedAt: now
    });
  }
  return { txs, rec: { ...r, nextDate: nextOccurrence(r, r.nextDate) } };
}

export function monthlyEquivalent(r: Recurring): number {
  const a = Math.abs(r.amount);
  const n = Math.max(1, r.interval || 1);
  switch (r.frequency) {
    case 'weekly':
      return Math.round((a * 52) / 12 / n);
    case 'monthly':
      return Math.round(a / n);
    case 'quarterly':
      return Math.round(a / 3 / n);
    case 'yearly':
      return Math.round(a / 12 / n);
  }
}

/** Prefilled transaction for paying/receiving a recurring item; the user can adjust it before saving. */
export function draftFor(r: Recurring, todayIso: ISODate) {
  return {
    recurringId: r.id, billDue: r.nextDate,
    kind: (r.kind === 'income' ? 'income' : r.kind === 'transfer' ? 'transfer' : 'expense') as 'income' | 'expense' | 'transfer',
    accountId: r.accountId,
    toAccountId: r.toAccountId,
    date: r.nextDate < todayIso ? todayIso : r.nextDate,
    amount: Math.abs(r.amount),
    categoryId: r.categoryId,
    payee: r.payee || r.name,
    memo: r.name
  };
}

const normName = (s: string | undefined) => (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

export function isRecurringActive(r: Recurring, todayIso: ISODate) {
  return r.active && (!r.endDate || r.endDate >= todayIso);
}

/**
 * Past transactions of a bill or income: ones recorded from it, plus any with the same
 * payee (or the item's name when no payee is set). For transfers only the outgoing side.
 */
export function historyFor(txs: Transaction[], r: Recurring): Transaction[] {
  const key = normName(r.payee || r.name);
  return txs
    .filter((t) => {
      if (t.recurringId === r.id) return true;
      if (!key || normName(t.payee) !== key) return false;
      if (t.transferId && t.amount > 0) return false;
      return true;
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}

/** The k-th date of the schedule counted from the next date (k < 0 = earlier ones), without drifting. */
function nthDate(r: Recurring, k: number): ISODate {
  const n = Math.max(1, r.interval || 1);
  switch (r.frequency) {
    case 'weekly':
      return addDays(r.nextDate, 7 * n * k);
    case 'monthly':
      return addMonths(r.nextDate, n * k);
    case 'quarterly':
      return addMonths(r.nextDate, 3 * n * k);
    case 'yearly':
      return addMonths(r.nextDate, 12 * n * k);
  }
}

/** Half the time between two bills, in days: how far a payment can be from its bill date. */
function halfInterval(r: Recurring): number {
  const n = Math.max(1, r.interval || 1);
  const days = { weekly: 7, monthly: 30, quarterly: 91, yearly: 365 }[r.frequency] * n;
  return Math.floor(days / 2);
}

/** Schedule dates between from and to, including ones before the next date (not before the start date). */
export function scheduleIn(r: Recurring, from: ISODate, to: ISODate): ISODate[] {
  const out: ISODate[] = [];
  let k = 0;
  while (k > -600 && nthDate(r, k) > from) k--;
  for (let i = 0; i < 800; i++, k++) {
    const d = nthDate(r, k);
    if (d > to) break;
    if (r.endDate && d > r.endDate) break;
    if (d >= from && (!r.startDate || d >= r.startDate)) out.push(d);
  }
  return out;
}

/**
 * The budget month a scheduled date is for. A bill comes once per month: the one dated in
 * November is November's bill, even when budget months start a few days off the calendar.
 * Weekly items follow the budget month the date falls in.
 */
export const budgetMonthOf = (m: Model, r: Recurring, d: ISODate) => {
  const base = r.frequency === 'weekly' ? monthOfDate(m, d) : d.slice(0, 7);
  return r.countsFor === 'next' ? shiftMonth(base, 1) : base;
};

export interface BillInPeriod {
  rec: Recurring;
  /** When it is due in this period (the first date, as a bill is paid once per period). */
  due: ISODate | null;
  /** The budget month that date counts for. */
  month: string | null;
  /** The payment booked for it in this period, if any. */
  paid: Transaction | null;
}

/**
 * Bills, subscriptions and income on a category that fall in one budget month (or, with a
 * year, anywhere in that year), each paid at most once per period.
 */
export function billsInPeriod(m: Model, categoryId: string, period: { month: string } | { year: number }): BillInPeriod[] {
  const inPeriod = (mk: string) => ('month' in period ? mk === period.month : mk.startsWith(`${period.year}-`));
  const first = 'month' in period ? period.month : `${period.year}-01`;
  const last = 'month' in period ? period.month : `${period.year}-12`;
  // wide enough that a payment made early or late still finds the date it was for
  const from = periodStart(m, shiftMonth(first, -2));
  const to = periodEnd(m, shiftMonth(last, 2));
  const out: BillInPeriod[] = [];
  for (const r of m.recurring) {
    if (r.categoryId !== categoryId || r.scenarioId || r.kind === 'transfer') continue;
    const dates = scheduleIn({ ...r, active: true }, from, to);
    // each payment belongs to the bill date nearest to it, if that is close enough (half the
    // time between two bills); a payment far from any bill date, or long before the bill
    // started, is not counted as paying it
    const reach = halfInterval(r);
    const forMonth = (t: Transaction): string | null => {
      if (t.recurringId === r.id && t.billDue) return budgetMonthOf(m, r, t.billDue);
      if (r.startDate && t.date < addDays(r.startDate, -reach)) return null;
      let best: ISODate | null = null;
      for (const d of dates) if (!best || Math.abs(daysBetween(d, t.date)) < Math.abs(daysBetween(best, t.date))) best = d;
      return best && Math.abs(daysBetween(best, t.date)) <= reach ? budgetMonthOf(m, r, best) : null;
    };
    const paid = historyFor(m.transactions, r).filter((t) => (t.billDue ?? t.date) >= from && (t.billDue ?? t.date) <= to && inPeriod(forMonth(t) ?? '')).sort((a, b) => a.date.localeCompare(b.date))[0] ?? null;
    const due = r.active ? (dates.find((d) => inPeriod(budgetMonthOf(m, r, d))) ?? null) : null;
    if (!paid && !due) continue;
    out.push({ rec: r, due, month: due ? budgetMonthOf(m, r, due) : paid ? forMonth(paid) : null, paid });
  }
  return out.sort((a, b) => (a.due ?? a.paid?.date ?? '').localeCompare(b.due ?? b.paid?.date ?? '') || a.rec.name.localeCompare(b.rec.name));
}
