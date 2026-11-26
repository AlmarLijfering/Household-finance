import { describe, it, expect } from 'vitest';
import { buildModel, DEFAULT_SETTINGS } from '../src/lib/calc/model';
import { yearlyPlan } from '../src/lib/calc/yearly';

const tx = (id: string, date: string, amount: number) => ({ id, accountId: 'r', date, amount, categoryId: 'ye11', status: 'cleared', createdAt: date, updatedAt: '' });
const model = (items: any[]) =>
  buildModel({
    settings: DEFAULT_SETTINGS,
    groups: [{ id: 'g', code: 'YE', name: 'Yearly expenses', kind: 'expense', sort: 0, updatedAt: '' }],
    categories: [{ id: 'ye11', code: 'YE011', name: 'Bday Joshua', groupId: 'g', sort: 0, updatedAt: '' }],
    accounts: [{ id: 'r', code: 'RES', name: 'Yearly', type: 'reserve', currency: 'RON', openingBalance: 0, openingDate: '2026-01-01', sort: 0, updatedAt: '' }],
    transactions: [tx('a', '2026-11-02', -18000), tx('b', '2026-11-22', -32000)],
    budgetLines: [], recurring: [], planned: [], scenarios: [], yearlyFunds: [], fxRates: [], reconciliations: [], importBatches: [],
    yearlyItems: items
  } as any);
const item = (id: string, name: string, due: string, est: number, extra: any = {}) => ({ id, year: 2026, name, categoryId: 'ye11', estimated: est, dueDate: due, paid: false, updatedAt: '', ...extra });

describe('yearly items: the category is what counts', () => {
  it('items sharing a category become one line and its money counts once', () => {
    const p = yearlyPlan(model([item('x', 'Bday Joshua', '2026-11-14', 50000, { paid: true }), item('y', 'Birthday - Joshua / Don Vito', '2026-12-01', 32000)]), 2026, '2026-11-26');
    expect(p.rows).toHaveLength(1);
    expect(p.rows[0].items.map((i) => i.name)).toEqual(['Bday Joshua', 'Birthday - Joshua / Don Vito']);
    expect(p.rows[0].actual).toBe(50000); // 180 + 320, once
    expect(p.rows[0].estimated).toBe(82000);
    expect(p.rows[0].paid).toBe(false);
    expect(p.totalEstimated).toBe(82000);
    expect(p.totalRemaining).toBe(32000);
  });
  it('an item with its own category shows that category’s bookings', () => {
    const p = yearlyPlan(model([item('x', 'Bday Joshua', '2026-11-14', 50000)]), 2026, '2026-11-26');
    expect(p.rows[0].actual).toBe(50000);
    expect(p.rows[0].items).toHaveLength(1);
  });
});
