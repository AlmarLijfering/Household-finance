import { useMemo, useState } from 'react';
import { useModel } from '../lib/useModel';
import { annualGrid, computeMonth, linesForCopy, type LineResult } from '../lib/calc/budget';
import { commit, put, del } from '../lib/db';
import { AmountInput, Field, Icon, Meter, Modal, Money, Seg, useToast, Confirm } from '../components/ui';
import { CategorySelect } from '../components/TxEditor';
import { Runway } from '../components/Runway';
import { currentMonth, monthLabel, shiftMonth, uid, sum, MONTHS, cx } from '../lib/util';
import type { BudgetLine, Rollover, Category, MonthPlan } from '../lib/types';
import { DrillMoney, type DrillFilter } from '../components/DrillDown';
import { CategoryForm } from '../components/CategoryForm';
import type { Model } from '../lib/calc/model';

export default function Budget() {
  const m = useModel();
  const [view, setView] = useState<'month' | 'year'>('month');
  const [month, setMonth] = useState(currentMonth());
  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Budget</h1>
          <p className="sub">Baseline is the plan you started with, estimate is what you expect now. Closed lines have nothing left to pay.</p>
        </div>
        <Seg value={view} onChange={setView} options={[['month', 'Month'], ['year', 'Year']]} ariaLabel="View" />
      </div>
      {view === 'month' ? <MonthView m={m} month={month} setMonth={setMonth} /> : <YearView m={m} year={Number(month.slice(0, 4))} setYear={(y) => setMonth(`${y}${month.slice(4)}`)} />}
    </div>
  );
}

function MonthSwitch({ month, setMonth }: { month: string; setMonth: (m: string) => void }) {
  return (
    <div className="row">
      <button className="icon-btn" aria-label="Previous month" onClick={() => setMonth(shiftMonth(month, -1))}>
        <Icon name="chevl" />
      </button>
      <h2 style={{ minWidth: 170, textAlign: 'center' }}>{monthLabel(month)}</h2>
      <button className="icon-btn" aria-label="Next month" onClick={() => setMonth(shiftMonth(month, 1))}>
        <Icon name="chev" />
      </button>
      {month !== currentMonth() ? (
        <button className="btn sm ghost" onClick={() => setMonth(currentMonth())}>
          Today
        </button>
      ) : null}
    </div>
  );
}

function MonthView({ m, month, setMonth }: { m: Model; month: string; setMonth: (s: string) => void }) {
  const toast = useToast();
  const mb = useMemo(() => computeMonth(m, month), [m, month]);
  const [adding, setAdding] = useState<Partial<BudgetLine> | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const prevWithLines = useMemo(() => {
    for (let i = 1; i <= 24; i++) {
      const p = shiftMonth(month, -i);
      if (m.budgetLines.some((b) => b.month === p)) return p;
    }
    return null;
  }, [m, month]);
  const isCurrent = month === currentMonth();
  const isFuture = month > currentMonth();
  const groupFilter = (code: string, name: string): DrillFilter => ({ title: name, from: month, groupCode: code });

  async function copyFrom(src: string) {
    const lines = linesForCopy(m, src, month, uid);
    // Like the workbook: what is projected to be left last month comes in as "Remainder last month".
    const remainderCat = m.categories.find((c) => c.code === 'IC015');
    const left = computeMonth(m, src).runway.free;
    let note = '';
    if (remainderCat && src === shiftMonth(month, -1)) {
      const line = lines.find((l) => l.categoryId === remainderCat.id);
      const amount = Math.max(0, left);
      if (line) Object.assign(line, { baseline: amount, estimate: amount });
      else if (amount) lines.unshift({ id: uid(), month, categoryId: remainderCat.id, baseline: amount, estimate: amount, closed: false, sort: -1, updatedAt: '' });
      if (amount) note = ` · remainder of ${monthLabel(src)} added as income`;
    }
    await commit(lines.map((l) => ({ table: 'budgetLines' as const, put: l })), `Create budget ${month}`);
    toast(`${lines.length} lines copied from ${monthLabel(src)}${note}`);
  }
  const plan: MonthPlan = m.monthPlans.find((p) => p.id === month) ?? { id: month, updatedAt: '' };
  const savePlan = (p: Partial<MonthPlan>) => put('monthPlans', { ...plan, ...p }, 'Edit month start');
  const [editCat, setEditCat] = useState<Category | null>(null);
  const update = (l: BudgetLine, p: Partial<BudgetLine>) => put('budgetLines', { ...l, ...p }, 'Edit budget line');

  const groupOrder = ['IC', 'PC', 'RE', 'UC', 'YE', 'DIV'];
  const sections = [...mb.sections].sort((a, b) => groupOrder.indexOf(a.groupCode) - groupOrder.indexOf(b.groupCode));
  const shownGroups = mb.groups.filter((g) => g.estimate || g.actual);
  // Like the workbook: spending paid out of reserve funds is shown but left out of the balance.
  const totals = shownGroups.filter((g) => g.code !== 'DIV');
  const fromReserves = shownGroups.filter((g) => g.code === 'DIV');
  const balance = {
    baseline: mb.start.baseline + sum(totals.map((g) => (g.kind === 'income' ? g.baseline : -g.baseline))),
    estimate: mb.start.estimate + sum(totals.map((g) => (g.kind === 'income' ? g.estimate : -g.estimate))),
    actual: sum(totals.map((g) => (g.kind === 'income' ? g.actual : -g.actual))),
    remaining: mb.start.balance + sum(totals.map((g) => (g.kind === 'income' ? g.remaining : -g.remaining)))
  };

  return (
    <>
      <div className="row wrap" style={{ justifyContent: 'space-between', marginBottom: 'var(--s4)' }}>
        <MonthSwitch month={month} setMonth={setMonth} />
        <div className="actions">
          {mb.lines.length ? (
            <>
              <button className="btn" onClick={() => setAdding({ month })}>
                <Icon name="plus" size={16} /> Add line
              </button>
              <button className="btn ghost" onClick={() => setConfirmClear(true)}>
                Remove this month’s budget
              </button>
            </>
          ) : null}
        </div>
      </div>

      {!mb.lines.length ? (
        <div className="empty">
          <h3>No budget for {monthLabel(month)} yet</h3>
          <p>
            {prevWithLines
              ? `Start from ${monthLabel(prevWithLines)}: every line is copied with its baseline as the new estimate, nothing closed.`
              : 'Add lines one by one, or import the budget sheets from your Excel workbook.'}
          </p>
          <div className="actions">
            {prevWithLines ? (
              <button className="btn primary" onClick={() => copyFrom(prevWithLines)}>
                Copy from {monthLabel(prevWithLines)}
              </button>
            ) : null}
            <button className="btn" onClick={() => setAdding({ month })}>
              Add a line
            </button>
          </div>
          {mb.unbudgeted.length ? <p className="small" style={{ marginTop: 12 }}>{mb.unbudgeted.length} categories already have transactions this month.</p> : null}
        </div>
      ) : (
        <>
          {!(month < currentMonth()) ? (
            <Runway
              r={mb.runway}
              title="Free at month end"
              note={isFuture ? `${monthLabel(month)} has not started, so the accounts hold nothing for it yet${mb.start.estimate ? ' — your starting estimate is used instead' : ''}. Income and costs below are what you plan.` : 'Current accounts and cash now, plus income still to come, minus what is still open below.'}
            />
          ) : null}
          <div className="panel flush section" style={{ marginTop: month < currentMonth() ? 0 : 'var(--s5)' }}>
            <div className="table-wrap">
              <table className="t">
                <thead>
                  <tr>
                    <th>Balance</th>
                    <th className="r desk-only">Baseline</th>
                    <th className="r">Estimate</th>
                    <th className="r">Actual</th>
                    <th className="r">Remaining</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>
                      In current accounts and cash
                      <div className="small muted">{isFuture ? 'Not started — uses your estimate' : isCurrent ? 'Balance today' : 'Balance at month end'}</div>
                    </td>
                    <td className="r desk-only">
                      <AmountInput inline ariaLabel="Starting money, baseline" value={plan.startBaseline ?? 0} onChange={(v) => v !== (plan.startBaseline ?? 0) && savePlan({ startBaseline: v || undefined })} />
                    </td>
                    <td className="r">
                      <AmountInput inline ariaLabel="Starting money, estimate" value={plan.startEstimate ?? 0} onChange={(v) => v !== (plan.startEstimate ?? 0) && savePlan({ startEstimate: v || undefined })} />
                    </td>
                    <td />
                    <td className="r"><Money v={mb.start.balance} /></td>
                  </tr>
                  {totals.map((g) => (
                    <tr key={g.code}>
                      <td>{g.name}</td>
                      <td className="r desk-only"><Money v={g.baseline} /></td>
                      <td className="r"><Money v={g.estimate} /></td>
                      <td className="r"><DrillMoney v={g.actual} f={groupFilter(g.code, `${g.name} · ${monthLabel(month)}`)} /></td>
                      <td className="r"><Money v={g.remaining} /></td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  {fromReserves.map((g) => (
                    <tr key={g.code} className="muted" style={{ fontWeight: 400 }}>
                      <td style={{ fontWeight: 400 }}>{g.name} <span className="small">(not in the balance)</span></td>
                      <td className="r desk-only" style={{ fontWeight: 400 }}><Money v={g.baseline} /></td>
                      <td className="r" style={{ fontWeight: 400 }}><Money v={g.estimate} /></td>
                      <td className="r" style={{ fontWeight: 400 }}><DrillMoney v={g.actual} f={groupFilter(g.code, `${g.name} · ${monthLabel(month)}`)} /></td>
                      <td className="r" style={{ fontWeight: 400 }}><Money v={g.remaining} /></td>
                    </tr>
                  ))}
                  <tr>
                    <td>Balance</td>
                    <td className="r desk-only"><Money v={balance.baseline} tone /></td>
                    <td className="r"><Money v={balance.estimate} tone /></td>
                    <td className="r"><Money v={balance.actual} tone /></td>
                    <td className="r"><Money v={balance.remaining} tone /></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          <div className="panel flush section" style={{ marginTop: 'var(--s5)' }}>
            <div className="table-wrap">
              <table className="t budget-table">
                <thead>
                  <tr>
                    <th className="desk-only">Code</th>
                    <th>Line</th>
                    <th className="r desk-only">Baseline</th>
                    <th className="r">Estimate</th>
                    <th className="r">Actual</th>
                    <th className="desk-only" style={{ width: 90 }} />
                    <th className="r">Remaining</th>
                    <th>Closed</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {sections.map((s) => (
                    <Section key={s.groupCode + s.name} name={s.name} lines={s.lines} m={m} update={update} isFuture={isFuture} month={month} onEditCategory={setEditCat} />
                  ))}
                  {mb.unbudgeted.length ? (
                    <>
                      <tr className="group">
                        <td colSpan={9}>Not in the budget</td>
                      </tr>
                      {mb.unbudgeted.map((u) => {
                        const c = m.categoryById.get(u.categoryId);
                        return (
                          <tr key={u.categoryId}>
                            <td className="code desk-only">{c?.code}</td>
                            <td>{c?.name}</td>
                            <td className="desk-only" />
                            <td />
                            <td className="r"><DrillMoney v={u.actual} f={{ title: `${c?.name} · ${monthLabel(month)}`, from: month, categoryIds: [u.categoryId] }} /></td>
                            <td className="desk-only" />
                            <td />
                            <td />
                            <td>
                              <button className="btn sm" onClick={() => setAdding({ month, categoryId: u.categoryId, estimate: u.actual, baseline: 0 })}>
                                Add to budget
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
      {adding ? <LineForm m={m} initial={adding} onClose={() => setAdding(null)} /> : null}
      {editCat ? <CategoryForm initial={editCat} onClose={() => setEditCat(null)} /> : null}
      {confirmClear ? (
        <Confirm
          title={`Remove the ${monthLabel(month)} budget?`}
          body="All budget lines for this month are deleted. Transactions are not affected."
          confirm="Remove budget"
          danger
          onClose={() => setConfirmClear(false)}
          onYes={() => commit(mb.lines.map((l) => ({ table: 'budgetLines' as const, del: l.line.id })), 'Remove month budget')}
        />
      ) : null}
    </>
  );
}

function Section({ name, lines, m, update, isFuture, month, onEditCategory }: { name: string; lines: LineResult[]; m: Model; update: (l: BudgetLine, p: Partial<BudgetLine>) => void; isFuture: boolean; month: string; onEditCategory: (c: Category) => void }) {
  const remaining = sum(lines.map((l) => l.remaining));
  return (
    <>
      <tr className="group">
        <td colSpan={6}>{name}</td>
        <td className="r">
          <Money v={remaining} />
        </td>
        <td colSpan={2} />
      </tr>
      {lines.map((r) => {
        const c = m.categoryById.get(r.line.categoryId);
        const income = r.kind === 'income';
        return (
          <tr key={r.line.id} className={cx(r.line.closed && 'closed')}>
            <td className="code desk-only">{c?.code}</td>
            <td className="name">
              <button type="button" className="drill" style={{ textDecoration: 'none', fontWeight: 500 }} onClick={() => c && onEditCategory(c)} title="Edit category">
                {r.line.label ?? c?.name}
              </button>
              {r.line.label && r.line.label !== c?.name ? <div className="small muted">{c?.name}</div> : null}
            </td>
            <td className="r desk-only">
              <AmountInput inline ariaLabel={`Baseline for ${r.line.label ?? c?.name}`} value={r.line.baseline} onChange={(v) => v !== r.line.baseline && update(r.line, { baseline: v })} />
            </td>
            <td className="r">
              <AmountInput inline ariaLabel={`Estimate for ${r.line.label ?? c?.name}`} value={r.line.estimate} onChange={(v) => v !== r.line.estimate && update(r.line, { estimate: v })} />
              {r.carryIn ? (
                <div className="small" style={{ color: r.carryIn > 0 ? 'var(--moss)' : 'var(--plum)' }} title="Rolled over from last month">
                  {r.carryIn > 0 ? '+' : ''}
                  <Money v={r.carryIn} /> rollover
                </div>
              ) : null}
            </td>
            <td className="r">
              <DrillMoney
                v={r.actual}
                f={{
                  title: `${r.line.label ?? c?.name} · ${monthLabel(month)}`,
                  from: month,
                  categoryIds: [r.line.categoryId],
                  week: r.line.week,
                  excludeWeeks: r.line.week ? undefined : lines.filter((x) => x.line.categoryId === r.line.categoryId && x.line.week).map((x) => x.line.week!)
                }}
              />
            </td>
            <td className="desk-only">
              {!isFuture ? <Meter value={r.actual} max={r.available} over={!income && r.actual > r.available} /> : null}
            </td>
            <td className="r">
              {r.over > 0 && !income ? (
                <span className="badge bad" title="Spent more than estimated">
                  over <Money v={r.over} />
                </span>
              ) : (
                <Money v={r.remaining} />
              )}
            </td>
            <td>
              <input type="checkbox" aria-label="Closed" checked={r.line.closed} onChange={(e) => update(r.line, { closed: e.target.checked })} style={{ width: 18, height: 18, accentColor: 'var(--moss)' }} />
            </td>
            <td>
              <button className="icon-btn" aria-label="Remove line" onClick={() => del('budgetLines', r.line.id, 'Remove budget line')}>
                <Icon name="x" size={16} />
              </button>
            </td>
          </tr>
        );
      })}
    </>
  );
}

function LineForm({ m, initial, onClose }: { m: Model; initial: Partial<BudgetLine>; onClose: () => void }) {
  const [categoryId, setCategoryId] = useState<string | null>(initial.categoryId ?? null);
  const [label, setLabel] = useState(initial.label ?? '');
  const [week, setWeek] = useState<number | undefined>(initial.week);
  const [baseline, setBaseline] = useState(initial.baseline ?? 0);
  const [estimate, setEstimate] = useState(initial.estimate ?? 0);
  const cat = categoryId ? m.categoryById.get(categoryId) : undefined;
  const [rollover, setRollover] = useState<Rollover>(cat?.rollover ?? 'none');
  return (
    <Modal
      title="Add budget line"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button
            className="btn primary"
            disabled={!categoryId}
            onClick={async () => {
              const line: BudgetLine = { id: uid(), month: initial.month!, categoryId: categoryId!, label: label || undefined, week, baseline: baseline || estimate, estimate: estimate || baseline, closed: false, sort: m.budgetLines.filter((b) => b.month === initial.month).length, updatedAt: '' };
              const changes: any[] = [{ table: 'budgetLines', put: line }];
              if (cat && rollover !== (cat.rollover ?? 'none')) changes.push({ table: 'categories', put: { ...cat, rollover } });
              await commit(changes, 'Add budget line');
              onClose();
            }}
          >
            Add line
          </button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Category" className="full">
          <CategorySelect m={m} value={categoryId} onChange={(v) => { setCategoryId(v); setRollover(m.categoryById.get(v ?? '')?.rollover ?? 'none'); }} allowEmpty={false} />
        </Field>
        <Field label="Label (optional)" help="e.g. “Food week 2” when one category has several lines">
          <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} />
        </Field>
        <Field label="Covers" help="A week line only counts transactions in that week">
          <select className="input" value={week ?? ''} onChange={(e) => setWeek(e.target.value ? Number(e.target.value) : undefined)}>
            <option value="">The whole month</option>
            {[1, 2, 3, 4, 5].map((w) => (
              <option key={w} value={w}>
                Week {w} (days {1 + 7 * (w - 1)}–{w === 5 ? 31 : 7 * w})
              </option>
            ))}
          </select>
        </Field>
        <Field label="Baseline">
          <AmountInput value={baseline} onChange={setBaseline} />
        </Field>
        <Field label="Estimate">
          <AmountInput value={estimate} onChange={setEstimate} />
        </Field>
        <Field label="Rollover for this category" className="full" help="What happens to the difference at the end of the month">
          <select className="input" value={rollover} onChange={(e) => setRollover(e.target.value as Rollover)}>
            <option value="none">No rollover — every month starts fresh</option>
            <option value="carry-remaining">Carry unspent money into next month</option>
            <option value="carry-overspend">Carry overspending into next month</option>
            <option value="carry-both">Carry both</option>
          </select>
        </Field>
      </div>
    </Modal>
  );
}

function YearView({ m, year, setYear }: { m: Model; year: number; setYear: (y: number) => void }) {
  const [show, setShow] = useState<'estimate' | 'actual' | 'diff'>('actual');
  const [spread, setSpread] = useState<string | null>(null);
  const grid = useMemo(() => annualGrid(m, year), [m, year]);
  const order = ['IC', 'PC', 'RE', 'UC', 'YE', 'DIV'];
  const cats = [...grid.cats.keys()]
    .map((id) => m.categoryById.get(id)!)
    .filter(Boolean)
    .sort((a, b) => order.indexOf(m.groupById.get(a.groupId)?.code ?? '') - order.indexOf(m.groupById.get(b.groupId)?.code ?? '') || a.code.localeCompare(b.code));
  const val = (id: string, i: number) => {
    const e = grid.cats.get(id)!;
    return show === 'estimate' ? e.estimate[i] : show === 'actual' ? e.actual[i] : e.estimate[i] - e.actual[i];
  };
  let lastGroup = '';
  return (
    <>
      <div className="row wrap" style={{ justifyContent: 'space-between', marginBottom: 'var(--s4)' }}>
        <div className="row">
          <button className="icon-btn" aria-label="Previous year" onClick={() => setYear(year - 1)}>
            <Icon name="chevl" />
          </button>
          <h2>{year}</h2>
          <button className="icon-btn" aria-label="Next year" onClick={() => setYear(year + 1)}>
            <Icon name="chev" />
          </button>
        </div>
        <Seg value={show} onChange={setShow} options={[['actual', 'Actual'], ['estimate', 'Estimate'], ['diff', 'Estimate − actual']]} />
      </div>
      {!cats.length ? (
        <div className="empty">
          <h3>Nothing budgeted or spent in {year}</h3>
          <p>Create monthly budgets or import your workbook to fill the year view.</p>
        </div>
      ) : (
        <div className="panel flush">
          <div className="table-wrap" style={{ maxHeight: '70vh' }}>
            <table className="t">
              <thead>
                <tr>
                  <th>Category</th>
                  {MONTHS.map((x) => (
                    <th key={x} className="r">{x}</th>
                  ))}
                  <th className="r">Year</th>
                  <th className="r">Estimate</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {cats.map((c) => {
                  const g = m.groupById.get(c.groupId);
                  const head = g?.code !== lastGroup;
                  lastGroup = g?.code ?? '';
                  const e = grid.cats.get(c.id)!;
                  return (
                    <FragmentRow key={c.id} head={head ? g?.name : undefined}>
                      <td style={{ whiteSpace: 'nowrap' }}>{c.name}</td>
                      {MONTHS.map((_, i) => (
                        <td key={i} className="r small">
                          {val(c.id, i) ? (
                            show === 'actual' ? (
                              <DrillMoney v={val(c.id, i)} compact f={{ title: `${c.name} · ${MONTHS[i]} ${year}`, from: grid.months[i], categoryIds: [c.id] }} />
                            ) : (
                              <Money v={val(c.id, i)} compact />
                            )
                          ) : (
                            <span className="muted">·</span>
                          )}
                        </td>
                      ))}
                      <td className="r"><b><Money v={sum(MONTHS.map((_, i) => val(c.id, i)))} compact /></b></td>
                      <td className="r muted"><Money v={sum(e.estimate)} compact /></td>
                      <td>
                        <button className="btn sm ghost" onClick={() => setSpread(c.id)} title="Set an annual budget and spread it over the months">
                          Annual…
                        </button>
                      </td>
                    </FragmentRow>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <p className="small muted" style={{ marginTop: 8 }}>“Annual…” sets a yearly amount for a category and spreads it evenly over the months that follow.</p>
      {spread ? <SpreadForm m={m} year={year} categoryId={spread} onClose={() => setSpread(null)} /> : null}
    </>
  );
}

function FragmentRow({ head, children }: { head?: string; children: React.ReactNode }) {
  return (
    <>
      {head ? (
        <tr className="group">
          <td colSpan={16}>{head}</td>
        </tr>
      ) : null}
      <tr>{children}</tr>
    </>
  );
}

function SpreadForm({ m, year, categoryId, onClose }: { m: Model; year: number; categoryId: string; onClose: () => void }) {
  const c = m.categoryById.get(categoryId)!;
  const [amount, setAmount] = useState(0);
  const [fromMonth, setFromMonth] = useState(Math.max(1, year === Number(currentMonth().slice(0, 4)) ? Number(currentMonth().slice(5, 7)) : 1));
  const months = Array.from({ length: 12 - fromMonth + 1 }, (_, i) => `${year}-${String(fromMonth + i).padStart(2, '0')}`);
  const per = months.length ? Math.round(amount / months.length) : 0;
  return (
    <Modal
      title={`Annual budget: ${c.name}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button
            className="btn primary"
            disabled={!amount}
            onClick={async () => {
              const changes: any[] = [];
              for (const mm of months) {
                const ex = m.budgetLines.find((b) => b.month === mm && b.categoryId === categoryId && !b.week);
                if (ex) changes.push({ table: 'budgetLines', put: { ...ex, estimate: per } });
                else changes.push({ table: 'budgetLines', put: { id: uid(), month: mm, categoryId, baseline: per, estimate: per, closed: false, sort: 999, updatedAt: '' } as BudgetLine });
              }
              await commit(changes, 'Annual budget');
              onClose();
            }}
          >
            Spread over {months.length} months
          </button>
        </>
      }
    >
      <div className="form-grid">
        <Field label={`Amount for ${year}`}>
          <AmountInput value={amount} onChange={setAmount} autoFocus />
        </Field>
        <Field label="Starting month">
          <select className="input" value={fromMonth} onChange={(e) => setFromMonth(Number(e.target.value))}>
            {MONTHS.map((x, i) => (
              <option key={x} value={i + 1}>{x}</option>
            ))}
          </select>
        </Field>
      </div>
      <p className="muted small" style={{ marginTop: 12 }}>
        Each month from {MONTHS[fromMonth - 1]} gets <Money v={per} />. Months that already have a line for this category have their estimate replaced.
      </p>
    </Modal>
  );
}
