import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { readWorkbook } from '../src/lib/importer/workbook';
import { parseWorkbook } from '../src/lib/importer/parse';
import { buildCommit, suggestAccountMap } from '../src/lib/importer/commit';
import { buildModel, DEFAULT_SETTINGS, accountBalance } from '../src/lib/calc/model';
import { computeMonth } from '../src/lib/calc/budget';
import { cashFlow } from '../src/lib/calc/reports';
import { buildReportWorkbook } from '../src/lib/excel/reports';

// Point WORKBOOK_DIR at the folder with the household workbooks to run these.
const DIR = process.env.WORKBOOK_DIR ?? '/mnt/user-data/uploads/Finacial Application';
const f2026 = `${DIR}/Budget 2026a.xlsx`;
const f2027 = `${DIR}/budget2027.xlsx`;
const load = async (f: string) => {
  const b = readFileSync(f);
  return readWorkbook(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), f.split('/').pop()!);
};
const empty = () => buildModel({ settings: DEFAULT_SETTINGS, accounts: [], groups: [], categories: [], transactions: [], budgetLines: [], recurring: [], planned: [], scenarios: [], yearlyItems: [], yearlyFunds: [], fxRates: [], reconciliations: [], importBatches: [] });

function apply(m: ReturnType<typeof empty>, changes: any[]) {
  const raw: any = { ...m };
  for (const c of changes) {
    const arr: any[] = raw[c.table] ? [...raw[c.table]] : [];
    if (c.put) {
      if (c.table === 'settings') { raw.settings = c.put; continue; }
      const i = arr.findIndex((x) => x.id === c.put.id);
      if (i >= 0) arr[i] = c.put; else arr.push(c.put);
    } else arr.splice(arr.findIndex((x) => x.id === c.del), 1);
    raw[c.table] = arr;
  }
  return buildModel(raw);
}

describe.runIf(existsSync(f2026))('2026 workbook', () => {
  it('imports and every account balance matches what Excel calculated', async () => {
    const wb = await load(f2026);
    const plan = parseWorkbook(wb, { mode: 'actuals' });
    expect(plan.checks.length).toBeGreaterThan(5);
    expect(plan.checks.every((c) => c.ok)).toBe(true);
    expect(plan.unmappedCategories).toEqual([]);
    let m = empty();
    const { changes } = buildCommit(plan, m, { accountMap: suggestAccountMap(plan, m), includeBudgets: true, includeYearly: true, includeFx: true, includeSubscriptions: true, skipAlreadyImported: true });
    m = apply(m, changes);
    for (const a of plan.accounts) {
      if (a.fileBalance == null) continue;
      const acc = m.accounts.find((x) => x.code === a.code)!;
      expect(accountBalance(m, acc.id)).toBe(a.fileBalance);
    }
    // transfers come in pairs that net to zero
    const byT = new Map<string, number>();
    for (const t of m.transactions) if (t.transferId) byT.set(t.transferId, (byT.get(t.transferId) ?? 0) + t.amount);
    expect([...byT.values()].every((v) => v === 0)).toBe(true);
    // a budget month reproduces the workbook's Actual and Remaining for fixed lines
    const nov = computeMonth(m, '2026-11');
    const rent = nov.lines.find((l) => m.categoryById.get(l.line.categoryId)?.code === 'PC011')!;
    expect(rent.actual).toBe(350000);
    expect(rent.remaining).toBe(0);
    const salary = nov.lines.find((l) => m.categoryById.get(l.line.categoryId)?.code === 'IC011')!;
    expect(salary.actual).toBe(1800000);
    const cf = cashFlow(m, { from: '2026-01', to: '2026-11' });
    expect(cf.some((r) => r.income > 0 && r.spending > 0)).toBe(true);
    const buf = await buildReportWorkbook(m, { from: '2026-01', to: '2026-11' });
    expect(buf.byteLength).toBeGreaterThan(20000);
  }, 60000);

  it('re-importing the same workbook skips rows already imported', async () => {
    const wb = await load(f2026);
    const plan = parseWorkbook(wb, { mode: 'actuals' });
    let m = empty();
    const o = { includeBudgets: true, includeYearly: true, includeFx: false, includeSubscriptions: true, skipAlreadyImported: true };
    m = apply(m, buildCommit(plan, m, { ...o, accountMap: suggestAccountMap(plan, m) }).changes);
    const n = m.transactions.length;
    const second = buildCommit(plan, m, { ...o, accountMap: suggestAccountMap(plan, m) });
    expect(second.counts.skippedAlreadyImported).toBeGreaterThan(1000);
    m = apply(m, second.changes);
    expect(m.transactions.length).toBe(n);
  }, 60000);
});

describe.runIf(existsSync(f2027))('2027 workbook (future plan)', () => {
  it('imports budgets and yearly items as plans, not transactions', async () => {
    const wb = await load(f2027);
    const plan = parseWorkbook(wb, { mode: 'plan' });
    let m = empty();
    m = apply(m, buildCommit(plan, m, { accountMap: suggestAccountMap(plan, m), includeBudgets: true, includeYearly: true, includeFx: true, includeSubscriptions: false, skipAlreadyImported: true }).changes);
    expect(m.transactions.length).toBe(0);
    expect(m.budgetLines.filter((b) => b.month === '2027-01').length).toBeGreaterThan(30);
    expect(m.yearlyItems.filter((y) => y.year === 2027).length).toBe(30);
    expect(m.yearlyFunds[0].monthlyContribution).toBe(237500);
  }, 60000);
});
