import { useMemo, useState } from 'react';
import { useModel } from '../lib/useModel';
import { balanceHistory, cashFlow, incomeByCategory, spendingByCategory } from '../lib/calc/reports';
import { CashFlowChart, TrendChart, SERIES } from '../components/charts';
import { Icon, Money, Seg, useToast } from '../components/ui';
import { MONTHS, shiftMonth, sum } from '../lib/util';
import { currentBudgetMonth } from '../lib/calc/period';
import { useSyncStatus, runSync } from '../lib/useSync';
import { isReserve } from '../lib/calc/model';
import { DrillMoney } from '../components/DrillDown';
import { CatChip } from '../components/Group';

type Tab = 'cash' | 'spend' | 'income' | 'balances';
const ml = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(2, 4)}`;

export default function Reports() {
  const m = useModel();
  const toast = useToast();
  const sync = useSyncStatus();
  const [tab, setTab] = useState<Tab>('cash');
  const [to, setTo] = useState(currentBudgetMonth(m));
  const [span, setSpan] = useState<'6' | '12' | 'year'>('12');
  const [acc, setAcc] = useState('all');
  const [busy, setBusy] = useState(false);
  const from = span === 'year' ? `${to.slice(0, 4)}-01` : shiftMonth(to, -(Number(span) - 1));
  const to2 = span === 'year' ? `${to.slice(0, 4)}-12` : to;
  const f = { from, to: to2, accountIds: acc === 'all' ? undefined : [acc] };
  const cf = useMemo(() => cashFlow(m, f), [m, from, to2, acc]);
  const sp = useMemo(() => spendingByCategory(m, f), [m, from, to2, acc]);
  const inc = useMemo(() => incomeByCategory(m, f), [m, from, to2, acc]);
  const bh = useMemo(() => balanceHistory(m, f), [m, from, to2]);

  async function download() {
    setBusy(true);
    try {
      const { buildReportWorkbook } = await import('../lib/excel/reports');
      const buf = await buildReportWorkbook(m, { from, to: to2 });
      const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `Household Reports ${from} to ${to2}.xlsx`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      toast('Excel report downloaded');
    } finally {
      setBusy(false);
    }
  }

  const grid = (d: typeof sp) => (
    <div className="panel flush">
      <div className="table-wrap" style={{ maxHeight: '65vh' }}>
        <table className="t grid">
          <thead>
            <tr>
              <th>Category</th>
              {d.months.map((x) => <th key={x} className="r">{ml(x)}</th>)}
              <th className="r">Total</th>
              <th className="r">Avg / month</th>
            </tr>
          </thead>
          <tbody>
            {d.rows.map((r) => {
              const c = r.categoryId === 'none' ? undefined : m.categoryById.get(r.categoryId as string);
              return (
                <tr key={r.categoryId as string}>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <CatChip m={m} categoryId={c?.id} />
                    {c?.section ? <span className="muted small"> · {c.section}</span> : null}
                  </td>
                  {r.values.map((v, i) => (
                    <td key={i} className="r small">
                      {v ? <DrillMoney v={v} compact f={{ title: `${c?.name ?? 'Uncategorised'} · ${ml(d.months[i])}`, from: d.months[i], categoryIds: c ? [c.id] : undefined, type: c ? 'all' : tab === 'income' ? 'income' : 'spending', accountIds: f.accountIds }} /> : <span className="muted">·</span>}
                    </td>
                  ))}
                  <td className="r"><b><Money v={r.total} compact /></b></td>
                  <td className="r muted"><Money v={Math.round(r.total / d.months.length)} compact /></td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td>Total</td>
              {d.months.map((_, i) => <td key={i} className="r small"><Money v={sum(d.rows.map((r) => r.values[i]))} compact /></td>)}
              <td className="r"><Money v={sum(d.rows.map((r) => r.total))} compact /></td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Reports</h1>
          <p className="sub">
            {sync.state.location
              ? sync.state.lastReportAt
                ? `Excel reports on OneDrive were refreshed ${new Date(sync.state.lastReportAt).toLocaleString('en-GB')} (data revision ${sync.state.lastReportRevision}).`
                : 'Excel reports are published to OneDrive after the next sync.'
              : 'Turn on OneDrive sync to have Excel reports published automatically after every sync.'}
            {sync.state.reportError ? ` Last publish failed: ${sync.state.reportError}. The previous report is still there.` : ''}
          </p>
        </div>
        <div className="actions">
          {sync.state.location ? <button className="btn" onClick={() => runSync()}>Publish now</button> : null}
          <button className="btn primary" onClick={download} disabled={busy}>
            <Icon name="download" size={16} /> {busy ? 'Building…' : 'Download Excel'}
          </button>
        </div>
      </div>
      <div className="row wrap" style={{ marginBottom: 'var(--s4)' }}>
        <Seg value={tab} onChange={setTab} options={[['cash', 'Cash flow'], ['spend', 'Spending'], ['income', 'Income'], ['balances', 'Balances']]} />
        <span className="spacer" />
        <select className="input" style={{ width: 'auto' }} value={acc} onChange={(e) => setAcc(e.target.value)} aria-label="Account">
          <option value="all">All accounts</option>
          {m.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <Seg value={span} onChange={setSpan} options={[['6', '6 months'], ['12', '12 months'], ['year', 'Calendar year']]} />
        <input className="input" type="month" style={{ width: 'auto' }} value={to} onChange={(e) => e.target.value && setTo(e.target.value)} aria-label="Ending month" />
      </div>

      {tab === 'cash' ? (
        <>
          <div className="panel"><CashFlowChart data={cf} height={280} /></div>
          <div className="panel flush section" style={{ marginTop: 'var(--s4)' }}>
            <div className="table-wrap">
              <table className="t">
                <thead><tr><th>Month</th><th className="r">Income</th><th className="r">Spending</th><th className="r">Net</th><th className="r">Into reserves</th></tr></thead>
                <tbody>
                  {cf.map((r) => (
                    <tr key={r.month}>
                      <td>{ml(r.month)}</td>
                      <td className="r"><DrillMoney v={r.income} f={{ title: `Income · ${ml(r.month)}`, from: r.month, type: 'income', accountIds: f.accountIds }} /></td>
                      <td className="r"><DrillMoney v={r.spending} f={{ title: `Spending · ${ml(r.month)}`, from: r.month, type: 'spending', accountIds: f.accountIds }} /></td>
                      <td className="r"><Money v={r.net} tone /></td>
                      <td className="r"><DrillMoney v={r.reserved} f={{ title: `Into reserves · ${ml(r.month)}`, from: r.month, type: 'reserved', accountIds: f.accountIds }} /></td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr><td>Total</td><td className="r"><Money v={sum(cf.map((r) => r.income))} /></td><td className="r"><Money v={sum(cf.map((r) => r.spending))} /></td><td className="r"><Money v={sum(cf.map((r) => r.net))} tone /></td><td className="r"><Money v={sum(cf.map((r) => r.reserved))} /></td></tr>
                </tfoot>
              </table>
            </div>
          </div>
        </>
      ) : null}
      {tab === 'spend' ? grid(sp) : null}
      {tab === 'income' ? grid(inc) : null}
      {tab === 'balances' ? (
        <>
          <div className="panel">
            <TrendChart data={bh} series={[{ key: 'spendable', name: 'Current & cash', color: SERIES[3] }, { key: 'reserves', name: 'Reserves & savings', color: SERIES[0] }]} height={280} />
          </div>
          <div className="panel flush section" style={{ marginTop: 'var(--s4)' }}>
            <div className="table-wrap">
              <table className="t">
                <thead><tr><th>Month end</th>{m.accounts.filter((a) => !a.archived).map((a) => <th key={a.id} className="r">{a.name}</th>)}<th className="r">Total</th></tr></thead>
                <tbody>
                  {bh.map((h) => (
                    <tr key={h.month}><td>{ml(h.month)}</td>{m.accounts.filter((a) => !a.archived).map((a) => <td key={a.id} className={`r small ${isReserve(a) ? '' : ''}`}><Money v={h.perAccount[a.id] ?? 0} compact /></td>)}<td className="r"><b><Money v={h.total} compact /></b></td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
