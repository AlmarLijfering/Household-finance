import { accountTypeFor, groupCodeFor, sectionFor } from '../structure';
import type { AccountType, ISODate } from '../types';
import { MONTHS, pad, toMinor, addDays, shiftMonth } from '../util';
import { ruleStart } from '../calc/period';
import { num, str, type Cell, type TableData, type WorkbookData } from './workbook';

export type Level = 'error' | 'warning' | 'info';
export interface Issue {
  level: Level;
  message: string;
  ref?: string;
}

export interface PlanCategory {
  code: string;
  name: string;
  groupCode: string;
  section?: string;
}
export interface PlanAccount {
  code: string;
  name: string;
  type: AccountType;
  openingBalance: number;
  statementBalance?: number;
  fileBalance?: number; // the balance the workbook itself calculated
}
export interface PlanTx {
  key: string;
  accountCode: string;
  date: ISODate;
  amount: number;
  categoryCode: string | null;
  rawCategory: string;
  payee: string;
  sourceRef: string;
  issues: Issue[];
  include: boolean;
  duplicateOf?: string; // within-file duplicate key
}
export interface PlanBudget {
  sheet: string;
  month: string; // YYYY-MM
  include: boolean;
  note?: string;
  lines: Array<{ categoryCode: string; label?: string; week?: number; baseline: number; estimate: number; closed: boolean; section?: string; sort: number }>;
  totals: { income: number; costs: number };
}
export interface PlanYearly {
  year: number;
  monthlyContribution: number;
  fundAccountCode?: string;
  items: Array<{ name: string; categoryCode: string | null; estimated: number; actual: number | null; dueDate: ISODate; paid: boolean }>;
}

export interface ImportPlan {
  fileName: string;
  layout: 'workbook-2026' | 'workbook-2027' | 'generic';
  year: number;
  mode: 'actuals' | 'plan';
  categories: PlanCategory[];
  accounts: PlanAccount[];
  transactions: PlanTx[];
  transferPairs: Array<{ out: string; in: string; categoryCode: string | null }>;
  budgets: PlanBudget[];
  yearly: PlanYearly | null;
  fx: Array<{ date: ISODate; currency: string; rate: number }>;
  subscriptions: Array<{ name: string; amount: number }>;
  unmappedCategories: string[];
  skipped: Array<{ name: string; reason: string }>;
  issues: Issue[];
  checks: Array<{ label: string; expected: number; actual: number; ok: boolean }>;
  /** First day of each budget month, from the week dates on the budget sheets. */
  periodStarts: Record<string, string>;
}

const CODE_RE = /^[A-Z]{2,3}\d{3}$/;
const monthIndex = (v: Cell): number => {
  const s = str(v).slice(0, 3).toLowerCase();
  return MONTHS.findIndex((m) => m.toLowerCase() === s);
};
const weekNo = (v: Cell): number => {
  const m = /(\d)/.exec(str(v));
  return m ? Math.min(5, Math.max(1, Number(m[1]))) : 1;
};
/** Rows only carry month + week: place them on the first day of that week of the budget month. */
function dateFor(starts: Record<string, string>, year: number, mi: number, week: number): ISODate {
  const month = `${year}-${pad(mi + 1)}`;
  const start = starts[month] ?? ruleStart(month, 'weeks');
  const nextStart = starts[shiftMonth(month, 1)] ?? ruleStart(shiftMonth(month, 1), 'weeks');
  const d = addDays(start, 7 * (week - 1));
  return d < nextStart ? d : addDays(nextStart, -1);
}
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

export function profileYear(wb: WorkbookData): number {
  const m = /(20\d\d)/.exec(wb.fileName);
  if (m) return Number(m[1]);
  return new Date().getFullYear();
}

export interface ParseOptions {
  year?: number;
  mode?: 'actuals' | 'plan';
  categoryMap?: Record<string, string>; // raw category name → code
}

export function parseWorkbook(wb: WorkbookData, opts: ParseOptions = {}): ImportPlan {
  const year = opts.year ?? profileYear(wb);
  const byName = (n: string) => wb.tables.find((t) => t.name === n);
  const tables = wb.tables;
  const is2027 = tables.some((t) => t.name === 'All_Accounts') || tables.some((t) => t.headers.includes('Dropdown Label'));
  const layout: ImportPlan['layout'] = is2027 ? 'workbook-2027' : byName('Total_Category') ? 'workbook-2026' : 'generic';
  const mode = opts.mode ?? (year > new Date().getFullYear() ? 'plan' : 'actuals');
  const plan: ImportPlan = {
    fileName: wb.fileName,
    layout,
    year,
    mode,
    categories: [],
    accounts: [],
    transactions: [],
    transferPairs: [],
    budgets: [],
    yearly: null,
    fx: [],
    subscriptions: [],
    unmappedCategories: [],
    skipped: [],
    issues: [],
    checks: [],
    periodStarts: {}
  };

  // ---------- budget months: week-1 start dates from the budget sheets (cell K3) ----------
  for (const t of tables.filter((t) => t.headers.includes('Baseline') && t.headers.includes('Closed') && t.headers.includes('Code'))) {
    const mi = monthIndex(wb.cell(t.sheet, 'J2'));
    const sheetMi = monthIndex(t.sheet.replace(/^Budget\s*/i, ''));
    const k3 = wb.cell(t.sheet, 'K3');
    if (mi < 0 || !(k3 instanceof Date)) continue;
    if (sheetMi >= 0 && sheetMi !== mi) continue; // mislabelled copy
    plan.periodStarts[`${year}-${pad(mi + 1)}`] = k3.toISOString().slice(0, 10);
  }

  // ---------- categories ----------
  const catTable = tables.find((t) => t.name === 'Category' && t.headers.includes('Sub Code'));
  const nameToCode = new Map<string, string>();
  if (catTable) {
    for (const r of catTable.rows) {
      const code = str(r.values['Sub Code']);
      const name = str(r.values['Category']);
      if (!CODE_RE.test(code) || !name) continue;
      if (!plan.categories.some((c) => c.code === code)) plan.categories.push({ code, name, groupCode: groupCodeFor(code), section: sectionFor(code) });
      nameToCode.set(norm(name), code);
      const label = str(r.values['Dropdown Label']);
      if (label) nameToCode.set(norm(label), code);
    }
  } else plan.issues.push({ level: 'warning', message: 'No category list (table "Category") found. Categories will be created from the names used in transactions.' });
  for (const [k, v] of Object.entries(opts.categoryMap ?? {})) nameToCode.set(norm(k), v);

  const resolveCategory = (raw: string): string | null => {
    if (!raw) return null;
    const prefix = /^([A-Z]{2,3}\d{3})\b/.exec(raw);
    if (prefix) return prefix[1];
    const exact = nameToCode.get(norm(raw));
    if (exact) return exact;
    // Tolerate small spelling differences ("Medecines" → "Medicines")
    const n = norm(raw);
    let best: string | null = null;
    for (const [k, v] of nameToCode) if (Math.abs(k.length - n.length) <= 2 && editDistance(k, n) <= (n.length > 6 ? 2 : 1)) best = best ?? v;
    return best;
  };

  // ---------- accounts ----------
  const accLookup = tables.find((t) => t.name === 'Account' && t.headers.includes('Accout Name'));
  const accSummary = byName('AccountNames');
  const summaryByCode = new Map<string, Record<string, Cell>>();
  for (const r of accSummary?.rows ?? []) if (str(r.values['Code'])) summaryByCode.set(str(r.values['Code']), r.values);
  for (const r of accLookup?.rows ?? []) {
    const code = str(r.values['Account']);
    const name = str(r.values['Accout Name']);
    if (!code || !name) continue;
    const s = summaryByCode.get(code);
    const stmt = s ? num(s['Actual Ammount']) : null;
    const fileBal = s ? num(s['Amount Lei']) : null;
    plan.accounts.push({
      code,
      name,
      type: accountTypeFor(code, name),
      openingBalance: 0,
      statementBalance: stmt != null ? toMinor(stmt) : undefined,
      fileBalance: fileBal != null ? toMinor(fileBal) : undefined
    });
  }

  // ---------- transactions per account sheet ----------
  const accountTables = tables.filter((t) => /^Account_[A-Z]+\d+$/.test(t.name));
  const unmapped = new Set<string>();
  for (const t of accountTables) {
    const tableCode = t.name.replace('Account_', '');
    let acc = plan.accounts.find((a) => a.code === tableCode) ?? plan.accounts.find((a) => norm(a.name) === norm(t.sheet));
    if (!acc) {
      acc = { code: tableCode, name: t.sheet.trim(), type: accountTypeFor(tableCode, t.sheet), openingBalance: 0 };
      plan.accounts.push(acc);
    }
    for (const r of t.rows) {
      const v = r.values;
      const mi = monthIndex(v['Month']);
      const amountRaw = num(v['Amount']);
      const rawCategory = str(v['Category']) || str(v['Sub Code']);
      const payee = str(v['Description']);
      const sourceRef = `${t.sheet.trim()}!${r.rowNumber}`;
      const issues: Issue[] = [];
      if (amountRaw == null || amountRaw === 0) {
        if (rawCategory || payee) plan.issues.push({ level: 'info', message: `Row without an amount skipped`, ref: sourceRef });
        continue;
      }
      if (mi < 0) {
        plan.issues.push({ level: 'error', message: `Month "${str(v['Month'])}" is not recognised`, ref: sourceRef });
        continue;
      }
      const amount = toMinor(amountRaw);
      const date = dateFor(plan.periodStarts, year, mi, weekNo(v['Week']));
      let code = str(v['Sub Code']);
      if (!CODE_RE.test(code)) code = resolveCategory(rawCategory) ?? '';
      // Opening balance rows: "Transfer … Start" or a Starting Balance category.
      const isOpening = (/^start$/i.test(payee) && /transfer/i.test(rawCategory)) || code === 'SB001';
      if (isOpening) {
        if (mode === 'actuals' && mi === 0) {
          acc.openingBalance += amount;
          continue;
        }
        if (mode === 'plan') continue;
      }
      if (!code) {
        unmapped.add(rawCategory || '(empty)');
        issues.push({ level: 'warning', message: `Category "${rawCategory || '(empty)'}" is not mapped` });
      }
      plan.transactions.push({
        key: `${acc.code}|${date}|${amount}|${norm(payee)}`,
        accountCode: acc.code,
        date,
        amount,
        categoryCode: code || null,
        rawCategory,
        payee,
        sourceRef,
        issues,
        include: true
      });
    }
  }
  plan.unmappedCategories = [...unmapped].sort();
  // Make sure every category code in use exists
  for (const tx of plan.transactions)
    if (tx.categoryCode && !plan.categories.some((c) => c.code === tx.categoryCode))
      plan.categories.push({ code: tx.categoryCode, name: tx.rawCategory.replace(/^[A-Z]{2,3}\d{3}\s*-\s*/, '') || tx.categoryCode, groupCode: groupCodeFor(tx.categoryCode), section: sectionFor(tx.categoryCode) });

  // Within-file duplicates
  const seen = new Map<string, number>();
  for (const tx of plan.transactions) {
    const k = tx.key;
    const n = (seen.get(k) ?? 0) + 1;
    seen.set(k, n);
    if (n > 1) {
      tx.duplicateOf = k;
      tx.issues.push({ level: 'info', message: 'Same account, week, amount and description as another row — kept, check if intended' });
    }
    tx.key = `${k}#${n}`;
  }

  matchTransfers(plan);

  // ---------- budgets ----------
  const budgetTables = tables.filter((t) => t.headers.includes('Baseline') && t.headers.includes('Closed') && t.headers.includes('Code'));
  for (const t of budgetTables) {
    const sheetMonth = monthIndex(t.sheet.replace(/^Budget\s*/i, ''));
    const declared = monthIndex(wb.cell(t.sheet, 'J2'));
    const mi = declared >= 0 ? declared : sheetMonth;
    if (mi < 0) {
      plan.skipped.push({ name: t.sheet, reason: 'Could not tell which month this budget is for' });
      continue;
    }
    const b: PlanBudget = { sheet: t.sheet, month: `${year}-${pad(mi + 1)}`, include: true, lines: [], totals: { income: 0, costs: 0 } };
    if (declared >= 0 && sheetMonth >= 0 && declared !== sheetMonth) b.note = `Sheet name says ${MONTHS[sheetMonth]} but the sheet is set to ${MONTHS[declared]}`;
    let section: string | undefined;
    let sort = 0;
    for (const r of t.rows) {
      const cat = str(r.raw[0]);
      const code = str(r.values['Code']);
      if (!CODE_RE.test(code)) {
        const others = r.raw.slice(1).every((x) => x == null || x === '');
        if (cat && others && !['Cat', 'CC'].includes(cat)) section = cat.trim();
        continue;
      }
      const catName = plan.categories.find((c) => c.code === code)?.name ?? '';
      const desc = str(r.values['Description']);
      const wk = /week\s*(\d)/i.exec(desc);
      const baseline = toMinor(num(r.values['Baseline']) ?? 0);
      const estimate = toMinor(num(r.values['Estimated'] ?? r.values['Estimate']) ?? 0);
      if (!wk && baseline === 0 && estimate === 0 && !r.values['Closed']) continue; // empty placeholder line
      b.lines.push({
        categoryCode: code,
        label: desc && norm(desc) !== norm(catName) ? desc : undefined,
        week: wk ? Number(wk[1]) : undefined,
        baseline,
        estimate,
        closed: r.values['Closed'] === true || str(r.values['Closed']).toLowerCase() === 'true',
        section: section && !['Income', 'Planned Cost', 'Reservations', 'Unplanned Cost'].includes(section) ? section : undefined,
        sort: sort++
      });
      if (groupCodeFor(code) === 'IC') b.totals.income += estimate;
      else b.totals.costs += estimate;
    }
    if (!plan.categories.length) for (const l of b.lines) plan.categories.push({ code: l.categoryCode, name: l.categoryCode, groupCode: groupCodeFor(l.categoryCode) });
    plan.budgets.push(b);
  }
  // Duplicated months: keep the sheet whose name agrees with its month setting
  const byMonth = new Map<string, PlanBudget[]>();
  for (const b of plan.budgets) byMonth.set(b.month, [...(byMonth.get(b.month) ?? []), b]);
  for (const [month, list] of byMonth) {
    if (list.length < 2) continue;
    const keep = list.find((b) => !b.note) ?? list[0];
    for (const b of list)
      if (b !== keep) {
        b.include = false;
        plan.issues.push({ level: 'warning', message: `"${b.sheet}" is a second budget for ${month}; "${keep.sheet}" is used instead`, ref: b.sheet });
      }
  }
  // Section names from the sheet override the code-based defaults
  for (const b of plan.budgets.filter((x) => x.include))
    for (const l of b.lines) {
      const c = plan.categories.find((x) => x.code === l.categoryCode);
      if (c && l.section) c.section = l.section;
    }

  // ---------- yearly expenses ----------
  const yearly = byName('YearlyCost');
  if (yearly) {
    const f = wb.formula('Budget Yearly Expenses', 'C4') ?? '';
    const mm = /(\d+(?:\.\d+)?)\s*\*\s*(\d+(?:\.\d+)?)/.exec(f);
    const monthly = mm ? Number(mm[2]) : num(wb.cell('Budget Yearly Expenses', 'C4')) ?? 0;
    const fund = plan.accounts.find((a) => /yearly/i.test(a.name));
    const items: PlanYearly['items'] = [];
    for (const r of yearly.rows) {
      const v = r.values;
      const codeCell = str(v['Category']);
      const name = str(v['Item']) || str(v['Description']) || codeCell;
      const est = num(v['Estimated']);
      if (!name || est == null) continue;
      const due = v['Due Date'] instanceof Date ? (v['Due Date'] as Date).toISOString().slice(0, 10) : `${year}-12-31`;
      const hasCode = CODE_RE.test(codeCell);
      items.push({
        name,
        categoryCode: hasCode ? codeCell : null,
        estimated: toMinor(est),
        actual: hasCode ? null : num(v['Actual']) != null ? toMinor(num(v['Actual'])!) : null,
        dueDate: `${year}${due.slice(4)}`,
        paid: v['Paid'] === true
      });
      if (hasCode && !plan.categories.some((c) => c.code === codeCell))
        plan.categories.push({ code: codeCell, name: name, groupCode: groupCodeFor(codeCell), section: 'Yearly expenses' });
    }
    plan.yearly = { year, monthlyContribution: toMinor(monthly), fundAccountCode: fund?.code, items };
  }

  // ---------- exchange rates ----------
  const fx = byName('Exchange_Rate_BNR');
  for (const r of fx?.rows ?? []) {
    const d = r.values['Date'];
    const rate = num(r.values['Rate']);
    const cur = str(r.values['Currency']).toUpperCase();
    if (d instanceof Date && rate && cur) plan.fx.push({ date: d.toISOString().slice(0, 10), currency: cur, rate });
  }

  // ---------- subscriptions ----------
  const subs = byName('Digital_Subsriptions') ?? tables.find((t) => t.headers.includes('Subscription'));
  for (const r of subs?.rows ?? []) {
    const name = str(r.values['Subscription']);
    const price = num(r.values['Price']);
    if (name && price && !/^total$/i.test(name)) plan.subscriptions.push({ name, amount: toMinor(price) });
  }

  // ---------- skipped / out of scope ----------
  const outOfScope = ['StockTrades', 'FUNDURI_DE_ACTION', 'Lookup_Funds'];
  for (const t of tables) {
    if (outOfScope.includes(t.name)) plan.skipped.push({ name: `${t.sheet} (${t.name})`, reason: 'Stocks and investment funds are outside the app scope' });
    if (['Total_Category', 'Total_Accounts', 'All_Accounts'].includes(t.name)) plan.skipped.push({ name: `${t.sheet} (${t.name})`, reason: 'Derived totals — the app recalculates these' });
  }
  for (const s of wb.sheets) if (/portfolio|stock|expenses per month/i.test(s) && !tables.some((t) => t.sheet === s)) plan.skipped.push({ name: s, reason: /expenses per month/i.test(s) ? 'Report — rebuilt as "Spending by category"' : 'Stocks and investment funds are outside the app scope' });

  // ---------- reconciliation checks ----------
  if (mode === 'actuals')
    for (const a of plan.accounts) {
      if (a.fileBalance == null) continue;
      const total = a.openingBalance + plan.transactions.filter((t) => t.accountCode === a.code).reduce((s, t) => s + t.amount, 0);
      plan.checks.push({ label: `${a.name} balance`, expected: a.fileBalance, actual: total, ok: Math.abs(total - a.fileBalance) <= 1 });
    }
  return plan;
}

/** Pair the two sides of a transfer between accounts (opposite amounts, same month). */
export function matchTransfers(plan: ImportPlan) {
  const transferish = (t: PlanTx) => {
    const g = t.categoryCode ? groupCodeFor(t.categoryCode) : '';
    return g === 'TR' || g === 'RE' || /transfer/i.test(t.rawCategory);
  };
  const accName = new Map(plan.accounts.map((a) => [a.code, norm(a.name)]));
  const used = new Set<string>();
  const cands = plan.transactions.filter(transferish);
  const outs = cands.filter((t) => t.amount < 0).sort((a, b) => a.date.localeCompare(b.date));
  for (const o of outs) {
    if (used.has(o.key)) continue;
    const month = o.date.slice(0, 7);
    const options = cands.filter(
      (i) => i.amount === -o.amount && i.accountCode !== o.accountCode && !used.has(i.key) && i.date.slice(0, 7) === month
    );
    if (!options.length) continue;
    const score = (i: PlanTx) =>
      (i.date === o.date ? 4 : 0) +
      (norm(i.payee).includes(accName.get(o.accountCode) ?? '#') ? 2 : 0) +
      (norm(o.payee).includes(accName.get(i.accountCode) ?? '#') ? 2 : 0) +
      (i.categoryCode && groupCodeFor(i.categoryCode) === 'TR' ? 1 : 0);
    options.sort((a, b) => score(b) - score(a));
    const i = options[0];
    used.add(o.key);
    used.add(i.key);
    const cat = [o.categoryCode, i.categoryCode].find((c) => c && groupCodeFor(c) === 'RE') ?? null;
    plan.transferPairs.push({ out: o.key, in: i.key, categoryCode: cat });
  }
}

export function planSummary(p: ImportPlan) {
  const included = p.transactions.filter((t) => t.include);
  return {
    transactions: included.length,
    transfers: p.transferPairs.length,
    budgets: p.budgets.filter((b) => b.include).length,
    budgetLines: p.budgets.filter((b) => b.include).reduce((s, b) => s + b.lines.length, 0),
    yearlyItems: p.yearly?.items.length ?? 0,
    fx: p.fx.length,
    subscriptions: p.subscriptions.length,
    inflow: included.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0),
    outflow: included.filter((t) => t.amount < 0).reduce((s, t) => s + t.amount, 0),
    errors: p.issues.filter((i) => i.level === 'error').length,
    warnings: p.issues.filter((i) => i.level === 'warning').length + p.transactions.filter((t) => t.issues.some((i) => i.level === 'warning')).length
  };
}

export type { TableData };

function editDistance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
