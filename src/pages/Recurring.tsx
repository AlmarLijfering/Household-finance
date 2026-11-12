import { useMemo, useState } from 'react';
import { useModel } from '../lib/useModel';
import { monthlyEquivalent, occurrences, postRecurring, signedAmount, upcoming, draftFor, historyFor, isRecurringActive } from '../lib/calc/recurring';
import { useTxEditor } from '../App';
import { put, del } from '../lib/db';
import { AmountInput, Field, Icon, Modal, Money, Seg, useToast } from '../components/ui';
import { AccountSelect, CategorySelect } from '../components/TxEditor';
import { addDays, addMonths, fmtDate, today, uid, sum, MONTHS, cx } from '../lib/util';
import type { Frequency, Recurring, RecurringKind } from '../lib/types';
import type { Model } from '../lib/calc/model';

const KIND_LABEL: Record<RecurringKind, string> = { bill: 'Bills', subscription: 'Subscriptions', income: 'Income', transfer: 'Transfers & savings' };
const FREQ: Record<Frequency, string> = { weekly: 'week', monthly: 'month', quarterly: 'quarter', yearly: 'year' };

export default function RecurringPage() {
  const m = useModel();
  const toast = useToast();
  const [edit, setEdit] = useState<Recurring | 'new' | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const [tab, setTab] = useState<'list' | 'calendar'>('list');
  const all = m.recurring.filter((r) => !r.scenarioId);
  const active = all.filter((r) => isRecurringActive(r, today()));
  const inactive = all.filter((r) => !isRecurringActive(r, today()));
  const subs = active.filter((r) => r.kind === 'subscription');
  const monthlyOut = sum(active.filter((r) => r.kind !== 'income' && r.kind !== 'transfer').map(monthlyEquivalent));
  const monthlyIn = sum(active.filter((r) => r.kind === 'income').map(monthlyEquivalent));
  const next30 = useMemo(() => upcoming(m, today(), addDays(today(), 30)), [m]);
  const lastOf = useMemo(() => {
    const map = new Map<string, { date: string; amount: number } | undefined>();
    for (const r of all) {
      const h = historyFor(m.transactions, r)[0];
      map.set(r.id, h ? { date: h.date, amount: h.amount } : undefined);
    }
    return map;
  }, [m]);

  const openTx = useTxEditor();
  // Opens an editable draft; the transaction is only created when it is saved.
  const pay = (r: Recurring) => openTx(draftFor(r, today()));
  async function skip(r: Recurring) {
    const { rec } = postRecurring(r, r.nextDate);
    await put('recurring', rec, `Skip ${r.name}`);
    toast(`Skipped — next ${fmtDate(rec.nextDate)}`);
  }

  const row = (r: Recurring, isActive: boolean) => {
    const last = lastOf.get(r.id);
    const ended = r.endDate && r.endDate < today();
    return (
      <div className={cx('list-row click', !isActive && 'inactive-row')} key={r.id} onClick={() => setDetail(r.id)}>
        <div className="grow">
          <div className="title">
            {r.name} {!isActive ? <span className="badge">{ended ? `Ended ${fmtDate(r.endDate!, true)}` : 'Paused'}</span> : null}
          </div>
          <div className="meta">
            {KIND_LABEL[r.kind].replace(/s$/, '')} · every {r.interval > 1 ? `${r.interval} ` : ''}
            {FREQ[r.frequency]}
            {r.interval > 1 ? 's' : ''} · {m.accountById.get(r.accountId)?.name}
            {r.toAccountId ? ` → ${m.accountById.get(r.toAccountId)?.name}` : ''}
            {isActive ? ` · next ${fmtDate(r.nextDate, true)}` : ''}
            {last ? ` · last ${fmtDate(last.date, true)}` : ' · no payments found'}
          </div>
        </div>
        <Money v={signedAmount(r)} tone={r.kind === 'income'} />
        {isActive ? (
          <button className="btn sm" onClick={(e) => { e.stopPropagation(); pay(r); }}>
            {r.kind === 'income' ? 'Received' : 'Paid'}
          </button>
        ) : (
          <span className="btn sm ghost" aria-hidden="true" style={{ visibility: 'hidden' }}>Paid</span>
        )}
      </div>
    );
  };

  const det = detail ? all.find((r) => r.id === detail) : undefined;
  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Bills & income</h1>
          <p className="sub">Recurring payments, subscriptions, salary and monthly transfers into your reserve funds. Click one to see its past payments.</p>
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
                  <button className="btn sm" onClick={() => pay(u.rec)}>{u.rec.kind === 'income' ? 'Received' : 'Paid'}</button>
                  <button className="btn sm ghost" onClick={() => skip(u.rec)}>Skip</button>
                </>
              ) : null}
            </div>
          ))}
          {!next30.length ? <div className="list-row muted">Nothing scheduled in the next 30 days.</div> : null}
        </div>
      ) : (
        <>
          {(['income', 'bill', 'subscription', 'transfer'] as RecurringKind[]).map((k) => {
            const list = active.filter((r) => r.kind === k);
            if (!list.length) return null;
            return (
              <div className="section" key={k} style={{ marginTop: 'var(--s5)' }}>
                <div className="section-head">
                  <h2>{KIND_LABEL[k]}</h2>
                  <span className="hint">
                    <Money v={sum(list.map(monthlyEquivalent))} /> per month
                  </span>
                </div>
                <div className="list">{list.map((r) => row(r, true))}</div>
              </div>
            );
          })}
          {inactive.length ? (
            <div className="section" style={{ marginTop: 'var(--s6)' }}>
              <div className="section-head">
                <h2>Inactive</h2>
                <span className="hint">Paused or ended — not due, but their past payments stay visible</span>
              </div>
              <div className="list inactive-list">{inactive.map((r) => row(r, false))}</div>
            </div>
          ) : null}
        </>
      )}
      {!all.length ? (
        <div className="empty section">
          <h3>No recurring items yet</h3>
          <p>Add rent, utilities, subscriptions, salary and the monthly top-ups of your reserve funds. They show up on the overview before they are due and feed the forecast.</p>
          <button className="btn primary" onClick={() => setEdit('new')}>Add the first one</button>
        </div>
      ) : null}
      {det ? <RecurringDetail m={m} r={det} onClose={() => setDetail(null)} onEdit={() => { setDetail(null); setEdit(det); }} onPay={() => { setDetail(null); pay(det); }} /> : null}
      {edit ? <RecurringForm m={m} initial={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} /> : null}
    </div>
  );
}

/** Past payments (or income) of one recurring item, found by payee or because they were recorded from it. */
function RecurringDetail({ m, r, onClose, onEdit, onPay }: { m: Model; r: Recurring; onClose: () => void; onEdit: () => void; onPay: () => void }) {
  const openTx = useTxEditor();
  const hist = useMemo(() => historyFor(m.transactions, r), [m, r]);
  const isActive = isRecurringActive(r, today());
  const year = today().slice(0, 4);
  const thisYear = hist.filter((t) => t.date.startsWith(year));
  const byYear = new Map<string, number>();
  for (const t of hist) byYear.set(t.date.slice(0, 4), (byYear.get(t.date.slice(0, 4)) ?? 0) + t.amount);
  const avg = hist.length ? Math.round(sum(hist.slice(0, 12).map((t) => t.amount)) / Math.min(12, hist.length)) : 0;
  return (
    <Modal
      title={r.name}
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn" onClick={onEdit}>
            <Icon name="settings" size={16} /> Edit{!isActive ? ' or reactivate' : ''}
          </button>
          <span className="spacer" />
          {isActive ? (
            <button className="btn primary" onClick={onPay}>
              {r.kind === 'income' ? 'Record income' : 'Record payment'} due {fmtDate(r.nextDate)}
            </button>
          ) : (
            <span className="muted small">Inactive — nothing to pay</span>
          )}
        </>
      }
    >
      <div className="kpis" style={{ marginBottom: 16 }}>
        <div>
          <div className="k-label">Expected</div>
          <div className="k-val"><Money v={signedAmount(r)} /></div>
          <div className="small muted">every {r.interval > 1 ? `${r.interval} ` : ''}{FREQ[r.frequency]}</div>
        </div>
        <div>
          <div className="k-label">Last</div>
          <div className="k-val">{hist[0] ? <Money v={hist[0].amount} /> : <span className="muted">—</span>}</div>
          <div className="small muted">{hist[0] ? fmtDate(hist[0].date, true) : 'none found'}</div>
        </div>
        <div>
          <div className="k-label">Average (last {Math.min(12, hist.length) || 0})</div>
          <div className="k-val"><Money v={avg} /></div>
        </div>
        <div>
          <div className="k-label">{year} so far</div>
          <div className="k-val"><Money v={sum(thisYear.map((t) => t.amount))} /></div>
          <div className="small muted">{thisYear.length} payments</div>
        </div>
      </div>
      <p className="small muted" style={{ marginBottom: 8 }}>
        Matched on payee “{r.payee || r.name}”{r.payee ? '' : ' (the name — set a payee under Edit if the bank uses a different one)'} and on payments recorded from this item.
        {byYear.size > 1 ? ` By year: ${[...byYear.entries()].map(([y, v]) => `${y} ${(v / 100).toFixed(2)}`).join(' · ')}.` : ''}
      </p>
      {hist.length ? (
        <div className="table-wrap" style={{ maxHeight: '45vh' }}>
          <table className="t">
            <thead>
              <tr>
                <th>Date</th>
                <th>Account</th>
                <th>Payee</th>
                <th className="r">Amount</th>
                <th className="r">vs expected</th>
              </tr>
            </thead>
            <tbody>
              {hist.map((t) => {
                const dv = Math.abs(t.amount) - Math.abs(r.amount);
                return (
                  <tr key={t.id} className="click" onClick={() => openTx({ id: t.id })}>
                    <td>{fmtDate(t.date, true)}</td>
                    <td className="small muted">{m.accountById.get(t.accountId)?.name}</td>
                    <td>{t.payee}</td>
                    <td className="r"><Money v={t.amount} tone /></td>
                    <td className="r small" style={{ color: dv > 0 ? 'var(--plum)' : dv < 0 ? 'var(--moss)' : undefined }}>{dv ? <Money v={dv} sign /> : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted">No past transactions found for this payee yet.</p>
      )}
    </Modal>
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
            <CategorySelect m={m} value={r.categoryId} onChange={(categoryId) => set({ categoryId })} date={r.nextDate} />
          </Field>
          <Field label="Counts for" help="Money for the following month (like a salary advance) is booked to the next budget month">
            <select className="input" value={r.countsFor ?? 'same'} onChange={(e) => set({ countsFor: e.target.value === 'next' ? 'next' : undefined })}>
              <option value="same">The budget month it arrives in</option>
              <option value="next">The next budget month</option>
            </select>
          </Field>
          <Field label="Payee" help="How it appears on your transactions; used to find past payments">
            <input className="input" value={r.payee ?? ''} onChange={(e) => set({ payee: e.target.value || undefined })} placeholder={r.name || 'e.g. Netflix'} />
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
