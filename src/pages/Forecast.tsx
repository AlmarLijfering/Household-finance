import { useMemo, useState } from 'react';
import { useModel } from '../lib/useModel';
import { forecast, lowestPoint } from '../lib/calc/forecast';
import { TrendChart, SERIES } from '../components/charts';
import { AmountInput, Field, Icon, Modal, Money, Seg } from '../components/ui';
import { put, del } from '../lib/db';
import { monthLabel, uid, today, fmtDate } from '../lib/util';
import type { PlannedEntry, Scenario } from '../lib/types';
import { AccountSelect, CategorySelect } from '../components/TxEditor';
import { RecurringForm } from './Recurring';

export default function Forecast() {
  const m = useModel();
  const [months, setMonths] = useState<'6' | '12' | '24'>('12');
  const [scope, setScope] = useState<'spendable' | 'all'>('spendable');
  const [on, setOn] = useState<Set<string>>(new Set(m.scenarios.map((s) => s.id)));
  const [editScenario, setEditScenario] = useState<Scenario | 'new' | null>(null);
  const [plan, setPlan] = useState<{ scenarioId: string | null } | null>(null);
  const [rec, setRec] = useState<string | null>(null);

  const series = useMemo(() => {
    const opts = { months: Number(months), scope };
    return [forecast(m, opts, null), ...m.scenarios.filter((s) => on.has(s.id)).map((s) => forecast(m, opts, s))];
  }, [m, months, scope, on]);
  const data = series[0].points.map((p, i) => {
    const row: Record<string, any> = { month: p.month };
    series.forEach((s, k) => (row['s' + k] = s.points[i].balance));
    return row;
  });
  const base = series[0];
  const low = lowestPoint(base);
  const end = base.points[base.points.length - 1];
  const futurePlanned = m.planned.filter((p) => p.date >= today()).sort((a, b) => a.date.localeCompare(b.date));

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Forecast</h1>
          <p className="sub">Projected month-end balance from budgets, recurring items and planned one-offs.</p>
        </div>
        <div className="actions">
          <Seg value={scope} onChange={setScope} options={[['spendable', 'Everyday money'], ['all', 'Including reserves']]} />
          <Seg value={months} onChange={setMonths} options={[['6', '6 mo'], ['12', '12 mo'], ['24', '24 mo']]} />
        </div>
      </div>

      <div className="kpis">
        <div>
          <div className="k-label">In {monthLabel(end.month)}</div>
          <div className="k-val"><Money v={end.balance} /></div>
        </div>
        <div>
          <div className="k-label">Lowest point</div>
          <div className="k-val" style={{ color: low.balance < 0 ? 'var(--plum)' : undefined }}><Money v={low.balance} /></div>
          <div className="small muted">{monthLabel(low.month)}</div>
        </div>
        <div>
          <div className="k-label">Average monthly income</div>
          <div className="k-val"><Money v={Math.round(base.points.reduce((a, p) => a + p.income, 0) / base.points.length)} /></div>
        </div>
        <div>
          <div className="k-label">Average monthly costs</div>
          <div className="k-val"><Money v={Math.round(base.points.reduce((a, p) => a + p.costs, 0) / base.points.length)} /></div>
        </div>
      </div>

      <div className="panel section" style={{ marginTop: 'var(--s5)' }}>
        <TrendChart data={data} series={series.map((s, k) => ({ key: 's' + k, name: s.name, color: s.scenarioId ? s.color : SERIES[0] }))} height={300} zero />
      </div>
      <p className="small muted" style={{ marginTop: 8 }}>
        {scope === 'spendable'
          ? 'Everyday money: current accounts and cash. Money set aside into reserve funds counts as going out.'
          : 'Including reserves: all accounts. Transfers into reserve funds are neutral; yearly-fund items are paid out on their due date.'}{' '}
        Months without their own budget repeat the most recent one.
      </p>

      <div className="grid-2e section">
        <div>
          <div className="section-head">
            <h2>Scenarios</h2>
            <button className="btn sm" onClick={() => setEditScenario('new')}><Icon name="plus" size={14} /> New scenario</button>
          </div>
          <div className="list">
            <div className="list-row">
              <span className="swatch" style={{ background: SERIES[0] }} />
              <div className="grow">
                <div className="title">Base plan</div>
                <div className="meta">Budgets, recurring items and planned entries</div>
              </div>
            </div>
            {m.scenarios.map((s) => (
              <div className="list-row" key={s.id}>
                <input type="checkbox" aria-label={`Show ${s.name}`} checked={on.has(s.id)} onChange={(e) => { const n = new Set(on); e.target.checked ? n.add(s.id) : n.delete(s.id); setOn(n); }} style={{ width: 18, height: 18, accentColor: s.color }} />
                <span className="swatch" style={{ background: s.color }} />
                <div className="grow">
                  <div className="title">{s.name}</div>
                  <div className="meta">
                    {[s.incomeChangePct ? `income ${s.incomeChangePct > 0 ? '+' : ''}${s.incomeChangePct}%` : '', s.spendChangePct ? `spending ${s.spendChangePct > 0 ? '+' : ''}${s.spendChangePct}%` : '', `${m.planned.filter((p) => p.scenarioId === s.id).length + m.recurring.filter((r) => r.scenarioId === s.id).length} extra items`].filter(Boolean).join(' · ')}
                  </div>
                </div>
                <button className="btn sm ghost" onClick={() => setPlan({ scenarioId: s.id })}>One-off</button>
                <button className="btn sm ghost" onClick={() => setRec(s.id)}>Recurring</button>
                <button className="icon-btn" aria-label="Edit scenario" onClick={() => setEditScenario(s)}><Icon name="settings" size={16} /></button>
              </div>
            ))}
          </div>
        </div>
        <div>
          <div className="section-head">
            <h2>Planned one-offs</h2>
            <button className="btn sm" onClick={() => setPlan({ scenarioId: null })}><Icon name="plus" size={14} /> Add</button>
          </div>
          {futurePlanned.length ? (
            <div className="list">
              {futurePlanned.slice(0, 30).map((p) => (
                <div className="list-row click" key={p.id} onClick={() => del('planned', p.id, 'Remove planned entry')} title="Click to remove">
                  <div className="grow">
                    <div className="title">{p.memo || m.categoryById.get(p.categoryId ?? '')?.name || 'Planned'}</div>
                    <div className="meta">{fmtDate(p.date, true)} · {m.accountById.get(p.accountId)?.name} · {p.scenarioId ? m.scenarios.find((s) => s.id === p.scenarioId)?.name : 'Base plan'}</div>
                  </div>
                  <Money v={p.amount} tone />
                  <Icon name="x" size={16} />
                </div>
              ))}
            </div>
          ) : (
            <p className="muted">Planned entries are kept apart from actual transactions: a holiday next summer, a car purchase, a bonus. Imported future workbooks land here too.</p>
          )}
        </div>
      </div>

      {editScenario ? <ScenarioForm initial={editScenario === 'new' ? undefined : editScenario} onClose={() => setEditScenario(null)} /> : null}
      {plan ? <PlannedForm scenarioId={plan.scenarioId} onClose={() => setPlan(null)} /> : null}
      {rec ? <RecurringForm m={m} scenarioId={rec} onClose={() => setRec(null)} /> : null}
    </div>
  );
}

function ScenarioForm({ initial, onClose }: { initial?: Scenario; onClose: () => void }) {
  const m = useModel();
  const colors = ['#9B5BB5', '#C98512', '#2F79B5'];
  const [s, setS] = useState<Scenario>(initial ?? { id: uid(), name: '', color: colors[m.scenarios.length % colors.length], updatedAt: '' });
  return (
    <Modal
      title={initial ? 'Edit scenario' : 'New scenario'}
      onClose={onClose}
      footer={
        <>
          {initial ? <button className="btn danger" onClick={async () => { await del('scenarios', s.id); onClose(); }}>Delete</button> : null}
          <span className="spacer" />
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!s.name} onClick={async () => { await put('scenarios', s); onClose(); }}>Save</button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Name" className="full"><input className="input" value={s.name} onChange={(e) => setS({ ...s, name: e.target.value })} placeholder="e.g. Move to a bigger flat" autoFocus /></Field>
        <Field label="Income change (%)"><input className="input num" type="number" value={s.incomeChangePct ?? 0} onChange={(e) => setS({ ...s, incomeChangePct: Number(e.target.value) || undefined })} /></Field>
        <Field label="Spending change (%)"><input className="input num" type="number" value={s.spendChangePct ?? 0} onChange={(e) => setS({ ...s, spendChangePct: Number(e.target.value) || undefined })} /></Field>
        <Field label="Colour">
          <div className="row">
            {colors.map((c) => (
              <button key={c} type="button" aria-label={`Colour ${c}`} onClick={() => setS({ ...s, color: c })} style={{ width: 28, height: 28, borderRadius: 6, background: c, border: s.color === c ? '3px solid var(--ink)' : '1px solid var(--line)' }} />
            ))}
          </div>
        </Field>
      </div>
    </Modal>
  );
}

function PlannedForm({ scenarioId, onClose }: { scenarioId: string | null; onClose: () => void }) {
  const m = useModel();
  const [p, setP] = useState<PlannedEntry>({ id: uid(), scenarioId, date: today(), accountId: m.accounts.find((a) => a.type === 'current')?.id ?? '', amount: 0, categoryId: null, updatedAt: '' });
  const [out, setOut] = useState(true);
  return (
    <Modal title="Planned one-off" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!p.amount} onClick={async () => { await put('planned', { ...p, amount: out ? -Math.abs(p.amount) : Math.abs(p.amount) }); onClose(); }}>Add</button></>}>
      <div className="stack">
        <Seg value={out ? 'out' : 'in'} onChange={(v) => setOut(v === 'out')} options={[['out', 'Money out'], ['in', 'Money in']]} />
        <div className="form-grid">
          <Field label="Description" className="full"><input className="input" value={p.memo ?? ''} onChange={(e) => setP({ ...p, memo: e.target.value })} autoFocus /></Field>
          <Field label="Amount"><AmountInput value={Math.abs(p.amount)} onChange={(amount) => setP({ ...p, amount })} /></Field>
          <Field label="Date"><input className="input" type="date" value={p.date} onChange={(e) => setP({ ...p, date: e.target.value })} /></Field>
          <Field label="Account"><AccountSelect m={m} value={p.accountId} onChange={(accountId) => setP({ ...p, accountId })} /></Field>
          <Field label="Category"><CategorySelect m={m} value={p.categoryId} onChange={(categoryId) => setP({ ...p, categoryId })} /></Field>
        </div>
      </div>
    </Modal>
  );
}
