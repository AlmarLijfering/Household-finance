import type { ISODate, Recurring, Transaction } from '../types';
import { addDays, addMonths, nowIso, uid } from '../util';
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
    recurringId: r.id,
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
