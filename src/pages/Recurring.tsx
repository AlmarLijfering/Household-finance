import { useMemo, useState } from 'react';
import { useModel } from '../lib/useModel';
import { monthlyEquivalent, occurrences, postRecurring, signedAmount, upcoming, draftFor } from '../lib/calc/recurring';
import { useTxEditor } from '../App';
import { commit, put, del } from '../lib/db';
import { AmountInput, Field, Icon, Modal, Money, Seg, useToast } from '../components/ui';
import { AccountSelect, CategorySelect } from '../components/TxEditor';
import { addDays, addMonths, fmtDate, today, uid, sum, MONTHS } from '../lib/util';
import type { Frequency, Recurring, RecurringKind } from '../lib/types';
import type { Model } from '../lib/calc/model';

const KIND_LABEL: Record<RecurringKind, string> = { bill: 'Bills', subscription: 'Subscriptions', income: 'Income', transfer: 'Transfers & savings' };
const FREQ: Record<Frequency, string> = { weekly: 'week', monthly: 'month', quarterly: 'quarter', yearly: 'year' };

export default function RecurringPage() {
  const m = useModel();
  const toast = useToast();
  const [edit, setEdit] = useState<Recurring | 'new' | null>(null);
  const [tab, setTab] = useState<'list' | 'calendar'>('list');
  const active = m.recurring.filter((r) => !r.scenarioId);
  const subs = active.filter((r) => r.kind === 'subscription' && r.active);
  const monthlyOut = sum(active.filter((r) => r.active && r.kind !== 'income' && r.kind !== 'transfer').map(monthlyEquivalent));
  const monthlyIn = sum(active.filter((r) => r.active && r.kind === 'income').map(monthlyEquivalent));
  const next30 = useMemo(() => upcoming(m, today(), addDays(today(), 30)), [m]);

  const openTx = useTxEditor();
  // Opens an editable draft; the transaction is only created when it is saved.
  const pay = (r: Recurring, _date: string) => openTx(draftFor(r, today()));
  async function skip(r: Recurring) {
    const { rec } = postRecurring(r, r.nextDate);
    await put('recurring', rec, `Skip ${r.name}`);
    toast(`Skipped — next ${fmtDate(rec.nextDate)}`);
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Bills & income</h1>
          <p className="sub">Recurring payments, subscriptions, salary and monthly transfers into your reserve funds.</p>
        </div>
        <div className="actions">
          <Seg value={tab} onChange={setTab} options={[['list', 'List'], ['calendar', 'Next 30 days']]} />
          <button className="btn primary" onClick={() => setEdit('new')}>
            <Icon name="plus" size={16} /> New
          </button>
        </div>
      </div>
      <div className="kpis">
        <div>
          <div className="k-label">Recurring costs per month</div>
          <div className="k-val"><Money v={monthlyOut} /></div>
        </div>
        <div>
          <div className="k-label">Recurring income per month</div>
          <div className="k-val"><Money v={monthlyIn} /></div>
        </div>
        <div>
          <div className="k-label">Subscriptions</div>
          <div className="k-val"><Money v={sum(subs.map(monthlyEquivalent))} /></div>
          <div className="small muted">{subs.length} active · <Money v={sum(subs.map(monthlyEquivalent)) * 12} /> a year</div>
        </div>
        <div>
          <div className="k-label">Due in 30 days</div>
          <div className="k-val"><Money v={sum(next30.filter((u) => u.amount < 0 && u.rec.kind !== 'transfer').map((u) => -u.amount))} /></div>
        </div>
      </div>

      {tab === 'calendar' ? (
        <div className="list section" style={{ marginTop: 'var(--s5)' }}>
          {next30.map((u) => (
            <div className="list-row" key={u.rec.id + u.date}>
              <div className="date-chip">
                <b>{Number(u.date.slice(8, 10))}</b>
                <span>{MONTHS[Number(u.date.slice(5, 7)) - 1]}</span>
              </div>
              <div className="grow">
                <div className="title">{u.rec.name}</div>
                <div className="meta">{u.overdue ? 'Overdue · ' : ''}{m.accountById.get(u.rec.accountId)?.name}</div>
              </div>
              <Money v={u.amount} tone={u.amount > 0} />
              {u.date === u.rec.nextDate ? (
                <>
                  <button className="btn sm" onClick={() => pay(u.rec, u.date)}>{u.rec.kind === 'income' ? 'Received' : 'Paid'}</button>
                  <button className="btn sm ghost" onClick={() => skip(u.rec)}>Skip</button>
                </>
              ) : null}
            </div>
          ))}
          {!next30.length ? <div className="list-row muted">Nothing scheduled in the next 30 days.</div> : null}
        </div>
      ) : (
        (['income', 'bill', 'subscription', 'transfer'] as RecurringKind[]).map((k) => {
          const list = active.filter((r) => r.kind === k);
          if (!list.length) return null;
          return (
            <div className="section" key={k} style={{ marginTop: 'var(--s5)' }}>
              <div className="section-head">
                <h2>{KIND_LABEL[k]}</h2>
                <span className="hint">
                  <Money v={sum(list.filter((r) => r.active).map(monthlyEquivalent))} /> per month
                </span>
              </div>
              <div className="list">
                {list.map((r) => (
                  <div className="list-row click" key={r.id} onClick={() => setEdit(r)} style={{ opacity: r.active ? 1 : 0.55 }}>
                    <div className="grow">
                      <div className="title">{r.name}</div>
                      <div className="meta">
                        Every {r.interval > 1 ? `${r.interval} ` : ''}
                        {FREQ[r.frequency]}
                        {r.interval > 1 ? 's' : ''} · {m.accountById.get(r.accountId)?.name}
                        {r.toAccountId ? ` → ${m.accountById.get(r.toAccountId)?.name}` : ''}
                        {r.active ? ` · next ${fmtDate(r.nextDate, true)}` : ' · paused'}
                      </div>
                    </div>
                    <Money v={signedAmount(r)} tone={r.kind === 'income'} />
                    {r.active ? (
                      <button className="btn sm" onClick={(e) => { e.stopPropagation(); pay(r, r.nextDate); }}>
                        {r.kind === 'income' ? 'Received' : 'Paid'}
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          );
        })
      )}
      {!active.length ? (
        <div className="empty section">
          <h3>No recurring items yet</h3>
          <p>Add rent, utilities, subscriptions, salary and the monthly top-ups of your reserve funds. They show up on the overview before they are due and feed the forecast.</p>
          <button className="btn primary" onClick={() => setEdit('new')}>Add the first one</button>
        </div>
      ) : null}
      {edit ? <RecurringForm m={m} initial={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} /> : null}
    </div>
  );
}

export function RecurringForm({ m, initial, onClose, scenarioId }: { m: Model; initial?: Recurring; onClose: () => void; scenarioId?: string }) {
  const [r, setR] = useState<Recurring>(
    initial ?? {
      id: uid(),
      name: '',
      kind: 'bill',
      accountId: m.accounts.find((a) => a.type === 'current')?.id ?? m.accounts[0]?.id ?? '',
      categoryId: null,
      amount: 0,
      frequency: 'monthly',
      interval: 1,
      startDate: addMonths(today(), 0),
      nextDate: today(),
      active: true,
      scenarioId: scenarioId ?? null,
      updatedAt: ''
    }
  );
  const set = (p: Partial<Recurring>) => setR({ ...r, ...p });
  const preview = occurrences({ ...r, active: true }, today(), addMonths(today(), 12)).slice(0, 4);
  return (
    <Modal
      title={initial ? `Edit ${initial.name}` : scenarioId ? 'Add to scenario' : 'New recurring item'}
      onClose={onClose}
      footer={
        <>
          {initial ? (
            <button className="btn danger" onClick={async () => { await del('recurring', r.id, 'Delete recurring'); onClose(); }}>
              Delete
            </button>
          ) : null}
          <span className="spacer" />
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!r.name || !r.amount || (r.kind === 'transfer' && !r.toAccountId)} onClick={async () => { await put('recurring', r, initial ? 'Edit recurring' : 'Add recurring'); onClose(); }}>
            Save
          </button>
        </>
      }
    >
      <div className="stack">
        <Seg value={r.kind} onChange={(kind) => set({ kind })} options={[['bill', 'Bill'], ['subscription', 'Subscription'], ['income', 'Income'], ['transfer', 'Transfer']]} />
        <div className="form-grid">
          <Field label="Name" className="full">
            <input className="input" value={r.name} onChange={(e) => set({ name: e.target.value })} autoFocus placeholder="e.g. Rent Bucharest, Netflix, Taxes set aside" />
          </Field>
          <Field label="Amount">
            <AmountInput value={r.amount} onChange={(amount) => set({ amount })} />
          </Field>
          <Field label="Repeats every">
            <div className="row">
              <input className="input num" style={{ width: 64 }} type="number" min={1} value={r.interval} onChange={(e) => set({ interval: Math.max(1, Number(e.target.value)) })} aria-label="Interval" />
              <select className="input" value={r.frequency} onChange={(e) => set({ frequency: e.target.value as Frequency })} aria-label="Frequency">
                <option value="weekly">week(s)</option>
                <option value="monthly">month(s)</option>
                <option value="quarterly">quarter(s)</option>
                <option value="yearly">year(s)</option>
              </select>
            </div>
          </Field>
          <Field label={r.kind === 'transfer' ? 'From account' : 'Account'}>
            <AccountSelect m={m} value={r.accountId} onChange={(accountId) => set({ accountId })} />
          </Field>
          {r.kind === 'transfer' ? (
            <Field label="To account">
              <AccountSelect m={m} value={r.toAccountId ?? ''} onChange={(toAccountId) => set({ toAccountId })} exclude={r.accountId} />
            </Field>
          ) : (
            <Field label="Next date">
              <input className="input" type="date" value={r.nextDate} onChange={(e) => set({ nextDate: e.target.value, startDate: initial ? r.startDate : e.target.value })} />
            </Field>
          )}
          {r.kind === 'transfer' ? (
            <Field label="Next date">
              <input className="input" type="date" value={r.nextDate} onChange={(e) => set({ nextDate: e.target.value })} />
            </Field>
          ) : null}
          <Field label="Category">
            <CategorySelect m={m} value={r.categoryId} onChange={(categoryId) => set({ categoryId })} />
          </Field>
          <Field label="Ends (optional)">
            <input className="input" type="date" value={r.endDate ?? ''} onChange={(e) => set({ endDate: e.target.value || undefined })} />
          </Field>
        </div>
        <label className="check">
          <input type="checkbox" checked={r.active} onChange={(e) => set({ active: e.target.checked })} /> Active
        </label>
        {preview.length ? <p className="small muted">Next: {preview.map((d) => fmtDate(d, true)).join(', ')}</p> : null}
      </div>
    </Modal>
  );
}
