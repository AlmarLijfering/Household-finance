// Predefined Excel reports built in the browser from committed data.
// Every data sheet is a structured Excel Table so PivotTables, Power Query and slicers can use it.
import type ExcelJS from 'exceljs';
import { loadExcel } from '../importer/workbook';
import { categoryLabel, kindOf, lines, txBase, type Model } from '../calc/model';
import { computeMonth } from '../calc/budget';
import { balanceHistory, cashFlow, incomeByCategory, monthsBetween, spendingByCategory } from '../calc/reports';
import { MONTHS, monthLabel, shiftMonth } from '../util';
import { currentBudgetMonth } from '../calc/period';

const INK = 'FF1C2A39';
const MOSS = 'FF2F6B4F';
const PAPER = 'FFF4F6F5';
const NUM = '#,##0.00;[Red]-#,##0.00';

export interface ReportOptions {
  from: string; // YYYY-MM
  to: string;
  revision?: number;
  pivot?: boolean; // add a sample PivotTable (Excel desktop/web)
}

export function defaultReportRange(m: Model): ReportOptions {
  const months = [...m.transactions.map((t) => t.date.slice(0, 7)), ...m.budgetLines.map((b) => b.month)].sort();
  const to = currentBudgetMonth(m);
  const from = months[0] && months[0] < to ? months[0] : shiftMonth(to, -11);
  return { from: from < shiftMonth(to, -35) ? shiftMonth(to, -35) : from, to };
}

const v = (minor: number) => Math.round(minor) / 100;

function header(ws: ExcelJS.Worksheet, title: string, subtitle: string) {
  ws.getCell('A1').value = title;
  ws.getCell('A1').font = { name: 'Calibri', size: 16, bold: true, color: { argb: INK } };
  ws.getCell('A2').value = subtitle;
  ws.getCell('A2').font = { size: 10, color: { argb: 'FF5B6873' } };
  ws.views = [{ state: 'frozen', ySplit: 4 }];
}

function addTable(ws: ExcelJS.Worksheet, name: string, ref: string, columns: Array<{ name: string; width?: number; money?: boolean; date?: boolean; total?: boolean }>, rows: any[][]) {
  ws.addTable({
    name,
    ref,
    headerRow: true,
    totalsRow: columns.some((c) => c.total),
    style: { theme: 'TableStyleMedium4', showRowStripes: true },
    columns: columns.map((c, i) => ({
      name: c.name,
      filterButton: true,
      totalsRowFunction: c.total ? 'sum' : i === 0 ? 'none' : 'none',
      totalsRowLabel: i === 0 && columns.some((x) => x.total) ? 'Total' : undefined
    })) as any,
    rows: rows.length ? rows : [columns.map(() => null)]
  });
  const startCol = ws.getCell(ref).col as unknown as number;
  columns.forEach((c, i) => {
    const col = ws.getColumn(Number(startCol) + i);
    col.width = c.width ?? Math.max(12, c.name.length + 4);
    if (c.money) col.numFmt = NUM;
    if (c.date) col.numFmt = 'yyyy-mm-dd';
  });
}

export async function buildReportWorkbook(m: Model, o: ReportOptions): Promise<ArrayBuffer> {
  const Excel = await loadExcel();
  const wb = new Excel.Workbook();
  wb.creator = 'Household Finance';
  wb.created = new Date();
  const base = m.settings.baseCurrency;
  const period = `${monthLabel(o.from)} – ${monthLabel(o.to)}`;
  const filter = { from: o.from, to: o.to };
  const months = monthsBetween(o.from, o.to);
  const mLabel = (mm: string) => `${MONTHS[Number(mm.slice(5, 7)) - 1]} ${mm.slice(0, 4)}`;

  // --- Summary
  const s = wb.addWorksheet('Summary', { properties: { tabColor: { argb: INK } } });
  header(s, m.settings.householdName + ' — finance reports', `${period}. Amounts in ${base}. Generated ${new Date().toLocaleString('en-GB')}${o.revision ? `, data revision ${o.revision}` : ''}.`);
  s.views = [];
  const cf = cashFlow(m, filter);
  const tot = (k: 'income' | 'spending' | 'net' | 'reserved') => cf.reduce((a, r) => a + r[k], 0);
  const bh = balanceHistory(m, { from: o.to, to: o.to })[0];
  const sumRows: Array<[string, number]> = [
    ['Income in period', tot('income')],
    ['Spending in period', tot('spending')],
    ['Net cash flow', tot('net')],
    ['Moved into reserve funds', tot('reserved')],
    ['Current and cash accounts at period end', bh?.spendable ?? 0],
    ['Reserve and savings accounts at period end', bh?.reserves ?? 0]
  ];
  sumRows.forEach(([label, val], i) => {
    s.getCell(`A${4 + i}`).value = label;
    s.getCell(`B${4 + i}`).value = v(val);
    s.getCell(`B${4 + i}`).numFmt = NUM;
  });
  s.getColumn(1).width = 46;
  s.getColumn(2).width = 18;
  s.getCell('A12').value = 'Sheets in this workbook are rebuilt by the app after every sync. Keep your own analyses in a separate workbook that reads "Household Data.xlsx" with Power Query, so updates never overwrite them.';
  s.getCell('A12').alignment = { wrapText: true, vertical: 'top' };
  s.mergeCells('A12:F14');

  // --- Cash flow monthly
  const c1 = wb.addWorksheet('Cash flow by month');
  header(c1, 'Cash flow by month', `Income and spending exclude transfers between your own accounts. ${period}.`);
  addTable(
    c1,
    'CashFlowMonthly',
    'A4',
    [{ name: 'Month', width: 14 }, { name: 'Year' }, { name: 'Income', money: true, total: true }, { name: 'Spending', money: true, total: true }, { name: 'Net', money: true, total: true }, { name: 'Into reserves', money: true, total: true }],
    cf.map((r) => [mLabel(r.month), Number(r.month.slice(0, 4)), v(r.income), v(r.spending), v(r.net), v(r.reserved)])
  );

  // --- Cash flow annual
  const c2 = wb.addWorksheet('Cash flow by year');
  header(c2, 'Cash flow by year', period);
  const years = Array.from(new Set(cf.map((r) => r.month.slice(0, 4))));
  addTable(
    c2,
    'CashFlowAnnual',
    'A4',
    [{ name: 'Year' }, { name: 'Income', money: true, total: true }, { name: 'Spending', money: true, total: true }, { name: 'Net', money: true, total: true }, { name: 'Into reserves', money: true, total: true }],
    years.map((y) => {
      const rs = cf.filter((r) => r.month.startsWith(y));
      const t = (k: 'income' | 'spending' | 'net' | 'reserved') => v(rs.reduce((a, r) => a + r[k], 0));
      return [Number(y), t('income'), t('spending'), t('net'), t('reserved')];
    })
  );

  // --- Income / spending by category (month columns)
  const grid = (name: string, title: string, tableName: string, data: ReturnType<typeof spendingByCategory>) => {
    const ws = wb.addWorksheet(name);
    header(ws, title, period);
    addTable(
      ws,
      tableName,
      'A4',
      [{ name: 'Code', width: 9 }, { name: 'Category', width: 28 }, { name: 'Section', width: 16 }, ...data.months.map((mm) => ({ name: mLabel(mm), money: true, total: true })), { name: 'Total', money: true, total: true }],
      data.rows.map((r) => {
        const c = r.categoryId === 'none' ? undefined : m.categoryById.get(r.categoryId as string);
        return [c?.code ?? '', c?.name ?? 'Uncategorised', c?.section ?? '', ...r.values.map(v), v(r.total)];
      })
    );
  };
  grid('Income by category', 'Income by category', 'IncomeByCategory', incomeByCategory(m, filter));
  grid('Spending by category', 'Spending by category', 'SpendingByCategory', spendingByCategory(m, filter));

  // --- Account balances
  const ab = wb.addWorksheet('Account balances');
  header(ab, 'Account balances at month end', `Converted to ${base} at the rate on the last day of each month.`);
  const hist = balanceHistory(m, filter);
  const accs = m.accounts.filter((a) => !a.archived);
  addTable(
    ab,
    'AccountBalances',
    'A4',
    [{ name: 'Month', width: 14 }, ...accs.map((a) => ({ name: a.name, money: true })), { name: 'Current & cash', money: true }, { name: 'Reserves & savings', money: true }, { name: 'Total', money: true }],
    hist.map((h) => [mLabel(h.month), ...accs.map((a) => v(h.perAccount[a.id] ?? 0)), v(h.spendable), v(h.reserves), v(h.total)])
  );

  // --- Budget vs actual (long format for pivots)
  const bva = wb.addWorksheet('Budget vs actual');
  header(bva, 'Budget versus actual', 'One row per budget line. Remaining follows the workbook rule: zero when closed or fully spent.');
  const bRows: any[][] = [];
  for (const mm of months) {
    const mb = computeMonth(m, mm);
    for (const r of mb.lines) {
      const c = m.categoryById.get(r.line.categoryId);
      const g = c ? m.groupById.get(c.groupId) : undefined;
      bRows.push([mLabel(mm), Number(mm.slice(0, 4)), g?.name ?? '', c?.section ?? '', c?.code ?? '', c?.name ?? '', r.line.label ?? c?.name ?? '', v(r.line.baseline), v(r.available), v(r.actual), v(r.remaining), v(r.over), r.line.closed ? 'Yes' : 'No']);
    }
    for (const u of mb.unbudgeted) {
      const c = m.categoryById.get(u.categoryId);
      const g = c ? m.groupById.get(c.groupId) : undefined;
      bRows.push([mLabel(mm), Number(mm.slice(0, 4)), g?.name ?? '', c?.section ?? '', c?.code ?? '', c?.name ?? '', 'Not budgeted', 0, 0, v(u.actual), 0, v(u.actual), 'No']);
    }
  }
  addTable(
    bva,
    'BudgetVsActual',
    'A4',
    [{ name: 'Month', width: 14 }, { name: 'Year' }, { name: 'Group', width: 16 }, { name: 'Section', width: 16 }, { name: 'Code' }, { name: 'Category', width: 26 }, { name: 'Line', width: 22 }, { name: 'Baseline', money: true, total: true }, { name: 'Estimate', money: true, total: true }, { name: 'Actual', money: true, total: true }, { name: 'Remaining', money: true, total: true }, { name: 'Over budget', money: true, total: true }, { name: 'Closed' }],
    bRows
  );

  // --- Transactions (detail)
  const tx = wb.addWorksheet('Transactions');
  header(tx, 'Transactions', 'Split transactions appear once per split. Transfers are marked so you can filter them out.');
  const txRows: any[][] = [];
  const ls = lines(m).filter((l) => l.month >= o.from && l.month <= o.to).sort((a, b) => a.date.localeCompare(b.date));
  for (const l of ls) {
    const a = m.accountById.get(l.tx.accountId);
    const c = l.categoryId ? m.categoryById.get(l.categoryId) : undefined;
    const g = c ? m.groupById.get(c.groupId) : undefined;
    const kind = kindOf(m, l.categoryId);
    txRows.push([
      new Date(l.date + 'T00:00:00Z'),
      Number(l.date.slice(0, 4)),
      mLabel(l.month),
      `Week ${l.week}`,
      a?.name ?? '',
      a?.type ?? '',
      l.tx.payee ?? '',
      l.tx.memo ?? '',
      g?.name ?? (l.tx.transferId ? 'Transfers' : ''),
      c?.section ?? '',
      c?.code ?? '',
      categoryLabel(m, l.categoryId),
      v(l.amount),
      l.tx.transferId || kind === 'transfer' ? 'Yes' : 'No',
      l.tx.status
    ]);
  }
  addTable(
    tx,
    'Transactions',
    'A4',
    [{ name: 'Date', date: true }, { name: 'Year' }, { name: 'Month', width: 12 }, { name: 'Week' }, { name: 'Account', width: 18 }, { name: 'Account type' }, { name: 'Payee', width: 22 }, { name: 'Memo', width: 22 }, { name: 'Group', width: 16 }, { name: 'Section', width: 14 }, { name: 'Code' }, { name: 'Category', width: 24 }, { name: `Amount (${base})`, money: true, total: true }, { name: 'Transfer' }, { name: 'Status' }],
    txRows
  );

  void txBase;
  return wb.xlsx.writeBuffer() as Promise<ArrayBuffer>;
}

/** A tables-only workbook meant as a stable Power Query / PivotTable source. */
export async function buildDataWorkbook(m: Model, o: ReportOptions): Promise<ArrayBuffer> {
  const Excel = await loadExcel();
  const wb = new Excel.Workbook();
  const ls = lines(m).filter((l) => l.month >= o.from && l.month <= o.to);
  const ws = wb.addWorksheet('Transactions');
  ws.addTable({
    name: 'tblTransactions',
    ref: 'A1',
    headerRow: true,
    columns: ['Date', 'Year', 'MonthNo', 'Account', 'AccountType', 'Payee', 'GroupCode', 'Group', 'Section', 'Code', 'Category', 'Amount', 'IsTransfer'].map((name) => ({ name, filterButton: true })),
    rows: ls.length
      ? ls.map((l) => {
          const a = m.accountById.get(l.tx.accountId);
          const c = l.categoryId ? m.categoryById.get(l.categoryId) : undefined;
          const g = c ? m.groupById.get(c.groupId) : undefined;
          return [new Date(l.date + 'T00:00:00Z'), Number(l.date.slice(0, 4)), Number(l.date.slice(5, 7)), a?.name ?? '', a?.type ?? '', l.tx.payee ?? '', g?.code ?? '', g?.name ?? '', c?.section ?? '', c?.code ?? '', c?.name ?? '', v(l.amount), l.tx.transferId || kindOf(m, l.categoryId) === 'transfer' ? 1 : 0];
        })
      : [Array(13).fill(null)]
  });
  ws.getColumn(1).numFmt = 'yyyy-mm-dd';
  const bw = wb.addWorksheet('Budget');
  const rows: any[][] = [];
  for (const mm of monthsBetween(o.from, o.to))
    for (const r of computeMonth(m, mm).lines) {
      const c = m.categoryById.get(r.line.categoryId);
      rows.push([Number(mm.slice(0, 4)), Number(mm.slice(5, 7)), c?.code ?? '', c?.name ?? '', r.line.label ?? '', v(r.line.baseline), v(r.available), v(r.actual), v(r.remaining), r.line.closed ? 1 : 0]);
    }
  bw.addTable({ name: 'tblBudget', ref: 'A1', headerRow: true, columns: ['Year', 'MonthNo', 'Code', 'Category', 'Line', 'Baseline', 'Estimate', 'Actual', 'Remaining', 'Closed'].map((name) => ({ name, filterButton: true })), rows: rows.length ? rows : [Array(10).fill(null)] });
  return wb.xlsx.writeBuffer() as Promise<ArrayBuffer>;
}
