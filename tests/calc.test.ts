import { describe, it, expect } from 'vitest';
import { remainingOf, computeMonth } from '../src/lib/calc/budget';
import { buildModel, DEFAULT_SETTINGS } from '../src/lib/calc/model';
import { occurrences, postRecurring } from '../src/lib/calc/recurring';
import { parseAmount, weekOfMonth, addMonths } from '../src/lib/util';
import { createKeyring, unlock, encryptJson, decryptJson, changePassphrase, rotateKey } from '../src/lib/sync/crypto';

const base = (over: any = {}) => buildModel({ settings: DEFAULT_SETTINGS, accounts: [], groups: [], categories: [], transactions: [], budgetLines: [], recurring: [], planned: [], scenarios: [], yearlyItems: [], yearlyFunds: [], fxRates: [], reconciliations: [], importBatches: [], ...over });

describe('budget rules from the workbook', () => {
  it('remaining is zero when closed or fully spent', () => {
    expect(remainingOf(1000, 400, false)).toBe(600);
    expect(remainingOf(1000, 400, true)).toBe(0);
    expect(remainingOf(1000, 1200, false)).toBe(0);
  });
  it('week lines only count their week; rollover carries unspent money', () => {
    const g = { id: 'g', code: 'PC', name: 'Planned', kind: 'expense', sort: 1, updatedAt: '' };
    const c = { id: 'food', code: 'PC061', name: 'Food', groupId: 'g', sort: 1, rollover: 'carry-remaining', updatedAt: '' };
    const c2 = { id: 'car', code: 'PC081', name: 'Gas car', groupId: 'g', sort: 2, rollover: 'carry-remaining', updatedAt: '' };
    const acc = { id: 'a', code: 'CUR001', name: 'A', type: 'current', currency: 'RON', openingBalance: 0, openingDate: '2026-01-01', sort: 0, updatedAt: '' };
    const tx = (id: string, date: string, amount: number, categoryId: string) => ({ id, accountId: 'a', date, amount, categoryId, status: 'cleared', createdAt: date, updatedAt: '' });
    const m = base({
      groups: [g], categories: [c, c2], accounts: [acc],
      budgetLines: [
        { id: 'w1', month: '2026-03', categoryId: 'food', week: 1, baseline: 90000, estimate: 90000, closed: false, sort: 0, updatedAt: '' },
        { id: 'w2', month: '2026-03', categoryId: 'food', week: 2, baseline: 90000, estimate: 90000, closed: false, sort: 1, updatedAt: '' },
        { id: 'car1', month: '2026-02', categoryId: 'car', baseline: 50000, estimate: 50000, closed: false, sort: 2, updatedAt: '' },
        { id: 'car2', month: '2026-03', categoryId: 'car', baseline: 50000, estimate: 50000, closed: false, sort: 2, updatedAt: '' }
      ],
      transactions: [tx('t1', '2026-03-03', -30000, 'food'), tx('t2', '2026-03-09', -100000, 'food'), tx('t3', '2026-02-10', -20000, 'car')]
    });
    const mb = computeMonth(m, '2026-03');
    const w1 = mb.lines.find((l) => l.line.id === 'w1')!;
    const w2 = mb.lines.find((l) => l.line.id === 'w2')!;
    expect(w1.actual).toBe(30000);
    expect(w2.actual).toBe(100000);
    expect(w2.over).toBe(10000);
    const car = mb.lines.find((l) => l.line.id === 'car2')!;
    expect(car.carryIn).toBe(30000);
    expect(car.remaining).toBe(80000);
  });
});

describe('helpers', () => {
  it('parses amounts typed in Romanian or English style', () => {
    expect(parseAmount('1.234,56')).toBe(123456);
    expect(parseAmount('1,234.56')).toBe(123456);
    expect(parseAmount('-50')).toBe(-5000);
    expect(parseAmount('50 lei')).toBe(5000);
  });
  it('week of month and month arithmetic', () => {
    expect(weekOfMonth('2026-11-07')).toBe(1);
    expect(weekOfMonth('2026-11-08')).toBe(2);
    expect(weekOfMonth('2026-11-30')).toBe(5);
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
  });
  it('recurring schedules advance and post transfers as linked pairs', () => {
    const r: any = { id: 'r', name: 'Taxes', kind: 'transfer', accountId: 'a', toAccountId: 'b', categoryId: 'RE', amount: 450000, frequency: 'monthly', interval: 1, startDate: '2026-01-02', nextDate: '2026-01-02', active: true, updatedAt: '' };
    expect(occurrences(r, '2026-01-01', '2026-04-30')).toEqual(['2026-01-02', '2026-02-02', '2026-03-02', '2026-04-02']);
    const { txs, rec } = postRecurring(r, '2026-01-02');
    expect(txs).toHaveLength(2);
    expect(txs[0].amount + txs[1].amount).toBe(0);
    expect(txs[0].transferId).toBe(txs[1].transferId);
    expect(rec.nextDate).toBe('2026-02-02');
  });
});

describe('encryption', () => {
  it('round-trips, unlocks with passphrase or recovery code, survives rotation', async () => {
    const { keyring, key, recovery } = await createKeyring('correct horse battery staple');
    const env = await encryptJson(key, keyring.keyId, { hello: 'world', n: 42 });
    expect(env.ct).not.toContain('world');
    const k2 = await unlock(keyring, 'correct horse battery staple');
    expect(await decryptJson(k2, env)).toEqual({ hello: 'world', n: 42 });
    const k3 = await unlock(keyring, recovery.toLowerCase());
    expect(await decryptJson(k3, env)).toEqual({ hello: 'world', n: 42 });
    await expect(unlock(keyring, 'wrong passphrase!!')).rejects.toThrow();
    // tampering is detected
    const bad = { ...env, ct: env.ct.slice(0, -4) + 'AAAA' };
    await expect(decryptJson(k2, bad)).rejects.toThrow();
    const ring2 = await changePassphrase(keyring, 'correct horse battery staple', 'a brand new passphrase');
    expect(await decryptJson(await unlock(ring2, 'a brand new passphrase'), env)).toEqual({ hello: 'world', n: 42 });
    const rot = await rotateKey(ring2, 'a brand new passphrase', 'rotated passphrase here');
    expect(rot.keyring.keyId).not.toBe(keyring.keyId);
    // old backups still open through the keyring's previous keys
    const kNew = await unlock(rot.keyring, 'rotated passphrase here');
    expect(await decryptJson(kNew, env, rot.keyring)).toEqual({ hello: 'world', n: 42 });
  }, 60000);
});

import { availableFor } from '../src/lib/calc/budget';
import { categoryAllowed } from '../src/lib/calc/model';
import { drillLines } from '../src/components/DrillDown';
import { currentMonth, shiftMonth } from '../src/lib/util';

describe('month-aware balance, category scope, drill-down', () => {
  const g = { id: 'g', code: 'PC', name: 'Planned', kind: 'expense', sort: 1, updatedAt: '' };
  const gi = { id: 'gi', code: 'IC', name: 'Income', kind: 'income', sort: 0, updatedAt: '' };
  const acc = { id: 'a', code: 'CUR001', name: 'A', type: 'current', currency: 'RON', openingBalance: 100000, openingDate: '2020-01-01', sort: 0, updatedAt: '' };
  const res = { id: 'r', code: 'RES001', name: 'Fund', type: 'reserve', currency: 'RON', openingBalance: 0, openingDate: '2020-01-01', sort: 1, updatedAt: '' };
  const cm = currentMonth();
  const prev = shiftMonth(cm, -1);
  const m = base({
    groups: [g, gi],
    accounts: [acc, res],
    categories: [
      { id: 'food', code: 'PC061', name: 'Food', groupId: 'g', sort: 1, updatedAt: '' },
      { id: 'med', code: 'DIV003', name: 'Medical', groupId: 'g', sort: 2, accountTypes: ['reserve'], updatedAt: '' },
      { id: 'sal', code: 'IC011', name: 'Salary', groupId: 'gi', sort: 0, updatedAt: '' }
    ],
    transactions: [
      { id: 't1', accountId: 'a', date: `${prev}-05`, amount: -20000, categoryId: 'food', status: 'cleared', createdAt: '', updatedAt: '' },
      { id: 't2', accountId: 'a', date: `${prev}-06`, amount: 50000, categoryId: 'sal', status: 'cleared', createdAt: '', updatedAt: '' }
    ]
  });
  it('a month that has not started has nothing in current accounts', () => {
    expect(availableFor(m, shiftMonth(cm, 1))).toBe(0);
    expect(availableFor(m, cm)).toBe(130000);
    expect(availableFor(m, shiftMonth(cm, -2))).toBe(100000);
  });
  it('categories can be limited to account types or accounts', () => {
    const med = m.categoryById.get('med')!;
    expect(categoryAllowed(med, m.accountById.get('a'))).toBe(false);
    expect(categoryAllowed(med, m.accountById.get('r'))).toBe(true);
    expect(categoryAllowed({ ...med, accountTypes: undefined, accountIds: ['a'] }, m.accountById.get('a'))).toBe(true);
    expect(categoryAllowed(m.categoryById.get('food')!, m.accountById.get('r'))).toBe(true);
  });
  it('drill-down lists the transactions behind a month figure', () => {
    expect(drillLines(m, { title: '', from: prev, type: 'spending' }).map((l) => l.tx.id)).toEqual(['t1']);
    expect(drillLines(m, { title: '', from: prev, type: 'income' }).map((l) => l.tx.id)).toEqual(['t2']);
    expect(drillLines(m, { title: '', from: prev, groupCode: 'PC' }).map((l) => l.tx.id)).toEqual(['t1']);
    expect(drillLines(m, { title: '', from: cm })).toHaveLength(0);
  });
});
