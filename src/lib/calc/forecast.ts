import type { ID, MonthKey, Scenario } from '../types';
import { computeMonth } from './budget';
import { isReserve, isSpendable, kindOf, toBase, monthBalance, categoryActiveOn, type Model } from './model';
import { occurrences, signedAmount } from './recurring';
import { shiftMonth, sum, today } from '../util';
import { currentBudgetMonth, monthOfDate, periodEnd, periodStart } from './period';

export interface ForecastPoint {
  month: MonthKey;
  balance: number;
  income: number;
  costs: number;
  planned: number;
}
export interface ForecastSeries {
  scenarioId: ID | null;
  name: string;
  color: string;
  points: ForecastPoint[];
}

export interface ForecastOptions {
  months: number;
  scope: 'spendable' | 'all'; // current+cash only, or every account incl. reserves
}

/**
 * Month-by-month projected balance.
 * - Months with budget lines use their remaining estimates; later months repeat the
 *   most recent budget as a template.
 * - Recurring items are added only when their category is not already budgeted, so a
 *   rent bill and a rent budget line are never counted twice.
 * - Reservations move money into reserve accounts: they reduce spendable money but are
 *   neutral for the all-accounts total. Yearly-fund items are paid from reserves on
 *   their due date.
 */
export function forecast(m: Model, opts: ForecastOptions, scenario: Scenario | null): ForecastSeries {
  const start = currentBudgetMonth(m);
  // money booked for later months (e.g. an advance meant for next month) is counted in that month, not in the start
  const startBal = monthBalance(m, opts.scope === 'spendable' ? isSpendable : (a) => isSpendable(a) || isReserve(a), start);
  const budgetMonths = Array.from(new Set(m.budgetLines.map((b) => b.month))).sort();
  const incomeF = 1 + (scenario?.incomeChangePct ?? 0) / 100;
  const spendF = 1 + (scenario?.spendChangePct ?? 0) / 100;
  const inScope = (accountId: ID) => {
    const a = m.accountById.get(accountId);
    if (!a) return false;
    return opts.scope === 'spendable' ? isSpendable(a) : isSpendable(a) || isReserve(a);
  };

  let bal = startBal;
  const points: ForecastPoint[] = [];
  for (let i = 0; i < opts.months; i++) {
    const month = shiftMonth(start, i);
    const template = budgetMonths.includes(month) ? month : [...budgetMonths].reverse().find((x) => x <= month) ?? budgetMonths[budgetMonths.length - 1];
    let income = 0,
      costs = 0,
      planned = 0;
    const budgeted = new Set<ID>();
    if (template) {
      const mb = computeMonth(m, template);
      for (const r of mb.lines) {
        // a repeated template month must not bring back a category that has ended by now
        if (!categoryActiveOn(m.categoryById.get(r.line.categoryId), periodStart(m, month))) continue;
        budgeted.add(r.line.categoryId);
        const amount = i === 0 && template === month ? r.remaining : r.line.closed && template === month ? 0 : r.available;
        if (r.kind === 'income') income += amount;
        else if (r.kind === 'reservation') {
          if (opts.scope === 'spendable') costs += amount;
        } else costs += amount;
      }
    }
    // Recurring items not covered by the budget
    const from = i === 0 ? today() : periodStart(m, month);
    for (const rec of m.recurring) {
      if (!rec.active) continue;
      if (rec.scenarioId && rec.scenarioId !== scenario?.id) continue;
      if (rec.categoryId && budgeted.has(rec.categoryId) && !rec.scenarioId) continue;
      const occ = occurrences(rec, from, periodEnd(m, month));
      if (!occ.length) continue;
      const acc = m.accountById.get(rec.accountId);
      for (const d of occ) {
        const v = toBase(m, signedAmount(rec), acc?.currency ?? 'RON', d);
        if (rec.kind === 'transfer') {
          const fromIn = inScope(rec.accountId);
          const toIn = rec.toAccountId ? inScope(rec.toAccountId) : false;
          if (fromIn && !toIn) costs += -v;
          if (!fromIn && toIn) income += -v;
        } else if (inScope(rec.accountId)) {
          if (v > 0) income += v;
          else costs += -v;
        }
      }
    }
    // Planned entries (imported future plans, one-off scenario items)
    for (const p of m.planned) {
      if (monthOfDate(m, p.date) !== month) continue;
      if (i === 0 && p.date < today()) continue;
      if (p.scenarioId && p.scenarioId !== scenario?.id) continue;
      if (!inScope(p.accountId)) continue;
      if (p.categoryId && budgeted.has(p.categoryId) && !p.scenarioId) continue;
      const acc = m.accountById.get(p.accountId);
      planned += toBase(m, p.amount, acc?.currency ?? 'RON', p.date);
    }
    // Yearly-fund items due this month are paid out of reserves
    if (opts.scope === 'all') {
      for (const y of m.yearlyItems) {
        if (y.paid || monthOfDate(m, y.dueDate) !== month) continue;
        if (i === 0 && y.dueDate < today()) continue;
        if (y.categoryId && budgeted.has(y.categoryId)) continue;
        costs += Math.max(0, y.estimated - (y.actualOverride ?? 0));
      }
    }
    income = Math.round(income * incomeF);
    costs = Math.round(costs * spendF);
    bal += income - costs + planned;
    points.push({ month, balance: bal, income, costs, planned });
  }
  return { scenarioId: scenario?.id ?? null, name: scenario?.name ?? 'Base plan', color: scenario?.color ?? '#2D8A5F', points };
}

export function lowestPoint(s: ForecastSeries) {
  return s.points.reduce((a, b) => (b.balance < a.balance ? b : a), s.points[0]);
}

export function _debugKinds(m: Model) {
  return sum(m.transactions.map((t) => (kindOf(m, t.categoryId) ? 1 : 0)));
}
