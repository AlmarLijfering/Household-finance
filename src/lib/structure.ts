// The household's category structure, carried over from the Excel workbooks.
import type { AccountType, GroupKind } from './types';

export interface GroupDef {
  code: string;
  name: string;
  kind: GroupKind;
  sort: number;
}

export const GROUPS: GroupDef[] = [
  { code: 'IC', name: 'Income', kind: 'income', sort: 1 },
  { code: 'PC', name: 'Planned costs', kind: 'expense', sort: 2 },
  { code: 'RE', name: 'Reservations', kind: 'reservation', sort: 3 },
  { code: 'UC', name: 'Unplanned costs', kind: 'expense', sort: 4 },
  { code: 'YE', name: 'Yearly expenses', kind: 'expense', sort: 5 },
  { code: 'DIV', name: 'Paid from reserves', kind: 'expense', sort: 6 },
  { code: 'TR', name: 'Transfers', kind: 'transfer', sort: 7 },
  { code: 'SB', name: 'Opening balances', kind: 'opening', sort: 8 }
];

/** Category codes that are internal money movements rather than spending. */
const TRANSFER_CODES = new Set(['DIV002', 'DIV005']);

export function groupCodeFor(code: string): string {
  if (TRANSFER_CODES.has(code)) return 'TR';
  const m = /^([A-Z]+)/.exec(code);
  const p = m ? m[1] : '';
  return GROUPS.some((g) => g.code === p) ? p : 'UC';
}

const PC_SECTIONS: Record<string, string> = {
  '01': 'Bucharest',
  '02': 'Floresti',
  '03': 'Subscriptions',
  '04': 'Healthcare',
  '05': 'Joshua',
  '06': 'Food & others',
  '07': 'Personal care',
  '08': 'Car',
  '09': 'Professional'
};

export function sectionFor(code: string): string | undefined {
  const g = groupCodeFor(code);
  if (g === 'PC') return PC_SECTIONS[code.slice(2, 4)] ?? 'Planned costs';
  if (g === 'IC') return 'Income';
  if (g === 'RE') return 'Reservations';
  if (g === 'UC') return 'Unplanned';
  if (g === 'YE') return 'Yearly expenses';
  return undefined;
}

export function costTypeFor(code: string): 'fixed' | 'variable' | undefined {
  const g = groupCodeFor(code);
  if (g === 'PC') return ['01', '02', '03', '09'].includes(code.slice(2, 4)) && !/5$/.test(code) ? 'fixed' : 'variable';
  if (g === 'UC') return 'variable';
  if (g === 'RE') return 'fixed';
  return undefined;
}

export function accountTypeFor(code: string, name: string): AccountType {
  if (/wallet|cash|numerar/i.test(name)) return 'cash';
  if (/^CUR/i.test(code)) return 'current';
  if (/^SAV/i.test(code) && /saving/i.test(name)) return 'savings';
  return 'reserve';
}

/** Default categories (used for a fresh start without importing). */
export const DEFAULT_CATEGORIES: Array<[string, string]> = [
  ['IC011', 'Salary Almar'],
  ['IC012', 'Income therapy'],
  ['IC013', 'Extra therapy money'],
  ['IC014', 'Other income'],
  ['IC015', 'Remainder last month'],
  ['IC016', 'Rebate'],
  ['PC011', 'Rent Bucharest'],
  ['PC012', 'Gas Bucharest'],
  ['PC013', 'Electricity Bucharest'],
  ['PC014', 'DIGI Bucharest'],
  ['PC015', 'Expenses Bucharest'],
  ['PC022', 'Gas & electricity Floresti'],
  ['PC024', 'DIGI Floresti'],
  ['PC025', 'Expenses Floresti'],
  ['PC031', 'Phone bill'],
  ['PC032', 'Digital subscriptions'],
  ['PC041', 'Medicines'],
  ['PC042', 'Therapy Almar'],
  ['PC051', 'Teachers Joshua'],
  ['PC052', 'Therapy Joshua'],
  ['PC053', 'Pocket money Joshua'],
  ['PC054', 'Diverse Joshua'],
  ['PC061', 'Food'],
  ['PC062', 'Others'],
  ['PC071', 'Drycleaner'],
  ['PC072', 'Hairdresser'],
  ['PC073', 'Sport'],
  ['PC081', 'Gas car'],
  ['PC082', 'Car others'],
  ['PC091', 'Solo'],
  ['PC092', 'Orange work'],
  ['PC093', 'Professional courses'],
  ['RE011', 'Taxes'],
  ['RE012', 'Yearly expenses'],
  ['RE013', 'Pension'],
  ['RE014', 'Holiday'],
  ['RE015', 'Oxygen line'],
  ['RE016', 'Other reservations'],
  ['UC011', 'Roundings'],
  ['UC012', 'Books'],
  ['UC013', 'House'],
  ['UC014', 'Clothes'],
  ['UC015', 'Courses'],
  ['UC016', 'Plane tickets'],
  ['UC017', 'Diverse unplanned'],
  ['DIV001', 'Yearly expenses (paid)'],
  ['DIV002', 'Transfer'],
  ['DIV003', 'Medical cost'],
  ['DIV004', 'Expenses – oxygen line'],
  ['DIV005', 'Investments'],
  ['DIV006', 'Summer school Joshua'],
  ['SB001', 'Starting balance']
];

export const DEFAULT_ACCOUNTS: Array<[string, string, AccountType, string?]> = [
  ['CUR001', 'BRD Almar', 'current'],
  ['CUR002', 'BRD Flory', 'current'],
  ['CUR003', 'Wallet', 'cash'],
  ['RES001', 'Yearly expenses', 'reserve', 'Car, house and other once-a-year costs'],
  ['RES002', 'Oxygen line', 'reserve', 'Medical costs'],
  ['RES003', 'Taxes', 'reserve', 'Income tax set aside monthly'],
  ['RES004', 'Holiday', 'reserve', 'Holidays and trips'],
  ['RES006', 'Other reservations', 'reserve']
];
