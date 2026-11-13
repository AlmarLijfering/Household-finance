import { useMemo, useState } from 'react';
import { useModel } from '../lib/useModel';
import { annualGrid, computeMonth, linesForCopy, type LineResult } from '../lib/calc/budget';
import { commit, put, del } from '../lib/db';
import { AmountInput, Field, Icon, Meter, Modal, Money, Seg, useToast, Confirm } from '../components/ui';
import { CategorySelect } from '../components/TxEditor';
import { Runway } from '../components/Runway';
import { monthLabel, shiftMonth, uid, sum, MONTHS, cx, fmtDate, addDays, daysBetween } from '../lib/util';
import { currentBudgetMonth, period, periodRule, ruleStart, weekRange } from '../lib/calc/period';
import type { BudgetLine, Rollover, Category, MonthPlan } from '../lib/types';
import { DrillMoney, type DrillFilter } from '../components/DrillDown';
import { CategoryForm } from '../components/CategoryForm';
import { GroupDot, groupVar } from '../components/Group';
import type { Model } from '../lib/calc/model';

export default function Budget() {
  const m = useModel();
  const [view, setView] = useState<'month' | 'year'>('month');
  const [month, setMonth] = useState(currentBudgetMonth(m));
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

function MonthSwitch({ month, setMonth, now }: { month: string; setMonth: (m: string) => void; now: string }) {
  return (
    <div className="row">
      <button className="icon-btn" aria-label="Previous month" onClick={() => setMonth(shiftMonth(month, -1))}>
        <Icon name="chevl" />
      </button>
      <h2 style={{ minWidth: 170, textAlign: 'center' }}>{monthLabel(month)}</h2>
      <button className="icon-btn" aria-label="Next month" onClick={() => setMonth(shiftMonth(month, 1))}>
        <Icon name="chev" />
      </button>
      {month !== now ? (
        <button className="btn sm ghost" onClick={() => setMonth(now)}>
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
  const now = currentBudgetMonth(m);
  const isCurrent = month === now;
  const isFuture = month > now;
  const per = period(m, month);
  const [editPeriod, setEditPeriod] = useState(false);
  // only categories used on current accounts or cash count as "missing" from the budget
  const everydayMissing = mb.unbudgeted.filter((u) => u.everyday);
  const groupFilter = (code: string, name: string): DrillFilter => ({ title: name, from: month, groupCode: code });

  async function copyFrom(src: string) {
    const lines = linesForCopy(m, src, month, uid);
    // What last month leaves over arrives through the "Carry over" row, so "Remainder last month" stays empty.
    const remainderCat = m.categories.find((c) => c.code === 'IC015');
    for (const l of lines) if (remainderCat && l.categoryId === remainderCat.id) Object.assign(l, { baseline: 0, estimate: 0 });
    const note = '';
    await commit(lines.map((l) => ({ table: 'budgetLines' as const, put: l })), `Create budget ${month}`);
    toast(`${lines.length} lines copied from ${monthLabel(src)}${note}`);
  }
  const plan: MonthPlan = m.monthPlans.find((p) => p.id === month) ?? { id: month, updatedAt: '' };
  const savePlan = (p: Partial<MonthPlan>) => put('monthPlans', { ...plan, ...p }, 'Edit month start');
  const [editCat, setEditCat] = useState<Category | null>(null);
  const update = (l: BudgetLine, p: Partial<BudgetLine>) => put('budgetLines', { ...l, ...p }, 'Edit budget line');

  const groupOrder = ['IC', 'PC', 'RE', 'UC', 'YE', 'DIV'];
  const sections = [...mb.sections].sort((a, b) => groupOrder.indexOf(a.groupCode) - groupOrder.indexOf(b.groupCode));
  const groupCodes = [...groupOrder.filter((c) => sections.some((x) => x.groupCode === c)), ...Array.from(new Set(sections.map((x) => x.groupCode))).filter((c) => !groupOrder.includes(c))];
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
        <div className="row wrap">
          <MonthSwitch month={month} setMonth={setMonth} now={now} />
          <button className="btn sm ghost" onClick={() => setEditPeriod(true)} title="Change the first and last day of this budget month">
            {fmtDate(per.start)} – {fmtDate(per.end, true)} · {per.days % 7 === 0 ? `${per.weeks} weeks` : `${per.days} days`}
          </button>
          {month > shiftMonth(now, 1) ? (
            <span className="badge" title="Nothing can be booked for this month yet; you can already plan its budget">
              Planning only — opens for booking in {monthLabel(shiftMonth(month, -1))}
            </span>
          ) : null}
        </div>
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
          {!(month < now) ? (
            <Runway
              r={mb.runway}
              title="Free at month end"
              startLabel={mb.start.when === 'next' ? 'Carried over and booked' : mb.start.when === 'later' ? 'Starting money (month not open)' : undefined}
              note={mb.start.when === 'next' ? `Starts with what ${monthLabel(shiftMonth(month, -1))} is projected to leave over, plus anything already booked for ${monthLabel(month)}.` : mb.start.when === 'later' ? `${monthLabel(month)} is not open yet: it starts at 0 and nothing can be booked for it yet. Income and costs below are your plan.` : 'Current accounts and cash now, plus income still to come, minus what is still open below.'}
            />
          ) : null}
          <div className="panel flush section" style={{ marginTop: month < now ? 0 : 'var(--s5)' }}>
            <div className="table-wrap">
              <table className="t balance-table">
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
                  {mb.start.when === 'next' ? (
                    <>
                      <tr>
                        <td>
                          Carry over from {monthLabel(shiftMonth(month, -1))}
                          <div className="small muted">Projected free money at the end of that month</div>
                        </td>
                        <td className="desk-only" />
                        <td />
                        <td />
                        <td className="r"><Money v={mb.start.carry} tone={mb.start.carry < 0} /></td>
                      </tr>
                      <tr>
                        <td>
                          Already booked for {monthLabel(month)}
                          <div className="small muted">Received or paid early, counted for this month</div>
                        </td>
                        <td className="desk-only" />
                        <td />
                        <td />
                        <td className="r">
                          <DrillMoney v={mb.start.booked} tone f={{ title: `Booked for ${monthLabel(month)}`, from: month, accountIds: m.accounts.filter((a) => a.type === 'current' || a.type === 'cash').map((a) => a.id) }} />
                        </td>
                      </tr>
                    </>
                  ) : null}
                  <tr>
                    <td>
                      {mb.start.when === 'next' ? 'Your own starting figures' : 'In current accounts and cash'}
                      <div className="small muted">
                        {mb.start.when === 'later'
                          ? 'Month not open yet — starts at 0'
                          : mb.start.when === 'next'
                            ? 'Optional plan; the carry over above is what counts'
                            : mb.start.when === 'current'
                              ? 'Booked up to now, without money for later months'
                              : 'At month end, without money for later months'}
                      </div>
                    </td>
                    <td className="r desk-only">
                      <AmountInput inline ariaLabel="Starting money, baseline" value={plan.startBaseline ?? 0} onChange={(v) => v !== (plan.startBaseline ?? 0) && savePlan({ startBaseline: v || undefined })} />
                    </td>
                    <td className="r">
                      <AmountInput inline ariaLabel="Starting money, estimate" value={plan.startEstimate ?? 0} onChange={(v) => v !== (plan.startEstimate ?? 0) && savePlan({ startEstimate: v || undefined })} />
                    </td>
                    <td />
                    <td className="r">{mb.start.when === 'next' ? <span className="muted">—</span> : <Money v={mb.start.balance} />}</td>
                  </tr>
                  {totals.map((g) => (
                    <tr key={g.code}>
                      <td>
                        <span className="cat-chip strong"><GroupDot code={g.code} />{g.name}</span>
                      </td>
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
                  <tr className="balance-total">
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

          <div className="section-head" style={{ marginTop: 'var(--s6)' }}>
            <h2>Budget lines</h2>
            <span className="hint">Type in Baseline or Estimate to change them · click an Actual amount to see its transactions</span>
          </div>
          {groupCodes.map((code) => {
            const secs = sections.filter((x) => x.groupCode === code);
            const g = mb.groups.find((x) => x.code === code);
            return <GroupCard key={code} code={code} name={g?.name ?? secs[0].name} kind={g?.kind ?? secs[0].kind} sections={secs} m={m} update={update} isFuture={isFuture} month={month} weeks={per.weeks} onEditCategory={setEditCat} onAdd={() => setAdding({ month })} />;
          })}
          {everydayMissing.length ? (
            <section className="bgroup" style={groupVar(null)}>
              <div className="bgroup-head static">
                <span className="bgroup-title">
                  <GroupDot /> Not in the budget
                </span>
                <span className="bgroup-sub">Everyday categories with spending this month but no budget line</span>
              </div>
              <div className="table-wrap">
                <table className="t bt">
                  <tbody>
                    {everydayMissing.map((u) => {
                      const c = m.categoryById.get(u.categoryId);
                      return (
                        <tr key={u.categoryId}>
                          <td>
                            <div className="bt-line">
                              <span className="cat-chip strong"><GroupDot code={m.groupById.get(c?.groupId ?? '')?.code} />{c?.name}</span>
                              <span className="bt-code">{c?.code}</span>
                            </div>
                          </td>
                          <td className="r" style={{ width: 150 }}>
                            <DrillMoney v={u.actual} f={{ title: `${c?.name} · ${monthLabel(month)}`, from: month, categoryIds: [u.categoryId] }} />
                          </td>
                          <td className="r" style={{ width: 170 }}>
                            <button className="btn sm" onClick={() => setAdding({ month, categoryId: u.categoryId, estimate: u.actual, baseline: 0 })}>
                              Add to budget
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}
        </>
      )}
      {adding ? <LineForm m={m} initial={adding} onClose={() => setAdding(null)} /> : null}
      {editCat ? <CategoryForm initial={editCat} onClose={() => setEditCat(null)} /> : null}
      {editPeriod ? <PeriodForm m={m} month={month} onClose={() => setEditPeriod(false)} /> : null}
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

type SectionData = { name: string; kind: string; groupCode: string; lines: LineResult[] };

/** One category group (Income, Planned costs, …) as a card: totals in the header, its sections and lines below. */
function GroupCard({ code, name, kind, sections, m, update, isFuture, month, weeks, onEditCategory, onAdd }: { code: string; name: string; kind: string; sections: SectionData[]; m: Model; update: (l: BudgetLine, p: Partial<BudgetLine>) => void; isFuture: boolean; month: string; weeks: number; onEditCategory: (c: Category) => void; onAdd: () => void }) {
  const [open, setOpen] = useState(true);
  const income = kind === 'income';
  // week lines for a week this month does not have (e.g. week 5 of a 4-week month) stay hidden while empty
  const visible = (r: LineResult) => !(r.line.week && r.line.week > weeks && !r.line.estimate && !r.line.baseline && !r.actual);
  const secs = sections.map((x) => ({ ...x, lines: x.lines.filter(visible) })).filter((x) => x.lines.length);
  const all = secs.flatMap((x) => x.lines);
  const tot = (rs: LineResult[]) => ({ baseline: sum(rs.map((r) => r.line.baseline)), estimate: sum(rs.map((r) => r.available)), actual: sum(rs.map((r) => r.actual)), remaining: sum(rs.map((r) => r.remaining)) });
  const t = tot(all);
  const pct = t.estimate > 0 ? Math.min(100, Math.round((t.actual / t.estimate) * 100)) : t.actual > 0 ? 100 : 0;
  const over = !income && t.actual > t.estimate;
  const closed = all.filter((r) => r.line.closed).length;
  const showSections = secs.length > 1 || (secs[0] && secs[0].name !== name && secs[0].name.toLowerCase() !== name.toLowerCase().replace(/ costs?$/, ''));
  if (!all.length) return null;
  return (
    <section className="bgroup" style={groupVar(code)}>
      <button type="button" className="bgroup-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className={cx('bgroup-chev', open && 'open')}>
          <Icon name="chev" size={18} />
        </span>
        <span className="bgroup-title">
          <GroupDot code={code} /> {name}
        </span>
        <span className="bgroup-sub">
          {all.length} line{all.length === 1 ? '' : 's'}
          {closed ? ` · ${closed} closed` : ''}
        </span>
        <span className="bgroup-figs">
          <span>
            <small>Estimate</small>
            <b><Money v={t.estimate} /></b>
          </span>
          <span>
            <small>{income ? 'Received' : 'Spent'}</small>
            <b><Money v={t.actual} /></b>
          </span>
          <span className={cx(t.remaining > 0 && 'emph')}>
            <small>{income ? 'Still to come' : 'Remaining'}</small>
            <b><Money v={t.remaining} /></b>
          </span>
        </span>
      </button>
      <div className={cx('bgroup-bar', over && 'over')} role="img" aria-label={`${pct}% of the estimate ${income ? 'received' : 'spent'}`}>
        <div style={{ width: `${pct}%` }} />
      </div>
      {open ? (
        <div className="table-wrap">
          <table className="t bt">
            <colgroup>
              <col />
              <col className="desk-only" style={{ width: 124 }} />
              <col style={{ width: 132 }} />
              <col style={{ width: 118 }} />
              <col className="desk-only" style={{ width: 110 }} />
              <col style={{ width: 128 }} />
              <col style={{ width: 62 }} />
              <col className="desk-only" style={{ width: 40 }} />
            </colgroup>
            <thead>
              <tr>
                <th>Line</th>
                <th className="r desk-only">Baseline</th>
                <th className="r">Estimate</th>
                <th className="r">{income ? 'Received' : 'Actual'}</th>
                <th className="desk-only" />
                <th className="r">{income ? 'To come' : 'Remaining'}</th>
                <th className="c">Closed</th>
                <th className="desk-only" aria-label="Remove" />
              </tr>
            </thead>
            {secs.map((sec, i) => {
              const st = tot(sec.lines);
              return (
                <tbody key={sec.name} className={cx(showSections && 'bsec-body', showSections && i > 0 && 'bsec-next')}>
                  <SectionRows showHead={!!showSections} name={sec.name} totals={st} lines={sec.lines} m={m} update={update} isFuture={isFuture} month={month} weeks={weeks} income={income} onEditCategory={onEditCategory} />
                </tbody>
              );
            })}
          </table>
          <div className="bgroup-foot">
            <button className="btn sm ghost" onClick={onAdd}>
              <Icon name="plus" size={14} /> Add line
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function SectionRows({ showHead, name, totals, lines, m, update, isFuture, month, weeks, income, onEditCategory }: { showHead: boolean; name: string; totals: { baseline: number; estimate: number; actual: number; remaining: number }; lines: LineResult[]; m: Model; update: (l: BudgetLine, p: Partial<BudgetLine>) => void; isFuture: boolean; month: string; weeks: number; income: boolean; onEditCategory: (c: Category) => void }) {
  return (
    <>
      {showHead ? (
        <tr className="bsec">
          <td colSpan={8}>
            <span className="bsec-name">{name}</span>
            <span className="bsec-count">{lines.length} {lines.length === 1 ? 'line' : 'lines'}</span>
          </td>
        </tr>
      ) : null}
      {lines.map((r) => {
        const c = m.categoryById.get(r.line.categoryId);
        const label = r.line.label ?? c?.name;
        const wr = r.line.week ? weekRange(m, month, r.line.week) : null;
        const labelHasName = !!c && !!r.line.label && r.line.label.toLowerCase().includes(c.name.toLowerCase());
        const meta = [r.line.label && r.line.label !== c?.name && !labelHasName ? c?.name : '', wr ? (r.line.week! > weeks ? `no week ${r.line.week} this month` : `${fmtDate(wr.start)} – ${fmtDate(wr.end)}`) : ''].filter(Boolean).join(' · ');
        const isOver = r.over > 0 && !income;
        return (
          <tr key={r.line.id} className={cx(r.line.closed && 'closed', isOver && 'is-over')}>
            <td className="c-name">
              <div className="bt-line">
                <button type="button" className="bt-name" onClick={() => c && onEditCategory(c)} title="Edit category">
                  {label}
                </button>
                <span className="bt-code">{c?.code}</span>
              </div>
              {meta ? <div className="bt-meta">{meta}</div> : null}
            </td>
            <td className="r desk-only">
              <AmountInput inline className="quiet" ariaLabel={`Baseline for ${label}`} value={r.line.baseline} onChange={(v) => v !== r.line.baseline && update(r.line, { baseline: v })} />
            </td>
            <td className="r c-est" data-label="Estimate">
              <AmountInput inline ariaLabel={`Estimate for ${label}`} value={r.line.estimate} onChange={(v) => v !== r.line.estimate && update(r.line, { estimate: v })} />
              {r.carryIn ? (
                <div className="bt-meta" style={{ color: r.carryIn > 0 ? 'var(--moss)' : 'var(--plum)' }} title="Rolled over from last month">
                  {r.carryIn > 0 ? '+' : ''}
                  <Money v={r.carryIn} /> rollover
                </div>
              ) : null}
            </td>
            <td className="r c-act" data-label={income ? 'Received' : 'Actual'}>
              {r.actual ? (
                <DrillMoney
                  v={r.actual}
                  f={{
                    title: `${label} · ${monthLabel(month)}`,
                    from: month,
                    categoryIds: [r.line.categoryId],
                    week: r.line.week,
                    excludeWeeks: r.line.week ? undefined : lines.filter((x) => x.line.categoryId === r.line.categoryId && x.line.week).map((x) => x.line.week!)
                  }}
                />
              ) : (
                <span className="zero">–</span>
              )}
            </td>
            <td className="desk-only">{!isFuture && (r.available > 0 || r.actual > 0) ? <Meter value={r.actual} max={r.available} over={isOver} /> : null}</td>
            <td className="r c-rem" data-label={income ? 'To come' : 'Remaining'}>
              {isOver ? (
                <span className="badge bad" title="Spent more than estimated">
                  over <Money v={r.over} />
                </span>
              ) : r.remaining > 0 ? (
                <b className="bt-remaining"><Money v={r.remaining} /></b>
              ) : (
                <span className="zero">{r.line.closed ? 'closed' : r.actual > 0 ? 'done' : '–'}</span>
              )}
            </td>
            <td className="c c-closed" data-label="Closed">
              <input type="checkbox" aria-label={`${label} closed`} title="Closed: nothing more expected on this line" checked={r.line.closed} onChange={(e) => update(r.line, { closed: e.target.checked })} className="sel-box" />
            </td>
            <td className="desk-only">
              <button className="icon-btn bt-x" aria-label={`Remove ${label}`} title="Remove line" onClick={() => del('budgetLines', r.line.id, 'Remove budget line')}>
                <Icon name="x" size={15} />
              </button>
            </td>
          </tr>
        );
      })}
      {showHead ? (
        <tr className="bsub">
          <td className="c-name">Total {name}</td>
          <td className="r desk-only"><Money v={totals.baseline} /></td>
          <td className="r c-est" data-label="Estimate"><Money v={totals.estimate} /></td>
          <td className="r c-act" data-label={income ? 'Received' : 'Actual'}><Money v={totals.actual} /></td>
          <td className="desk-only" />
          <td className="r c-rem" data-label={income ? 'To come' : 'Remaining'}><Money v={totals.remaining} /></td>
          <td className="c-closed" />
          <td className="desk-only" />
        </tr>
      ) : null}
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
          <CategorySelect m={m} value={categoryId} onChange={(v) => { setCategoryId(v); setRollover(m.categoryById.get(v ?? '')?.rollover ?? 'none'); }} allowEmpty={false} date={period(m, initial.month!).start} />
        </Field>
        <Field label="Label (optional)" help="e.g. “Food week 2” when one category has several lines">
          <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} />
        </Field>
        <Field label="Covers" help="A week line only counts transactions in that week">
          <select className="input" value={week ?? ''} onChange={(e) => setWeek(e.target.value ? Number(e.target.value) : undefined)}>
            <option value="">The whole month</option>
            {Array.from({ length: period(m, initial.month!).weeks }, (_, i) => i + 1).map((w) => {
              const r = weekRange(m, initial.month!, w);
              return (
                <option key={w} value={w}>
                  Week {w} ({fmtDate(r.start)} – {fmtDate(r.end)})
                </option>
              );
            })}
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
            <table className="t grid">
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
                    <FragmentRow key={c.id} head={head ? <span className="cat-chip strong"><GroupDot code={g?.code} />{g?.name}</span> : undefined}>
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

function FragmentRow({ head, children }: { head?: React.ReactNode; children: React.ReactNode }) {
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
  const cbm = currentBudgetMonth(m);
  const [fromMonth, setFromMonth] = useState(Math.max(1, year === Number(cbm.slice(0, 4)) ? Number(cbm.slice(5, 7)) : 1));
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

/** Set the first and last day of a budget month. The next month starts the day after this one ends. */
function PeriodForm({ m, month, onClose }: { m: Model; month: string; onClose: () => void }) {
  const toast = useToast();
  const cur = period(m, month);
  const [start, setStart] = useState(cur.start);
  const [end, setEnd] = useState(cur.end);
  const days = daysBetween(start, end) + 1;
  const valid = start && end && days >= 7 && days <= 49;
  const next = shiftMonth(month, 1);
  const prev = shiftMonth(month, -1);
  const plan = (id: string) => m.monthPlans.find((p) => p.id === id) ?? { id, updatedAt: '' };
  return (
    <Modal
      title={`Dates of ${monthLabel(month)}`}
      onClose={onClose}
      footer={
        <>
          <button
            className="btn ghost"
            onClick={async () => {
              await commit([{ table: 'monthPlans', put: { ...plan(month), startDate: undefined } }, { table: 'monthPlans', put: { ...plan(next), startDate: undefined } }], 'Reset month dates');
              toast('Dates follow the default rule again');
              onClose();
            }}
          >
            Use default dates
          </button>
          <span className="spacer" />
          <button className="btn" onClick={onClose}>Cancel</button>
          <button
            className="btn primary"
            disabled={!valid}
            onClick={async () => {
              await commit(
                [
                  { table: 'monthPlans', put: { ...plan(month), startDate: start } },
                  { table: 'monthPlans', put: { ...plan(next), startDate: addDays(end, 1) } }
                ],
                'Set month dates'
              );
              toast(`${monthLabel(month)}: ${fmtDate(start)} – ${fmtDate(end, true)}`);
              onClose();
            }}
          >
            Save dates
          </button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="First day">
          <input className="input" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
        </Field>
        <Field label="Last day">
          <input className="input" type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
        </Field>
      </div>
      <p className="small muted" style={{ marginTop: 12 }}>
        {valid ? `${days} days${days % 7 === 0 ? ` — ${days / 7} whole weeks` : ' — not whole weeks'}. ` : 'A budget month needs at least 7 days. '}
        {monthLabel(prev)} now ends on {fmtDate(addDays(start, -1), true)} and {monthLabel(next)} starts on {fmtDate(addDays(end, 1), true)}. Transactions move to the budget month their date falls in.
      </p>
      <p className="small muted" style={{ marginTop: 8 }}>
        Default for months you have not set: {periodRule(m) === 'weeks' ? `whole weeks, starting on the Monday nearest the 1st (${fmtDate(ruleStart(month, 'weeks'), true)} for this month)` : 'calendar months'}. Change it under Settings → Household.
      </p>
    </Modal>
  );
}
