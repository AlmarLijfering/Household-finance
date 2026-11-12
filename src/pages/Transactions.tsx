import { useMemo, useState } from 'react';
import { useModel } from '../lib/useModel';
import { txOrder, txBase } from '../lib/calc/model';
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
  const [type, setType] = useState<'all' | 'in' | 'out' | 'transfer' | 'uncat'>('all');

  const txs = useMemo(
    () =>
      m.transactions
        .filter(
          (t) =>
            (account === 'all' || t.accountId === account) &&
            (!cat || t.categoryId === cat || t.splits?.some((s) => s.categoryId === cat)) &&
            (!month || t.date.startsWith(month)) &&
            (!from || t.date >= from) &&
            (!to || t.date <= to) &&
            (type === 'all' || (type === 'transfer' ? !!t.transferId : type === 'uncat' ? !t.transferId && !t.categoryId && !t.splits?.length : !t.transferId && (type === 'in' ? t.amount > 0 : t.amount < 0))) &&
            matchesSearch(m, t, q)
        )
        .sort((a, b) => txOrder(b, a)),
    [m, q, account, cat, from, to, type, month]
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
        <button className="btn primary" onClick={() => open()}>
          <Icon name="plus" size={16} /> Add transaction
        </button>
      </div>
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
          <CategorySelect m={m} value={cat} onChange={setCat} ariaLabel="Category" allowNew={false} />
          <select className="input" aria-label="Type" value={type} onChange={(e) => setType(e.target.value as any)}>
            <option value="all">All types</option>
            <option value="out">Money out</option>
            <option value="in">Money in</option>
            <option value="transfer">Transfers</option>
            <option value="uncat">Needs a category</option>
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
