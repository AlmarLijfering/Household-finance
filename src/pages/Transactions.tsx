import { useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useModel } from '../lib/useModel';
import { txOrder, txBase } from '../lib/calc/model';
import { txMonth } from '../lib/calc/period';
import { earmarkHints } from '../lib/calc/earmark';
import { commit } from '../lib/db';
import { monthLabel } from '../lib/util';
import { TxTable, matchesSearch } from '../components/TxTable';
import { Icon, Money } from '../components/ui';
import { useTxEditor } from '../App';
import { CategorySelect } from '../components/TxEditor';
import { sum } from '../lib/util';

export default function Transactions() {
  const m = useModel();
  const open = useTxEditor();
  const [q, setQ] = useState('');
  const [account, setAccount] = useState('all');
  const [cat, setCat] = useState<string | null>(null);
  const [month, setMonth] = useState('');
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
            (!cat || t.categoryId === cat || t.splits?.some((s) => s.categoryId === cat)) &&
            (!month || txMonth(m, t) === month) &&
            (!from || t.date >= from) &&
            (!to || t.date <= to) &&
            (type === 'earmark' ? hints.has(t.id) : type === 'all' || (type === 'transfer' ? !!t.transferId : type === 'uncat' ? !t.transferId && !t.categoryId && !t.splits?.length : !t.transferId && (type === 'in' ? t.amount > 0 : t.amount < 0))) &&
            matchesSearch(m, t, q)
        )
        .sort((a, b) => txOrder(b, a)),
    [m, q, account, cat, from, to, type, month, hints]
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
        <div className="form-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
          <input className="input" placeholder="Search" aria-label="Search" value={q} onChange={(e) => setQ(e.target.value)} />
          <select className="input" aria-label="Account" value={account} onChange={(e) => setAccount(e.target.value)}>
            <option value="all">All accounts</option>
            {m.accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <CategorySelect m={m} value={cat} onChange={setCat} ariaLabel="Category" allowNew={false} showEnded />
          <select className="input" aria-label="Type" value={type} onChange={(e) => setType(e.target.value as any)}>
            <option value="all">All types</option>
            <option value="out">Money out</option>
            <option value="in">Money in</option>
            <option value="transfer">Transfers</option>
            <option value="uncat">Needs a category</option>
            <option value="earmark">Check budget month ({hints.size})</option>
          </select>
          <input className="input" type="month" aria-label="Month" value={month} onChange={(e) => setMonth(e.target.value)} title="Month" />
          <input className="input" type="date" aria-label="From date" value={from} onChange={(e) => setFrom(e.target.value)} />
          <input className="input" type="date" aria-label="To date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
      </div>
      <div className="panel flush">
        <TxTable m={m} txs={txs} showAccount />
      </div>
    </div>
  );
}
