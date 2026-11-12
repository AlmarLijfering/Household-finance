// Core domain model. All money is stored as integer minor units (bani / cents)
// in the currency of the account it belongs to. Reports convert to the base currency.

export type ID = string;
export type ISODate = string; // YYYY-MM-DD
export type MonthKey = string; // YYYY-MM

export type AccountType = 'current' | 'cash' | 'savings' | 'reserve';

export interface Account {
  id: ID;
  code: string; // e.g. CUR001 / RES003 — kept from the Excel workbook
  name: string;
  type: AccountType;
  currency: string; // ISO code, e.g. RON, EUR
  openingBalance: number; // minor units
  openingDate: ISODate;
  owner?: string;
  purpose?: string; // for reserve funds: what the money is set aside for
  targetAmount?: number; // optional savings target, minor units
  statementBalance?: number; // last known bank balance (from "Actual Amount" in Excel)
  statementDate?: ISODate;
  archived?: boolean;
  sort: number;
  updatedAt: string;
}

export type GroupKind = 'income' | 'expense' | 'reservation' | 'transfer' | 'opening';

export interface CategoryGroup {
  id: ID;
  code: string; // IC, PC, RE, UC, DIV, SB, YE
  name: string;
  kind: GroupKind;
  sort: number;
  updatedAt: string;
}

export type Rollover = 'none' | 'carry-remaining' | 'carry-overspend' | 'carry-both';

export interface Category {
  id: ID;
  code: string; // e.g. PC061
  name: string;
  groupId: ID;
  section?: string; // budget section, e.g. "Bucharest", "Joshua", "Car"
  costType?: 'fixed' | 'variable';
  rollover?: Rollover;
  // Where the category can be used. Both empty/undefined = every account.
  accountTypes?: AccountType[];
  accountIds?: ID[];
  activeUntil?: ISODate; // last day it can be used; later bookings and budget months leave it out
  archived?: boolean;
  sort: number;
  updatedAt: string;
}

export interface Split {
  id: ID;
  categoryId: ID | null;
  amount: number; // minor units, same sign convention as the parent
  memo?: string;
}

export type TxStatus = 'uncleared' | 'cleared' | 'reconciled';

export interface Transaction {
  id: ID;
  accountId: ID;
  date: ISODate;
  amount: number; // signed minor units: + money in, − money out
  payee?: string;
  memo?: string;
  categoryId: ID | null; // null when split or a plain transfer
  splits?: Split[];
  // Transfers are two linked transactions sharing transferId.
  transferId?: ID;
  transferAccountId?: ID;
  status: TxStatus;
  reconciliationId?: ID;
  importBatchId?: ID;
  recurringId?: ID; // set when recorded from a bill or income
  budgetMonth?: MonthKey; // counts for this budget month instead of the one its date falls in
  monthConfirmed?: boolean; // you confirmed it counts for the month of its date (no earmark warning)
  sourceRef?: string; // workbook/sheet/row for traceability and duplicate checks
  createdAt: string;
  updatedAt: string;
}

export interface BudgetLine {
  id: ID;
  importBatchId?: ID;
  month: MonthKey;
  categoryId: ID;
  label?: string; // e.g. "Food Week 2"
  week?: number; // 1-5 when a line covers a single week of the month
  baseline: number; // original plan, minor units base currency (always positive)
  estimate: number; // current expectation
  closed: boolean; // closed lines have no remaining amount
  note?: string;
  sort: number;
  updatedAt: string;
}

export type Frequency = 'weekly' | 'monthly' | 'quarterly' | 'yearly';
export type RecurringKind = 'bill' | 'subscription' | 'income' | 'transfer';

export interface Recurring {
  id: ID;
  importBatchId?: ID;
  name: string;
  kind: RecurringKind;
  accountId: ID;
  toAccountId?: ID; // for transfers (e.g. monthly top-up of the Taxes fund)
  categoryId: ID | null;
  amount: number; // positive minor units in account currency; sign derived from kind
  frequency: Frequency;
  interval: number; // every N periods
  startDate: ISODate;
  endDate?: ISODate;
  nextDate: ISODate;
  payee?: string;
  active: boolean;
  scenarioId?: ID | null; // null/undefined = part of the base plan
  countsFor?: 'same' | 'next'; // 'next': money for the following budget month, e.g. a salary advance
  updatedAt: string;
}

export interface PlannedEntry {
  id: ID;
  scenarioId: ID | null; // null = base plan
  date: ISODate;
  accountId: ID;
  amount: number; // signed minor units
  categoryId: ID | null;
  memo?: string;
  importBatchId?: ID;
  updatedAt: string;
}

export interface Scenario {
  id: ID;
  name: string;
  color: string;
  description?: string;
  incomeChangePct?: number; // e.g. -20 = income drops 20%
  spendChangePct?: number;
  updatedAt: string;
}

export interface YearlyItem {
  id: ID;
  importBatchId?: ID;
  year: number;
  name: string;
  categoryId: ID | null;
  estimated: number;
  actualOverride?: number; // when not derived from transactions
  dueDate: ISODate;
  paid: boolean;
  updatedAt: string;
}

export interface YearlyFund {
  id: ID; // `${year}`
  year: number;
  accountId: ID | null;
  monthlyContribution: number;
  updatedAt: string;
}

export interface FxRate {
  id: ID; // `${currency}:${date}`
  date: ISODate;
  currency: string;
  rate: number; // units of base currency per 1 unit of `currency`
  updatedAt: string;
}

export interface Reconciliation {
  id: ID;
  accountId: ID;
  statementDate: ISODate;
  statementBalance: number;
  clearedBalance: number;
  difference: number;
  adjustmentTxId?: ID;
  completedAt: string;
  updatedAt: string;
}

export interface ImportBatch {
  id: ID;
  fileName: string;
  mode: 'actuals' | 'plan';
  importedAt: string;
  counts: Record<string, number>;
  totals: Record<string, number>;
  undone?: boolean;
  updatedAt: string;
}

/** Per-month figures for the "In current accounts and cash" row of the budget balance. */
export interface MonthPlan {
  id: MonthKey;
  startDate?: ISODate; // own first day of this budget month (end = next month's start − 1)
  startBaseline?: number;
  startEstimate?: number;
  updatedAt: string;
}

export interface Settings {
  id: 'settings';
  householdName: string;
  baseCurrency: string;
  currencies: string[];
  weekStartsOn: 1 | 0;
  budgetPeriods?: 'weeks' | 'calendar'; // default 'weeks': months in whole weeks
  defaultAccountId?: ID;
  updatedAt: string;
}

export const TABLES = [
  'accounts',
  'groups',
  'categories',
  'transactions',
  'budgetLines',
  'recurring',
  'planned',
  'scenarios',
  'yearlyItems',
  'yearlyFunds',
  'fxRates',
  'reconciliations',
  'importBatches',
  'monthPlans',
  'settings'
] as const;
export type TableName = (typeof TABLES)[number];

export interface TableTypes {
  accounts: Account;
  groups: CategoryGroup;
  categories: Category;
  transactions: Transaction;
  budgetLines: BudgetLine;
  recurring: Recurring;
  planned: PlannedEntry;
  scenarios: Scenario;
  yearlyItems: YearlyItem;
  yearlyFunds: YearlyFund;
  fxRates: FxRate;
  reconciliations: Reconciliation;
  importBatches: ImportBatch;
  monthPlans: MonthPlan;
  settings: Settings;
}

// An operation is the unit of change. Ops carry stable IDs so that retrying an
// upload with an uncertain outcome never applies the same change twice.
export interface Op {
  opId: ID;
  table: TableName;
  kind: 'put' | 'delete';
  key: ID;
  record?: unknown;
  at: string;
  device: string;
  label?: string;
}

// The single authoritative household snapshot stored (encrypted) on OneDrive.
export interface Snapshot {
  format: 'pfm-snapshot';
  version: 1;
  revision: number;
  savedAt: string;
  savedBy: string;
  appliedOps: ID[]; // recent op IDs (bounded) for idempotent retries
  data: { [K in TableName]: TableTypes[K][] };
}
