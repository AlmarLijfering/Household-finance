import { describe, it, expect } from 'vitest';
import { buildModel, DEFAULT_SETTINGS, moveTarget, moveHistory } from '../src/lib/calc/model';
import { cashFlow, groupSeries, incomeOut, OTHER_INCOME } from '../src/lib/calc/reports';

const groups = [
  { id: 'gi', code: 'IC', name: 'Income', kind: 'income', sort: 0, updatedAt: '' },
  { id: 'gp', code: 'PC', name: 'Planned', kind: 'expense', sort: 1, updatedAt: '' },
  { id: 'gr', code: 'RE', name: 'Reservations', kind: 'reservation', sort: 2, updatedAt: '' },
  { id: 'gd', code: 'DIV', name: 'Paid from reserves', kind: 'expense', sort: 3, updatedAt: '' }
];
const categories = [
  { id: 'sal', code: 'IC001', name: 'Salary', groupId: 'gi', sort: 0, updatedAt: '' },
  { id: 'bon', code: 'IC002', name: 'Bonus', groupId: 'gi', sort: 1, updatedAt: '' },
  { id: 'ph1', code: 'PC013', name: 'Phone Bucharest', groupId: 'gp', sort: 2, updatedAt: '' },
  { id: 'ph2', code: 'PC031', name: 'Phone bill', groupId: 'gp', sort: 3, updatedAt: '' },
  { id: 'tax', code: 'RE011', name: 'Taxes', groupId: 'gr', sort: 4, moveToAccountId: 'r', updatedAt: '' },
  { id: 'pen', code: 'RE013', name: 'Pension', groupId: 'gr', sort: 5, updatedAt: '' },
  { id: 'paid', code: 'DIV001', name: 'Yearly (paid)', groupId: 'gd', sort: 6, updatedAt: '' }
];
const accounts = [
  { id: 'a', code: 'CUR001', name: 'Current', type: 'current', currency: 'RON', openingBalance: 0, openingDate: '2025-12-29', sort: 0, updatedAt: '' },
  { id: 'r', code: 'RES003', name: 'Taxes', type: 'reserve', currency: 'RON', openingBalance: 0, openingDate: '2025-12-29', sort: 1, updatedAt: '' }
];
const tx = (id: string, accountId: string, date: string, amount: number, categoryId: string | null, extra: any = {}) => ({ id, accountId, date, amount, categoryId, status: 'cleared', createdAt: date, updatedAt: '', ...extra });
const m = buildModel({
  settings: { ...DEFAULT_SETTINGS, incomeReport: { order: ['bon', 'sal'], colors: {} } },
  groups, categories, accounts, recurring: [], planned: [], scenarios: [], yearlyItems: [], yearlyFunds: [], fxRates: [], reconciliations: [], importBatches: [], budgetLines: [],
  transactions: [
    tx('s', 'a', '2026-03-10', 1000000, 'sal'),
    tx('b', 'a', '2026-03-12', 200000, 'bon'),
    tx('g', 'a', '2026-03-13', 5000, null), // uncategorised money in
    tx('p1', 'a', '2026-03-15', -6000, 'ph1'),
    tx('p2', 'a', '2026-04-15', -4000, 'ph2'),
    // reserving for taxes as a transfer: counted once
    tx('to', 'a', '2026-03-20', -300000, 'tax', { transferId: 'x', transferAccountId: 'r' }),
    tx('ti', 'r', '2026-03-20', 300000, null, { transferId: 'x', transferAccountId: 'a' }),
    // pension leaves the accounts
    tx('pe', 'a', '2026-03-21', -50000, 'pen'),
    // later paid from the reserve: not counted again
    tx('pr', 'r', '2026-04-10', -250000, 'paid')
  ]
} as any);

describe('cash flow with reservations', () => {
  it('counts reservations once and keeps costs paid from reserves apart', () => {
    const [mar, apr] = cashFlow(m, { from: '2026-03', to: '2026-04' });
    expect(mar).toMatchObject({ income: 1205000, reserved: 350000, spending: 6000, fromReserves: 0, net: 1205000 - 350000 - 6000 });
    expect(apr).toMatchObject({ income: 0, reserved: 0, spending: 4000, fromReserves: 250000, net: -4000 });
  });

  it('stacks income in your order and sets the line to spending + reservations', () => {
    const { rows, sources } = incomeOut(m, { from: '2026-03', to: '2026-04' });
    expect(sources).toEqual(['bon', 'sal', OTHER_INCOME]);
    expect(rows[0]).toMatchObject({ bon: 200000, sal: 1000000, [OTHER_INCOME]: 5000, out: 356000, left: 849000 });
  });

  it('category groups add up their categories with the average over all months', () => {
    const g = groupSeries(m, { from: '2026-03', to: '2026-05' }, ['ph1', 'ph2']);
    expect(g.values).toEqual([6000, 4000, 0]);
    expect(g.avg).toBe(Math.round(10000 / 3));
    // a reservation group does not count the receiving side of the transfer
    expect(groupSeries(m, { from: '2026-03', to: '2026-03' }, ['tax']).values).toEqual([300000]);
    expect(groupSeries(m, { from: '2026-03', to: '2026-03' }, ['sal', 'bon']).values).toEqual([1200000]);
  });

  it('knows where a reservation category moves money', () => {
    expect(moveTarget(m, 'tax')?.id).toBe('r');
    expect(moveTarget(m, 'pen')).toBeUndefined();
    expect(moveHistory(m, 'tax')[0]).toMatchObject({ count: 1 });
  });
});
