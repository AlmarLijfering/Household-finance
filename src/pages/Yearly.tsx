import { useState } from 'react';
import { openArchiveView } from '../lib/archive';
import { useModel } from '../lib/useModel';
import { useMemo } from 'react';
import { yearlyPlan, yearlyCandidates } from '../lib/calc/yearly';
import { put, del, commit } from '../lib/db';
import { AmountInput, Field, Icon, Modal, Money, useToast } from '../components/ui';
import { CategorySelect } from '../components/TxEditor';
import { fmtDate, today, uid, nowIso } from '../lib/util';
import type { YearlyItem, YearlyFund, Category, CategoryGroup } from '../lib/types';
import type { Model } from '../lib/calc/model';
import type { Change } from '../lib/importer/commit';
import { useTxEditor } from '../App';

/** A "Yearly expenses" category for an item: reuses one with the same name, otherwise makes YE0xx. */
function categoryFor(m: Model, name: string, taken: Category[] = []): { id: string; changes: Change[] } {
  const changes: Change[] = [];
  let group = m.groups.find((g) => g.code === 'YE');
  if (!group) {
    group = { id: uid(), code: 'YE', name: 'Yearly expenses', kind: 'expense', sort: 5, updatedAt: nowIso() } as CategoryGroup;
    changes.push({ table: 'groups', put: group });
  }
  const all = [...m.categories, ...taken];
  const same = all.find((c) => c.groupId === group!.id && c.name.trim().toLowerCase() === name.trim().toLowerCase());
  if (same) return { id: same.id, changes };
  const nums = all.filter((c) => /^YE\d+$/.test(c.code)).map((c) => Number(c.code.slice(2)));
  const code = `YE${String((nums.length ? Math.max(...nums) : 0) + 1).padStart(3, '0')}`;
  // paid from the yearly fund, like in the workbook; change the scope under Categories if needed
  const c: Category = { id: uid(), code, name: name.trim(), groupId: group.id, section: 'Yearly expenses', costType: 'fixed', rollover: 'none', accountTypes: ['reserve', 'savings'], sort: 500 + nums.length, updatedAt: nowIso() };
  taken.push(c);
  changes.push({ table: 'categories', put: c });
  return { id: c.id, changes };
}

export default function Yearly() {
  const m = useModel();
  const [year, setYear] = useState(Number(today().slice(0, 4)));
  const [edit, setEdit] = useState<YearlyItem | 'new' | null>(null);
  const [fundEdit, setFundEdit] = useState(false);
  const closedY = m.closedYears.find((c) => c.year === year);
  const toast = useToast();
  const p = yearlyPlan(m, year, today());
  const withoutCat = p.rows.filter((r) => !r.item.categoryId);
  async function giveCategories() {
    const taken: Category[] = [];
    const changes: Change[] = [];
    for (const r of withoutCat) {
      const res = categoryFor(m, r.item.name, taken);
      changes.push(...res.changes, { table: 'yearlyItems', put: { ...r.item, categoryId: res.id } });
    }
    await commit(changes, 'Categories for yearly items');
    toast(`${withoutCat.length} items now have a category — link their transactions next`);
  }
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
          {withoutCat.length ? (
            <button className="btn" onClick={giveCategories} title="Creates a Yearly expenses category (YE001…) for each item that has none">
              Give every item a category ({withoutCat.length})
            </button>
          ) : null}
          <button className="btn" onClick={() => setFundEdit(true)}>Fund settings</button>
          <button className="btn primary" disabled={!!closedY} onClick={() => setEdit('new')}><Icon name="plus" size={16} /> Add item</button>
        </div>
      </div>
      {closedY ? (
        <div className="notice info" style={{ marginBottom: 'var(--s4)' }}>
          {year} is closed. Its yearly expenses are in the {year} archive.{' '}
          <button className="btn sm ghost" onClick={() => openArchiveView(closedY)}>Open {year} read-only</button>
        </div>
      ) : null}

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
                      <div className="small muted">
                        {r.item.categoryId ? `${m.categoryById.get(r.item.categoryId)?.code} · ` : 'No category · '}
                        {r.source === 'transactions' ? `${r.linked.length} linked transaction${r.linked.length === 1 ? '' : 's'}` : r.source === 'entered' ? 'amount entered by hand — link its transactions' : 'nothing linked yet'}
                      </div>
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

      {edit ? <ItemForm initial={edit === 'new' ? undefined : edit} year={year} fundAccountId={p.fund?.accountId} onClose={() => setEdit(null)} /> : null}
      {fundEdit ? (
        <FundForm
          initial={p.fund ?? { id: String(year), year, accountId: reserveAccounts.find((a) => /yearly/i.test(a.name))?.id ?? null, monthlyContribution: 0, updatedAt: '' }}
          onClose={() => setFundEdit(false)}
        />
      ) : null}
    </div>
  );
}

function ItemForm({ initial, year, fundAccountId, onClose }: { initial?: YearlyItem; year: number; fundAccountId?: string | null; onClose: () => void }) {
  const m = useModel();
  const toast = useToast();
  const openTx = useTxEditor();
  const [it, setIt] = useState<YearlyItem>(initial ?? { id: uid(), year, name: '', categoryId: null, estimated: 0, dueDate: `${year}-12-01`, paid: false, updatedAt: '' });
  const [pick, setPick] = useState<Set<string>>(new Set());
  const set = (p: Partial<YearlyItem>) => setIt({ ...it, ...p });
  const row = initial ? yearlyPlan(m, year, today()).rows.find((r) => r.item.id === initial.id) : undefined;
  const candidates = useMemo(() => (initial ? yearlyCandidates(m, { ...it }, fundAccountId).slice(0, 40) : []), [m, it.categoryId, it.name, fundAccountId]);
  const paidCat = m.categories.find((c) => c.code === 'DIV001');

  async function createCategory() {
    const res = categoryFor(m, it.name || 'Yearly item');
    await commit([...res.changes, ...(initial ? [{ table: 'yearlyItems' as const, put: { ...it, categoryId: res.id } }] : [])], 'Category for yearly item');
    set({ categoryId: res.id });
    toast(`Category ${m.categoryById.get(res.id)?.code ?? 'created'} ready`);
  }

  async function link() {
    let catId = it.categoryId;
    const changes: Change[] = [];
    if (!catId) {
      const res = categoryFor(m, it.name);
      catId = res.id;
      changes.push(...res.changes);
    }
    const before = m.transactions.filter((t) => pick.has(t.id));
    for (const t of before) changes.push({ table: 'transactions', put: { ...t, categoryId: catId } });
    changes.push({ table: 'yearlyItems', put: { ...it, categoryId: catId } });
    await commit(changes, `Link transactions to ${it.name}`);
    set({ categoryId: catId });
    setPick(new Set());
    toast({ text: `${before.length} transaction${before.length === 1 ? '' : 's'} linked to ${it.name}`, action: { label: 'Undo', run: () => commit(before.map((t) => ({ table: 'transactions' as const, put: t })), 'Undo link') } });
  }

  async function unlink(txId: string) {
    const t = m.transactions.find((x) => x.id === txId);
    if (!t) return;
    await put('transactions', { ...t, categoryId: paidCat?.id ?? null }, 'Unlink from yearly item');
  }

  return (
    <Modal
      title={initial ? initial.name : 'New yearly item'}
      onClose={onClose}
      wide={!!initial}
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
        <Field label="Item" className="full"><input className="input" value={it.name} onChange={(e) => set({ name: e.target.value })} autoFocus={!initial} /></Field>
        <Field label="Estimated"><AmountInput value={it.estimated} onChange={(estimated) => set({ estimated })} /></Field>
        <Field label="Due date"><input className="input" type="date" value={it.dueDate} onChange={(e) => set({ dueDate: e.target.value })} /></Field>
        <Field label="Category" help="Transactions in this category this year make up the actual amount">
          <div className="row">
            <CategorySelect m={m} value={it.categoryId} onChange={(categoryId) => set({ categoryId })} filter={(k) => k === 'expense'} />
            {!it.categoryId ? <button type="button" className="btn sm" onClick={createCategory} title="Create a Yearly expenses category named after this item">Create</button> : null}
          </div>
        </Field>
        <Field label="Amount entered by hand" help="Used only while no transactions are linked (e.g. the actual from your workbook)">
          <AmountInput value={it.actualOverride ?? 0} onChange={(v) => set({ actualOverride: v || undefined })} />
        </Field>
      </div>
      <label className="check" style={{ marginTop: 12 }}><input type="checkbox" checked={it.paid} onChange={(e) => set({ paid: e.target.checked })} /> Paid</label>

      {initial ? (
        <>
          <div className="section-head" style={{ marginTop: 20 }}>
            <h3>Linked transactions</h3>
            <span className="hint">{row?.linked.length ? <>total <Money v={row.actual} /></> : 'none yet'}</span>
          </div>
          {row?.linked.length ? (
            <div className="list">
              {row.linked.map((l) => (
                <div className="list-row" key={l.tx.id}>
                  <div className="grow click" onClick={() => openTx({ id: l.tx.id })} style={{ cursor: 'pointer' }}>
                    <div className="title">{l.tx.payee || l.tx.memo || '—'}</div>
                    <div className="meta">{fmtDate(l.date, true)} · {m.accountById.get(l.tx.accountId)?.name}</div>
                  </div>
                  <Money v={l.amount} tone />
                  <button className="btn sm ghost" onClick={() => unlink(l.tx.id)} title={`Move back to ${paidCat?.name ?? 'no category'}`}>Unlink</button>
                </div>
              ))}
            </div>
          ) : null}
          <div className="section-head" style={{ marginTop: 20 }}>
            <h3>Possible matches</h3>
            <span className="hint">paid from the fund, booked as yearly expense, or naming “{it.name}”</span>
          </div>
          {candidates.length ? (
            <>
              <div className="list" style={{ maxHeight: 260, overflow: 'auto' }}>
                {candidates.map((t) => (
                  <label className="list-row click" key={t.id}>
                    <input type="checkbox" className="sel-box" checked={pick.has(t.id)} onChange={() => setPick((x) => { const n = new Set(x); n.has(t.id) ? n.delete(t.id) : n.add(t.id); return n; })} />
                    <div className="grow">
                      <div className="title">{t.payee || t.memo || '—'}</div>
                      <div className="meta">{fmtDate(t.date, true)} · {m.accountById.get(t.accountId)?.name} · {m.categoryById.get(t.categoryId ?? '')?.name ?? 'no category'}</div>
                    </div>
                    <Money v={t.amount} tone />
                  </label>
                ))}
              </div>
              <div className="row" style={{ justifyContent: 'flex-end', marginTop: 8 }}>
                <button className="btn primary" disabled={!pick.size} onClick={link}>
                  Link {pick.size || ''} to {it.name}
                </button>
              </div>
            </>
          ) : (
            <p className="muted small">No likely transactions found in {year}. You can also give any transaction this category from the Transactions page (one by one or with Edit selected).</p>
          )}
        </>
      ) : null}
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
