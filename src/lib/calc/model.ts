import type {
  Account,
  BudgetLine,
  Category,
  CategoryGroup,
  FxRate,
  GroupKind,
  ID,
  ISODate,
  MonthKey,
  PlannedEntry,
  Recurring,
  Scenario,
  Settings,
  Transaction,
  YearlyFund,
  YearlyItem,
  Reconciliation,
  ImportBatch,
  MonthPlan,
  AccountType,
  ClosedYear
} from '../types';
import { txMonth, txWeek, periodEnd } from './period';

export interface Model {
  settings: Settings;
  accounts: Account[];
  groups: CategoryGroup[];
  categories: Category[];
  transactions: Transaction[];
  budgetLines: BudgetLine[];
  recurring: Recurring[];
  planned: PlannedEntry[];
  scenarios: Scenario[];
  yearlyItems: YearlyItem[];
  yearlyFunds: YearlyFund[];
  fxRates: FxRate[];
  reconciliations: Reconciliation[];
  importBatches: ImportBatch[];
  monthPlans: MonthPlan[];
  closedYears: ClosedYear[];
  // indexes
  accountById: Map<ID, Account>;
  categoryById: Map<ID, Category>;
  groupById: Map<ID, CategoryGroup>;
  ratesByCurrency: Map<string, FxRate[]>; // sorted by date asc
}

export const DEFAULT_SETTINGS: Settings = {
  id: 'settings',
  householdName: 'Our household',
  baseCurrency: 'RON',
  currencies: ['RON', 'EUR'],
  weekStartsOn: 1,
  updatedAt: ''
};

export function buildModel(raw: Omit<Model, 'accountById' | 'categoryById' | 'groupById' | 'ratesByCurrency' | 'monthPlans' | 'closedYears'> & { monthPlans?: MonthPlan[]; closedYears?: ClosedYear[] }): Model {
  const ratesByCurrency = new Map<string, FxRate[]>();
  for (const r of raw.fxRates) {
    const arr = ratesByCurrency.get(r.currency) ?? [];
    arr.push(r);
    ratesByCurrency.set(r.currency, arr);
  }
  for (const arr of ratesByCurrency.values()) arr.sort((a, b) => a.date.localeCompare(b.date));
  return {
    ...raw,
    monthPlans: raw.monthPlans ?? [],
    closedYears: [...(raw.closedYears ?? [])].sort((a, b) => a.year - b.year),
    accounts: [...raw.accounts].sort((a, b) => a.sort - b.sort || a.code.localeCompare(b.code)),
    categories: [...raw.categories].sort((a, b) => a.sort - b.sort || a.code.localeCompare(b.code)),
    groups: [...raw.groups].sort((a, b) => a.sort - b.sort),
    accountById: new Map(raw.accounts.map((a) => [a.id, a])),
    categoryById: new Map(raw.categories.map((c) => [c.id, c])),
    groupById: new Map(raw.groups.map((g) => [g.id, g])),
    ratesByCurrency
  };
}

// ---------- currency ----------
/** Base-currency units per 1 unit of `currency` on (or before) `date`. */
export function rateFor(m: Model, currency: string, date: ISODate): number {
  if (currency === m.settings.baseCurrency) return 1;
  const arr = m.ratesByCurrency.get(currency);
  if (!arr || !arr.length) return 1;
  let lo = 0,
    hi = arr.length - 1,
    best = arr[0];
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid].date <= date) {
      best = arr[mid];
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return best.rate;
}
export function toBase(m: Model, amount: number, currency: string, date: ISODate): number {
  return Math.round(amount * rateFor(m, currency, date));
}
export function txBase(m: Model, t: Transaction): number {
  const acc = m.accountById.get(t.accountId);
  return toBase(m, t.amount, acc?.currency ?? m.settings.baseCurrency, t.date);
}

// ---------- categories ----------
/** Whether a category may be used on an account (category scope: account types or specific accounts). */
export function categoryAllowed(c: Category, account?: Account | null): boolean {
  const types = c.accountTypes ?? [];
  const ids = c.accountIds ?? [];
  if (!types.length && !ids.length) return true;
  if (!account) return true;
  return ids.includes(account.id) || types.includes(account.type);
}
/** Whether a category can still be used on a date (it has no end date, or the date is not after it). */
export function categoryActiveOn(c: Category | undefined, date: ISODate): boolean {
  return !c?.activeUntil || date <= c.activeUntil;
}

/** A category that can be used on everyday accounts (current accounts or cash). */
export function isEverydayCategory(m: Model, c: Category): boolean {
  const types = c.accountTypes ?? [];
  const ids = c.accountIds ?? [];
  if (!types.length && !ids.length) return true;
  if (types.includes('current') || types.includes('cash')) return true;
  return ids.some((id) => {
    const a = m.accountById.get(id);
    return a ? a.type === 'current' || a.type === 'cash' : false;
  });
}
export function scopeLabel(m: Model, c: Category): string {
  const ids = c.accountIds ?? [];
  const types = c.accountTypes ?? [];
  if (!ids.length && !types.length) return 'All accounts';
  const t = types.map((x) => ACCOUNT_TYPE_LABEL[x]);
  const a = ids.map((id) => m.accountById.get(id)?.name ?? '?');
  return [...t, ...a].join(', ');
}
export const ACCOUNT_TYPE_LABEL: Record<AccountType, string> = { current: 'Current accounts', cash: 'Cash', reserve: 'Reserve funds', savings: 'Savings' };

export function kindOf(m: Model, categoryId: ID | null | undefined): GroupKind | null {
  if (!categoryId) return null;
  const c = m.categoryById.get(categoryId);
  if (!c) return null;
  return m.groupById.get(c.groupId)?.kind ?? null;
}
export function categoryLabel(m: Model, id: ID | null | undefined): string {
  if (!id) return 'Uncategorised';
  const c = m.categoryById.get(id);
  return c ? c.name : 'Unknown category';
}

/** A transaction broken into category amounts (splits expanded), in base currency. */
export interface Line {
  tx: Transaction;
  categoryId: ID | null;
  amount: number; // base currency
  date: ISODate;
  month: MonthKey;
  week: number;
}
const linesCache = new WeakMap<Model, Line[]>();
export function lines(m: Model, txs?: Transaction[]): Line[] {
  if (!txs) {
    const hit = linesCache.get(m);
    if (hit) return hit;
    const all = linesOf(m, m.transactions);
    linesCache.set(m, all);
    return all;
  }
  return linesOf(m, txs);
}
function linesOf(m: Model, txs: Transaction[]): Line[] {
  const out: Line[] = [];
  for (const t of txs) {
    const acc = m.accountById.get(t.accountId);
    const cur = acc?.currency ?? m.settings.baseCurrency;
    const base = { tx: t, date: t.date, month: txMonth(m, t), week: txWeek(m, t) };
    if (t.splits && t.splits.length) {
      for (const s of t.splits) out.push({ ...base, categoryId: s.categoryId, amount: toBase(m, s.amount, cur, t.date) });
    } else out.push({ ...base, categoryId: t.categoryId, amount: toBase(m, t.amount, cur, t.date) });
  }
  return out;
}

/** True when a line is money moving inside the household rather than income or spending. */
/**
 * How a line counts in cash-flow views.
 * - income: income categories (and uncategorised money in)
 * - reserved: set aside in reservations or savings (counts as money used when it is set aside)
 * - spending: costs, except those paid from reserves
 * - fromReserves: costs paid from money set aside earlier ("Paid from reserves"); already counted as reserved
 * - internal: transfers between your own accounts, opening balances
 */
export type FlowKind = 'income' | 'reserved' | 'spending' | 'fromReserves' | 'internal';
export function flowKind(m: Model, l: { categoryId: ID | null; amount: number; tx: Transaction }): FlowKind {
  const k = kindOf(m, l.categoryId);
  if (!l.categoryId) return l.tx.transferId ? 'internal' : l.amount > 0 ? 'income' : 'spending';
  if (k === 'income') return 'income';
  if (k === 'reservation') return l.tx.transferId && l.amount > 0 ? 'internal' : 'reserved';
  if (k === 'expense') {
    const c = m.categoryById.get(l.categoryId);
    return c && m.groupById.get(c.groupId)?.code === 'DIV' ? 'fromReserves' : 'spending';
  }
  return 'internal';
}

/** The reserve or savings account a reservation category moves money to, if set. */
export function moveTarget(m: Model, categoryId: ID | null | undefined): Account | undefined {
  if (!categoryId) return undefined;
  const c = m.categoryById.get(categoryId);
  if (!c?.moveToAccountId || kindOf(m, categoryId) !== 'reservation') return undefined;
  const a = m.accountById.get(c.moveToAccountId);
  return a && !a.archived ? a : undefined;
}
/** Where money booked on this category went before, most used first (from transfers). */
export function moveHistory(m: Model, categoryId: ID): Array<{ account: Account; count: number }> {
  const counts = new Map<ID, number>();
  for (const t of m.transactions) if (t.categoryId === categoryId && t.transferId && t.amount < 0 && t.transferAccountId) counts.set(t.transferAccountId, (counts.get(t.transferAccountId) ?? 0) + 1);
  return [...counts]
    .map(([id, count]) => ({ account: m.accountById.get(id)!, count }))
    .filter((x) => x.account)
    .sort((a, b) => b.count - a.count);
}

export function isInternal(m: Model, l: Line): boolean {
  const k = kindOf(m, l.categoryId);
  if (k === 'transfer' || k === 'opening' || k === 'reservation') return true;
  if (l.tx.transferId && !l.categoryId) return true;
  return false;
}

// ---------- balances ----------
export function accountBalance(m: Model, accountId: ID, asOf?: ISODate): number {
  const a = m.accountById.get(accountId);
  if (!a) return 0;
  let b = a.openingDate && asOf && a.openingDate > asOf ? 0 : a.openingBalance;
  for (const t of m.transactions) if (t.accountId === accountId && (!asOf || t.date <= asOf)) b += t.amount;
  return b;
}
export function balancesByAccount(m: Model, asOf?: ISODate): Map<ID, number> {
  const out = new Map<ID, number>();
  for (const a of m.accounts) out.set(a.id, a.openingDate && asOf && a.openingDate > asOf ? 0 : a.openingBalance);
  for (const t of m.transactions) if (!asOf || t.date <= asOf) out.set(t.accountId, (out.get(t.accountId) ?? 0) + t.amount);
  return out;
}
export const isSpendable = (a: Account) => a.type === 'current' || a.type === 'cash';
export const isReserve = (a: Account) => a.type === 'reserve' || a.type === 'savings';

export function totalBase(m: Model, filter: (a: Account) => boolean, asOf?: ISODate): number {
  const bal = balancesByAccount(m, asOf);
  const date = asOf ?? new Date().toISOString().slice(0, 10);
  let s = 0;
  for (const a of m.accounts) if (!a.archived && filter(a)) s += toBase(m, bal.get(a.id) ?? 0, a.currency, date);
  return s;
}

export function runningBalances(m: Model, accountId: ID): Map<ID, number> {
  const a = m.accountById.get(accountId);
  const txs = m.transactions.filter((t) => t.accountId === accountId).sort(txOrder);
  let b = a?.openingBalance ?? 0;
  const out = new Map<ID, number>();
  for (const t of txs) {
    b += t.amount;
    out.set(t.id, b);
  }
  return out;
}
export function txOrder(a: Transaction, b: Transaction) {
  return a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
}

/**
 * Money in the given accounts for a budget month: opening balances plus every transaction
 * that counts for this month or an earlier one. Money booked for a later month is left out,
 * even when it is already in the bank (e.g. a salary advance meant for next month).
 */
export function monthBalance(m: Model, filter: (a: Account) => boolean, month: MonthKey): number {
  const end = periodEnd(m, month);
  let s = 0;
  const ok = new Map<ID, Account>();
  for (const a of m.accounts) if (!a.archived && filter(a)) ok.set(a.id, a);
  for (const a of ok.values()) if (!a.openingDate || a.openingDate <= end) s += toBase(m, a.openingBalance, a.currency, end);
  for (const t of m.transactions) {
    const a = ok.get(t.accountId);
    if (!a) continue;
    if (txMonth(m, t) > month) continue;
    s += toBase(m, t.amount, a.currency, t.date);
  }
  return s;
}

/** Net money already booked for one budget month in the given accounts. */
export function bookedInMonth(m: Model, filter: (a: Account) => boolean, month: MonthKey): number {
  let s = 0;
  for (const t of m.transactions) {
    const a = m.accountById.get(t.accountId);
    if (!a || a.archived || !filter(a)) continue;
    if (txMonth(m, t) !== month) continue;
    s += toBase(m, t.amount, a.currency, t.date);
  }
  return s;
}
