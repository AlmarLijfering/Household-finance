import { useMemo, useState } from 'react';
import type { ID, ReportGroup } from '../lib/types';
import type { Model } from '../lib/calc/model';
import { groupSeries, incomeOut, OTHER_INCOME, type ReportFilter } from '../lib/calc/reports';
import { put } from '../lib/db';
import { MONTHS, sum, uid, nowIso } from '../lib/util';
import { AverageChart, IncomeOutChart } from './charts';
import { Field, Icon, Modal, Money, useToast } from './ui';
import { DrillMoney } from './DrillDown';
import { CatChip, groupColor } from './Group';

const ml = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(2, 4)}`;
// Default colours for income sources, in stacking order (validated categorical set first).
const INCOME_COLORS = ['#2D8A5F', '#2F79B5', '#1F8A8A', '#C98512', '#9B5BB5', '#6B7785', '#B5523B', '#7A8F2F'];

function sourceName(m: Model, key: string) {
  return key === OTHER_INCOME ? 'Other money in' : m.categoryById.get(key)?.name ?? 'Unknown';
}

// ---------------------------------------------------------------------------------
// Income & spending

export function IncomeOutView({ m, f }: { m: Model; f: ReportFilter }) {
  const toast = useToast();
  const { rows: all, sources } = useMemo(() => incomeOut(m, f), [m, f.from, f.to, f.accountIds?.join()]);
  // months before your data starts would pull the line to zero
  const first = all.findIndex((r) => r.income || r.out);
  const rows = first > 0 ? all.slice(first) : all;
  const colors = m.settings.incomeReport?.colors ?? {};
  const colorOf = (key: string, i: number) => colors[key] ?? INCOME_COLORS[i % INCOME_COLORS.length];
  const series = sources.map((k, i) => ({ key: k, name: sourceName(m, k), color: colorOf(k, i) }));
  const [arranging, setArranging] = useState(false);
  const total = (k: keyof (typeof rows)[number]) => sum(rows.map((r) => r[k] as number));
  const months = rows.length;

  return (
    <>
      <div className="panel">
        <div className="row wrap" style={{ marginBottom: 6 }}>
          <p className="small muted" style={{ margin: 0, maxWidth: '72ch' }}>
            Bars: income by source. Line: everything that went out, spending plus reservations and savings. Where the line is above the bar you used more than came in; where it cuts through the bar you can see which income the rest comes from.
          </p>
          <span className="spacer" />
          <button className="btn sm" onClick={() => setArranging(true)}>
            <Icon name="edit" size={14} /> Order &amp; colours
          </button>
        </div>
        <IncomeOutChart data={rows} sources={series} height={340} />
      </div>

      <div className="panel flush section" style={{ marginTop: 'var(--s4)' }}>
        <div className="table-wrap">
          <table className="t grid">
            <thead>
              <tr>
                <th>Month</th>
                {[...series].reverse().map((s) => (
                  <th key={s.key} className="r">
                    <span className="gdot" style={{ ['--g' as any]: s.color }} /> {s.name}
                  </th>
                ))}
                <th className="r">Income</th>
                <th className="r">Reservations &amp; savings</th>
                <th className="r">Spending</th>
                <th className="r">Left</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.month}>
                  <td>{ml(r.month)}</td>
                  {[...series].reverse().map((s) => (
                    <td key={s.key} className="r small">
                      {r[s.key] ? <DrillMoney v={r[s.key] as number} compact f={{ title: `${s.name} · ${ml(r.month)}`, from: r.month, categoryIds: s.key === OTHER_INCOME ? undefined : [s.key], type: 'income', accountIds: f.accountIds }} /> : <span className="muted">·</span>}
                    </td>
                  ))}
                  <td className="r"><b><Money v={r.income} compact /></b></td>
                  <td className="r"><DrillMoney v={r.reserved} compact f={{ title: `Reservations & savings · ${ml(r.month)}`, from: r.month, type: 'reserved', accountIds: f.accountIds }} /></td>
                  <td className="r"><DrillMoney v={r.spending} compact f={{ title: `Spending · ${ml(r.month)}`, from: r.month, type: 'spending', accountIds: f.accountIds }} /></td>
                  <td className="r"><Money v={r.left} compact tone /></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>Total</td>
                {[...series].reverse().map((s) => <td key={s.key} className="r small"><Money v={sum(rows.map((r) => r[s.key] as number))} compact /></td>)}
                <td className="r"><Money v={total('income')} compact /></td>
                <td className="r"><Money v={total('reserved')} compact /></td>
                <td className="r"><Money v={total('spending')} compact /></td>
                <td className="r"><Money v={total('left')} compact tone /></td>
              </tr>
              <tr>
                <td>Average</td>
                {[...series].reverse().map((s) => <td key={s.key} className="r small muted"><Money v={Math.round(sum(rows.map((r) => r[s.key] as number)) / Math.max(1, months))} compact /></td>)}
                <td className="r muted"><Money v={Math.round(total('income') / Math.max(1, months))} compact /></td>
                <td className="r muted"><Money v={Math.round(total('reserved') / Math.max(1, months))} compact /></td>
                <td className="r muted"><Money v={Math.round(total('spending') / Math.max(1, months))} compact /></td>
                <td className="r muted"><Money v={Math.round(total('left') / Math.max(1, months))} compact tone /></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {arranging ? (
        <ArrangeSources
          m={m}
          sources={series}
          onClose={() => setArranging(false)}
          onSave={async (order, cols) => {
            await put('settings', { ...m.settings, incomeReport: { order, colors: cols }, updatedAt: nowIso() }, 'Income report layout');
            toast('Order and colours saved');
            setArranging(false);
          }}
        />
      ) : null}
    </>
  );
}

function ArrangeSources({ m, sources, onClose, onSave }: { m: Model; sources: Array<{ key: string; name: string; color: string }>; onClose: () => void; onSave: (order: string[], colors: Record<string, string>) => void }) {
  // also offer income categories that have no money in this period, so the order is complete
  const extra = m.categories.filter((c) => !c.archived && m.groupById.get(c.groupId)?.kind === 'income' && !sources.some((s) => s.key === c.id));
  const saved = m.settings.incomeReport?.colors ?? {};
  const [list, setList] = useState(() => [...sources, ...extra.map((c, i) => ({ key: c.id, name: c.name, color: saved[c.id] ?? INCOME_COLORS[(sources.length + i) % INCOME_COLORS.length] }))]);
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= list.length) return;
    const next = [...list];
    [next[i], next[j]] = [next[j], next[i]];
    setList(next);
  };
  return (
    <Modal
      title="Order and colours of income"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={() => onSave(list.map((x) => x.key), Object.fromEntries(list.map((x) => [x.key, x.color])))}>Save</button>
        </>
      }
    >
      <p className="small muted" style={{ marginTop: 0 }}>
        The first source sits at the bottom of each bar. Put the income you count on most at the bottom: what is left above the line then shows which extra money it came from.
      </p>
      <div className="list flat">
        {list.map((s, i) => (
          <div className="list-row compact" key={s.key}>
            <span className="muted small" style={{ width: 54 }}>{i === 0 ? 'Bottom' : i === list.length - 1 ? 'Top' : ''}</span>
            <input type="color" aria-label={`Colour for ${s.name}`} value={s.color} onChange={(e) => setList(list.map((x) => (x.key === s.key ? { ...x, color: e.target.value } : x)))} style={{ width: 36, height: 28, border: 0, padding: 0, background: 'none' }} />
            <span className="grow">{s.name}</span>
            <button className="icon-btn" aria-label={`Move ${s.name} down in the bar`} disabled={i === 0} onClick={() => move(i, -1)}>
              <Icon name="down" size={16} />
            </button>
            <button className="icon-btn" aria-label={`Move ${s.name} up in the bar`} disabled={i === list.length - 1} onClick={() => move(i, 1)}>
              <Icon name="up" size={16} />
            </button>
          </div>
        ))}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------------
// Category groups

export function GroupsView({ m, f }: { m: Model; f: ReportFilter }) {
  const toast = useToast();
  const groups = m.settings.reportGroups ?? [];
  const [selId, setSelId] = useState<ID | null>(groups[0]?.id ?? null);
  const sel = groups.find((g) => g.id === selId) ?? groups[0];
  const [editing, setEditing] = useState<ReportGroup | 'new' | null>(null);
  const data = useMemo(() => (sel ? groupSeries(m, f, sel.categoryIds) : null), [m, sel, f.from, f.to, f.accountIds?.join()]);

  async function saveGroups(next: ReportGroup[], label: string) {
    await put('settings', { ...m.settings, reportGroups: next, updatedAt: nowIso() }, label);
  }

  return (
    <>
      <div className="row wrap" style={{ marginBottom: 'var(--s3)' }}>
        {groups.length ? (
          <select className="input" style={{ width: 'auto', minWidth: 220 }} aria-label="Category group" value={sel?.id ?? ''} onChange={(e) => setSelId(e.target.value)}>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.label}
              </option>
            ))}
          </select>
        ) : null}
        {sel ? (
          <button className="btn" onClick={() => setEditing(sel)}>
            <Icon name="edit" size={16} /> Edit
          </button>
        ) : null}
        <button className="btn primary" onClick={() => setEditing('new')}>
          <Icon name="plus" size={16} /> New group
        </button>
      </div>

      {!sel || !data ? (
        <div className="empty">
          <h3>Put categories together</h3>
          <p>Pick one or more categories, for example all phone bills from different budget sections, give them a label and see them over time with their average.</p>
          <button className="btn primary" onClick={() => setEditing('new')}>New group</button>
        </div>
      ) : (
        <>
          <div className="panel">
            <div className="row wrap" style={{ marginBottom: 6, gap: 24 }}>
              <div>
                <div className="k-label">{data.incomeOnly ? 'Received' : 'Spent'} in this period</div>
                <div className="k-val"><Money v={data.total} /></div>
              </div>
              <div>
                <div className="k-label">Average per month</div>
                <div className="k-val"><Money v={data.avg} /></div>
              </div>
              <div className="small muted" style={{ alignSelf: 'flex-end' }}>
                {sel.categoryIds.length} {sel.categoryIds.length === 1 ? 'category' : 'categories'} · average over {data.months.length} months, months without bookings count as 0
              </div>
            </div>
            <AverageChart data={data.months.map((month, i) => ({ month, value: data.values[i] }))} name={sel.label} color={sel.color ?? '#2F79B5'} avg={data.avg} height={300} />
          </div>
          <div className="panel flush section" style={{ marginTop: 'var(--s4)' }}>
            <div className="table-wrap">
              <table className="t grid">
                <thead>
                  <tr>
                    <th>Category</th>
                    {data.months.map((x) => <th key={x} className="r">{ml(x)}</th>)}
                    <th className="r">Total</th>
                    <th className="r">Avg / month</th>
                  </tr>
                </thead>
                <tbody>
                  {data.perCategory.map((r) => {
                    const c = m.categoryById.get(r.categoryId);
                    return (
                      <tr key={r.categoryId}>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          <CatChip m={m} categoryId={r.categoryId} />
                          {c?.section ? <span className="muted small"> · {c.section}</span> : null}
                        </td>
                        {r.values.map((v, i) => (
                          <td key={i} className="r small">
                            {v ? <DrillMoney v={v} compact f={{ title: `${c?.name ?? ''} · ${ml(data.months[i])}`, from: data.months[i], categoryIds: [r.categoryId], type: 'all', accountIds: f.accountIds }} /> : <span className="muted">·</span>}
                          </td>
                        ))}
                        <td className="r"><b><Money v={sum(r.values)} compact /></b></td>
                        <td className="r muted"><Money v={Math.round(sum(r.values) / data.months.length)} compact /></td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <td>{sel.label}</td>
                    {data.values.map((v, i) => <td key={i} className="r small"><Money v={v} compact /></td>)}
                    <td className="r"><Money v={data.total} compact /></td>
                    <td className="r"><Money v={data.avg} compact /></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </>
      )}

      {editing ? (
        <GroupForm
          m={m}
          group={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onDelete={
            editing !== 'new'
              ? async () => {
                  await saveGroups(groups.filter((g) => g.id !== editing.id), 'Delete report group');
                  setSelId(null);
                  setEditing(null);
                  toast('Group deleted');
                }
              : undefined
          }
          onSave={async (g) => {
            const exists = groups.some((x) => x.id === g.id);
            await saveGroups(exists ? groups.map((x) => (x.id === g.id ? g : x)) : [...groups, g], 'Report group');
            setSelId(g.id);
            setEditing(null);
            toast(`“${g.label}” saved`);
          }}
        />
      ) : null}
    </>
  );
}

function GroupForm({ m, group, onClose, onSave, onDelete }: { m: Model; group: ReportGroup | null; onClose: () => void; onSave: (g: ReportGroup) => void; onDelete?: () => void }) {
  const [label, setLabel] = useState(group?.label ?? '');
  const [ids, setIds] = useState<Set<ID>>(new Set(group?.categoryIds ?? []));
  const [color, setColor] = useState(group?.color ?? '#2F79B5');
  const [q, setQ] = useState('');
  const match = (name: string, extra = '') => !q || `${name} ${extra}`.toLowerCase().includes(q.toLowerCase());
  const toggle = (id: ID) => {
    const next = new Set(ids);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setIds(next);
  };
  const shownGroups = m.groups.filter((g) => g.kind !== 'transfer' && g.kind !== 'opening');
  return (
    <Modal
      title={group ? `Edit “${group.label}”` : 'New category group'}
      onClose={onClose}
      wide
      footer={
        <>
          {onDelete ? (
            <button className="btn danger" onClick={onDelete}>
              <Icon name="trash" size={16} /> Delete
            </button>
          ) : null}
          <span className="spacer" />
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!label.trim() || !ids.size} onClick={() => onSave({ id: group?.id ?? uid(), label: label.trim(), categoryIds: [...ids], color })}>
            Save group
          </button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Label">
          <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Phone bills" autoFocus />
        </Field>
        <Field label="Line colour">
          <input type="color" className="input" value={color} onChange={(e) => setColor(e.target.value)} style={{ padding: 4, height: 40 }} />
        </Field>
      </div>
      <div className="row wrap" style={{ margin: '14px 0 8px' }}>
        <b>{ids.size} selected</b>
        <span className="spacer" />
        <input className="input" style={{ maxWidth: 260 }} placeholder="Find a category" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find a category" />
      </div>
      <div className="pick-list">
        {shownGroups.map((g) => {
          const cats = m.categories.filter((c) => c.groupId === g.id && !c.archived && match(c.name, `${c.section ?? ''} ${c.code}`));
          if (!cats.length) return null;
          return (
            <div key={g.id} className="pick-group">
              <div className="pick-head">
                <span className="gdot" style={{ ['--g' as any]: groupColor(g.code) }} /> {g.name}
              </div>
              {cats.map((c) => (
                <label key={c.id} className="pick-row">
                  <input type="checkbox" checked={ids.has(c.id)} onChange={() => toggle(c.id)} />
                  <span>{c.name}</span>
                  {c.section ? <span className="muted small">{c.section}</span> : null}
                  <span className="code-tag">{c.code}</span>
                </label>
              ))}
            </div>
          );
        })}
      </div>
    </Modal>
  );
}
