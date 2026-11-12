// "Export to Excel": everything in the app as readable tables, one sheet per kind of record.
import { loadExcel } from '../importer/workbook';
import { accountBalance, categoryLabel, scopeLabel, toBase, type Model } from '../calc/model';
import { computeMonth } from '../calc/budget';
import { period, txMonth, txWeek } from '../calc/period';
import { monthlyEquivalent } from '../calc/recurring';
import { MONTHS, today } from '../util';
import type { Transaction } from '../types';

const NUM = '#,##0.00;[Red]-#,##0.00';
const v = (minor: number | undefined | null) => (minor == null ? null : Math.round(minor) / 100);
const d = (iso: string | undefined | null) => (iso ? new Date(iso + 'T00:00:00Z') : null);
const ml = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;

type Col = { name: string; width?: number; money?: boolean; date?: boolean };

function sheet(wb: any, title: string, tableName: string, cols: Col[], rows: any[][]) {
  const ws = wb.addWorksheet(title, { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.addTable({
    name: tableName,
    ref: 'A1',
    headerRow: true,
    style: { theme: 'TableStyleMedium4', showRowStripes: true },
    columns: cols.map((c) => ({ name: c.name, filterButton: true })),
    rows: rows.length ? rows : [cols.map(() => null)]
  });
  cols.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    col.width = c.width ?? Math.max(11, c.name.length + 3);
    if (c.money) col.numFmt = NUM;
    if (c.date) col.numFmt = 'yyyy-mm-dd';
  });
}

function txRows(m: Model, txs: Transaction[]) {
  const rows: any[][] = [];
  for (const t of txs) {
    const a = m.accountById.get(t.accountId);
    const parts = t.splits?.length ? t.splits.map((s) => ({ categoryId: s.categoryId, amount: s.amount, split: true })) : [{ categoryId: t.categoryId, amount: t.amount, split: false }];
    for (const p of parts) {
      const c = p.categoryId ? m.categoryById.get(p.categoryId) : undefined;
      const g = c ? m.groupById.get(c.groupId) : undefined;
      const bm = txMonth(m, t);
      rows.push([
        d(t.date),
        ml(bm),
        txWeek(m, t),
        a?.name ?? '',
        t.payee ?? '',
        t.memo ?? '',
        c?.code ?? '',
        p.categoryId ? categoryLabel(m, p.categoryId) : t.transferId ? '' : 'Uncategorised',
        g?.name ?? '',
        c?.section ?? '',
        t.transferId ? (t.amount < 0 ? `To ${m.accountById.get(t.transferAccountId ?? '')?.name ?? ''}` : `From ${m.accountById.get(t.transferAccountId ?? '')?.name ?? ''}`) : '',
        p.split ? 'Yes' : 'No',
        v(p.amount),
        a?.currency ?? m.settings.baseCurrency,
        v(toBase(m, p.amount, a?.currency ?? m.settings.baseCurrency, t.date))
      ]);
    }
  }
  return rows;
}

const TX_COLS: Col[] = [
  { name: 'Date', date: true },
  { name: 'Budget month', width: 14 },
  { name: 'Week' },
  { name: 'Account', width: 18 },
  { name: 'Payee', width: 24 },
  { name: 'Memo', width: 22 },
  { name: 'Code' },
  { name: 'Category', width: 24 },
  { name: 'Group', width: 16 },
  { name: 'Section', width: 14 },
  { name: 'Transfer', width: 20 },
  { name: 'Split' },
  { name: 'Amount', money: true },
  { name: 'Currency' },
  { name: 'Amount (base)', money: true }
];

/** Only the given transactions (e.g. what is filtered on the Transactions page). */
export async function exportTransactions(m: Model, txs: Transaction[]): Promise<ArrayBuffer> {
  const Excel = await loadExcel();
  const wb = new Excel.Workbook();
  sheet(wb, 'Transactions', 'Transactions', TX_COLS, txRows(m, [...txs].sort((a, b) => a.date.localeCompare(b.date))));
  return wb.xlsx.writeBuffer() as Promise<ArrayBuffer>;
}

/** Everything: transactions, accounts, categories, budgets, bills, yearly items, plans. */
export async function exportAll(m: Model): Promise<ArrayBuffer> {
  const Excel = await loadExcel();
  const wb = new Excel.Workbook();
  wb.creator = 'Household Finance';

  sheet(wb, 'Transactions', 'Transactions', TX_COLS, txRows(m, [...m.transactions].sort((a, b) => a.date.localeCompare(b.date))));

  sheet(
    wb,
    'Accounts',
    'Accounts',
    [{ name: 'Code' }, { name: 'Account', width: 22 }, { name: 'Kind' }, { name: 'Currency' }, { name: 'Opening balance', money: true }, { name: 'Opening date', date: true }, { name: 'Balance today', money: true }, { name: 'Bank balance', money: true }, { name: 'Bank date', date: true }, { name: 'Difference', money: true }, { name: 'Purpose', width: 28 }, { name: 'Archived' }],
    m.accounts.map((a) => {
      const onBankDate = a.statementBalance != null ? accountBalance(m, a.id, a.statementDate ?? today()) : null;
      return [a.code, a.name, a.type, a.currency, v(a.openingBalance), d(a.openingDate), v(accountBalance(m, a.id)), v(a.statementBalance), d(a.statementDate), onBankDate != null ? v(a.statementBalance! - onBankDate) : null, a.purpose ?? '', a.archived ? 'Yes' : 'No'];
    })
  );

  sheet(
    wb,
    'Categories',
    'Categories',
    [{ name: 'Code' }, { name: 'Category', width: 26 }, { name: 'Group', width: 18 }, { name: 'Section', width: 16 }, { name: 'Cost type' }, { name: 'Rollover' }, { name: 'Used on', width: 30 }, { name: 'Archived' }],
    m.categories.map((c) => [c.code, c.name, m.groupById.get(c.groupId)?.name ?? '', c.section ?? '', c.costType ?? '', c.rollover ?? 'none', scopeLabel(m, c), c.archived ? 'Yes' : 'No'])
  );

  const months = Array.from(new Set(m.budgetLines.map((b) => b.month))).sort();
  const bRows: any[][] = [];
  for (const mm of months) {
    const p = period(m, mm);
    for (const r of computeMonth(m, mm).lines) {
      const c = m.categoryById.get(r.line.categoryId);
      bRows.push([ml(mm), d(p.start), d(p.end), m.groupById.get(c?.groupId ?? '')?.name ?? '', c?.section ?? '', c?.code ?? '', c?.name ?? '', r.line.label ?? '', r.line.week ?? null, v(r.line.baseline), v(r.line.estimate), v(r.actual), v(r.remaining), r.line.closed ? 'Yes' : 'No']);
    }
  }
  sheet(
    wb,
    'Budget',
    'Budget',
    [{ name: 'Budget month', width: 14 }, { name: 'From', date: true }, { name: 'To', date: true }, { name: 'Group', width: 16 }, { name: 'Section', width: 14 }, { name: 'Code' }, { name: 'Category', width: 24 }, { name: 'Line', width: 18 }, { name: 'Week' }, { name: 'Baseline', money: true }, { name: 'Estimate', money: true }, { name: 'Actual', money: true }, { name: 'Remaining', money: true }, { name: 'Closed' }],
    bRows
  );

  sheet(
    wb,
    'Bills & income',
    'BillsIncome',
    [{ name: 'Name', width: 22 }, { name: 'Kind' }, { name: 'Payee', width: 20 }, { name: 'Account', width: 18 }, { name: 'To account', width: 18 }, { name: 'Category', width: 22 }, { name: 'Amount', money: true }, { name: 'Every' }, { name: 'Next date', date: true }, { name: 'Ends', date: true }, { name: 'Per month', money: true }, { name: 'Active' }],
    m.recurring
      .filter((r) => !r.scenarioId)
      .map((r) => [r.name, r.kind, r.payee ?? '', m.accountById.get(r.accountId)?.name ?? '', r.toAccountId ? m.accountById.get(r.toAccountId)?.name ?? '' : '', r.categoryId ? categoryLabel(m, r.categoryId) : '', v(r.amount), `${r.interval > 1 ? r.interval + ' ' : ''}${r.frequency}`, d(r.nextDate), d(r.endDate), v(monthlyEquivalent(r)), r.active && (!r.endDate || r.endDate >= today()) ? 'Yes' : 'No'])
  );

  sheet(
    wb,
    'Yearly expenses',
    'YearlyExpenses',
    [{ name: 'Year' }, { name: 'Item', width: 24 }, { name: 'Category', width: 22 }, { name: 'Estimated', money: true }, { name: 'Actual entered', money: true }, { name: 'Due date', date: true }, { name: 'Paid' }],
    m.yearlyItems.map((y) => [y.year, y.name, y.categoryId ? categoryLabel(m, y.categoryId) : '', v(y.estimated), v(y.actualOverride), d(y.dueDate), y.paid ? 'Yes' : 'No'])
  );

  sheet(
    wb,
    'Planned',
    'Planned',
    [{ name: 'Date', date: true }, { name: 'Scenario', width: 20 }, { name: 'Account', width: 18 }, { name: 'Category', width: 22 }, { name: 'Description', width: 24 }, { name: 'Amount', money: true }],
    m.planned.map((p) => [d(p.date), p.scenarioId ? m.scenarios.find((s) => s.id === p.scenarioId)?.name ?? '' : 'Base plan', m.accountById.get(p.accountId)?.name ?? '', p.categoryId ? categoryLabel(m, p.categoryId) : '', p.memo ?? '', v(p.amount)])
  );

  return wb.xlsx.writeBuffer() as Promise<ArrayBuffer>;
}

export function downloadXlsx(buf: ArrayBuffer, fileName: string) {
  const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
