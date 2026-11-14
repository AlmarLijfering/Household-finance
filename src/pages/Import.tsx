import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useModel } from '../lib/useModel';
import { readWorkbook, type WorkbookData } from '../lib/importer/workbook';
import { parseWorkbook, planSummary, type ImportPlan } from '../lib/importer/parse';
import { buildCommit, suggestAccountMap, undoChanges, existingKeys } from '../lib/importer/commit';
import { commit } from '../lib/db';
import { Field, Icon, Money, Seg, useToast, Confirm } from '../components/ui';
import { cx, fmtDate } from '../lib/util';
import { structureChanges } from '../lib/seed';

export default function ImportPage() {
  const m = useModel();
  const toast = useToast();
  const [wb, setWb] = useState<WorkbookData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [year, setYear] = useState<number | null>(null);
  const [mode, setMode] = useState<'actuals' | 'plan'>('actuals');
  const [catMap, setCatMap] = useState<Record<string, string>>({});
  const [accMap, setAccMap] = useState<Record<string, string>>({});
  const [budgetOff, setBudgetOff] = useState<Set<string>>(new Set());
  const [opts, setOpts] = useState({ includeBudgets: true, includeYearly: true, includeFx: true, includeSubscriptions: true, skipAlreadyImported: true });
  const [done, setDone] = useState<{ counts: Record<string, number>; batchId: string } | null>(null);
  const [undo, setUndo] = useState<string | null>(null);
  const lockedBy = (batchId: string) => m.closedYears.find((c) => c.importBatchIds.includes(batchId))?.year;
  const [showRows, setShowRows] = useState(false);

  const plan: ImportPlan | null = useMemo(() => {
    if (!wb) return null;
    const p = parseWorkbook(wb, { year: year ?? undefined, mode, categoryMap: catMap });
    for (const b of p.budgets) if (budgetOff.has(b.sheet)) b.include = false;
    return p;
  }, [wb, year, mode, catMap, budgetOff]);
  const summary = plan ? planSummary(plan) : null;
  const accountMap = useMemo(() => (plan ? { ...suggestAccountMap(plan, m), ...accMap } : {}), [plan, m, accMap]);
  const already = useMemo(() => {
    if (!plan) return 0;
    const keys = existingKeys(m);
    return plan.transactions.filter((t) => keys.has(`${plan.fileName}:${t.sourceRef}|${t.amount}`)).length;
  }, [plan, m]);

  async function pick(file: File) {
    setLoading(true);
    setError(null);
    setDone(null);
    try {
      const data = await readWorkbook(await file.arrayBuffer(), file.name);
      const first = parseWorkbook(data);
      setWb(data);
      setYear(first.year);
      setMode(first.mode);
      setCatMap({});
      setAccMap({});
      setBudgetOff(new Set());
    } catch (e: any) {
      setError(`This file could not be read as an Excel workbook (${e?.message ?? e}). Save it as .xlsx and try again.`);
    } finally {
      setLoading(false);
    }
  }

  async function doCommit() {
    if (!plan) return;
    const changes: any[] = [];
    let model = m;
    if (!m.groups.length) {
      // first import: start from the household structure so names and sections are right
      const s = structureChanges();
      changes.push(...s.changes.filter((c) => c.table === 'settings' || c.table === 'groups' || c.table === 'categories'));
      const { buildModel } = await import('../lib/calc/model');
      model = buildModel({ ...m, groups: s.changes.filter((c) => c.table === 'groups').map((c) => c.put), categories: s.changes.filter((c) => c.table === 'categories').map((c) => c.put) });
    }
    const { changes: ch, batch, counts } = buildCommit(plan, model, { ...opts, accountMap });
    await commit([...changes, ...ch], `Import ${plan.fileName}`);
    setDone({ counts, batchId: batch.id });
    toast(`Imported ${plan.fileName}`);
  }

  const step = done ? 3 : plan ? 2 : 1;
  const unmapped = plan?.unmappedCategories ?? [];
  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Import from Excel</h1>
          <p className="sub">Bring in your budget workbooks. Nothing is saved until you confirm, and every import can be undone.</p>
        </div>
      </div>
      <div className="steps" aria-label="Progress">
        {['Choose workbook', 'Review & map', 'Done'].map((s, i) => (
          <span key={s} className={cx(step === i + 1 && 'on', step > i + 1 && 'done')}>{s}</span>
        ))}
      </div>

      {step === 1 ? (
        <div className="empty">
          <h3>Choose a workbook</h3>
          <p>
            Works with your <b>Budget 2026</b> layout (one sheet per account, monthly budget sheets, Lookups) and the <b>budget 2027</b> layout (coded categories, All Accounts). Stocks and investment sheets are skipped.
          </p>
          <label className="btn primary">
            <Icon name="import" size={16} /> {loading ? 'Reading…' : 'Choose .xlsx file'}
            <input type="file" accept=".xlsx,.xlsm" hidden onChange={(e) => e.target.files?.[0] && pick(e.target.files[0])} />
          </label>
          {error ? <div className="notice bad" style={{ marginTop: 12 }}>{error}</div> : null}
        </div>
      ) : null}

      {step === 2 && plan && summary ? (
        <div className="stack">
          <div className="panel">
            <div className="row wrap">
              <div className="grow">
                <h3>{plan.fileName}</h3>
                <p className="small muted">
                  {plan.layout === 'workbook-2026' ? 'Household budget workbook (account sheets with month and week)' : plan.layout === 'workbook-2027' ? 'Household budget workbook with coded categories' : 'Workbook with named tables'}
                </p>
              </div>
              <button className="btn ghost" onClick={() => setWb(null)}>Choose another file</button>
            </div>
            <div className="form-grid" style={{ marginTop: 12 }}>
              <Field label="Year in this workbook" help="Rows only carry a month and week; this year is used to build dates.">
                <input className="input" type="number" value={year ?? ''} onChange={(e) => setYear(Number(e.target.value))} />
              </Field>
              <Field label="Import as">
                <Seg value={mode} onChange={setMode} options={[['actuals', 'Actual transactions'], ['plan', 'Future plan']]} />
              </Field>
            </div>
            <p className="small muted" style={{ marginTop: 8 }}>
              {mode === 'actuals' ? 'Rows become transactions in your accounts, with opening balances from the “Start” rows.' : 'Rows become planned entries for the forecast. They stay separate from actual transactions and do not change balances.'}
            </p>
          </div>

          <div className="kpis">
            <div><div className="k-label">{mode === 'actuals' ? 'Transactions' : 'Planned entries'}</div><div className="k-val">{summary.transactions}</div><div className="small muted">{summary.transfers} transfers paired</div></div>
            <div><div className="k-label">Budgets</div><div className="k-val">{summary.budgets}</div><div className="small muted">{summary.budgetLines} lines</div></div>
            <div><div className="k-label">Money in / out</div><div className="k-val small"><Money v={summary.inflow} /></div><div className="small muted"><Money v={summary.outflow} /></div></div>
            <div><div className="k-label">Other</div><div className="k-val small">{summary.yearlyItems} yearly · {summary.subscriptions} subs</div><div className="small muted">{summary.fx} exchange rates</div></div>
          </div>

          {plan.checks.length ? (
            <div className="panel">
              <h3>Reconciled against the workbook’s own totals</h3>
              <table className="t" style={{ marginTop: 8 }}>
                <thead><tr><th>Account</th><th className="r">Workbook says</th><th className="r">Imported rows add up to</th><th /></tr></thead>
                <tbody>
                  {plan.checks.map((c) => (
                    <tr key={c.label}><td>{c.label}</td><td className="r"><Money v={c.expected} /></td><td className="r"><Money v={c.actual} /></td><td>{c.ok ? <span className="badge good">Matches</span> : <span className="badge bad">Differs by <Money v={c.actual - c.expected} /></span>}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {already ? <div className="notice">{already} rows from this workbook were imported before. {opts.skipAlreadyImported ? 'They will be skipped.' : 'They will be imported again.'}</div> : null}

          {unmapped.length ? (
            <div className="panel">
              <h3>Categories to map</h3>
              <p className="small muted">These names are not in the workbook’s category list. Pick where they belong, or leave them uncategorised.</p>
              <div className="form-grid" style={{ marginTop: 8 }}>
                {unmapped.map((u) => (
                  <Field key={u} label={`“${u}” (${plan.transactions.filter((t) => t.rawCategory === u).length} rows)`}>
                    <select className="input" value={catMap[u] ?? ''} onChange={(e) => setCatMap({ ...catMap, [u]: e.target.value })}>
                      <option value="">Leave uncategorised</option>
                      {plan.categories.map((c) => <option key={c.code} value={c.code}>{c.code} · {c.name}</option>)}
                    </select>
                  </Field>
                ))}
              </div>
            </div>
          ) : null}

          <div className="panel">
            <h3>Accounts</h3>
            <div className="table-wrap">
              <table className="t" style={{ marginTop: 8 }}>
                <thead><tr><th>In the workbook</th><th>Kind</th><th className="r">Opening balance</th><th>Import into</th></tr></thead>
                <tbody>
                  {plan.accounts.map((a) => (
                    <tr key={a.code}>
                      <td>{a.name} <span className="muted small">{a.code}</span></td>
                      <td className="small">{a.type}</td>
                      <td className="r">{mode === 'actuals' ? <Money v={a.openingBalance} /> : <span className="muted">—</span>}</td>
                      <td>
                        <select className="input" value={accountMap[a.code]} onChange={(e) => setAccMap({ ...accMap, [a.code]: e.target.value })}>
                          <option value="new">Create new account</option>
                          {m.accounts.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {plan.budgets.length ? (
            <div className="panel">
              <h3>Budget sheets</h3>
              <div className="list" style={{ marginTop: 8 }}>
                {plan.budgets.map((b) => (
                  <label key={b.sheet} className="list-row" style={{ cursor: 'pointer' }}>
                    <input type="checkbox" checked={b.include} onChange={(e) => { const n = new Set(budgetOff); e.target.checked ? n.delete(b.sheet) : n.add(b.sheet); setBudgetOff(n); }} style={{ width: 18, height: 18, accentColor: 'var(--moss)' }} />
                    <div className="grow">
                      <div className="title">{b.sheet.trim()} → {b.month}</div>
                      <div className="meta">{b.lines.length} lines · income <Money v={b.totals.income} /> · costs <Money v={b.totals.costs} />{b.note ? ` · ${b.note}` : ''}</div>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          ) : null}

          <div className="panel">
            <h3>Options</h3>
            <div className="stack" style={{ marginTop: 8 }}>
              <label className="check"><input type="checkbox" checked={opts.includeBudgets} onChange={(e) => setOpts({ ...opts, includeBudgets: e.target.checked })} /> Import monthly budgets (replaces earlier imported lines for the same months)</label>
              {plan.yearly ? <label className="check"><input type="checkbox" checked={opts.includeYearly} onChange={(e) => setOpts({ ...opts, includeYearly: e.target.checked })} /> Import {plan.yearly.items.length} yearly expense items and the monthly contribution of <Money v={plan.yearly.monthlyContribution} /></label> : null}
              {plan.fx.length ? <label className="check"><input type="checkbox" checked={opts.includeFx} onChange={(e) => setOpts({ ...opts, includeFx: e.target.checked })} /> Import {plan.fx.length} BNR exchange rates</label> : null}
              {plan.subscriptions.length ? <label className="check"><input type="checkbox" checked={opts.includeSubscriptions} onChange={(e) => setOpts({ ...opts, includeSubscriptions: e.target.checked })} /> Create {plan.subscriptions.length} monthly subscriptions ({plan.subscriptions.map((s) => s.name).join(', ')})</label> : null}
              <label className="check"><input type="checkbox" checked={opts.skipAlreadyImported} onChange={(e) => setOpts({ ...opts, skipAlreadyImported: e.target.checked })} /> Skip rows already imported from this workbook</label>
            </div>
          </div>

          {plan.issues.filter((i) => i.level !== 'info').length || plan.skipped.length ? (
            <details className="panel">
              <summary><b>Notes from the check</b> <span className="muted small">— {plan.issues.filter((i) => i.level === 'warning').length} warnings, {plan.skipped.length} parts skipped, {plan.issues.filter((i) => i.level === 'info').length} empty rows</span></summary>
              <ul className="small" style={{ marginTop: 8 }}>
                {plan.issues.filter((i) => i.level !== 'info').map((i, k) => <li key={k}>{i.message}{i.ref ? <span className="muted"> ({i.ref})</span> : null}</li>)}
                {plan.skipped.map((s) => <li key={s.name}>Skipped <b>{s.name}</b>: {s.reason}</li>)}
              </ul>
            </details>
          ) : null}

          <details className="panel" open={showRows} onToggle={(e) => setShowRows((e.target as HTMLDetailsElement).open)}>
            <summary><b>Preview rows</b></summary>
            {showRows ? (
              <div className="table-wrap" style={{ maxHeight: 400, marginTop: 8 }}>
                <table className="t">
                  <thead><tr><th>Source</th><th>Account</th><th>Date</th><th>Category</th><th>Description</th><th className="r">Amount</th><th /></tr></thead>
                  <tbody>
                    {plan.transactions.slice(0, 400).map((t) => (
                      <tr key={t.key}>
                        <td className="small muted">{t.sourceRef}</td>
                        <td className="small">{plan.accounts.find((a) => a.code === t.accountCode)?.name}</td>
                        <td className="small">{fmtDate(t.date)}</td>
                        <td className="small">{t.categoryCode ?? <span className="badge warn">{t.rawCategory || 'none'}</span>}</td>
                        <td className="small">{t.payee}</td>
                        <td className="r"><Money v={t.amount} tone /></td>
                        <td>{plan.transferPairs.some((p) => p.out === t.key || p.in === t.key) ? <span className="badge info">transfer</span> : t.duplicateOf ? <span className="badge warn" title={t.issues[0]?.message}>check</span> : null}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </details>

          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button className="btn" onClick={() => setWb(null)}>Cancel</button>
            <button className="btn primary" onClick={doCommit} disabled={summary.errors > 0}>
              Import {summary.transactions} {mode === 'actuals' ? 'transactions' : 'planned entries'}
            </button>
          </div>
        </div>
      ) : null}

      {m.closedYears.length ? (
        <div className="notice info">
          Closed years: {m.closedYears.map((c) => c.year).join(', ')}. Rows that count for a closed year are skipped when you import.
        </div>
      ) : null}

      {step === 3 && done ? (
        <div className="stack">
          <div className="notice good">
            Import finished: {Object.entries(done.counts).map(([k, v]) => `${v} ${k.replace(/([A-Z])/g, ' $1').toLowerCase()}`).join(', ')}.
          </div>
          <div className="actions">
            <Link className="btn primary" to="/">Go to the overview</Link>
            <Link className="btn" to="/budget">Open the budget</Link>
            <button className="btn" onClick={() => { setWb(null); setDone(null); }}>Import another workbook</button>
            <button className="btn danger" onClick={() => setUndo(done.batchId)}>Undo this import</button>
          </div>
        </div>
      ) : null}

      {m.importBatches.length ? (
        <div className="section">
          <div className="section-head"><h2>Earlier imports</h2></div>
          <div className="list">
            {[...m.importBatches].sort((a, b) => b.importedAt.localeCompare(a.importedAt)).map((b) => (
              <div className="list-row" key={b.id}>
                <div className="grow">
                  <div className="title">{b.fileName} {b.undone ? <span className="badge">Undone</span> : null}</div>
                  <div className="meta">{new Date(b.importedAt).toLocaleString('en-GB')} · {b.mode === 'plan' ? 'future plan' : 'actuals'} · {Object.entries(b.counts).map(([k, v]) => `${v} ${k}`).join(', ')}</div>
                </div>
                {!b.undone && lockedBy(b.id) ? (
                  <span className="badge" title={`Part of this import is in the closed year ${lockedBy(b.id)}. Reopen that year to undo it.`}>{lockedBy(b.id)} closed</span>
                ) : !b.undone ? (
                  <button className="btn sm danger" onClick={() => setUndo(b.id)}>Undo</button>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {undo ? (
        <Confirm
          title="Undo this import?"
          body="Every transaction, planned entry, budget line, yearly item and subscription created by this import is removed. Accounts and categories it created stay, so you can delete them by hand if you want."
          confirm="Undo import"
          danger
          onClose={() => setUndo(null)}
          onYes={async () => { await commit(undoChanges(m, undo), 'Undo import'); setDone(null); toast('Import undone'); }}
        />
      ) : null}
    </div>
  );
}
