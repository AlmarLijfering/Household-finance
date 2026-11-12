import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useModel } from '../lib/useModel';
import { computeMonth } from '../lib/calc/budget';
import { balancesByAccount, isReserve, isSpendable, toBase } from '../lib/calc/model';
import { balanceHistory, cashFlow, spendingByCategory } from '../lib/calc/reports';
import { upcoming, draftFor } from '../lib/calc/recurring';
import { useTxEditor } from '../App';
import { useDrill, DrillMoney } from '../components/DrillDown';
import { earmarkHints } from '../lib/calc/earmark';
import { Link as RLink } from 'react-router-dom';
import { addDays, fmtDate, monthLabel, shiftMonth, today, sum, MONTHS, daysBetween } from '../lib/util';
import { currentBudgetMonth, period as budgetPeriod } from '../lib/calc/period';
import { Runway } from '../components/Runway';
import { CashFlowChart, HBars, TrendChart, SERIES } from '../components/charts';
import { Icon, Money, Seg, useToast } from '../components/ui';
import { commit } from '../lib/db';

type Period = '3' | '6' | '12' | 'ytd';

export default function Dashboard() {
  const m = useModel();
  const toast = useToast();
  const [period, setPeriod] = useState<Period>('6');
  const [accountFilter, setAccountFilter] = useState<string>('all');
  const month = currentBudgetMonth(m);
  const per = budgetPeriod(m, month);
  const flagged = useMemo(() => earmarkHints(m).size, [m]);
  const mb = useMemo(() => computeMonth(m, month), [m, month]);
  const from = period === 'ytd' ? `${month.slice(0, 4)}-01` : shiftMonth(month, -(Number(period) - 1));
  const accountIds = accountFilter === 'all' ? undefined : accountFilter === 'everyday' ? m.accounts.filter(isSpendable).map((a) => a.id) : [accountFilter];
  const flow = useMemo(() => cashFlow(m, { from, to: month, accountIds }), [m, from, month, accountFilter]);
  const hist = useMemo(() => balanceHistory(m, { from, to: month }), [m, from, month]);
  const spend = useMemo(() => spendingByCategory(m, { from: month, to: month, accountIds }), [m, month, accountFilter]);
  const next = useMemo(() => upcoming(m, today(), addDays(today(), 21)).slice(0, 8), [m]);
  const bal = balancesByAccount(m);
  const reserves = m.accounts.filter((a) => isReserve(a) && !a.archived);
  const thisMonth = flow[flow.length - 1];
  const budgetLeft = sum(mb.lines.filter((l) => l.kind === 'expense').map((l) => l.remaining));
  const budgetTotal = sum(mb.lines.filter((l) => l.kind === 'expense').map((l) => l.available));
  const reservesTotal = sum(reserves.map((a) => toBase(m, bal.get(a.id) ?? 0, a.currency, today())));
  const dueSoon = sum(next.filter((u) => u.date <= addDays(today(), 7) && u.amount < 0).map((u) => -u.amount));

  const openTx = useTxEditor();
  const drill = useDrill();
  const markPaid = (u: (typeof next)[number]) => openTx(draftFor(u.rec, today()));

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>{monthLabel(month)}</h1>
          <p className="sub">
            Day {daysBetween(per.start, today()) + 1} of {per.days} ({fmtDate(per.start)} – {fmtDate(per.end)}) · {mb.lines.length ? `${mb.lines.filter((l) => l.line.closed).length} of ${mb.lines.length} budget lines closed` : 'no budget for this month yet'}
          </p>
        </div>
        <div className="actions">
          <select className="input" style={{ width: 'auto' }} value={accountFilter} onChange={(e) => setAccountFilter(e.target.value)} aria-label="Filter by account">
            <option value="all">All accounts</option>
            <option value="everyday">Everyday accounts</option>
            {m.accounts.filter((a) => !a.archived).map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <Seg ariaLabel="Period" value={period} onChange={setPeriod} options={[['3', '3 mo'], ['6', '6 mo'], ['12', '12 mo'], ['ytd', 'This year']]} />
        </div>
      </div>

      {flagged ? (
        <div className="notice" style={{ marginBottom: 'var(--s4)' }}>
          {flagged} transaction{flagged === 1 ? '' : 's'} may belong to next month’s budget (e.g. the salary advance). <RLink to="/transactions" state={{ type: 'earmark' }}>Check them</RLink>
        </div>
      ) : null}
      <Runway
        r={mb.runway}
        title="Free money at the end of the month"
        note={mb.lines.length ? 'What your current accounts and cash will hold after the income still expected and everything still open in this month’s budget.' : 'Set up this month’s budget to see what will be left after planned costs.'}
      />

      <div className="kpis section" style={{ marginTop: 'var(--s5)' }}>
        <div>
          <div className="k-label">Net cash flow this month</div>
          <div className="k-val">
            <Money v={thisMonth?.net ?? 0} sign />
          </div>
          <div className="small muted">
            in <DrillMoney v={thisMonth?.income ?? 0} f={{ title: `Income · ${monthLabel(month)}`, from: month, type: 'income', accountIds }} /> · out{' '}
            <DrillMoney v={thisMonth?.spending ?? 0} f={{ title: `Spending · ${monthLabel(month)}`, from: month, type: 'spending', accountIds }} />
          </div>
        </div>
        <div>
          <div className="k-label">Budget left to spend</div>
          <div className="k-val">
            <Money v={budgetLeft} />
          </div>
          <div className="small muted">of <Money v={budgetTotal} /> planned costs</div>
        </div>
        <div>
          <div className="k-label">Reserve funds</div>
          <div className="k-val">
            <Money v={reservesTotal} />
          </div>
          <div className="small muted">{reserves.length} envelopes</div>
        </div>
        <div>
          <div className="k-label">Due in the next 7 days</div>
          <div className="k-val">
            <Money v={dueSoon} />
          </div>
          <div className="small muted">{next.filter((u) => u.date <= addDays(today(), 7)).length} payments</div>
        </div>
      </div>

      <div className="grid-2 section">
        <div className="stack">
          <div className="section-head">
            <h2>Cash flow</h2>
            <span className="hint">Transfers between your own accounts are left out</span>
          </div>
          <div className="panel">
            <CashFlowChart data={flow} onPick={(month, type) => drill({ title: `${type === 'income' ? 'Income' : 'Spending'} · ${monthLabel(month)}`, from: month, type, accountIds })} />
            <p className="small muted" style={{ marginTop: 6 }}>Click a bar to see its transactions.</p>
          </div>
          <div className="section-head" style={{ marginTop: 'var(--s5)' }}>
            <h2>Savings trend</h2>
            <span className="hint">Month-end balances</span>
          </div>
          <div className="panel">
            <TrendChart
              data={hist}
              series={[
                { key: 'reserves', name: 'Reserves & savings', color: SERIES[0] },
                { key: 'spendable', name: 'Current & cash', color: SERIES[3] }
              ]}
            />
          </div>
        </div>
        <div className="stack">
          <div className="section-head">
            <h2>Coming up</h2>
            <Link to="/recurring" className="small">
              All bills & income
            </Link>
          </div>
          {next.length ? (
            <div className="list">
              {next.map((u) => (
                <div className="list-row" key={u.rec.id + u.date}>
                  <div className="date-chip">
                    <b>{Number(u.date.slice(8, 10))}</b>
                    <span>{MONTHS[Number(u.date.slice(5, 7)) - 1]}</span>
                  </div>
                  <div className="grow">
                    <div className="title">{u.rec.name}</div>
                    <div className="meta">
                      {u.overdue ? <span className="badge bad">Overdue</span> : null} {m.accountById.get(u.rec.accountId)?.name}
                      {u.rec.kind === 'transfer' ? ` → ${m.accountById.get(u.rec.toAccountId!)?.name}` : ''}
                    </div>
                  </div>
                  <Money v={u.amount} tone={u.amount > 0} cur={m.accountById.get(u.rec.accountId)?.currency} />
                  <button className="btn sm" onClick={() => markPaid(u)} title={`Record ${u.rec.name} as ${u.rec.kind === 'income' ? 'received' : 'paid'}`}>
                    <Icon name="check" size={14} /> {u.rec.kind === 'income' ? 'Received' : 'Paid'}
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty">
              <h3>Nothing due in the next three weeks</h3>
              <p>Add rent, subscriptions and salary under Bills & income to see them here before they happen.</p>
            </div>
          )}

          <div className="section-head" style={{ marginTop: 'var(--s5)' }}>
            <h2>Reserve funds</h2>
            <Link to="/accounts" className="small">
              Accounts
            </Link>
          </div>
          <div className="envelopes">
            {reserves.map((a) => {
              const v = bal.get(a.id) ?? 0;
              const target = a.targetAmount ?? Math.max(v, 1);
              return (
                <Link key={a.id} to={`/accounts/${a.id}`} className="envelope">
                  <div className="name">{a.name}</div>
                  <div className="amt">
                    <Money v={v} cur={a.currency} />
                  </div>
                  {a.targetAmount ? (
                    <>
                      <div className="fill">
                        <div style={{ width: `${Math.min(100, (v / target) * 100)}%` }} />
                      </div>
                      <div className="small muted" style={{ marginTop: 4 }}>
                        of <Money v={a.targetAmount} /> goal
                      </div>
                    </>
                  ) : (
                    <div className="small muted" style={{ marginTop: 4 }}>{a.purpose ?? (a.type === 'savings' ? 'Savings' : 'Reserve fund')}</div>
                  )}
                </Link>
              );
            })}
          </div>

          <div className="section-head" style={{ marginTop: 'var(--s5)' }}>
            <h2>Top spending this month</h2>
          </div>
          <div className="panel">
            {spend.rows.length ? (
              <HBars
                rows={spend.rows.slice(0, 6).map((r) => ({ label: r.categoryId === 'none' ? 'Uncategorised' : m.categoryById.get(r.categoryId as string)?.name ?? '?', sub: r.categoryId === 'none' ? undefined : m.categoryById.get(r.categoryId as string)?.section, value: r.total, id: r.categoryId as string }))}
                onPick={(row) => drill({ title: `${row.label} · ${monthLabel(month)}`, from: month, categoryIds: row.id === 'none' ? undefined : [row.id!], type: row.id === 'none' ? 'spending' : 'all', accountIds })}
              />
            ) : (
              <p className="muted">No spending recorded yet this month.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
