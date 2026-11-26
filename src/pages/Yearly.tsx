import { useState } from 'react';
import { openArchiveView } from '../lib/archive';
import { useModel } from '../lib/useModel';
import { useMemo } from 'react';
import { yearlyPlan, yearlyCandidates } from '../lib/calc/yearly';
import { put, del, commit } from '../lib/db';
import { AmountInput, Field, Icon, Modal, Money, useToast } from '../components/ui';
import { CategorySelect } from '../components/TxEditor';
import { fmtDate, fmtMoney, today, uid, nowIso } from '../lib/util';
import type { YearlyItem, YearlyFund, Category, CategoryGroup } from '../lib/types';
import type { Model } from '../lib/calc/model';
import type { Change } from '../lib/importer/commit';
import { useTxEditor } from '../App';

/** Sub category of a yearly item: the budget section of its category ('' when not split yet). */
const GENERIC = 'Yearly expenses';
function subOf(m: Model, it: YearlyItem): string {
  const sec = it.categoryId ? m.categoryById.get(it.categoryId)?.section : undefined;
  return sec && sec !== GENERIC ? sec : '';
}
function subCategories(m: Model): string[] {
  const ye = m.groups.find((g) => g.code === 'YE');
  return Array.from(new Set(m.categories.filter((c) => c.groupId === ye?.id && c.section && c.section !== GENERIC).map((c) => c.section!))).sort();
}

/** A "Yearly expenses" category for an item: reuses one with the same name, otherwise makes YE0xx. */
function categoryFor(m: Model, name: string, taken: Category[] = [], section?: string, fresh = false): { id: string; changes: Change[] } {
  const changes: Change[] = [];
  let group = m.groups.find((g) => g.code === 'YE');
  if (!group) {
    group = { id: uid(), code: 'YE', name: 'Yearly expenses', kind: 'expense', sort: 5, updatedAt: nowIso() } as CategoryGroup;
    changes.push({ table: 'groups', put: group });
  }
  const all = [...m.categories, ...taken];
  const same = all.find((c) => c.groupId === group!.id && c.name.trim().toLowerCase() === name.trim().toLowerCase());
  if (same && !fresh) return { id: same.id, changes };
  const nums = all.filter((c) => /^YE\d+$/.test(c.code)).map((c) => Number(c.code.slice(2)));
  const code = `YE${String((nums.length ? Math.max(...nums) : 0) + 1).padStart(3, '0')}`;
  // paid from the yearly fund, like in the workbook; change the scope under Categories if needed
  const c: Category = { id: uid(), code, name: name.trim(), groupId: group.id, section: section?.trim() || 'Yearly expenses', costType: 'fixed', rollover: 'none', accountTypes: ['reserve', 'savings'], sort: 500 + nums.length, updatedAt: nowIso() };
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
  const withoutCat = p.rows.flatMap((r) => r.items).filter((x) => !x.categoryId).map((item) => ({ item }));
  const shared = p.rows.filter((r) => r.items.length > 1);
  // an earlier import could bring in the workbook's total row as an item
  const totalRow = p.rows.find((r) => /^(grand\s+)?totals?$/i.test(r.item.name.trim()) && r.estimated === p.rows.filter((x) => x !== r).reduce((a, x) => a + x.estimated, 0));
  // items under their sub category (like the sections of Planned costs in the budget)
  const subsUsed = Array.from(new Set(p.rows.map((r) => subOf(m, r.item))));
  const showSubs = subsUsed.some(Boolean);
  const groupedRows: Array<[string, typeof p.rows]> = subsUsed
    .sort((a, b) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)))
    .map((sub) => [sub, p.rows.filter((r) => subOf(m, r.item) === sub)]);
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
      {totalRow ? (
        <div className="notice bad" style={{ marginBottom: 'var(--s4)' }}>
          <b>“{totalRow.item.name}” looks like the total row from your Excel workbook</b>: its estimate ({fmtMoney(totalRow.item.estimated)}) equals all other items together, so every total on this page is counted twice.{' '}
          <button
            className="btn sm danger"
            onClick={async () => {
              const before = totalRow.item;
              await del('yearlyItems', before.id);
              toast({ text: `“${before.name}” removed`, action: { label: 'Undo', run: () => put('yearlyItems', before) } });
            }}
          >
            Remove it
          </button>
        </div>
      ) : null}
      {shared.length ? (
        <div className="notice" style={{ marginBottom: 'var(--s4)' }}>
          <b>{shared.map((r) => `${r.items.map((x) => x.name).join(' and ')} (${m.categoryById.get(r.item.categoryId ?? '')?.code})`).join('; ')}</b>{' '}
          {shared.length === 1 ? 'share one category' : 'each share a category'}, so {shared.length === 1 ? 'they are' : 'each pair is'} shown as one line: the money booked on a category counts once. To follow them separately, open one, pick or create its own category, and move its transactions to it on the Transactions page.
        </div>
      ) : null}
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
                {groupedRows.map(([sub, rows]) => [
                  showSubs ? (
                    <tr key={`h-${sub}`} className="ysub">
                      <td colSpan={2}>
                        <b>{sub || 'Not in a sub category'}</b> <span className="muted small">· {rows.length} item{rows.length === 1 ? '' : 's'}</span>
                      </td>
                      <td className="r"><Money v={rows.reduce((a, r) => a + r.estimated, 0)} /></td>
                      <td className="r"><Money v={rows.reduce((a, r) => a + r.actual, 0)} /></td>
                      <td className="r"><Money v={rows.reduce((a, r) => a + r.remainder, 0)} /></td>
                      <td colSpan={2} />
                    </tr>
                  ) : null,
                  ...rows.map((r) => (
                  <tr key={r.item.id} className="click" onClick={() => setEdit(r.item)}>
                    <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(r.item.dueDate)}</td>
                    <td>
                      {r.items.map((x) => x.name).join(' + ')}
                      <div className="small muted">
                        {r.items.length > 1 ? <span className="badge warn" style={{ marginRight: 6 }}>{r.items.length} items, one category</span> : null}
                        {r.item.categoryId ? `${m.categoryById.get(r.item.categoryId)?.code} · ` : 'No category · '}
                        {r.source === 'transactions' ? `${r.linked.length} linked transaction${r.linked.length === 1 ? '' : 's'}` : r.source === 'entered' ? 'amount entered by hand — link its transactions' : 'nothing linked yet'}
                      </div>
                    </td>
                    <td className="r"><Money v={r.estimated} /></td>
                    <td className="r"><Money v={r.actual} /></td>
                    <td className="r"><Money v={r.remainder} /></td>
                    <td>
                      {r.status === 'paid' ? <span className="badge good">Paid</span> : r.status === 'overdue' ? <span className="badge bad">Past due date</span> : r.status === 'due-soon' ? <span className="badge warn">Due soon</span> : <span className="badge">Planned</span>}
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" aria-label="Paid" checked={r.paid} onChange={(e) => commit(r.items.map((x) => ({ table: 'yearlyItems' as const, put: { ...x, paid: e.target.checked } })), 'Paid')} style={{ width: 18, height: 18, accentColor: 'var(--moss)' }} />
                    </td>
                  </tr>
                  ))
                ])}
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
  const [sub, setSub] = useState(() => subOf(m, initial ?? ({ categoryId: null } as YearlyItem)));
  /** Changes that put the item's category in the chosen sub category. */
  const subChanges = (catId: string | null): Change[] => {
    const c = catId ? m.categoryById.get(catId) : undefined;
    if (!c || m.groupById.get(c.groupId)?.code !== 'YE') return [];
    const want = sub.trim() || GENERIC;
    return (c.section ?? GENERIC) === want ? [] : [{ table: 'categories', put: { ...c, section: want, updatedAt: nowIso() } }];
  };
  const set = (p: Partial<YearlyItem>) => setIt({ ...it, ...p });
  const row = initial ? yearlyPlan(m, year, today()).rows.find((r) => r.item.id === initial.id) : undefined;
  const candidates = useMemo(() => (initial ? yearlyCandidates(m, { ...it }, fundAccountId).slice(0, 40) : []), [m, it.categoryId, it.name, fundAccountId]);
  const hiddenCategorised = useMemo(() => (initial ? yearlyCandidates(m, { ...it }, fundAccountId, { includeCategorised: true }).length - yearlyCandidates(m, { ...it }, fundAccountId).length : 0), [m, it.categoryId, it.name, fundAccountId]);
  const paidCat = m.categories.find((c) => c.code === 'DIV001');
  // An item is a yearly budget line: it books on its own category, like a line in the monthly budget.
  const cat = it.categoryId ? m.categoryById.get(it.categoryId) : undefined;
  const sharedWith = it.categoryId ? m.yearlyItems.filter((y) => y.id !== it.id && y.year === it.year && y.categoryId === it.categoryId) : [];
  const usedElsewhere = useMemo(() => new Set(m.yearlyItems.filter((y) => y.id !== it.id && y.year === it.year && y.categoryId).map((y) => y.categoryId!)), [m, it.id, it.year]);
  const [changeCat, setChangeCat] = useState(false);

  async function save() {
    const changes: Change[] = [];
    let catId = it.categoryId;
    if (!catId) {
      // a new item gets its own category, named after it
      const res = categoryFor(m, it.name, [], sub, true);
      catId = res.id;
      changes.push(...res.changes);
    } else if (cat && m.groupById.get(cat.groupId)?.code === 'YE' && !sharedWith.length && cat.name !== it.name.trim()) {
      // the item and its category are one: renaming one renames the other
      changes.push({ table: 'categories', put: { ...cat, name: it.name.trim(), updatedAt: nowIso() } });
    }
    changes.push({ table: 'yearlyItems', put: { ...it, categoryId: catId } }, ...subChanges(catId));
    await commit(changes, 'Yearly item');
    onClose();
  }

  /** For items that share a category: the one whose name doesn't match it gets a category of its own. */
  const movable = sharedWith.length ? [it, ...sharedWith].filter((y) => y.name.trim() !== cat?.name) : [];
  const toMove = movable.length ? movable : [it];
  async function ownCategory(target: YearlyItem) {
    const res = categoryFor(m, target.name, [], subOf(m, target) === GENERIC ? sub : subOf(m, target), true);
    const put = target.id === it.id ? { ...it, categoryId: res.id } : { ...target, categoryId: res.id, updatedAt: nowIso() };
    await commit([...res.changes, { table: 'yearlyItems', put }], 'Own category for yearly item');
    if (target.id === it.id) set({ categoryId: res.id });
    toast(`${target.name} now has its own category. Move its transactions to it on the Transactions page.`);
  }

  async function link() {
    let catId = it.categoryId;
    const changes: Change[] = [];
    if (!catId) {
      const res = categoryFor(m, it.name, [], sub, true);
      catId = res.id;
      changes.push(...res.changes);
    }
    const before = m.transactions.filter((t) => pick.has(t.id));
    for (const t of before) changes.push({ table: 'transactions', put: { ...t, categoryId: catId } });
    changes.push({ table: 'yearlyItems', put: { ...it, categoryId: catId } }, ...subChanges(catId));
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
          <button className="btn primary" disabled={!it.name.trim()} onClick={save}>Save</button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Item" className="full"><input className="input" value={it.name} onChange={(e) => set({ name: e.target.value })} autoFocus={!initial} /></Field>
        <Field label="Sub category" help="Groups yearly items, e.g. Car, House, Presents. Also shown as a section in the budget.">
          <input className="input" list="ye-subs" value={sub} onChange={(e) => setSub(e.target.value)} placeholder="e.g. Car" />
          <datalist id="ye-subs">{subCategories(m).map((x) => <option key={x} value={x} />)}</datalist>
        </Field>
        <Field label="Estimated"><AmountInput value={it.estimated} onChange={(estimated) => set({ estimated })} /></Field>
        <Field label="Due date"><input className="input" type="date" value={it.dueDate} onChange={(e) => set({ dueDate: e.target.value })} /></Field>
        <div className="full small yi-cat">
          {cat ? (
            <>
              Books on <b>{cat.code} · {cat.name}</b>: everything booked on it in {it.year} is the actual, split payments included.{' '}
            </>
          ) : (
            <>Saving creates its category, <b>{it.name.trim() || 'named after the item'}</b>, under Yearly expenses{sub.trim() ? ` · ${sub.trim()}` : ''}. </>
          )}
          {!changeCat ? (
            <button type="button" className="link-btn" onClick={() => setChangeCat(true)}>{cat ? 'Use another category' : 'Use an existing category'}</button>
          ) : null}
          {changeCat ? (
            <div style={{ marginTop: 6, maxWidth: 420 }}>
              <CategorySelect m={m} value={it.categoryId} onChange={(categoryId) => set({ categoryId })} filter={(k) => k === 'expense'} exclude={usedElsewhere} allowNew={false} emptyLabel="Create a new one when saving" ariaLabel="Category" />
            </div>
          ) : null}
        </div>
        {sharedWith.length ? (
          <div className="notice full small" style={{ margin: 0 }}>
            <b>{sharedWith.map((x) => x.name).join(', ')}</b> books on the same category, so the two are shown as one line.{' '}
            {toMove.map((y) => (
              <button key={y.id} type="button" className="btn sm" style={{ marginRight: 6 }} onClick={() => ownCategory(y)}>Give {y.name} its own category</button>
            ))}
          </div>
        ) : null}
        <Field label="Amount entered by hand" help="Only used while nothing is booked on its category yet (e.g. the actual from your workbook)">
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
            <span className="hint">without a category or booked as “Yearly expenses (paid)”: paid from the fund or naming “{it.name}”</span>
          </div>
          {hiddenCategorised ? (
            <p className="small muted" style={{ margin: '0 0 8px' }}>
              {hiddenCategorised} more transaction{hiddenCategorised === 1 ? '' : 's'} could match but already {hiddenCategorised === 1 ? 'has' : 'have'} another category, so {hiddenCategorised === 1 ? 'it is' : 'they are'} not shown. Change the category on the Transactions page if one belongs here.
            </p>
          ) : null}
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
