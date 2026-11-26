import { useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useModel } from '../lib/useModel';
import { txOrder, txBase } from '../lib/calc/model';
import { txMonth } from '../lib/calc/period';
import { earmarkHints } from '../lib/calc/earmark';
import { openArchiveView } from '../lib/archive';
import { ARCHIVE_YEAR } from '../lib/db';
import { commit } from '../lib/db';
import { monthLabel, parseAmount } from '../lib/util';
import type { Model } from '../lib/calc/model';
import { categoryBlocks } from '../components/TxEditor';
import { TxTable, matchesSearch } from '../components/TxTable';
import { Icon, Money } from '../components/ui';
import { useTxEditor } from '../App';
import { sum } from '../lib/util';

/** Category ids for a filter value: 'cat:<id>', 'sec:<groupId>:<section>' or 'grp:<groupId>'. */
function categoriesFor(m: Model, v: string): Set<string> | null {
  if (!v) return null;
  const [kind, a, ...rest] = v.split(':');
  if (kind === 'cat') return new Set([a]);
  if (kind === 'grp') return new Set(m.categories.filter((c) => c.groupId === a).map((c) => c.id));
  if (kind === 'sec') {
    const sec = rest.join(':');
    return new Set(m.categories.filter((c) => c.groupId === a && (c.section ?? '') === sec).map((c) => c.id));
  }
  return null;
}

/** Category filter that can also take a whole budget group or budget section. */
function BudgetCategoryFilter({ m, value, onChange }: { m: Model; value: string; onChange: (v: string | null) => void }) {
  const blocks = categoryBlocks(m, (c) => !c.archived);
  return (
    <select className="input" aria-label="Category" value={value} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">All categories</option>
      {blocks.map((b, i) => {
        const g = m.groupById.get(b.groupId)!;
        const firstOfGroup = i === 0 || blocks[i - 1].groupId !== b.groupId;
        const split = b.section !== null;
        return [
          // a group that is split into sections gets its own heading with "All of …"
          firstOfGroup && split ? (
            <optgroup key={`${g.id}-all`} label={g.name}>
              <option value={`grp:${g.id}`}>All of {g.name}</option>
            </optgroup>
          ) : null,
          <optgroup key={b.key} label={b.label}>
            {split ? (b.section ? <option value={`sec:${g.id}:${b.section}`}>All of {b.section}</option> : null) : <option value={`grp:${g.id}`}>All of {g.name}</option>}
            {b.cats.map((c) => (
              <option key={c.id} value={`cat:${c.id}`}>
                {c.name}
                {c.activeUntil ? ` (ended ${c.activeUntil})` : ''}
              </option>
            ))}
          </optgroup>
        ];
      })}
    </select>
  );
}

export default function Transactions() {
  const m = useModel();
  const open = useTxEditor();
  const [q, setQ] = useState('');
  const [account, setAccount] = useState('all');
  // category filter: one category, a whole budget section, or a whole budget group
  const [cat, setCatRaw] = useState<string>('');
  const setCat = (v: string | null) => setCatRaw(v ?? '');
  const [minAmt, setMinAmt] = useState('');
  const [maxAmt, setMaxAmt] = useState('');
  const minV = minAmt.trim() ? parseAmount(minAmt) : null;
  const maxV = maxAmt.trim() ? parseAmount(maxAmt) : null;
  const catSet = useMemo(() => categoriesFor(m, cat), [m, cat]);
  const [month, setMonth] = useState('');
  const [moreFilters, setMoreFilters] = useState(false);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const loc = useLocation();
  const [type, setType] = useState<'all' | 'in' | 'out' | 'transfer' | 'uncat' | 'earmark'>((loc.state as any)?.type === 'earmark' ? 'earmark' : 'all');
  const hints = useMemo(() => earmarkHints(m), [m]);

  const txs = useMemo(
    () =>
      m.transactions
        .filter(
          (t) =>
            (account === 'all' || t.accountId === account) &&
            (!catSet || (t.categoryId != null && catSet.has(t.categoryId)) || !!t.splits?.some((s) => s.categoryId != null && catSet.has(s.categoryId))) &&
            (minV == null || Math.abs(t.amount) >= Math.abs(minV)) &&
            (maxV == null || Math.abs(t.amount) <= Math.abs(maxV)) &&
            (!month || txMonth(m, t) === month) &&
            (!from || t.date >= from) &&
            (!to || t.date <= to) &&
            (type === 'earmark' ? hints.has(t.id) : type === 'all' || (type === 'transfer' ? !!t.transferId : type === 'uncat' ? !t.transferId && !t.categoryId && !t.splits?.length : !t.transferId && (type === 'in' ? t.amount > 0 : t.amount < 0))) &&
            matchesSearch(m, t, q)
        )
        .sort((a, b) => txOrder(b, a)),
    [m, q, account, catSet, from, to, type, month, hints, minV, maxV]
  );
  const net = sum(txs.filter((t) => !t.transferId).map((t) => txBase(m, t)));

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Transactions</h1>
          <p className="sub">
            {txs.length} shown · net <Money v={net} sign /> {m.settings.baseCurrency} excluding transfers
          </p>
        </div>
        <div className="actions">
          <button
            className="btn"
            disabled={!txs.length}
            onClick={async () => {
              const { exportTransactions, downloadXlsx } = await import('../lib/excel/export');
              downloadXlsx(await exportTransactions(m, txs), `Transactions ${new Date().toISOString().slice(0, 10)}.xlsx`);
            }}
          >
            <Icon name="download" size={16} /> Export to Excel
          </button>
          <button className="btn primary" onClick={() => open()}>
            <Icon name="plus" size={16} /> Add transaction
          </button>
        </div>
      </div>
      {m.closedYears.length && !ARCHIVE_YEAR ? (
        <div className="notice info" style={{ marginBottom: 'var(--s3)' }}>
          Transactions of closed years are in their archives:{' '}
          {m.closedYears.map((c) => (
            <button key={c.id} className="btn sm ghost" onClick={() => openArchiveView(c)}>
              Open {c.year}
            </button>
          ))}
        </div>
      ) : null}
      {hints.size ? (
        <div className="notice" style={{ marginBottom: 'var(--s3)' }}>
          <b>{hints.size} transaction{hints.size === 1 ? '' : 's'} may belong to the next budget month</b> — e.g. a salary advance received late in the month.{' '}
          {type !== 'earmark' ? (
            <button className="btn sm" onClick={() => setType('earmark')}>Show them</button>
          ) : (
            <button
              className="btn sm"
              onClick={() =>
                commit(
                  m.transactions.filter((t) => hints.has(t.id)).map((t) => ({ table: 'transactions' as const, put: { ...t, budgetMonth: hints.get(t.id)!.suggested } })),
                  'Earmark for next month'
                )
              }
            >
              Count all for their next month
            </button>
          )}
        </div>
      ) : null}
      <div className="panel" style={{ marginBottom: 'var(--s3)' }}>
        <div className={moreFilters ? 'filters open' : 'filters'}>
          <label className="field">
            <span>Search</span>
            <input className="input" placeholder="Payee, memo, category or amount" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
          <label className="field more">
            <span>Account</span>
            <select className="input" value={account} onChange={(e) => setAccount(e.target.value)}>
              <option value="all">All accounts</option>
              {m.accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field more">
            <span>Category</span>
            <BudgetCategoryFilter m={m} value={cat} onChange={setCat} />
          </label>
          <label className="field more">
            <span>Type</span>
            <select className="input" value={type} onChange={(e) => setType(e.target.value as any)}>
              <option value="all">All types</option>
              <option value="out">Money out</option>
              <option value="in">Money in</option>
              <option value="transfer">Transfers</option>
              <option value="uncat">Needs a category</option>
              <option value="earmark">Check budget month ({hints.size})</option>
            </select>
          </label>
          <label className="field more">
            <span>Budget month</span>
            <input className="input" type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
          </label>
          <label className="field more">
            <span>Amount from</span>
            <input className="input" inputMode="decimal" placeholder="e.g. 100" value={minAmt} onChange={(e) => setMinAmt(e.target.value)} aria-invalid={minAmt.trim() !== '' && minV == null} />
          </label>
          <label className="field more">
            <span>Amount to</span>
            <input className="input" inputMode="decimal" placeholder="e.g. 500" value={maxAmt} onChange={(e) => setMaxAmt(e.target.value)} aria-invalid={maxAmt.trim() !== '' && maxV == null} />
          </label>
          <label className="field more">
            <span>From date</span>
            <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="field more">
            <span>To date</span>
            <input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          <button className="btn mobile-only-flex" type="button" onClick={() => setMoreFilters(!moreFilters)} aria-expanded={moreFilters}>
            {moreFilters ? 'Fewer filters' : `More filters${[account !== 'all', cat, type !== 'all', month, from, to, minAmt, maxAmt].filter(Boolean).length ? ` (${[account !== 'all', cat, type !== 'all', month, from, to, minAmt, maxAmt].filter(Boolean).length} on)` : ''}`}
          </button>
          {q || account !== 'all' || cat || type !== 'all' || month || from || to || minAmt || maxAmt ? (
            <button className="btn ghost" style={{ alignSelf: 'end' }} onClick={() => { setQ(''); setAccount('all'); setCat(null); setType('all'); setMonth(''); setFrom(''); setTo(''); setMinAmt(''); setMaxAmt(''); }}>
              Clear filters
            </button>
          ) : null}
        </div>
      </div>
      <div className="panel flush">
        <TxTable m={m} txs={txs} showAccount />
      </div>
    </div>
  );
}
