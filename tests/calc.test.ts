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
  it('month balances: current, next (carry over), later (0)', () => {
    expect(availableFor(m, cm)).toBe(130000);
    expect(availableFor(m, shiftMonth(cm, -2))).toBe(100000);
    // no budget lines: next month carries over exactly what this month holds
    expect(availableFor(m, shiftMonth(cm, 1))).toBe(130000);
    expect(availableFor(m, shiftMonth(cm, 2))).toBe(0);
  });
  it('money booked for next month stays out of this month and is carried in next month', () => {
    const next = shiftMonth(cm, 1);
    const m2 = base({ ...m, transactions: [...m.transactions, { id: 'adv', accountId: 'a', date: `${cm}-25` > `${cm}-28` ? `${cm}-20` : `${cm}-20`, amount: 900000, categoryId: 'sal', budgetMonth: next, status: 'cleared', createdAt: '', updatedAt: '' }] });
    expect(availableFor(m2, cm)).toBe(130000); // the advance is not part of this month
    expect(availableFor(m2, next)).toBe(130000 + 900000); // carry over + booked for next month
    const mb = computeMonth(m2, next);
    expect(mb.start.carry).toBe(130000);
    expect(mb.start.booked).toBe(900000);
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

import { ruleStart, monthOfDate, weekOfPeriod, periodEnd } from '../src/lib/calc/period';
import { historyFor } from '../src/lib/calc/recurring';

describe('budget months in whole weeks', () => {
  it('starts on the Monday nearest the 1st, like the workbook', () => {
    expect(ruleStart('2026-10', 'weeks')).toBe('2026-09-28'); // 1 Oct is a Thursday
    expect(ruleStart('2026-11', 'weeks')).toBe('2026-11-02'); // Sunday → next Monday
    expect(ruleStart('2026-12', 'weeks')).toBe('2026-11-30');
    expect(ruleStart('2027-01', 'weeks')).toBe('2027-01-04');
    expect(ruleStart('2026-11', 'calendar')).toBe('2026-11-01');
  });
  it('dates fall in the right budget month and week; own dates override the rule', () => {
    const m = base({ monthPlans: [{ id: '2026-12', startDate: '2026-12-07', updatedAt: '' }] });
    expect(monthOfDate(m, '2026-11-01')).toBe('2026-10');
    expect(monthOfDate(m, '2026-11-02')).toBe('2026-11');
    expect(periodEnd(m, '2026-11')).toBe('2026-12-06'); // November stretched to 5 weeks
    expect(monthOfDate(m, '2026-12-03')).toBe('2026-11');
    expect(weekOfPeriod(m, '2026-11-09')).toBe(2);
    expect(weekOfPeriod(m, '2026-12-06')).toBe(5);
  });
  it('bill history matches on payee or on the item it was recorded from', () => {
    const r: any = { id: 'r1', name: 'Netflix', kind: 'subscription', amount: 7250 };
    const t = (id: string, payee: string, extra: any = {}) => ({ id, payee, accountId: 'a', date: '2026-01-0' + id.length, amount: -7250, categoryId: null, status: 'cleared', createdAt: '', updatedAt: '', ...extra });
    const h = historyFor([t('1', 'NETFLIX'), t('22', 'Spotify'), t('333', 'other', { recurringId: 'r1' })] as any, r);
    expect(h.map((x) => x.id).sort()).toEqual(['1', '333']);
  });
});

import { earmarkHints } from '../src/lib/calc/earmark';
import { periodEnd as pEnd } from '../src/lib/calc/period';
import { addDays as add } from '../src/lib/util';

describe('earmark warnings', () => {
  const cm = currentMonth();
  const acc = { id: 'a', code: 'CUR001', name: 'A', type: 'current', currency: 'RON', openingBalance: 0, openingDate: '2020-01-01', sort: 0, updatedAt: '' };
  const gi = { id: 'gi', code: 'IC', name: 'Income', kind: 'income', sort: 0, updatedAt: '' };
  const sal = { id: 'sal', code: 'IC011', name: 'Salary', groupId: 'gi', sort: 0, updatedAt: '' };
  const rec = { id: 'r', name: 'Salary advance', payee: 'Nagarro', kind: 'income', accountId: 'a', categoryId: 'sal', amount: 900000, frequency: 'monthly', interval: 1, startDate: '2026-01-25', nextDate: '2026-01-25', active: true, countsFor: 'next', updatedAt: '' };
  it('flags a late-month advance that is not earmarked, not an early one or an earmarked one', () => {
    const base0 = base({ accounts: [acc], groups: [gi], categories: [sal], recurring: [rec] });
    const late = add(pEnd(base0, cm), -4);
    const early = add(pEnd(base0, cm), -20);
    const tx = (id: string, date: string, extra: any = {}) => ({ id, accountId: 'a', date, amount: 900000, payee: 'Nagarro', categoryId: 'sal', status: 'cleared', createdAt: '', updatedAt: '', ...extra });
    const m = base({ accounts: [acc], groups: [gi], categories: [sal], recurring: [rec], transactions: [tx('late', late), tx('early', early), tx('done', late, { budgetMonth: shiftMonth(cm, 1) }), tx('ok', late, { monthConfirmed: true })] });
    const h = earmarkHints(m);
    expect([...h.keys()]).toEqual(['late']);
    expect(h.get('late')!.suggested).toBe(shiftMonth(cm, 1));
  });
});

import { planBulk } from '../src/lib/bulk';

describe('mass update', () => {
  const accs = [
    { id: 'a', code: 'CUR001', name: 'A', type: 'current', currency: 'RON', openingBalance: 0, openingDate: '2020-01-01', sort: 0, updatedAt: '' },
    { id: 'b', code: 'CUR002', name: 'B', type: 'current', currency: 'RON', openingBalance: 0, openingDate: '2020-01-01', sort: 1, updatedAt: '' },
    { id: 'e', code: 'SAV1', name: 'E', type: 'savings', currency: 'EUR', openingBalance: 0, openingDate: '2020-01-01', sort: 2, updatedAt: '' }
  ];
  const groups = [
    { id: 'gi', code: 'IC', name: 'Income', kind: 'income', sort: 0, updatedAt: '' },
    { id: 'gp', code: 'PC', name: 'Planned', kind: 'expense', sort: 1, updatedAt: '' },
    { id: 'gr', code: 'RE', name: 'Res', kind: 'reservation', sort: 2, updatedAt: '' }
  ];
  const cats = [
    { id: 'food', code: 'PC061', name: 'Food', groupId: 'gp', sort: 0, updatedAt: '' },
    { id: 'sal', code: 'IC011', name: 'Salary', groupId: 'gi', sort: 1, updatedAt: '' },
    { id: 'tax', code: 'RE011', name: 'Taxes', groupId: 'gr', sort: 2, updatedAt: '' }
  ];
  const tx = (id: string, accountId: string, amount: number, extra: any = {}) => ({ id, accountId, date: '2026-10-05', amount, payee: 'x', categoryId: null, status: 'cleared', createdAt: '', updatedAt: '', ...extra });
  const m = base({
    accounts: accs, groups, categories: cats,
    transactions: [
      tx('out1', 'a', -1000), tx('out2', 'a', -2000), tx('in1', 'a', 5000),
      tx('t-out', 'a', -3000, { transferId: 'T', transferAccountId: 'b' }), tx('t-in', 'b', 3000, { transferId: 'T', transferAccountId: 'a' })
    ]
  });
  it('category: only where the type fits; transfers get it on the outgoing side', () => {
    const r = planBulk(m, ['out1', 'out2', 'in1', 't-out'], { categoryId: 'food' });
    const got = new Map(r.changes.map((c) => [c.put.id, c.put]));
    expect(got.get('out1').categoryId).toBe('food');
    expect(got.has('in1')).toBe(false);
    expect(got.has('t-out')).toBe(false);
    expect(r.skipped.map((s) => s.reason).sort()).toEqual(['Money in needs an income category', 'Transfers only take reservation or transfer categories']);
    const r2 = planBulk(m, ['t-in'], { categoryId: 'tax' });
    expect(r2.changes.find((c) => c.put.id === 't-out')!.put.categoryId).toBe('tax');
  });
  it('account, date, payee and budget month; transfers stay in step', () => {
    const r = planBulk(m, ['out1', 't-out'], { accountId: 'b', payee: 'New', date: '2026-10-06', budgetMonth: '2026-11' });
    const got = new Map(r.changes.map((c) => [c.put.id, c.put]));
    expect(got.get('out1')).toMatchObject({ accountId: 'b', payee: 'New', date: '2026-10-06', budgetMonth: '2026-11' });
    // transfer side to b would make both sides the same account → account skipped, rest applied to both sides
    expect(got.get('t-out')).toMatchObject({ accountId: 'a', payee: 'New', date: '2026-10-06' });
    expect(got.get('t-in')).toMatchObject({ payee: 'New', date: '2026-10-06' });
    expect(r.skipped[0].reason).toMatch(/same account/);
    // amounts and type never change
    expect(got.get('out1').amount).toBe(-1000);
    const eur = planBulk(m, ['out2'], { accountId: 'e' });
    expect(eur.changes).toHaveLength(0);
    expect(eur.skipped[0].reason).toMatch(/currency/);
  });
});

import { linesForCopy } from '../src/lib/calc/budget';
import { categoryActiveOn } from '../src/lib/calc/model';

describe('categories with an end date', () => {
  const g = { id: 'g', code: 'PC', name: 'Planned', kind: 'expense', sort: 1, updatedAt: '' };
  const cats = [
    { id: 'old', code: 'PC014', name: 'DIGI Bucharest', groupId: 'g', sort: 0, activeUntil: '2026-10-31', updatedAt: '' },
    { id: 'food', code: 'PC061', name: 'Food', groupId: 'g', sort: 1, updatedAt: '' }
  ];
  const line = (id: string, month: string, categoryId: string) => ({ id, month, categoryId, baseline: 10000, estimate: 10000, closed: false, sort: 0, updatedAt: '' });
  const m = base({ groups: [g], categories: cats, budgetLines: [line('a', '2026-10', 'old'), line('b', '2026-11', 'old'), line('c', '2026-11', 'food')] });
  it('drops out of budget months that start after the end date, also when a line exists', () => {
    expect(computeMonth(m, '2026-10').lines.map((l) => l.line.id)).toEqual(['a']); // October starts 28 Sep
    expect(computeMonth(m, '2026-11').lines.map((l) => l.line.id)).toEqual(['c']);
    expect(linesForCopy(m, '2026-10', '2026-11', () => 'x').length).toBe(0);
  });
  it('can be booked up to and including its last day', () => {
    expect(categoryActiveOn(m.categoryById.get('old'), '2026-10-31')).toBe(true);
    expect(categoryActiveOn(m.categoryById.get('old'), '2026-11-01')).toBe(false);
    const r = planBulk(m, [], {});
    expect(r.changes).toHaveLength(0);
  });
});
