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
  /** All items on this line: more than one when they share a category. */
  items: YearlyItem[];
  estimated: number; // of all items on the line
  paid: boolean; // all items on the line paid
}

/** Mirrors the "Budget Yearly Expenses" sheet: account + contributions still to come − remaining costs. */
export function yearlyPlan(m: Model, year: number, todayIso: string) {
  const items = m.yearlyItems.filter((y) => y.year === year).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const fund = m.yearlyFunds.find((f) => f.year === year);
  const ls = lines(m).filter((l) => l.month.startsWith(String(year)));
  // The category is what counts: its transactions this year are the actual. Items that share a
  // category are shown as one line, so the same money is never counted twice.
  const groups: YearlyItem[][] = [];
  for (const item of items) {
    const g = item.categoryId ? groups.find((x) => x[0].categoryId === item.categoryId) : undefined;
    if (g) g.push(item);
    else groups.push([item]);
  }
  const rows: YearlyRow[] = groups.map((group) => {
    const item = group[0];
    const linked = item.categoryId ? ls.filter((l) => l.categoryId === item.categoryId) : [];
    const typed = group.some((g) => g.actualOverride != null) ? sum(group.map((g) => g.actualOverride ?? 0)) : null;
    const source: YearlyRow['source'] = linked.length ? 'transactions' : typed != null ? 'entered' : 'none';
    const actual = linked.length ? -sum(linked.map((l) => l.amount)) : typed ?? 0;
    const estimated = sum(group.map((g) => g.estimated));
    const paid = group.every((g) => g.paid);
    const remainder = paid ? 0 : Math.max(0, estimated - actual);
    const soon = new Date(todayIso);
    soon.setDate(soon.getDate() + 30);
    const status: YearlyRow['status'] = paid
      ? 'paid'
      : item.dueDate < todayIso
        ? 'overdue'
        : item.dueDate <= soon.toISOString().slice(0, 10)
          ? 'due-soon'
          : 'planned';
    return { item, items: group, estimated, paid, linked, source, actual, remainder, status };
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
    totalEstimated: sum(rows.map((r) => r.estimated)),
    totalRemaining,
    balance: fundBalance + contributions - totalRemaining
  };
}

const words = (s: string) => s.toLowerCase().split(/[^a-z0-9ăâîșțşţ]+/).filter((w) => w.length >= 3);

/**
 * Transactions that could belong to a yearly item: money out in the item's year, not yet in its
 * category, paid from the yearly fund, booked as "Yearly expenses (paid)", or naming the item.
 */
/**
 * Transactions that may belong to a yearly item. Only ones without a real category are offered:
 * uncategorised, or still on the general "Yearly expenses (paid)" category waiting to be assigned.
 * Anything with another category is fixed on the Transactions page instead.
 */
export function yearlyCandidates(m: Model, item: YearlyItem, fundAccountId: string | null | undefined, opts: { includeCategorised?: boolean } = {}): Transaction[] {
  const paidCat = m.categories.find((c) => c.code === 'DIV001')?.id;
  const ws = words(item.name);
  return m.transactions
    .filter((t) => {
      if (t.amount >= 0 || (t.transferId && !t.categoryId)) return false;
      if (!opts.includeCategorised && t.categoryId && t.categoryId !== paidCat) return false;
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
