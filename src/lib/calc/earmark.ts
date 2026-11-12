// Spot transactions that should probably count for the next budget month but do not
// (e.g. a salary advance received on the 25th that was left in the current month).
import type { ID, MonthKey, Transaction } from '../types';
import { currentBudgetMonth, monthOfDate, periodEnd } from './period';
import { daysBetween, shiftMonth } from '../util';
import type { Model } from './model';

const norm = (s: string | undefined) => (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const LATE_DAYS = 10; // only the last days of a budget month are candidates

export interface EarmarkHint {
  suggested: MonthKey;
  reason: string;
}

export function earmarkHints(m: Model): Map<ID, EarmarkHint> {
  const out = new Map<ID, EarmarkHint>();
  // recurring items that are meant for the next month
  const nextRecs = m.recurring.filter((r) => r.countsFor === 'next');
  const recKeys = new Map(nextRecs.map((r) => [norm(r.payee || r.name), r]));
  // payee + category combinations you moved forward before
  const moved = new Map<string, number>();
  for (const t of m.transactions) {
    if (t.budgetMonth && t.budgetMonth > monthOfDate(m, t.date)) {
      const k = `${norm(t.payee)}|${t.categoryId ?? ''}`;
      moved.set(k, (moved.get(k) ?? 0) + 1);
    }
  }
  const oldest = shiftMonth(currentBudgetMonth(m), -1); // only recent months, not old history
  for (const t of m.transactions) {
    if (t.budgetMonth || t.monthConfirmed || (t.transferId && t.amount > 0)) continue;
    const month = monthOfDate(m, t.date);
    if (month < oldest) continue;
    if (daysBetween(t.date, periodEnd(m, month)) >= LATE_DAYS) continue;
    const rec = (t.recurringId && nextRecs.find((r) => r.id === t.recurringId)) || recKeys.get(norm(t.payee));
    const learned = (moved.get(`${norm(t.payee)}|${t.categoryId ?? ''}`) ?? 0) >= 2;
    if (!rec && !learned) continue;
    out.set(t.id, {
      suggested: shiftMonth(month, 1),
      reason: rec ? `${rec.name} counts for the next budget month` : `Earlier ${t.payee} payments were counted for the next month`
    });
  }
  return out;
}

export function isFlagged(hints: Map<ID, EarmarkHint>, t: Transaction) {
  return hints.has(t.id);
}
