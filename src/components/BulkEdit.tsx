import { useMemo, useState, type ReactNode } from 'react';
import { useModel } from '../lib/useModel';
import { commit } from '../lib/db';
import { planBulk, type BulkChanges } from '../lib/bulk';
import { lastBookableMonth, monthOfDate } from '../lib/calc/period';
import { monthLabel, shiftMonth, today } from '../lib/util';
import { Field, Modal, useToast } from './ui';
import { AccountSelect, CategorySelect } from './TxEditor';
import { BudgetDatePicker } from './BudgetDatePicker';
import type { ID } from '../lib/types';

function Toggle({ on, set, label, children }: { on: boolean; set: (v: boolean) => void; label: string; children: ReactNode }) {
  return (
    <div className="bulk-row">
      <label className="check">
        <input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} /> <b>{label}</b>
      </label>
      <div style={{ opacity: on ? 1 : 0.45, pointerEvents: on ? 'auto' : 'none' }}>{children}</div>
    </div>
  );
}

export function BulkEdit({ ids, onClose, onDone }: { ids: ID[]; onClose: () => void; onDone: () => void }) {
  const m = useModel();
  const toast = useToast();
  const sel = useMemo(() => m.transactions.filter((t) => ids.includes(t.id)), [m, ids]);
  const counts = {
    in: sel.filter((t) => !t.transferId && t.amount > 0).length,
    out: sel.filter((t) => !t.transferId && t.amount < 0).length,
    transfer: sel.filter((t) => t.transferId).length
  };
  const [useAcc, setUseAcc] = useState(false);
  const [acc, setAcc] = useState<ID>(sel[0]?.accountId ?? m.accounts[0]?.id ?? '');
  const [useCat, setUseCat] = useState(false);
  const [cat, setCat] = useState<ID | null>(null);
  const [useMonth, setUseMonth] = useState(false);
  const [month, setMonth] = useState<string>('');
  const [usePayee, setUsePayee] = useState(false);
  const [payee, setPayee] = useState('');
  const [useDate, setUseDate] = useState(false);
  const [date, setDate] = useState(today());

  const maxMonth = lastBookableMonth(m);
  const months = useMemo(() => {
    const base = monthOfDate(m, today());
    return Array.from({ length: 14 }, (_, i) => shiftMonth(base, i - 12)).filter((x) => x <= maxMonth);
  }, [m]);
  const catFilter = counts.transfer && !counts.in && !counts.out ? (k: string) => k === 'reservation' || k === 'transfer' : counts.in && !counts.out ? (k: string) => k === 'income' || k === 'opening' || k === 'transfer' : counts.out && !counts.in ? (k: string) => k !== 'income' && k !== 'opening' : undefined;

  const changes: BulkChanges = {
    ...(useAcc ? { accountId: acc } : {}),
    ...(useCat ? { categoryId: cat } : {}),
    ...(useMonth ? { budgetMonth: month || null } : {}),
    ...(usePayee ? { payee } : {}),
    ...(useDate ? { date } : {})
  };
  const preview = useMemo(() => planBulk(m, ids, changes), [m, ids, useAcc, acc, useCat, cat, useMonth, month, usePayee, payee, useDate, date]);
  const any = useAcc || useCat || useMonth || usePayee || useDate;

  async function apply() {
    const r = planBulk(m, ids, changes);
    if (!r.changes.length) return toast('Nothing to change');
    const before = r.before;
    await commit(r.changes, `Update ${r.updated} transactions`);
    toast({ text: `${r.updated} transaction${r.updated === 1 ? '' : 's'} updated`, action: { label: 'Undo', run: () => commit(before.map((t) => ({ table: 'transactions' as const, put: t })), 'Undo mass update') } });
    onDone();
    onClose();
  }

  return (
    <Modal
      title={`Update ${ids.length} transaction${ids.length === 1 ? '' : 's'}`}
      onClose={onClose}
      footer={
        <>
          <span className="small muted" style={{ marginRight: 'auto' }}>
            {any ? `${preview.updated} will change${preview.skipped.length ? `, ${preview.skipped.reduce((s, x) => s + x.count, 0)} skipped` : ''}` : 'Tick what you want to change'}
          </span>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!any || !preview.changes.length} onClick={apply}>
            Update {preview.updated || ''} transaction{preview.updated === 1 ? '' : 's'}
          </button>
        </>
      }
    >
      <p className="small muted" style={{ marginBottom: 12 }}>
        Selected: {counts.out} money out, {counts.in} money in, {counts.transfer} transfer side{counts.transfer === 1 ? '' : 's'}. Only the ticked fields change; the type of a transaction never changes. Transfers keep both sides in step.
      </p>
      <div className="stack">
        <Toggle on={useAcc} set={setUseAcc} label="Account">
          <AccountSelect m={m} value={acc} onChange={setAcc} ariaLabel="New account" />
        </Toggle>
        <Toggle on={useCat} set={setUseCat} label="Category">
          <CategorySelect m={m} value={cat} onChange={setCat} filter={catFilter} ariaLabel="New category" accountId={useAcc ? acc : undefined} />
        </Toggle>
        <Toggle on={useMonth} set={setUseMonth} label="Counts for budget month">
          <select className="input" aria-label="New budget month" value={month} onChange={(e) => setMonth(e.target.value)}>
            <option value="">The month of each transaction’s date</option>
            {months.map((x) => (
              <option key={x} value={x}>{monthLabel(x)}</option>
            ))}
          </select>
        </Toggle>
        <Toggle on={usePayee} set={setUsePayee} label="Payee">
          <input className="input" aria-label="New payee" value={payee} onChange={(e) => setPayee(e.target.value)} placeholder="Leave empty to clear the payee" />
        </Toggle>
        <Toggle on={useDate} set={setUseDate} label="Date">
          <BudgetDatePicker m={m} value={date} onChange={setDate} ariaLabel="New date" />
        </Toggle>
      </div>
      {any && preview.skipped.length ? (
        <div className="notice small" style={{ marginTop: 12 }}>
          Will be skipped:
          <ul style={{ margin: '4px 0 0 18px', padding: 0 }}>
            {preview.skipped.map((s) => (
              <li key={s.reason}>
                {s.count} × {s.reason}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Modal>
  );
}

void Field;
