import type { YearlyItem } from '../types';
import { accountBalance, lines, toBase, type Model } from './model';
import { currentMonth, sum } from '../util';

export interface YearlyRow {
  item: YearlyItem;
  actual: number;
  remainder: number;
  status: 'paid' | 'overdue' | 'due-soon' | 'planned';
}

/** Mirrors the "Budget Yearly Expenses" sheet: account + contributions still to come − remaining costs. */
export function yearlyPlan(m: Model, year: number, todayIso: string) {
  const items = m.yearlyItems.filter((y) => y.year === year).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const fund = m.yearlyFunds.find((f) => f.year === year);
  const ls = lines(m).filter((l) => l.date.startsWith(String(year)));
  const rows: YearlyRow[] = items.map((item) => {
    const actual =
      item.actualOverride ??
      (item.categoryId ? -sum(ls.filter((l) => l.categoryId === item.categoryId).map((l) => l.amount)) : 0);
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
    return { item, actual, remainder, status };
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
