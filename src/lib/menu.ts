// The side menu, set up per device: which pages, in what order, in which sections, with what
// names and icons, which ones go in the phone bar, and the page the app opens on.
import { useEffect, useState } from 'react';

export interface MenuItemDef {
  id: string;
  to: string;
  label: string;
  icon: string;
  desc: string;
  /** Where the page lives in the app, used to group the "add a page" list. */
  area: 'daily' | 'setup' | 'data' | 'device';
  fixed?: boolean; // cannot be removed (Settings, so the setup stays reachable)
}

export const MENU_ITEMS: MenuItemDef[] = [
  { id: 'budget', to: '/budget', label: 'Budget', icon: 'budget', desc: 'This month’s budget and the year view', area: 'daily' },
  { id: 'accounts', to: '/accounts', label: 'Accounts', icon: 'accounts', desc: 'Balances and bank balances', area: 'daily' },
  { id: 'transactions', to: '/transactions', label: 'Transactions', icon: 'list', desc: 'Search and filter everything', area: 'daily' },
  { id: 'overview', to: '/', label: 'Overview', icon: 'home', desc: 'This month at a glance', area: 'daily' },
  { id: 'yearly', to: '/yearly', label: 'Yearly expenses', icon: 'envelope', desc: 'Once-a-year costs and their fund', area: 'daily' },
  { id: 'forecast', to: '/forecast', label: 'Forecast', icon: 'forecast', desc: 'Projected balances and scenarios', area: 'daily' },
  { id: 'reports', to: '/reports', label: 'Reports', icon: 'report', desc: 'Charts and Excel downloads', area: 'daily' },
  { id: 'categories', to: '/categories', label: 'Categories', icon: 'list', desc: 'Add, edit and limit categories', area: 'setup' },
  { id: 'recurring', to: '/recurring', label: 'Bills & income', icon: 'repeat', desc: 'Subscriptions, salary, monthly transfers', area: 'setup' },
  { id: 'household', to: '/settings/household', label: 'Household & currency', icon: 'user', desc: 'Name, budget months, currencies and rates', area: 'setup' },
  { id: 'sync', to: '/settings/sync', label: 'Sync & sharing', icon: 'cloud', desc: 'OneDrive, who has access, encryption, backups', area: 'setup' },
  { id: 'import', to: '/import', label: 'Import from Excel', icon: 'import', desc: 'Bring in a budget workbook', area: 'data' },
  { id: 'years', to: '/years', label: 'Years & archive', icon: 'archive', desc: 'Close a finished year, open old years read-only', area: 'data' },
  { id: 'data', to: '/settings/data', label: 'Export & backup', icon: 'download', desc: 'Excel export, backup copy, restore', area: 'data' },
  { id: 'menu', to: '/settings/menu', label: 'Menu setup', icon: 'edit', desc: 'This menu: pages, order, sections, phone bar', area: 'device' },
  { id: 'settings', to: '/settings', label: 'Settings & sync', icon: 'settings', desc: 'Everything to set up, in one place', area: 'device', fixed: true }
];

/** Icons you can pick for a menu item. */
export const MENU_ICONS = ['home', 'budget', 'accounts', 'list', 'envelope', 'repeat', 'forecast', 'report', 'calendar', 'transfer', 'split', 'scale', 'note', 'archive', 'import', 'download', 'cloud', 'user', 'lock', 'edit', 'search', 'settings'];

export type MenuRow =
  | { kind: 'page'; id: string; label?: string; icon?: string }
  | { kind: 'section'; id: string; label?: string };

export interface MenuConfig {
  v: 2;
  rows: MenuRow[];
  start: string; // page id the app opens on
  bar: string[] | null; // pages in the phone bar (max 3); null = the first three
}

export const PHONE_BAR_MAX = 3;

const page = (id: string): MenuRow => ({ kind: 'page', id });
export const newSectionId = () => 's' + Math.random().toString(36).slice(2, 8);

export const DEFAULT_MENU: MenuConfig = {
  v: 2,
  rows: ['budget', 'accounts', 'transactions', 'overview', 'yearly', 'forecast', 'reports'].map(page).concat([{ kind: 'section', id: 'lower' }, page('settings')]),
  start: 'overview',
  bar: null
};

const KEY = 'pfm.menu';
const EVENT = 'pfm-menu';
const known = new Map(MENU_ITEMS.map((i) => [i.id, i]));

/** The first menu setup (one dividing line, hidden items) turned into the current one, unchanged in what it shows. */
function fromV1(c: { order?: string[]; labels?: Record<string, string>; hidden?: string[]; start?: string }): MenuConfig {
  const hidden = new Set(c.hidden ?? []);
  const rows: MenuRow[] = [];
  for (const id of c.order ?? []) {
    if (id === 'divider') rows.push({ kind: 'section', id: 'lower' });
    else if (known.has(id) && !hidden.has(id)) rows.push({ kind: 'page', id, label: c.labels?.[id]?.trim() || undefined });
  }
  return { v: 2, rows, start: c.start ?? 'overview', bar: null };
}

/** Saved setup, repaired: unknown or doubled pages dropped, Settings always present, start page valid. */
export function loadMenu(): MenuConfig {
  let raw: any = null;
  try {
    raw = JSON.parse(localStorage.getItem(KEY) || 'null');
  } catch {}
  const c: MenuConfig = !raw ? structuredClone(DEFAULT_MENU) : raw.v === 2 ? raw : fromV1(raw);
  const seen = new Set<string>();
  const rows = (c.rows ?? []).filter((r) => {
    if (r.kind === 'section') return !!r.id && !seen.has('§' + r.id) && seen.add('§' + r.id);
    return known.has(r.id) && !seen.has(r.id) && !!seen.add(r.id);
  });
  if (!rows.some((r) => r.kind === 'page' && r.id === 'settings')) rows.push(page('settings'));
  const pages = rows.filter((r) => r.kind === 'page').map((r) => r.id);
  const start = pages.includes(c.start) ? c.start : pages.includes('overview') ? 'overview' : pages[0];
  const bar = c.bar ? c.bar.filter((id) => pages.includes(id) && id !== 'settings').slice(0, PHONE_BAR_MAX) : null;
  return { v: 2, rows, start, bar };
}

export function saveMenu(c: MenuConfig | null) {
  try {
    if (c) localStorage.setItem(KEY, JSON.stringify(c));
    else localStorage.removeItem(KEY);
  } catch {}
  window.dispatchEvent(new Event(EVENT));
}

export interface MenuEntry extends MenuItemDef {
  name: string; // label to show
}
export interface MenuGroup {
  id: string;
  label?: string; // section heading; none = just a line
  items: MenuEntry[];
}
export interface ResolvedMenu {
  groups: MenuGroup[];
  visible: MenuEntry[]; // all shown, in order
  start: MenuEntry;
  bar: MenuEntry[]; // phone bar
}

export function entryFor(r: Extract<MenuRow, { kind: 'page' }>): MenuEntry {
  const def = known.get(r.id)!;
  return { ...def, icon: r.icon || def.icon, name: r.label?.trim() || def.label };
}

export function resolveMenu(c: MenuConfig): ResolvedMenu {
  const groups: MenuGroup[] = [{ id: 'top', items: [] }];
  for (const r of c.rows) {
    if (r.kind === 'section') groups.push({ id: r.id, label: r.label?.trim() || undefined, items: [] });
    else groups[groups.length - 1].items.push(entryFor(r));
  }
  const visible = groups.flatMap((g) => g.items);
  const start = visible.find((e) => e.id === c.start) ?? visible[0];
  const bar = c.bar ? visible.filter((e) => c.bar!.includes(e.id)) : visible.filter((e) => e.id !== 'settings').slice(0, PHONE_BAR_MAX);
  return { groups: groups.filter((g) => g.items.length || g.label), visible, start, bar };
}

export function useMenu(): ResolvedMenu {
  const [c, setC] = useState(loadMenu);
  useEffect(() => {
    const h = () => setC(loadMenu());
    window.addEventListener(EVENT, h);
    window.addEventListener('storage', h);
    return () => {
      window.removeEventListener(EVENT, h);
      window.removeEventListener('storage', h);
    };
  }, []);
  return resolveMenu(c);
}
