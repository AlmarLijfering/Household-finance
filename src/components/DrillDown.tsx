import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { useModel } from '../lib/useModel';
import { isInternal, kindOf, lines, type Line, type Model } from '../lib/calc/model';
import type { ID } from '../lib/types';
import { fmtDate, monthLabel, sum } from '../lib/util';
import { weekRange } from '../lib/calc/period';
import { Modal, Money } from './ui';
import { txCategoryText } from './TxTable';
import { useTxEditor } from '../App';

/** What a drill-down shows: transactions behind one figure. */
export interface DrillFilter {
  title: string;
  from: string; // YYYY-MM (first month)
  to?: string; // YYYY-MM (last month), defaults to from
  categoryIds?: ID[];
  groupCode?: string; // IC, PC, RE, UC, DIV…
  type?: 'income' | 'spending' | 'reserved' | 'transfers' | 'all';
  week?: number;
  excludeWeeks?: number[];
  accountIds?: ID[];
}

/** Lines matching a filter, using the same sign rules as the budget and cash-flow reports. */
export function drillLines(m: Model, f: DrillFilter): Line[] {
  const to = f.to ?? f.from;
  const cats = f.categoryIds ? new Set(f.categoryIds) : null;
  const accs = f.accountIds && f.accountIds.length ? new Set(f.accountIds) : null;
  return lines(m)
    .filter((l) => {
      if (l.month < f.from || l.month > to) return false;
      if (accs && !accs.has(l.tx.accountId)) return false;
      if (f.week && l.week !== f.week) return false;
      if (f.excludeWeeks?.includes(l.week)) return false;
      if (cats && (!l.categoryId || !cats.has(l.categoryId))) return false;
      const k = kindOf(m, l.categoryId);
      if (f.groupCode) {
        const c = l.categoryId ? m.categoryById.get(l.categoryId) : undefined;
        if (!c || m.groupById.get(c.groupId)?.code !== f.groupCode) return false;
      }
      // the incoming side of a categorised transfer is not counted twice
      if ((cats || f.groupCode) && l.tx.transferId && l.amount > 0 && k === 'reservation') return false;
      switch (f.type ?? 'all') {
        case 'income':
          return k === 'income' || (!l.categoryId && !l.tx.transferId && l.amount > 0);
        case 'spending':
          return k === 'expense' || (!l.categoryId && !l.tx.transferId && l.amount < 0);
        case 'reserved':
          return k === 'reservation' && l.amount < 0;
        case 'transfers':
          return isInternal(m, l);
        default:
          return true;
      }
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}

export function DrillDownModal({ f, onClose }: { f: DrillFilter; onClose: () => void }) {
  const m = useModel();
  const open = useTxEditor();
  const [q, setQ] = useState('');
  const rows = useMemo(() => drillLines(m, f), [m, f]);
  const shown = q ? rows.filter((l) => `${l.tx.payee ?? ''} ${l.tx.memo ?? ''} ${txCategoryText(m, l.tx)}`.toLowerCase().includes(q.toLowerCase())) : rows;
  const total = sum(shown.map((l) => l.amount));
  const period = f.to && f.to !== f.from ? `${monthLabel(f.from)} – ${monthLabel(f.to)}` : monthLabel(f.from);
  return (
    <Modal title={f.title} onClose={onClose} wide>
      <div className="row wrap" style={{ marginBottom: 12 }}>
        <div className="grow">
          <div className="muted small">
            {period}
            {f.week ? ` · week ${f.week} (${fmtDate(weekRange(m, f.from, f.week).start)} – ${fmtDate(weekRange(m, f.from, f.week).end)})` : ''} · {shown.length} transaction{shown.length === 1 ? '' : 's'}
          </div>
          <div style={{ fontFamily: 'var(--display)', fontWeight: 700, fontSize: 22 }}>
            <Money v={total} tone />
          </div>
        </div>
        <input className="input" style={{ maxWidth: 260 }} placeholder="Filter" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter transactions" />
      </div>
      {shown.length ? (
        <div className="table-wrap" style={{ maxHeight: '55vh' }}>
          <table className="t">
            <thead>
              <tr>
                <th>Date</th>
                <th>Account</th>
                <th>Payee</th>
                <th>Category</th>
                <th className="r">Amount</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((l, i) => (
                <tr key={l.tx.id + i} className="click" onClick={() => open({ id: l.tx.id })} title="Open transaction">
                  <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(l.date)}</td>
                  <td className="small muted">{m.accountById.get(l.tx.accountId)?.name}</td>
                  <td>
                    {l.tx.payee || <span className="muted">—</span>}
                    {l.tx.memo ? <div className="small muted">{l.tx.memo}</div> : null}
                  </td>
                  <td className="small">{l.tx.splits?.length ? `${m.categoryById.get(l.categoryId ?? '')?.name ?? 'Uncategorised'} (split)` : txCategoryText(m, l.tx)}</td>
                  <td className="r">
                    <Money v={l.amount} tone />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted">No transactions here yet.</p>
      )}
    </Modal>
  );
}

const DrillCtx = createContext<(f: DrillFilter) => void>(() => {});
export const useDrill = () => useContext(DrillCtx);
export function DrillProvider({ children }: { children: ReactNode }) {
  const [f, setF] = useState<DrillFilter | null>(null);
  return (
    <DrillCtx.Provider value={setF}>
      {children}
      {f ? <DrillDownModal f={f} onClose={() => setF(null)} /> : null}
    </DrillCtx.Provider>
  );
}

/** A figure that opens its transactions when clicked. */
export function DrillMoney({ v, f, tone, compact }: { v: number; f: DrillFilter; tone?: boolean; compact?: boolean }) {
  const drill = useDrill();
  return (
    <button type="button" className="drill" onClick={(e) => { e.stopPropagation(); drill(f); }} title="Show transactions">
      <Money v={v} tone={tone} compact={compact} />
    </button>
  );
}
