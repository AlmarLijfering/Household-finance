// Budget months ("periods"). A budget month can run on its own dates, e.g. in whole
// weeks from Monday 2 November to Sunday 29 November, as in the household workbook.
//
// Rule for months without their own start date:
//   weeks    → starts on the Monday nearest the 1st (1st on Mon–Thu: that week's Monday,
//              Fri–Sun: the following Monday), so every month is 4 or 5 whole weeks
//   calendar → starts on the 1st
// A month always ends the day before the next month starts, so months never overlap
// or leave gaps. Changing a month's end moves the next month's start.
import type { ISODate, MonthKey, Transaction } from '../types';
import { addDays, daysBetween, isoDate, parseISO, shiftMonth, today } from '../util';
import type { Model } from './model';

export type PeriodRule = 'weeks' | 'calendar';

export function ruleStart(month: MonthKey, rule: PeriodRule): ISODate {
  const first = `${month}-01`;
  if (rule === 'calendar') return first;
  const d = parseISO(first);
  const dow = (d.getDay() + 6) % 7; // Monday = 0 … Sunday = 6
  const shift = dow <= 3 ? -dow : 7 - dow;
  d.setDate(d.getDate() + shift);
  return isoDate(d);
}

interface PeriodCache {
  starts: Map<MonthKey, ISODate>;
  byDate: Map<ISODate, MonthKey>;
}
const caches = new WeakMap<Model, PeriodCache>();
function cache(m: Model): PeriodCache {
  let c = caches.get(m);
  if (!c) caches.set(m, (c = { starts: new Map(), byDate: new Map() }));
  return c;
}

export function periodRule(m: Model): PeriodRule {
  return m.settings.budgetPeriods ?? 'weeks';
}

export function periodStart(m: Model, month: MonthKey): ISODate {
  const c = cache(m);
  let s = c.starts.get(month);
  if (!s) {
    s = m.monthPlans.find((p) => p.id === month)?.startDate ?? ruleStart(month, periodRule(m));
    c.starts.set(month, s);
  }
  return s;
}

export function periodEnd(m: Model, month: MonthKey): ISODate {
  return addDays(periodStart(m, shiftMonth(month, 1)), -1);
}

export function period(m: Model, month: MonthKey) {
  const start = periodStart(m, month);
  const end = periodEnd(m, month);
  const days = daysBetween(start, end) + 1;
  return { month, start, end, days, weeks: Math.ceil(days / 7) };
}

/** The budget month a date belongs to. */
export function monthOfDate(m: Model, date: ISODate): MonthKey {
  const c = cache(m);
  const hit = c.byDate.get(date);
  if (hit) return hit;
  let month = date.slice(0, 7);
  for (let i = 0; i < 3 && date < periodStart(m, month); i++) month = shiftMonth(month, -1);
  for (let i = 0; i < 3 && date > periodEnd(m, month); i++) month = shiftMonth(month, 1);
  c.byDate.set(date, month);
  return month;
}

/** Week within the budget month: days 1–7 of the month are week 1, and so on. */
export function weekOfPeriod(m: Model, date: ISODate): number {
  const start = periodStart(m, monthOfDate(m, date));
  return Math.floor(daysBetween(start, date) / 7) + 1;
}

export function weekRange(m: Model, month: MonthKey, week: number): { start: ISODate; end: ISODate } {
  const start = addDays(periodStart(m, month), 7 * (week - 1));
  const end = addDays(start, 6);
  const pe = periodEnd(m, month);
  return { start, end: end > pe ? pe : end };
}

export const currentBudgetMonth = (m: Model) => monthOfDate(m, today());

/** The budget month a transaction counts for: its own setting, otherwise the month its date falls in. */
export function txMonth(m: Model, t: Pick<Transaction, 'date' | 'budgetMonth'>): MonthKey {
  return t.budgetMonth ?? monthOfDate(m, t.date);
}

/** Week of a transaction inside the budget month it counts for (moved transactions sit in the first or last week). */
export function txWeek(m: Model, t: Pick<Transaction, 'date' | 'budgetMonth'>): number {
  const month = txMonth(m, t);
  const p = period(m, month);
  if (t.date < p.start) return 1;
  if (t.date > p.end) return p.weeks;
  return Math.floor(daysBetween(p.start, t.date) / 7) + 1;
}

/** Bookings are allowed up to and including the next budget month. */
export const lastBookableMonth = (m: Model) => shiftMonth(currentBudgetMonth(m), 1);
export const lastBookableDate = (m: Model) => periodEnd(m, lastBookableMonth(m));
