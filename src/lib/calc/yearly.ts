import type { YearlyItem, Transaction } from '../types';
import { accountBalance, lines, toBase, type Model, type Line } from './model';
import { currentMonth, sum } from '../util';

export interface YearlyRow {
  item: YearlyItem;
  /** transactions in the item's category in this year */
  linked: Line[];
  /** where the actual comes from */
  source: 'transactions' | 'entered' | 'none';
  actual: number;
  remainder: number;
  status: 'paid' | 'overdue' | 'due-soon' | 'planned';
}

/** Mirrors the "Budget Yearly Expenses" sheet: account + contributions still to come − remaining costs. */
export function yearlyPlan(m: Model, year: number, todayIso: string) {
  const items = m.yearlyItems.filter((y) => y.year === year).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const fund = m.yearlyFunds.find((f) => f.year === year);
  const ls = lines(m).filter((l) => l.month.startsWith(String(year)));
  const rows: YearlyRow[] = items.map((item) => {
    // linked transactions win; the amount typed in (e.g. from the workbook) is the fallback
    const linked = item.categoryId ? ls.filter((l) => l.categoryId === item.categoryId) : [];
    const source: YearlyRow['source'] = linked.length ? 'transactions' : item.actualOverride != null ? 'entered' : 'none';
    const actual = linked.length ? -sum(linked.map((l) => l.amount)) : item.actualOverride ?? 0;
    const remainder = item.paid ? 0 : Math.max(0, item.estimated - actual);
    const soon = new Date(todayIso);
    soon.setDate(soon.getDate() + 30);
    const status: YearlyRow['status'] = item.paid
      ? 'paid'
      : item.dueDate < todayIso
        ? 'overdue'
        : item.dueDate <= soon.toISOString().slice(0, 10)
          ? 'due-soon'
          : 'planned';
    return { item, linked, source, actual, remainder, status };
  });
  const acc = fund?.accountId ? m.accountById.get(fund.accountId) : undefined;
  const fundBalance = acc ? toBase(m, accountBalance(m, acc.id), acc.currency, todayIso) : 0;
  const cm = currentMonth();
  const monthsLeft = cm.startsWith(String(year)) ? 12 - Number(cm.slice(5, 7)) : cm < `${year}-01` ? 12 : 0;
  const contributions = (fund?.monthlyContribution ?? 0) * monthsLeft;
  const totalRemaining = sum(rows.map((r) => r.remainder));
  return {
    rows,
    fund,
    account: acc,
    fundBalance,
    monthsLeft,
    contributions,
    totalEstimated: sum(rows.map((r) => r.item.estimated)),
    totalRemaining,
    balance: fundBalance + contributions - totalRemaining
  };
}

const words = (s: string) => s.toLowerCase().split(/[^a-z0-9ăâîșțşţ]+/).filter((w) => w.length >= 3);

/**
 * Transactions that could belong to a yearly item: money out in the item's year, not yet in its
 * category, paid from the yearly fund, booked as "Yearly expenses (paid)", or naming the item.
 */
export function yearlyCandidates(m: Model, item: YearlyItem, fundAccountId: string | null | undefined): Transaction[] {
  const paidCat = m.categories.find((c) => c.code === 'DIV001')?.id;
  const ws = words(item.name);
  return m.transactions
    .filter((t) => {
      if (t.amount >= 0 || (t.transferId && !t.categoryId)) return false;
      if (!t.date.startsWith(String(item.year))) return false;
      if (item.categoryId && t.categoryId === item.categoryId) return false;
      if (t.splits?.length) return false;
      const text = `${t.payee ?? ''} ${t.memo ?? ''}`.toLowerCase();
      const named = ws.some((w) => text.includes(w));
      const fromFund = fundAccountId ? t.accountId === fundAccountId : false;
      const paidYearly = paidCat ? t.categoryId === paidCat : false;
      return named || fromFund || paidYearly;
    })
    .sort((a, b) => {
      // name matches and dates close to the due date first
      // 1) from the fund or booked as yearly expense, 2) naming the item, 3) closest to the due date
      const named = (t: Transaction) => words(`${t.payee ?? ''} ${t.memo ?? ''}`).some((w) => ws.includes(w));
      const reserve = (t: Transaction) => (fundAccountId && t.accountId === fundAccountId) || (paidCat && t.categoryId === paidCat);
      const score = (t: Transaction) => (reserve(t) ? 0 : 2e12) + (named(t) ? 0 : 1e12) + Math.abs(Date.parse(t.date) - Date.parse(item.dueDate));
      return score(a) - score(b);
    });
}
