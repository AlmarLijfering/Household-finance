import { describe, it, expect } from 'vitest';
import { scheduleIn } from '../src/lib/calc/recurring';
import type { Recurring } from '../src/lib/types';

const r = (p: Partial<Recurring>): Recurring => ({ id: 'r', name: 'Netflix', kind: 'subscription', accountId: 'a', categoryId: 'c', amount: 4000, frequency: 'monthly', interval: 1, startDate: '2026-01-31', nextDate: '2026-12-31', active: true, scenarioId: null, updatedAt: '', ...p });

describe('bill schedule', () => {
  it('finds dates before the next date without drifting', () => {
    expect(scheduleIn(r({}), '2026-02-01', '2026-05-31')).toEqual(['2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31']);
  });
  it('does not go before the start date or past the end date', () => {
    expect(scheduleIn(r({ startDate: '2026-10-31', endDate: '2027-01-15' }), '2026-01-01', '2027-03-31')).toEqual(['2026-10-31', '2026-11-30', '2026-12-31']);
  });
  it('yearly bills land once a year', () => {
    expect(scheduleIn(r({ frequency: 'yearly', startDate: undefined, nextDate: '2027-03-05' }), '2026-01-01', '2026-12-31')).toEqual(['2026-03-05']);
  });
});

import { buildModel, DEFAULT_SETTINGS } from '../src/lib/calc/model';
import { billsInPeriod } from '../src/lib/calc/recurring';

const pay = (id: string, date: string, extra: any = {}) => ({ id, accountId: 'a', date, amount: -6000, payee: 'Orange', categoryId: 'c', status: 'cleared', createdAt: date, updatedAt: '', ...extra });
const world = (rec: Partial<Recurring>, txs: any[]) =>
  buildModel({
    settings: DEFAULT_SETTINGS,
    groups: [{ id: 'g', code: 'PC', name: 'Planned', kind: 'expense', sort: 0, updatedAt: '' }],
    categories: [{ id: 'c', code: 'PC031', name: 'Phone bill', groupId: 'g', sort: 0, updatedAt: '' }],
    accounts: [{ id: 'a', code: 'BRD', name: 'BRD', type: 'checking', currency: 'RON', openingBalance: 0, openingDate: '2026-01-01', sort: 0, updatedAt: '' }],
    transactions: txs,
    budgetLines: [], planned: [], scenarios: [], yearlyFunds: [], fxRates: [], reconciliations: [], importBatches: [], yearlyItems: [],
    recurring: [r({ name: 'Orange', payee: 'Orange', amount: 6000, ...rec })]
  } as any);

describe('which payment pays which bill', () => {
  it('an August payment does not pay a bill that starts in November', () => {
    const m = world({ startDate: '2026-11-20', nextDate: '2026-11-20' }, [pay('aug', '2026-08-30')]);
    const [b] = billsInPeriod(m, 'c', { month: '2026-11' });
    expect(b.paid).toBeNull();
    expect(b.due).toBe('2026-11-20');
  });
  it('a payment a few days early or late still counts for its month', () => {
    const m = world({ startDate: '2026-01-20', nextDate: '2026-12-20' }, [pay('nov', '2026-11-24'), pay('oct', '2026-10-17')]);
    expect(billsInPeriod(m, 'c', { month: '2026-11' })[0].paid?.id).toBe('nov');
    expect(billsInPeriod(m, 'c', { month: '2026-10' })[0].paid?.id).toBe('oct');
  });
  it('a payment made from the bill counts for the due date it paid, even when paid late', () => {
    const m = world({ startDate: '2026-01-01', nextDate: '2026-12-01' }, [pay('late', '2026-11-27', { recurringId: 'r', billDue: '2026-11-01' })]);
    expect(billsInPeriod(m, 'c', { month: '2026-11' })[0].paid?.id).toBe('late');
    expect(billsInPeriod(m, 'c', { month: '2026-12' })[0].paid).toBeNull();
  });
});
