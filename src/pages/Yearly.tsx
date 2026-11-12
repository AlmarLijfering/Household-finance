import { useState } from 'react';
import { useModel } from '../lib/useModel';
import { yearlyPlan } from '../lib/calc/yearly';
import { put, del } from '../lib/db';
import { AmountInput, Field, Icon, Modal, Money } from '../components/ui';
import { CategorySelect } from '../components/TxEditor';
import { fmtDate, today, uid } from '../lib/util';
import type { YearlyItem, YearlyFund } from '../lib/types';

export default function Yearly() {
  const m = useModel();
  const [year, setYear] = useState(Number(today().slice(0, 4)));
  const [edit, setEdit] = useState<YearlyItem | 'new' | null>(null);
  const [fundEdit, setFundEdit] = useState(false);
  const p = yearlyPlan(m, year, today());
  const reserveAccounts = m.accounts.filter((a) => a.type === 'reserve' || a.type === 'savings');
  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Yearly expenses</h1>
          <p className="sub">Once-a-year costs paid from a reserve fund that you top up every month.</p>
        </div>
        <div className="actions">
          <div className="row">
            <button className="icon-btn" aria-label="Previous year" onClick={() => setYear(year - 1)}><Icon name="chevl" /></button>
            <h2>{year}</h2>
            <button className="icon-btn" aria-label="Next year" onClick={() => setYear(year + 1)}><Icon name="chev" /></button>
          </div>
          <button className="btn" onClick={() => setFundEdit(true)}>Fund settings</button>
          <button className="btn primary" onClick={() => setEdit('new')}><Icon name="plus" size={16} /> Add item</button>
        </div>
      </div>

      <div className="kpis">
        <div>
          <div className="k-label">In the fund now</div>
          <div className="k-val"><Money v={p.fundBalance} /></div>
          <div className="small muted">{p.account?.name ?? 'No account linked'}</div>
        </div>
        <div>
          <div className="k-label">Contributions still to come</div>
          <div className="k-val"><Money v={p.contributions} /></div>
          <div className="small muted">{p.monthsLeft} × <Money v={p.fund?.monthlyContribution ?? 0} /></div>
        </div>
        <div>
          <div className="k-label">Still to pay this year</div>
          <div className="k-val"><Money v={p.totalRemaining} /></div>
          <div className="small muted">of <Money v={p.totalEstimated} /> estimated</div>
        </div>
        <div>
          <div className="k-label">{p.balance >= 0 ? 'Left at year end' : 'Shortfall'}</div>
          <div className="k-val" style={{ color: p.balance < 0 ? 'var(--plum)' : undefined }}><Money v={p.balance} /></div>
        </div>
      </div>

      {p.rows.length ? (
        <div className="panel flush section" style={{ marginTop: 'var(--s5)' }}>
          <div className="table-wrap">
            <table className="t">
              <thead>
                <tr>
                  <th>Due</th>
                  <th>Item</th>
                  <th className="r">Estimated</th>
                  <th className="r">Actual</th>
                  <th className="r">Remaining</th>
                  <th>Status</th>
                  <th>Paid</th>
                </tr>
              </thead>
              <tbody>
                {p.rows.map((r) => (
                  <tr key={r.item.id} className="click" onClick={() => setEdit(r.item)}>
                    <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(r.item.dueDate)}</td>
                    <td>
                      {r.item.name}
                      {r.item.categoryId ? <div className="small muted">{m.categoryById.get(r.item.categoryId)?.name} · actual from transactions</div> : null}
                    </td>
                    <td className="r"><Money v={r.item.estimated} /></td>
                    <td className="r"><Money v={r.actual} /></td>
                    <td className="r"><Money v={r.remainder} /></td>
                    <td>
                      {r.status === 'paid' ? <span className="badge good">Paid</span> : r.status === 'overdue' ? <span className="badge bad">Past due date</span> : r.status === 'due-soon' ? <span className="badge warn">Due soon</span> : <span className="badge">Planned</span>}
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" aria-label="Paid" checked={r.item.paid} onChange={(e) => put('yearlyItems', { ...r.item, paid: e.target.checked })} style={{ width: 18, height: 18, accentColor: 'var(--moss)' }} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="empty section">
          <h3>No yearly items for {year}</h3>
          <p>List the costs that come once a year — car tax, insurance, tyre changes, presents — with an estimate and a due date.</p>
          <button className="btn primary" onClick={() => setEdit('new')}>Add the first item</button>
        </div>
      )}

      {edit ? <ItemForm initial={edit === 'new' ? undefined : edit} year={year} onClose={() => setEdit(null)} /> : null}
      {fundEdit ? (
        <FundForm
          initial={p.fund ?? { id: String(year), year, accountId: reserveAccounts.find((a) => /yearly/i.test(a.name))?.id ?? null, monthlyContribution: 0, updatedAt: '' }}
          onClose={() => setFundEdit(false)}
        />
      ) : null}
    </div>
  );
}

function ItemForm({ initial, year, onClose }: { initial?: YearlyItem; year: number; onClose: () => void }) {
  const m = useModel();
  const [it, setIt] = useState<YearlyItem>(initial ?? { id: uid(), year, name: '', categoryId: null, estimated: 0, dueDate: `${year}-12-01`, paid: false, updatedAt: '' });
  const set = (p: Partial<YearlyItem>) => setIt({ ...it, ...p });
  return (
    <Modal
      title={initial ? initial.name : 'New yearly item'}
      onClose={onClose}
      footer={
        <>
          {initial ? <button className="btn danger" onClick={async () => { await del('yearlyItems', it.id); onClose(); }}>Delete</button> : null}
          <span className="spacer" />
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!it.name} onClick={async () => { await put('yearlyItems', it); onClose(); }}>Save</button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Item" className="full"><input className="input" value={it.name} onChange={(e) => set({ name: e.target.value })} autoFocus /></Field>
        <Field label="Estimated"><AmountInput value={it.estimated} onChange={(estimated) => set({ estimated })} /></Field>
        <Field label="Due date"><input className="input" type="date" value={it.dueDate} onChange={(e) => set({ dueDate: e.target.value })} /></Field>
        <Field label="Category (optional)" help="When set, the actual amount is taken from transactions in this category" className="full">
          <CategorySelect m={m} value={it.categoryId} onChange={(categoryId) => set({ categoryId })} />
        </Field>
        {!it.categoryId ? <Field label="Actual paid"><AmountInput value={it.actualOverride ?? 0} onChange={(v) => set({ actualOverride: v || undefined })} /></Field> : null}
      </div>
      <label className="check" style={{ marginTop: 12 }}><input type="checkbox" checked={it.paid} onChange={(e) => set({ paid: e.target.checked })} /> Paid</label>
    </Modal>
  );
}

function FundForm({ initial, onClose }: { initial: YearlyFund; onClose: () => void }) {
  const m = useModel();
  const [f, setF] = useState(initial);
  return (
    <Modal title={`Yearly fund ${f.year}`} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={async () => { await put('yearlyFunds', f); onClose(); }}>Save</button></>}>
      <div className="form-grid">
        <Field label="Reserve account">
          <select className="input" value={f.accountId ?? ''} onChange={(e) => setF({ ...f, accountId: e.target.value || null })}>
            <option value="">— none —</option>
            {m.accounts.filter((a) => a.type === 'reserve' || a.type === 'savings').map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </Field>
        <Field label="Monthly contribution"><AmountInput value={f.monthlyContribution} onChange={(monthlyContribution) => setF({ ...f, monthlyContribution })} /></Field>
      </div>
    </Modal>
  );
}
