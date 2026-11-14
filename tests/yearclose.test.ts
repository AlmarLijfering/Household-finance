import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { buildModel, DEFAULT_SETTINGS, accountBalance, monthBalance, isSpendable, type Model } from '../src/lib/calc/model';
import { computeMonth, annualGrid, linesForCopy } from '../src/lib/calc/budget';
import { cashFlow, spendingByCategory, balanceHistory } from '../src/lib/calc/reports';
import { closeCheck, planClose, planReopen, opTouchesClosed, yearsOverview } from '../src/lib/calc/yearclose';
import { readWorkbook } from '../src/lib/importer/workbook';
import { parseWorkbook } from '../src/lib/importer/parse';
import { buildCommit, suggestAccountMap } from '../src/lib/importer/commit';

const base = (over: any = {}) =>
  buildModel({ settings: DEFAULT_SETTINGS, accounts: [], groups: [], categories: [], transactions: [], budgetLines: [], recurring: [], planned: [], scenarios: [], yearlyItems: [], yearlyFunds: [], fxRates: [], reconciliations: [], importBatches: [], ...over });

function apply(m: Model, changes: any[]): Model {
  const raw: any = { ...m };
  for (const c of changes) {
    const arr: any[] = raw[c.table] ? [...raw[c.table]] : [];
    if (c.put) {
      if (c.table === 'settings') {
        raw.settings = c.put;
        continue;
      }
      const i = arr.findIndex((x) => x.id === c.put.id);
      if (i >= 0) arr[i] = c.put;
      else arr.push(c.put);
    } else {
      const i = arr.findIndex((x) => x.id === c.del);
      if (i >= 0) arr.splice(i, 1);
    }
    raw[c.table] = arr;
  }
  return buildModel(raw);
}

const groups = [
  { id: 'gi', code: 'IC', name: 'Income', kind: 'income', sort: 0, updatedAt: '' },
  { id: 'gp', code: 'PC', name: 'Planned', kind: 'expense', sort: 1, updatedAt: '' },
  { id: 'gt', code: 'RE', name: 'Reservations', kind: 'reservation', sort: 2, updatedAt: '' }
];
const categories = [
  { id: 'sal', code: 'IC001', name: 'Salary', groupId: 'gi', sort: 0, updatedAt: '' },
  { id: 'food', code: 'PC061', name: 'Food', groupId: 'gp', sort: 1, rollover: 'carry-remaining', updatedAt: '' },
  { id: 'res', code: 'RE001', name: 'Taxes fund', groupId: 'gt', sort: 2, updatedAt: '' }
];
const accounts = [
  { id: 'a', code: 'CUR001', name: 'Current', type: 'current', currency: 'RON', openingBalance: 100000, openingDate: '2025-12-29', sort: 0, updatedAt: '' },
  { id: 'b', code: 'RES001', name: 'Taxes', type: 'reserve', currency: 'RON', openingBalance: 0, openingDate: '2025-12-29', sort: 1, updatedAt: '' }
];
const tx = (id: string, accountId: string, date: string, amount: number, categoryId: string | null, extra: any = {}) => ({ id, accountId, date, amount, categoryId, status: 'cleared', createdAt: date, updatedAt: '', ...extra });

const sample = () =>
  base({
    groups,
    categories,
    accounts,
    transactions: [
      tx('t1', 'a', '2026-06-10', -10000, 'food'),
      tx('t2', 'a', '2026-12-25', 500000, 'sal', { budgetMonth: '2027-01' }), // dated 2026, counts for 2027: stays
      tx('t3', 'a', '2027-01-03', -20000, 'food', { budgetMonth: '2026-12' }), // dated 2027, counts for 2026: archived
      tx('o1', 'a', '2026-12-30', -30000, 'res', { transferId: 'x', transferAccountId: 'b' }), // outgoing side decides
      tx('i1', 'b', '2027-01-02', 30000, null, { transferId: 'x', transferAccountId: 'a', budgetMonth: '2027-01' }),
      tx('t5', 'a', '2027-02-02', -5000, 'food')
    ],
    budgetLines: [
      { id: 'd', month: '2026-12', categoryId: 'food', baseline: 50000, estimate: 50000, closed: false, sort: 0, updatedAt: '' },
      { id: 'j', month: '2027-01', categoryId: 'food', baseline: 50000, estimate: 50000, closed: false, sort: 0, updatedAt: '' }
    ],
    yearlyItems: [{ id: 'y26', year: 2026, name: 'Insurance', categoryId: null, estimated: 100000, dueDate: '2026-05-01', paid: true, updatedAt: '' }]
  });

describe('closing a year', () => {
  it('the budget month decides the year; transfers move as a pair with their outgoing side', () => {
    const m = sample();
    const p = planClose(m, 2026, 'test', 'onedrive');
    expect(p.archive.data.transactions.map((t) => t.id).sort()).toEqual(['i1', 'o1', 't1', 't3']);
    const after = apply(m, p.changes);
    expect(after.transactions.map((t) => t.id).sort()).toEqual(['t2', 't5']);
    expect(after.budgetLines.map((b) => b.id)).toEqual(['j']);
    expect(after.yearlyItems).toHaveLength(0);
    expect(p.archive.data.yearlyItems).toHaveLength(1);
  });

  it('balances, the January carry-over and rollover stay exactly the same', () => {
    const m = sample();
    const after = apply(m, planClose(m, 2026, 'test', 'onedrive').changes);
    for (const a of ['a', 'b']) expect(accountBalance(after, a)).toBe(accountBalance(m, a));
    expect(monthBalance(after, isSpendable, '2027-01')).toBe(monthBalance(m, isSpendable, '2027-01'));
    const jBefore = computeMonth(m, '2027-01').lines[0];
    const jAfter = computeMonth(after, '2027-01').lines[0];
    expect(jBefore.carryIn).toBe(50000 - 20000); // December food: 500 budgeted, 200 spent
    expect(jAfter.carryIn).toBe(jBefore.carryIn);
    expect(jAfter.available).toBe(jBefore.available);
  });

  it('reports and the year view still show the closed year from its totals', () => {
    const m = sample();
    const after = apply(m, planClose(m, 2026, 'test', 'onedrive').changes);
    const f = { from: '2026-01', to: '2027-02' };
    expect(cashFlow(after, f)).toEqual(cashFlow(m, f));
    expect(spendingByCategory(after, f).rows).toEqual(spendingByCategory(m, f).rows);
    const bh = (x: Model) => balanceHistory(x, f).map((r) => r.total);
    expect(bh(after)).toEqual(bh(m));
    const g = annualGrid(after, 2026);
    expect(g.closed).toBe(true);
    expect(g.cats.get('food')!.actual[11]).toBe(20000);
    expect(linesForCopy(after, '2026-12', '2027-03', () => 'n')).toHaveLength(1); // December can still be copied
  });

  it('reopening brings everything back exactly as it was', () => {
    const m = sample();
    const p = planClose(m, 2026, 'test', 'onedrive');
    const closed = apply(m, p.changes);
    const reopened = apply(closed, planReopen(closed, p.archive));
    const ids = (x: Model) => x.transactions.map((t) => t.id).sort();
    expect(ids(reopened)).toEqual(ids(m));
    expect(reopened.accounts.map((a) => [a.id, a.openingBalance, a.openingDate])).toEqual(m.accounts.map((a) => [a.id, a.openingBalance, a.openingDate]));
    expect(reopened.closedYears).toHaveLength(0);
    expect(reopened.budgetLines.map((b) => b.id).sort()).toEqual(['d', 'j']);
  });

  it('refuses when not allowed and explains why', () => {
    const m = sample();
    expect(closeCheck(m, 2026, '2026-11-13').problems[0]).toMatch(/runs until/);
    expect(closeCheck(m, 2026, '2027-01-20', 3).problems[0]).toMatch(/3 changes/);
    const withOld = apply(m, [{ table: 'transactions', put: tx('old', 'a', '2025-06-01', -100, 'food') }]);
    expect(closeCheck(withOld, 2026, '2027-01-20').problems.join(' ')).toMatch(/Close 2025 first/);
    const closed = apply(m, planClose(m, 2026, 'test', 'onedrive').changes);
    expect(closeCheck(closed, 2026, '2027-01-20').problems[0]).toMatch(/already closed/);
    expect(() => planReopen(closed, { ...planClose(m, 2026, 't', 'onedrive').archive, year: 2025 } as any)).toThrow(/Only the most recently closed/);
    const c = closeCheck(m, 2026, '2027-01-20');
    expect(c.ok).toBe(true);
    expect(c.notes.join(' ')).toMatch(/dated in 2026 count for 2027/);
  });

  it('edits to a closed year made on another device are recognised and dropped', () => {
    const m = sample();
    const closed = apply(m, planClose(m, 2026, 'test', 'onedrive').changes);
    expect(opTouchesClosed(closed, { table: 'transactions', kind: 'put', key: 't1', record: tx('t1', 'a', '2026-06-10', -999, 'food') })).toBe(true);
    expect(opTouchesClosed(closed, { table: 'transactions', kind: 'put', key: 't2', record: tx('t2', 'a', '2026-12-25', 1, 'sal', { budgetMonth: '2027-01' }) })).toBe(false);
    expect(opTouchesClosed(closed, { table: 'budgetLines', kind: 'put', key: 'd', record: { id: 'd', month: '2026-12' } })).toBe(true);
    expect(yearsOverview(closed).find((y) => y.year === 2026)!.closed).toBe(true);
  });
});

// The real workbook, when available
const DIR = process.env.WORKBOOK_DIR ?? '/mnt/user-data/uploads/Finacial Application';
const f2026 = `${DIR}/Budget 2026a.xlsx`;
describe.runIf(existsSync(f2026))('closing 2026 on the real workbook', () => {
  it('keeps every balance and report figure, and reopens to the same data', async () => {
    const b = readFileSync(f2026);
    const wb = await readWorkbook(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), 'Budget 2026a.xlsx');
    const plan = parseWorkbook(wb, { mode: 'actuals' });
    const empty = base();
    const { changes } = buildCommit(plan, empty, { accountMap: suggestAccountMap(plan, empty), includeBudgets: true, includeYearly: true, includeFx: true, includeSubscriptions: false, skipAlreadyImported: true });
    const m = apply(empty, changes);
    const years = yearsOverview(m);
    const first = years[0].year;
    // close every year before 2027 in order, then check
    let cur = m;
    const archives: any[] = [];
    for (const y of years.filter((y) => y.year < 2027)) {
      expect(closeCheck(cur, y.year, '2027-02-01').problems).toEqual([]);
      const p = planClose(cur, y.year, 'test', 'onedrive');
      archives.push(p.archive);
      cur = apply(cur, p.changes);
    }
    for (const a of m.accounts) expect(accountBalance(cur, a.id)).toBe(accountBalance(m, a.id));
    const f = { from: `${first}-01`, to: '2027-01' };
    expect(cashFlow(cur, f)).toEqual(cashFlow(m, f));
    expect(balanceHistory(cur, f).map((r) => r.total)).toEqual(balanceHistory(m, f).map((r) => r.total));
    expect(monthBalance(cur, isSpendable, '2027-01')).toBe(monthBalance(m, isSpendable, '2027-01'));
    // reopen newest first
    for (const a of archives.reverse()) cur = apply(cur, planReopen(cur, a));
    expect(cur.transactions.length).toBe(m.transactions.length);
    for (const a of m.accounts) {
      expect(accountBalance(cur, a.id)).toBe(accountBalance(m, a.id));
      expect(cur.accountById.get(a.id)!.openingBalance).toBe(a.openingBalance);
    }
  }, 60000);
});
