// Starting points: the household structure without data, or a synthetic demo.
import { commit } from './db';
import { DEFAULT_ACCOUNTS, DEFAULT_CATEGORIES, GROUPS, costTypeFor, groupCodeFor, sectionFor } from './structure';
import type { Account, BudgetLine, Category, CategoryGroup, Recurring, Scenario, Settings, Transaction, YearlyFund, YearlyItem, FxRate } from './types';
import { addMonths, currentMonth, monthEnd, nowIso, shiftMonth, today, uid } from './util';
import type { Change } from './importer/commit';

export function structureChanges(): { changes: Change[]; cat: Map<string, string>; acc: Map<string, string> } {
  const at = nowIso();
  const changes: Change[] = [];
  const settings: Settings = { id: 'settings', householdName: 'Our household', baseCurrency: 'RON', currencies: ['RON', 'EUR'], weekStartsOn: 1, updatedAt: at };
  changes.push({ table: 'settings', put: settings });
  const gid = new Map<string, string>();
  for (const g of GROUPS) {
    const rec: CategoryGroup = { id: uid(), code: g.code, name: g.name, kind: g.kind, sort: g.sort, updatedAt: at };
    gid.set(g.code, rec.id);
    changes.push({ table: 'groups', put: rec });
  }
  const cat = new Map<string, string>();
  DEFAULT_CATEGORIES.forEach(([code, name], i) => {
    const fromReserves = ['DIV001', 'DIV003', 'DIV004', 'DIV006'].includes(code);
    const rec: Category = { id: uid(), code, name, groupId: gid.get(groupCodeFor(code))!, section: sectionFor(code), costType: costTypeFor(code), rollover: 'none', accountTypes: fromReserves ? ['reserve', 'savings'] : undefined, sort: i, updatedAt: at };
    cat.set(code, rec.id);
    changes.push({ table: 'categories', put: rec });
  });
  const acc = new Map<string, string>();
  DEFAULT_ACCOUNTS.forEach(([code, name, type, purpose], i) => {
    const rec: Account = { id: uid(), code, name, type, currency: 'RON', openingBalance: 0, openingDate: `${today().slice(0, 4)}-01-01`, purpose, sort: i, updatedAt: at };
    acc.set(code, rec.id);
    changes.push({ table: 'accounts', put: rec });
  });
  return { changes, cat, acc };
}

export async function startEmpty() {
  const { changes } = structureChanges();
  await commit(changes, 'Set up household');
}

/** Synthetic sample data so the app can be explored before importing real workbooks. */
export async function loadDemo() {
  const { changes, cat, acc } = structureChanges();
  const at = nowIso();
  const C = (c: string) => cat.get(c)!;
  const A = (c: string) => acc.get(c)!;
  const start = shiftMonth(currentMonth(), -5);
  const startDate = `${start}-01`;
  // opening balances
  for (const ch of changes)
    if (ch.table === 'accounts') {
      const a = ch.put as Account;
      a.openingDate = startDate;
      a.openingBalance = ({ CUR001: 420000, CUR002: 85000, CUR003: 60000, RES001: 500000, RES002: 300000, RES003: 1800000, RES004: 650000, RES006: 1200000 } as Record<string, number>)[a.code] ?? 0;
    }
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const tx = (accountId: string, date: string, amount: number, categoryId: string | null, payee: string, extra: Partial<Transaction> = {}): Transaction => ({
    id: uid(),
    accountId,
    date,
    amount,
    categoryId,
    payee,
    status: date < today() ? 'cleared' : 'uncleared',
    createdAt: at,
    updatedAt: at,
    ...extra
  });
  const out: Transaction[] = [];
  const transfer = (from: string, to: string, date: string, amount: number, categoryId: string | null, memo: string) => {
    const id = uid();
    out.push(tx(from, date, -amount, categoryId, memo, { transferId: id, transferAccountId: to }));
    out.push(tx(to, date, amount, null, memo, { transferId: id, transferAccountId: from }));
  };
  for (let i = 0; i < 6; i++) {
    const m = shiftMonth(start, i);
    const d = (day: number) => {
      const x = `${m}-${String(day).padStart(2, '0')}`;
      return x > monthEnd(m) ? monthEnd(m) : x;
    };
    const isNow = m === currentMonth();
    const cut = isNow ? today() : monthEnd(m);
    const push = (t: Transaction) => t.date <= cut && out.push(t);
    push(tx(A('CUR001'), d(1), 1800000, C('IC011'), 'Employer salary'));
    push(tx(A('CUR002'), d(3), 1150000 + Math.round(rnd() * 150000), C('IC012'), 'Therapy practice'));
    push(tx(A('CUR001'), d(2), -350000, C('PC011'), 'Landlord Bucharest'));
    push(tx(A('CUR001'), d(9), -Math.round(30000 + rnd() * 18000), C('PC012'), 'Gas supplier'));
    push(tx(A('CUR001'), d(12), -Math.round(28000 + rnd() * 15000), C('PC013'), 'Electricity supplier'));
    push(tx(A('CUR001'), d(15), -11500, C('PC014'), 'DIGI'));
    push(tx(A('CUR001'), d(15), -7749, C('PC024'), 'DIGI'));
    push(tx(A('CUR001'), d(10), -Math.round(45000 + rnd() * 20000), C('PC022'), 'Gas & electricity Floresti'));
    push(tx(A('CUR001'), d(5), -6100, C('PC031'), 'Phone operator'));
    push(tx(A('CUR001'), d(6), -5500, C('PC032'), 'Video streaming'));
    push(tx(A('CUR001'), d(6), -7250, C('PC032'), 'Movies streaming'));
    push(tx(A('CUR001'), d(18), -11000, C('PC032'), 'AI assistant'));
    push(tx(A('CUR003'), d(8), -15000, C('PC051'), 'English lessons'));
    push(tx(A('CUR003'), d(15), -15000, C('PC051'), 'English lessons'));
    push(tx(A('CUR003'), d(22), -15000, C('PC051'), 'English lessons'));
    push(tx(A('CUR002'), d(20), -40000, C('PC052'), 'Therapist Joshua'));
    push(tx(A('CUR001'), d(4), -16500, C('PC091'), 'Solo'));
    push(tx(A('CUR001'), d(11), -Math.round(30000 + rnd() * 40000), C('PC081'), 'Fuel station'));
    push(tx(A('CUR001'), d(25), -Math.round(25000 + rnd() * 30000), C('PC081'), 'Fuel station'));
    push(tx(A('CUR002'), d(14), -Math.round(10000 + rnd() * 50000), C('PC041'), 'Pharmacy'));
    push(tx(A('CUR003'), d(17), -35000, C('PC072'), 'Hairdresser'));
    push(tx(A('CUR001'), d(7), -40000, C('PC073'), 'Gym'));
    for (const w of [1, 8, 15, 22, 29]) {
      push(tx(A('CUR001'), d(w + 1), -Math.round(65000 + rnd() * 45000), C('PC061'), rnd() > 0.5 ? 'Carrefour' : 'Lidl'));
      push(tx(A('CUR002'), d(w + 3), -Math.round(8000 + rnd() * 25000), C('PC062'), 'Bakery & market'));
    }
    if (rnd() > 0.4) push(tx(A('CUR002'), d(19), -Math.round(20000 + rnd() * 120000), C('UC014'), 'Clothing store'));
    if (rnd() > 0.6) push(tx(A('CUR001'), d(23), -Math.round(10000 + rnd() * 50000), C('UC013'), 'Home store'));
    // household money movements
    if (d(3) <= cut) transfer(A('CUR002'), A('CUR001'), d(3), 800000, null, 'Monthly pooling');
    if (d(2) <= cut) {
      transfer(A('CUR001'), A('RES003'), d(2), 450000, C('RE011'), 'Taxes set aside');
      transfer(A('CUR001'), A('RES001'), d(2), 237500, C('RE012'), 'Yearly expenses');
      transfer(A('CUR001'), A('RES004'), d(2), 225000, C('RE014'), 'Holiday');
      transfer(A('CUR001'), A('RES002'), d(2), 100000, C('RE015'), 'Oxygen line');
    }
    if (d(6) <= cut) transfer(A('CUR001'), A('CUR003'), d(6), 80000, null, 'Cash withdrawal');
    if (i === 2) push(tx(A('RES002'), d(16), -63000, C('DIV003'), 'Eye doctor'));
    if (i === 3) push(tx(A('RES001'), d(9), -50000, C('DIV001'), 'Gas check'));
  }
  for (const t of out) changes.push({ table: 'transactions', put: t });

  // budgets for each month (copy the same template)
  const template: Array<[string, number, string?, number?]> = [
    ['IC011', 1800000],
    ['IC012', 1200000],
    ['IC014', 50000],
    ['PC011', 350000],
    ['PC012', 45000],
    ['PC013', 45000],
    ['PC014', 11500],
    ['PC015', 52500],
    ['PC022', 60000],
    ['PC024', 7749],
    ['PC025', 29000],
    ['PC031', 6100],
    ['PC032', 55000],
    ['PC041', 50000],
    ['PC051', 60000],
    ['PC052', 40000],
    ['PC054', 10000],
    ['PC061', 90000, 'Food week 1', 1],
    ['PC062', 30000, 'Others week 1', 1],
    ['PC061', 90000, 'Food week 2', 2],
    ['PC062', 30000, 'Others week 2', 2],
    ['PC061', 90000, 'Food week 3', 3],
    ['PC062', 30000, 'Others week 3', 3],
    ['PC061', 90000, 'Food week 4', 4],
    ['PC062', 30000, 'Others week 4', 4],
    ['PC061', 60000, 'Food week 5', 5],
    ['PC062', 20000, 'Others week 5', 5],
    ['PC072', 35000],
    ['PC073', 40000],
    ['PC081', 90000],
    ['PC082', 5000],
    ['PC091', 16500],
    ['RE011', 450000],
    ['RE012', 237500],
    ['RE014', 225000],
    ['RE015', 100000],
    ['UC014', 50000],
    ['UC017', 20000]
  ];
  for (let i = 0; i < 7; i++) {
    const m = shiftMonth(start, i);
    template.forEach(([code, amt, label, week], s) => {
      const past = m < currentMonth();
      const l: BudgetLine = { id: uid(), month: m, categoryId: C(code), label, week, baseline: amt, estimate: amt, closed: past, sort: s, updatedAt: at };
      changes.push({ table: 'budgetLines', put: l });
    });
  }

  // recurring
  const next = (day: number) => {
    const x = `${currentMonth()}-${String(day).padStart(2, '0')}`;
    return x >= today() ? x : addMonths(x, 1);
  };
  const recs: Array<Partial<Recurring> & Pick<Recurring, 'name' | 'kind' | 'amount'>> = [
    { name: 'Salary', kind: 'income', amount: 1800000, accountId: A('CUR001'), categoryId: C('IC011'), nextDate: next(1) },
    { name: 'Rent Bucharest', kind: 'bill', amount: 350000, accountId: A('CUR001'), categoryId: C('PC011'), nextDate: next(2) },
    { name: 'DIGI Bucharest', kind: 'bill', amount: 11500, accountId: A('CUR001'), categoryId: C('PC014'), nextDate: next(15) },
    { name: 'Phone', kind: 'bill', amount: 6100, accountId: A('CUR001'), categoryId: C('PC031'), nextDate: next(5) },
    { name: 'Video streaming', kind: 'subscription', amount: 5500, accountId: A('CUR001'), categoryId: C('PC032'), nextDate: next(6) },
    { name: 'Movies streaming', kind: 'subscription', amount: 7250, accountId: A('CUR001'), categoryId: C('PC032'), nextDate: next(6) },
    { name: 'AI assistant', kind: 'subscription', amount: 11000, accountId: A('CUR001'), categoryId: C('PC032'), nextDate: next(18) },
    { name: 'Cloud hosting', kind: 'subscription', amount: 3000, accountId: A('CUR001'), categoryId: C('PC032'), nextDate: next(21) },
    { name: 'Taxes set aside', kind: 'transfer', amount: 450000, accountId: A('CUR001'), toAccountId: A('RES003'), categoryId: C('RE011'), nextDate: next(2) },
    { name: 'Yearly expenses fund', kind: 'transfer', amount: 237500, accountId: A('CUR001'), toAccountId: A('RES001'), categoryId: C('RE012'), nextDate: next(2) },
    { name: 'Car insurance', kind: 'bill', amount: 165000, accountId: A('RES001'), categoryId: C('DIV001'), frequency: 'yearly', nextDate: addMonths(today(), 2) }
  ];
  for (const r of recs)
    changes.push({
      table: 'recurring',
      put: { id: uid(), frequency: 'monthly', interval: 1, startDate: r.nextDate, active: true, updatedAt: at, categoryId: null, accountId: A('CUR001'), nextDate: today(), ...r } as Recurring
    });

  // yearly fund
  const y = Number(today().slice(0, 4));
  const fund: YearlyFund = { id: String(y), year: y, accountId: A('RES001'), monthlyContribution: 237500, updatedAt: at };
  changes.push({ table: 'yearlyFunds', put: fund });
  const items: Array<[string, number, string, boolean]> = [
    ['Gas check', 75000, `${y}-01-08`, true],
    ['Air filters', 40000, `${y}-01-31`, true],
    ['Car tax', 15000, `${y}-03-01`, true],
    ['House tax', 53000, `${y}-03-01`, true],
    ["Women's day", 47500, `${y}-03-08`, true],
    ['Change tyres', 50000, `${y}-04-01`, true],
    ['Car insurance', 165000, `${y}-06-15`, true],
    ['Car service', 120000, `${y}-09-10`, true],
    ['Change tyres', 50000, `${y}-11-01`, false],
    ['Christmas presents', 250000, `${y}-12-10`, false],
    ['Domain & hosting', 60000, `${y}-12-20`, false]
  ];
  for (const [name, est, due, paid] of items) {
    const it: YearlyItem = { id: uid(), year: y, name, categoryId: null, estimated: est, actualOverride: paid ? est : undefined, dueDate: due, paid, updatedAt: at };
    changes.push({ table: 'yearlyItems', put: it });
  }
  // scenarios
  const sc: Scenario[] = [
    { id: uid(), name: 'Income 15% lower', color: '#9B5BB5', incomeChangePct: -15, updatedAt: at },
    { id: uid(), name: 'Tighter spending', color: '#C98512', spendChangePct: -10, updatedAt: at }
  ];
  for (const s of sc) changes.push({ table: 'scenarios', put: s });
  // EUR rates (synthetic)
  for (let i = 0; i < 200; i++) {
    const date = addMonths(today(), -7).slice(0, 8) + '01';
    const d = new Date(date);
    d.setDate(d.getDate() + i);
    const iso = d.toISOString().slice(0, 10);
    const r: FxRate = { id: `EUR:${iso}`, date: iso, currency: 'EUR', rate: Math.round((4.97 + Math.sin(i / 20) * 0.02) * 10000) / 10000, updatedAt: at };
    changes.push({ table: 'fxRates', put: r });
  }
  // a EUR savings account
  changes.push({ table: 'accounts', put: { id: uid(), code: 'SAV101', name: 'Savings EUR', type: 'savings', currency: 'EUR', openingBalance: 300000, openingDate: startDate, sort: 20, updatedAt: at } as Account });
  await commit(changes, 'Load sample data');
}
