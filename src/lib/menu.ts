// The menu, set up per device: order, labels, what is shown, and the page the app opens on.
import { useEffect, useState } from 'react';

export interface MenuItemDef {
  id: string;
  to: string;
  label: string;
  icon: string;
  desc: string;
  fixed?: boolean; // cannot be hidden (Settings, so the setup stays reachable)
}

export const MENU_ITEMS: MenuItemDef[] = [
  { id: 'budget', to: '/budget', label: 'Budget', icon: 'budget', desc: 'This month’s budget and the year view' },
  { id: 'accounts', to: '/accounts', label: 'Accounts', icon: 'accounts', desc: 'Balances and bank balances' },
  { id: 'transactions', to: '/transactions', label: 'Transactions', icon: 'list', desc: 'Search and filter everything' },
  { id: 'overview', to: '/', label: 'Overview', icon: 'home', desc: 'This month at a glance' },
  { id: 'recurring', to: '/recurring', label: 'Bills & income', icon: 'repeat', desc: 'Subscriptions, salary, monthly transfers' },
  { id: 'yearly', to: '/yearly', label: 'Yearly expenses', icon: 'envelope', desc: 'Once-a-year costs and their fund' },
  { id: 'forecast', to: '/forecast', label: 'Forecast', icon: 'forecast', desc: 'Projected balances and scenarios' },
  { id: 'reports', to: '/reports', label: 'Reports', icon: 'report', desc: 'Charts and Excel downloads' },
  { id: 'categories', to: '/categories', label: 'Categories', icon: 'list', desc: 'Add, edit and limit categories' },
  { id: 'years', to: '/years', label: 'Years & archive', icon: 'archive', desc: 'Close a finished year, open old years read-only' },
  { id: 'import', to: '/import', label: 'Import from Excel', icon: 'import', desc: 'Bring in a budget workbook' },
  { id: 'settings', to: '/settings', label: 'Settings & sync', icon: 'settings', desc: 'OneDrive, categories, menu, currency, data', fixed: true }
];
export const DIVIDER = 'divider';

export interface MenuConfig {
  order: string[]; // item ids, plus DIVIDER where the line goes
  labels: Record<string, string>;
  hidden: string[];
  start: string; // item id the app opens on
}

export const DEFAULT_MENU: MenuConfig = {
  order: ['budget', 'accounts', 'transactions', 'overview', 'recurring', 'yearly', 'forecast', 'reports', DIVIDER, 'categories', 'years', 'import', 'settings'],
  labels: {},
  hidden: ['categories'],
  start: 'overview'
};

const KEY = 'pfm.menu';
const EVENT = 'pfm-menu';

/** Saved setup, repaired: unknown ids dropped, items added later appear before Settings. */
export function loadMenu(): MenuConfig {
  let c: Partial<MenuConfig> = {};
  try {
    c = JSON.parse(localStorage.getItem(KEY) || '{}');
  } catch {}
  const known = new Set(MENU_ITEMS.map((i) => i.id));
  const order = (c.order ?? DEFAULT_MENU.order).filter((id, i, a) => (id === DIVIDER ? a.indexOf(DIVIDER) === i : known.has(id) && a.indexOf(id) === i));
  for (const it of MENU_ITEMS) if (!order.includes(it.id)) order.splice(Math.max(0, order.indexOf('settings')), 0, it.id);
  if (!order.includes(DIVIDER)) order.splice(Math.max(0, order.indexOf('categories')), 0, DIVIDER);
  const hidden = (c.hidden ?? DEFAULT_MENU.hidden).filter((id) => known.has(id) && !MENU_ITEMS.find((i) => i.id === id)?.fixed);
  const start = c.start && known.has(c.start) && !hidden.includes(c.start) ? c.start : 'overview';
  return { order, labels: { ...(c.labels ?? {}) }, hidden, start };
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
export interface ResolvedMenu {
  main: MenuEntry[]; // above the line
  lower: MenuEntry[]; // below the line
  visible: MenuEntry[]; // all shown, in order
  start: MenuEntry;
}
export function resolveMenu(c: MenuConfig): ResolvedMenu {
  const byId = new Map(MENU_ITEMS.map((i) => [i.id, i]));
  const main: MenuEntry[] = [];
  const lower: MenuEntry[] = [];
  let below = false;
  for (const id of c.order) {
    if (id === DIVIDER) {
      below = true;
      continue;
    }
    const def = byId.get(id);
    if (!def || c.hidden.includes(id)) continue;
    const e = { ...def, name: c.labels[id]?.trim() || def.label };
    (below ? lower : main).push(e);
  }
  const visible = [...main, ...lower];
  const start = visible.find((e) => e.id === c.start) ?? visible.find((e) => e.id === 'overview') ?? visible[0];
  return { main, lower, visible, start };
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
