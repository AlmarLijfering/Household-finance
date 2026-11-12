import type { BudgetLine, GroupKind, ID, MonthKey } from '../types';
import { lines, kindOf, isSpendable, monthBalance, bookedInMonth, isEverydayCategory, categoryActiveOn, type Model, type Line } from './model';
import { shiftMonth, sum } from '../util';
import { currentBudgetMonth, periodStart } from './period';

export interface LineResult {
  line: BudgetLine;
  kind: GroupKind;
  actual: number; // positive = money received (income) or money spent (costs)
  carryIn: number; // rollover from previous month (can be negative)
  available: number; // estimate + carryIn
  remaining: number; // what is still expected to come in / go out this month
  over: number; // amount above the estimate
}

export interface GroupResult {
  code: string;
  name: string;
  kind: GroupKind;
  baseline: number;
  estimate: number;
  actual: number;
  remaining: number;
}

export interface MonthBudget {
  month: MonthKey;
  lines: LineResult[];
  sections: Array<{ name: string; kind: GroupKind; groupCode: string; lines: LineResult[] }>;
  groups: GroupResult[];
  /** spending without a budget line; `everyday` = the category is used on current accounts or cash */
  unbudgeted: Array<{ categoryId: ID; actual: number; kind: GroupKind; everyday: boolean }>;
  totals: { income: GroupResult; costs: GroupResult };
  /** "In current accounts and cash" row: planned start figures and the money the month starts with. */
  start: MonthStart;
  runway: Runway;
}

export interface MonthStart {
  baseline: number;
  estimate: number;
  /** what the month has to work with in current accounts and cash */
  balance: number;
  when: 'past' | 'current' | 'next' | 'later';
  /** next month only: the current month's projected free money, carried over */
  carry: number;
  /** next month only: money already booked for it (advance received, rent paid early…) */
  booked: number;
}

/**
 * Money in current accounts and cash for a budget month.
 * - past and current months: everything booked for this month or earlier (never later months)
 * - next month: what this month is projected to leave over, plus what is already booked for it
 * - two or more months ahead: nothing yet
 */
export function monthStart(m: Model, month: MonthKey): Pick<MonthStart, 'balance' | 'when' | 'carry' | 'booked'> {
  const now = currentBudgetMonth(m);
  if (month <= now) return { balance: monthBalance(m, isSpendable, month), when: month === now ? 'current' : 'past', carry: 0, booked: 0 };
  if (month === shiftMonth(now, 1)) {
    const carry = computeMonth(m, now).runway.free;
    const booked = bookedInMonth(m, isSpendable, month);
    return { balance: carry + booked, when: 'next', carry, booked };
  }
  return { balance: 0, when: 'later', carry: 0, booked: 0 };
}
export const availableFor = (m: Model, month: MonthKey) => monthStart(m, month).balance;

export interface Runway {
  available: number; // current + cash account balances now
  incomeToCome: number;
  costsToPay: number; // planned + reservations + unplanned still open
  free: number; // projected free money at month end
}

/** Category amounts for one month, sign-normalised so spending and income are positive. */
function actualsIndex(m: Model, month: MonthKey) {
  const ls = lines(m).filter((l) => l.month === month);
  const byCat = new Map<ID, Line[]>();
  for (const l of ls) {
    if (!l.categoryId) continue;
    // For a categorised transfer only the outgoing side counts (money set aside).
    if (l.tx.transferId && l.amount > 0 && kindOf(m, l.categoryId) === 'reservation') continue;
    const arr = byCat.get(l.categoryId) ?? [];
    arr.push(l);
    byCat.set(l.categoryId, arr);
  }
  return byCat;
}

const signFor = (k: GroupKind) => (k === 'income' ? 1 : -1);

/** The workbook rule: nothing remains when a line is closed or the actual reached the estimate. */
export function remainingOf(estimate: number, actual: number, closed: boolean) {
  if (closed || actual >= estimate) return 0;
  return estimate - actual;
}

const monthCache = new WeakMap<Model, Map<MonthKey, MonthBudget>>();

export function computeMonth(m: Model, month: MonthKey, depth = 0): MonthBudget {
  let cache = monthCache.get(m);
  if (!cache) monthCache.set(m, (cache = new Map()));
  const hit = cache.get(month);
  if (hit) return hit;
  const res = computeMonthRaw(m, month, depth);
  cache.set(month, res);
  return res;
}

function computeMonthRaw(m: Model, month: MonthKey, depth: number): MonthBudget {
  const idx = actualsIndex(m, month);
  // a category that ended before this budget month starts is left out, even if a line exists
  const start0 = periodStart(m, month);
  const monthLines = m.budgetLines
    .filter((b) => b.month === month && categoryActiveOn(m.categoryById.get(b.categoryId), start0))
    .sort((a, b) => a.sort - b.sort);
  const byCatLines = new Map<ID, BudgetLine[]>();
  for (const b of monthLines) byCatLines.set(b.categoryId, [...(byCatLines.get(b.categoryId) ?? []), b]);

  const results: LineResult[] = monthLines.map((line) => {
    const kind = kindOf(m, line.categoryId) ?? 'expense';
    const s = signFor(kind);
    const catLines = idx.get(line.categoryId) ?? [];
    const siblings = byCatLines.get(line.categoryId) ?? [];
    const weekCovered = new Set(siblings.filter((x) => x.week).map((x) => x.week));
    let rel: Line[];
    if (line.week) rel = catLines.filter((l) => l.week === line.week);
    else if (weekCovered.size) rel = catLines.filter((l) => !weekCovered.has(l.week));
    else rel = catLines;
    // When the same category has several non-week lines, the first one carries the actuals.
    if (!line.week && siblings.filter((x) => !x.week).indexOf(line) > 0) rel = [];
    const actual = s * sum(rel.map((l) => l.amount));
    const carryIn = depth < 12 ? carryFor(m, line, month, depth) : 0;
    const available = line.estimate + carryIn;
    return {
      line,
      kind,
      actual,
      carryIn,
      available,
      remaining: remainingOf(available, actual, line.closed),
      over: Math.max(0, actual - available)
    };
  });

  // Spending in categories that have no budget line this month
  const unbudgeted: MonthBudget['unbudgeted'] = [];
  for (const [catId, ls] of idx) {
    if (byCatLines.has(catId)) continue;
    const kind = kindOf(m, catId);
    if (!kind || kind === 'transfer' || kind === 'opening') continue;
    const actual = signFor(kind) * sum(ls.map((l) => l.amount));
    const cat = m.categoryById.get(catId);
    if (actual !== 0) unbudgeted.push({ categoryId: catId, actual, kind, everyday: cat ? isEverydayCategory(m, cat) : true });
  }

  // Sections in display order
  const sections: MonthBudget['sections'] = [];
  for (const r of results) {
    const c = m.categoryById.get(r.line.categoryId);
    const g = c ? m.groupById.get(c.groupId) : undefined;
    const name = c?.section || g?.name || 'Other';
    let sec = sections.find((s) => s.name === name && s.groupCode === (g?.code ?? ''));
    if (!sec) sections.push((sec = { name, kind: r.kind, groupCode: g?.code ?? '', lines: [] }));
    sec.lines.push(r);
  }

  const groups: GroupResult[] = m.groups
    .filter((g) => g.kind === 'income' || g.kind === 'expense' || g.kind === 'reservation')
    .map((g) => {
      const rs = results.filter((r) => m.categoryById.get(r.line.categoryId)?.groupId === g.id);
      const un = unbudgeted.filter((u) => m.categoryById.get(u.categoryId)?.groupId === g.id);
      return {
        code: g.code,
        name: g.name,
        kind: g.kind,
        baseline: sum(rs.map((r) => r.line.baseline)),
        estimate: sum(rs.map((r) => r.available)),
        actual: sum(rs.map((r) => r.actual)) + sum(un.map((u) => u.actual)),
        remaining: sum(rs.map((r) => r.remaining))
      };
    });

  const agg = (gs: GroupResult[], name: string, kind: GroupKind): GroupResult => ({
    code: '',
    name,
    kind,
    baseline: sum(gs.map((g) => g.baseline)),
    estimate: sum(gs.map((g) => g.estimate)),
    actual: sum(gs.map((g) => g.actual)),
    remaining: sum(gs.map((g) => g.remaining))
  });
  const income = agg(groups.filter((g) => g.kind === 'income'), 'Income', 'income');
  const costs = agg(groups.filter((g) => g.kind !== 'income'), 'Costs', 'expense');

  const plan = m.monthPlans.find((p) => p.id === month);
  const ms = monthStart(m, month);
  const startMoney = ms.balance;
  const start: MonthStart = { baseline: plan?.startBaseline ?? 0, estimate: plan?.startEstimate ?? 0, ...ms };
  const runway: Runway = {
    available: startMoney,
    incomeToCome: income.remaining,
    costsToPay: costs.remaining,
    free: startMoney + income.remaining - costs.remaining
  };

  return { month, lines: results, sections, groups, unbudgeted, totals: { income, costs }, start, runway };
}

function carryFor(m: Model, line: BudgetLine, month: MonthKey, depth: number): number {
  const cat = m.categoryById.get(line.categoryId);
  const mode = cat?.rollover ?? 'none';
  if (mode === 'none' || line.week) return 0;
  const kind = kindOf(m, line.categoryId);
  if (kind === 'income') return 0;
  const prev = shiftMonth(month, -1);
  if (!m.budgetLines.some((b) => b.month === prev && b.categoryId === line.categoryId)) return 0;
  const pm = computeMonth(m, prev, depth + 1);
  const prevLines = pm.lines.filter((r) => r.line.categoryId === line.categoryId && !r.line.week);
  if (!prevLines.length) return 0;
  const left = sum(prevLines.map((r) => r.available - r.actual));
  if (left > 0 && (mode === 'carry-remaining' || mode === 'carry-both')) return left;
  if (left < 0 && (mode === 'carry-overspend' || mode === 'carry-both')) return left;
  return 0;
}

/** Copy a month's lines into another month (baseline = previous estimate, nothing closed). */
export function linesForCopy(m: Model, from: MonthKey, to: MonthKey, newId: () => string): BudgetLine[] {
  const startTo = periodStart(m, to);
  return m.budgetLines
    .filter((b) => b.month === from && categoryActiveOn(m.categoryById.get(b.categoryId), startTo))
    .map((b) => ({ ...b, id: newId(), month: to, baseline: b.baseline, estimate: b.baseline, closed: false, updatedAt: '' }));
}

/** Annual view: estimate and actual per category per month. */
export function annualGrid(m: Model, year: number) {
  const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
  const computed = months.map((mm) => computeMonth(m, mm));
  const cats = new Map<ID, { estimate: number[]; actual: number[] }>();
  computed.forEach((mb, i) => {
    for (const r of mb.lines) {
      const e = cats.get(r.line.categoryId) ?? { estimate: Array(12).fill(0), actual: Array(12).fill(0) };
      e.estimate[i] += r.available;
      e.actual[i] += r.actual;
      cats.set(r.line.categoryId, e);
    }
    for (const u of mb.unbudgeted) {
      const e = cats.get(u.categoryId) ?? { estimate: Array(12).fill(0), actual: Array(12).fill(0) };
      e.actual[i] += u.actual;
      cats.set(u.categoryId, e);
    }
  });
  return { months, computed, cats };
}
