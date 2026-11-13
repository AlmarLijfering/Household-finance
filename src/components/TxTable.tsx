import { useState } from 'react';
import type { Transaction } from '../lib/types';
import type { Model } from '../lib/calc/model';
import { categoryLabel } from '../lib/calc/model';
import { cx, fmtDay, MONTHS, monthLabel, sum } from '../lib/util';
import { CatChip } from './Group';
import { Icon } from './ui';
import { txMonth, txWeek } from '../lib/calc/period';
import { txBase } from '../lib/calc/model';
import { Fragment } from 'react';
import { useMemo } from 'react';
import { earmarkHints } from '../lib/calc/earmark';
import { BulkEdit } from './BulkEdit';
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

export function TxTable({ m, txs, running, showAccount, pageSize = 150, bulk = true }: { m: Model; txs: Transaction[]; running?: Map<string, number>; showAccount?: boolean; pageSize?: number; bulk?: boolean }) {
  const open = useTxEditor();
  const [limit, setLimit] = useState(pageSize);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState(false);
  const hints = useMemo(() => earmarkHints(m), [m]);
  const rows = txs.slice(0, limit);
  // one heading per day instead of repeating the date on every row
  const perDay = useMemo(() => {
    const map = new Map<string, { n: number; net: number }>();
    for (const t of txs) {
      const d = map.get(t.date) ?? { n: 0, net: 0 };
      d.n += 1;
      if (!t.transferId) d.net += txBase(m, t);
      map.set(t.date, d);
    }
    return map;
  }, [txs, m]);
  const span = (bulk ? 1 : 0) + (showAccount ? 1 : 0) + 3 + (running ? 1 : 0);
  // keep only selections that are still in the (filtered) list
  const visibleSel = useMemo(() => new Set(txs.filter((t) => sel.has(t.id)).map((t) => t.id)), [txs, sel]);
  if (!txs.length) return <p className="muted" style={{ padding: 16 }}>No transactions match.</p>;
  const allOn = visibleSel.size === txs.length;
  const toggle = (id: string) =>
    setSel((x) => {
      const n = new Set(x);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  return (
    <>
      {bulk && visibleSel.size ? (
        <div className="bulk-bar">
          <b>{visibleSel.size} selected</b>
          {!allOn ? (
            <button className="btn sm ghost" onClick={() => setSel(new Set(txs.map((t) => t.id)))}>
              Select all {txs.length}
            </button>
          ) : null}
          <span className="spacer" />
          <button className="btn sm primary" onClick={() => setEditing(true)}>
            Edit selected
          </button>
          <button className="btn sm ghost" onClick={() => setSel(new Set())}>
            Clear
          </button>
        </div>
      ) : null}
      <div className="table-wrap">
        <table className="t txt">
          <thead>
            <tr>
              {bulk ? (
                <th style={{ width: 34 }}>
                  <input
                    type="checkbox"
                    aria-label={allOn ? 'Clear selection' : 'Select all shown'}
                    checked={allOn}
                    ref={(el) => {
                      if (el) el.indeterminate = visibleSel.size > 0 && !allOn;
                    }}
                    onChange={() => setSel(allOn ? new Set() : new Set(txs.map((t) => t.id)))}
                    className="sel-box"
                  />
                </th>
              ) : null}
              {showAccount ? <th>Account</th> : null}
              <th>Payee</th>
              <th>Category</th>
              <th className="r">Amount</th>
              {running ? <th className="r desk-only">Balance</th> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((t, i) => {
              const acc = m.accountById.get(t.accountId);
              const newDay = i === 0 || rows[i - 1].date !== t.date;
              const day = perDay.get(t.date);
              return (
                <Fragment key={t.id}>
                {newDay ? (
                  <tr className="day">
                    <td colSpan={span}>
                      <span className="day-date">{fmtDay(t.date)}</span>
                      <span className="day-meta">
                        {MONTHS[Number(txMonth(m, { date: t.date }).slice(5, 7)) - 1]} budget · week {txWeek(m, { date: t.date })}
                      </span>
                      <span className="day-sum">
                        {day?.n} transaction{day?.n === 1 ? '' : 's'} · net <Money v={day?.net ?? 0} sign />
                      </span>
                    </td>
                  </tr>
                ) : null}
                <tr className={cx('click tx', visibleSel.has(t.id) && 'sel')} onClick={() => open({ id: t.id })}>
                  {bulk ? (
                    <td className="tx-sel" onClick={(e) => { e.stopPropagation(); toggle(t.id); }}>
                      <input type="checkbox" aria-label="Select" checked={visibleSel.has(t.id)} onChange={() => toggle(t.id)} onClick={(e) => e.stopPropagation()} className="sel-box" />
                    </td>
                  ) : null}
                  {showAccount ? <td className="tx-acc">{acc?.name}</td> : null}
                  <td className="tx-payee">
                    <div style={{ fontWeight: 550 }}>{t.payee || <span className="muted">—</span>}</div>
                    {t.memo ? <div className="small muted">{t.memo}</div> : null}
                  </td>
                  <td className="tx-cat">
                    <TxCategory m={m} t={t} />
                    {t.budgetMonth ? <span className="badge info" style={{ marginLeft: 6 }} title="Counts for another budget month than its date">for {MONTHS[Number(t.budgetMonth.slice(5, 7)) - 1]}</span> : null}
                    {hints.get(t.id) ? <EarmarkFlag t={t} suggested={hints.get(t.id)!.suggested} reason={hints.get(t.id)!.reason} /> : null}
                  </td>
                  <td className="r tx-amt">
                    <Money v={t.amount} tone={t.amount > 0} sign={t.amount > 0} cur={acc?.currency} />
                  </td>
                  {running ? (
                    <td className="r muted desk-only">
                      <Money v={running.get(t.id) ?? 0} />
                    </td>
                  ) : null}
                </tr>
                </Fragment>
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
      {editing ? <BulkEdit ids={[...visibleSel]} onClose={() => setEditing(false)} onDone={() => setSel(new Set())} /> : null}
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

/** Warning on a transaction that probably belongs to the next budget month, with one-click fixes. */
export function EarmarkFlag({ t, suggested, reason }: { t: Transaction; suggested: string; reason: string }) {
  return (
    <span className="earmark" onClick={(e) => e.stopPropagation()} title={reason}>
      <span className="badge warn">Not earmarked?</span>
      <button type="button" className="btn sm" onClick={() => put('transactions', { ...t, budgetMonth: suggested, monthConfirmed: undefined }, 'Earmark for next month')}>
        Count for {monthLabel(suggested).split(' ')[0]}
      </button>
      <button type="button" className="btn sm ghost" onClick={() => put('transactions', { ...t, monthConfirmed: true }, 'Confirm budget month')}>
        It’s right
      </button>
    </span>
  );
}

/** Category of a transaction with its group marker; transfers show the other account. */
export function TxCategory({ m, t }: { m: Model; t: Transaction }) {
  if (t.splits?.length) return <span className="cat-chip none"><Icon name="split" size={14} /> Split · {t.splits.length} categories</span>;
  if (t.transferId) {
    const other = m.accountById.get(t.transferAccountId ?? '')?.name ?? 'another account';
    return (
      <>
        <span className="cat-chip none"><Icon name="transfer" size={14} /> {t.amount < 0 ? `To ${other}` : `From ${other}`}</span>
        {t.categoryId ? <> <CatChip m={m} categoryId={t.categoryId} /></> : null}
      </>
    );
  }
  return <CatChip m={m} categoryId={t.categoryId} />;
}
void sum;
