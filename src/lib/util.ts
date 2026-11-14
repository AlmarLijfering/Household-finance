import type { ISODate, MonthKey } from './types';

export function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export const nowIso = () => new Date().toISOString();

let _device: string | null = null;
export function deviceId(): string {
  if (_device) return _device;
  try {
    _device = localStorage.getItem('pfm.device');
    if (!_device) {
      _device = uid();
      localStorage.setItem('pfm.device', _device);
    }
  } catch {
    _device = 'device-' + uid();
  }
  return _device;
}

// ---------- money ----------
export const toMinor = (n: number) => Math.round((Number(n) || 0) * 100);
export const fromMinor = (m: number) => m / 100;

const fmtCache = new Map<string, Intl.NumberFormat>();
export function fmtMoney(minor: number, currency = 'RON', opts: { sign?: boolean; compact?: boolean } = {}): string {
  const key = currency + (opts.compact ? 'c' : '');
  let f = fmtCache.get(key);
  if (!f) {
    f = new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency,
      currencyDisplay: 'code',
      minimumFractionDigits: opts.compact ? 0 : 2,
      maximumFractionDigits: opts.compact ? 0 : 2
    });
    fmtCache.set(key, f);
  }
  const s = f.format(Math.abs(minor) / 100).replace(currency, '').trim();
  const sign = minor < 0 ? '−' : opts.sign && minor > 0 ? '+' : '';
  return `${sign}${s}`;
}
export function fmtNum(minor: number, compact = false) {
  return fmtMoney(minor, 'RON', { compact });
}

/** Parse user-typed amounts: accepts "1.234,56", "1,234.56", "-50", "50 lei". */
export function parseAmount(input: string): number | null {
  let s = String(input).trim().replace(/[^\d,.\-−+]/g, '').replace('−', '-');
  if (!s) return null;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(/,/g, '');
  const n = Number(s);
  return Number.isFinite(n) ? toMinor(n) : null;
}

// ---------- dates ----------
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export const pad = (n: number) => String(n).padStart(2, '0');
export function isoDate(d: Date): ISODate {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
// A closed year opened read-only behaves as if today were late in its last budget month.
const ARCHIVE_TODAY: ISODate | null = (() => {
  try {
    const v = new URLSearchParams(location.search).get('archive');
    return v && /^\d{4}$/.test(v) ? `${v}-12-20` : null;
  } catch {
    return null;
  }
})();
export const today = (): ISODate => ARCHIVE_TODAY ?? isoDate(new Date());
export const monthOf = (d: ISODate): MonthKey => d.slice(0, 7);
export const currentMonth = (): MonthKey => monthOf(today());
export function parseISO(d: ISODate): Date {
  const [y, m, dd] = d.split('-').map(Number);
  return new Date(y, m - 1, dd);
}
export function addDays(d: ISODate, n: number): ISODate {
  const x = parseISO(d);
  x.setDate(x.getDate() + n);
  return isoDate(x);
}
export function addMonths(d: ISODate, n: number): ISODate {
  const x = parseISO(d);
  const day = x.getDate();
  x.setDate(1);
  x.setMonth(x.getMonth() + n);
  const last = new Date(x.getFullYear(), x.getMonth() + 1, 0).getDate();
  x.setDate(Math.min(day, last));
  return isoDate(x);
}
export function shiftMonth(m: MonthKey, n: number): MonthKey {
  return monthOf(addMonths(m + '-01', n));
}
export function monthStart(m: MonthKey): ISODate {
  return m + '-01';
}
export function monthEnd(m: MonthKey): ISODate {
  const [y, mm] = m.split('-').map(Number);
  return `${m}-${pad(new Date(y, mm, 0).getDate())}`;
}
export function monthLabel(m: MonthKey, long = true): string {
  const [y, mm] = m.split('-').map(Number);
  return `${(long ? MONTHS_LONG : MONTHS)[mm - 1]} ${y}`;
}
/** Week of month as used in the household workbook: days 1–7 = week 1, …, 29–31 = week 5. */
export function weekOfMonth(d: ISODate): number {
  return Math.min(5, Math.floor((Number(d.slice(8, 10)) - 1) / 7) + 1);
}
export function fmtDate(d: ISODate, withYear = false): string {
  const x = parseISO(d);
  return `${x.getDate()} ${MONTHS[x.getMonth()]}${withYear ? ' ' + x.getFullYear() : ''}`;
}
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/** "Mon 9 Nov 2026" */
export function fmtDay(d: ISODate): string {
  return `${DOW[parseISO(d).getDay()]} ${fmtDate(d, true)}`;
}
export function daysBetween(a: ISODate, b: ISODate): number {
  return Math.round((parseISO(b).getTime() - parseISO(a).getTime()) / 86400000);
}

export function groupBy<T, K extends string | number>(xs: T[], f: (x: T) => K): Record<K, T[]> {
  const out = {} as Record<K, T[]>;
  for (const x of xs) (out[f(x)] ||= []).push(x);
  return out;
}
export const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
export function cx(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(' ');
}
