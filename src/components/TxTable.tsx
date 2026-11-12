import { useState } from 'react';
import type { Transaction } from '../lib/types';
import type { Model } from '../lib/calc/model';
import { categoryLabel } from '../lib/calc/model';
import { cx, fmtDate } from '../lib/util';
import { Money } from './ui';
import { useTxEditor } from '../App';
import { put } from '../lib/db';

export function txCategoryText(m: Model, t: Transaction): string {
  if (t.splits?.length) return `Split · ${t.splits.length} categories`;
  if (t.transferId) {
    const other = m.accountById.get(t.transferAccountId ?? '')?.name ?? 'another account';
    const dir = t.amount < 0 ? `To ${other}` : `From ${other}`;
    return t.categoryId ? `${dir} · ${categoryLabel(m, t.categoryId)}` : dir;
  }
  return categoryLabel(m, t.categoryId);
}

export function StatusToggle({ t }: { t: Transaction }) {
  const label = t.status === 'reconciled' ? 'R' : t.status === 'cleared' ? 'C' : '·';
  return (
    <button
      className={cx('badge', t.status === 'reconciled' ? 'good' : t.status === 'cleared' ? 'info' : '')}
      style={{ border: 0, cursor: t.status === 'reconciled' ? 'default' : 'pointer', minWidth: 26, justifyContent: 'center' }}
      title={t.status === 'reconciled' ? 'Reconciled' : t.status === 'cleared' ? 'Cleared — click to mark not cleared' : 'Not cleared — click to mark cleared'}
      onClick={(e) => {
        e.stopPropagation();
        if (t.status !== 'reconciled') put('transactions', { ...t, status: t.status === 'cleared' ? 'uncleared' : 'cleared' }, 'Toggle cleared');
      }}
    >
      {label}
    </button>
  );
}

export function TxTable({ m, txs, running, showAccount, selectable, selected, onToggle, pageSize = 150 }: { m: Model; txs: Transaction[]; running?: Map<string, number>; showAccount?: boolean; selectable?: boolean; selected?: Set<string>; onToggle?: (t: Transaction) => void; pageSize?: number }) {
  const open = useTxEditor();
  const [limit, setLimit] = useState(pageSize);
  const rows = txs.slice(0, limit);
  if (!txs.length) return <p className="muted" style={{ padding: 16 }}>No transactions match.</p>;
  return (
    <>
      <div className="table-wrap">
        <table className="t">
          <thead>
            <tr>
              {selectable ? <th aria-label="Cleared" /> : null}
              <th>Date</th>
              {showAccount ? <th>Account</th> : null}
              <th>Payee</th>
              <th>Category</th>
              <th className="r">Amount</th>
              {running ? <th className="r desk-only">Balance</th> : null}
              {!selectable ? <th aria-label="Status" /> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => {
              const acc = m.accountById.get(t.accountId);
              return (
                <tr key={t.id} className={cx('click', selected?.has(t.id) && 'sel')} onClick={() => (selectable && onToggle ? onToggle(t) : open({ id: t.id }))}>
                  {selectable ? (
                    <td>
                      <input type="checkbox" aria-label="Cleared" checked={selected?.has(t.id) ?? false} readOnly style={{ width: 18, height: 18, accentColor: 'var(--moss)' }} />
                    </td>
                  ) : null}
                  <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(t.date, true)}</td>
                  {showAccount ? <td className="muted">{acc?.name}</td> : null}
                  <td>
                    <div style={{ fontWeight: 550 }}>{t.payee || <span className="muted">—</span>}</div>
                    {t.memo ? <div className="small muted">{t.memo}</div> : null}
                  </td>
                  <td className="small">{txCategoryText(m, t)}</td>
                  <td className="r">
                    <Money v={t.amount} tone={t.amount > 0} cur={acc?.currency} />
                  </td>
                  {running ? (
                    <td className="r muted desk-only">
                      <Money v={running.get(t.id) ?? 0} />
                    </td>
                  ) : null}
                  {!selectable ? (
                    <td>
                      <StatusToggle t={t} />
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {txs.length > limit ? (
        <div style={{ padding: 12, textAlign: 'center' }}>
          <button className="btn" onClick={() => setLimit(limit + 300)}>
            Show more ({txs.length - limit} older)
          </button>
        </div>
      ) : null}
    </>
  );
}

export function matchesSearch(m: Model, t: Transaction, q: string): boolean {
  if (!q) return true;
  const s = q.toLowerCase();
  const amt = (Math.abs(t.amount) / 100).toFixed(2);
  return (
    (t.payee ?? '').toLowerCase().includes(s) ||
    (t.memo ?? '').toLowerCase().includes(s) ||
    txCategoryText(m, t).toLowerCase().includes(s) ||
    amt.includes(s.replace(',', '.')) ||
    (m.categoryById.get(t.categoryId ?? '')?.code ?? '').toLowerCase() === s
  );
}
