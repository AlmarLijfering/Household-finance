import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useModel } from '../lib/useModel';
import { accountBalance, runningBalances, txOrder } from '../lib/calc/model';
import { TxTable, matchesSearch } from '../components/TxTable';
import { AmountInput, Field, Icon, Modal, Money, useToast } from '../components/ui';
import { useTxEditor } from '../App';
import { commit } from '../lib/db';
import { fmtDate, fmtMoney, nowIso, today, uid, sum } from '../lib/util';
import type { Reconciliation, Transaction } from '../lib/types';
import { AccountForm } from './Accounts';

export default function Register() {
  const { id } = useParams();
  const m = useModel();
  const open = useTxEditor();
  const toast = useToast();
  const acc = m.accountById.get(id ?? '');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'all' | 'uncleared' | 'cleared'>('all');
  const [recon, setRecon] = useState<{ date: string; balance: number } | null>(null);
  const [setup, setSetup] = useState(false);
  const [edit, setEdit] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());

  const all = useMemo(() => m.transactions.filter((t) => t.accountId === id).sort((a, b) => txOrder(b, a)), [m, id]);
  const running = useMemo(() => runningBalances(m, id ?? ''), [m, id]);
  if (!acc) return <p>Account not found. <Link to="/accounts">Back to accounts</Link></p>;

  const balance = accountBalance(m, acc.id);
  const clearedBal = acc.openingBalance + sum(all.filter((t) => t.status !== 'uncleared').map((t) => t.amount));
  const shown = all.filter((t) => matchesSearch(m, t, q) && (status === 'all' || (status === 'uncleared' ? t.status === 'uncleared' : t.status !== 'uncleared')));
  const lastRecon = m.reconciliations.filter((r) => r.accountId === acc.id).sort((a, b) => b.statementDate.localeCompare(a.statementDate))[0];

  // ----- reconciliation -----
  const reconTx = recon ? all.filter((t) => t.status !== 'reconciled' && t.date <= recon.date) : [];
  const reconciledBase = acc.openingBalance + sum(all.filter((t) => t.status === 'reconciled').map((t) => t.amount));
  const reconCleared = reconciledBase + sum(reconTx.filter((t) => sel.has(t.id)).map((t) => t.amount));
  const diff = recon ? recon.balance - reconCleared : 0;

  function startRecon(date: string, bal: number) {
    setRecon({ date, balance: bal });
    setSel(new Set(all.filter((t) => t.status === 'cleared' && t.date <= date).map((t) => t.id)));
    setSetup(false);
  }

  async function finish(adjust: boolean) {
    if (!recon) return;
    const at = nowIso();
    const rid = uid();
    const changes: any[] = [];
    for (const t of reconTx) if (sel.has(t.id)) changes.push({ table: 'transactions', put: { ...t, status: 'reconciled', reconciliationId: rid } });
    let adjId: string | undefined;
    if (adjust && diff !== 0) {
      const round = m.categories.find((c) => c.code === 'UC011');
      const t: Transaction = { id: uid(), accountId: acc!.id, date: recon.date, amount: diff, payee: 'Reconciliation adjustment', categoryId: round?.id ?? null, status: 'reconciled', reconciliationId: rid, createdAt: at, updatedAt: at };
      adjId = t.id;
      changes.push({ table: 'transactions', put: t });
    }
    const r: Reconciliation = { id: rid, accountId: acc!.id, statementDate: recon.date, statementBalance: recon.balance, clearedBalance: reconCleared, difference: adjust ? 0 : diff, adjustmentTxId: adjId, completedAt: at, updatedAt: at };
    changes.push({ table: 'reconciliations', put: r }, { table: 'accounts', put: { ...acc!, statementBalance: recon.balance, statementDate: recon.date } });
    await commit(changes, `Reconcile ${acc!.name}`);
    toast(`${acc!.name} reconciled to ${fmtDate(recon.date, true)}`);
    setRecon(null);
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <p className="small">
            <Link to="/accounts">Accounts</Link>
          </p>
          <h1>{acc.name}</h1>
          <p className="sub">
            {acc.purpose ?? (acc.type === 'cash' ? 'Cash' : acc.type === 'current' ? 'Current account' : acc.type)} · {acc.currency}
          </p>
        </div>
        <div className="actions">
          <button className="btn" onClick={() => setEdit(true)}>
            <Icon name="settings" size={16} /> Edit
          </button>
          {!recon ? (
            <button className="btn" onClick={() => setSetup(true)}>
              <Icon name="scale" size={16} /> Reconcile
            </button>
          ) : null}
          <button className="btn primary" onClick={() => open({ accountId: acc.id })}>
            <Icon name="plus" size={16} /> Add
          </button>
        </div>
      </div>

      <div className="kpis">
        <div>
          <div className="k-label">Balance</div>
          <div className="k-val">
            <Money v={balance} cur={acc.currency} />
          </div>
        </div>
        <div>
          <div className="k-label">Cleared balance</div>
          <div className="k-val">
            <Money v={clearedBal} cur={acc.currency} />
          </div>
        </div>
        <div>
          <div className="k-label">Last bank balance entered</div>
          <div className="k-val">{acc.statementBalance != null ? <Money v={acc.statementBalance} cur={acc.currency} /> : <span className="muted">—</span>}</div>
          <div className="small muted">{acc.statementDate ? fmtDate(acc.statementDate, true) : 'not entered yet'}</div>
        </div>
        <div>
          <div className="k-label">Last reconciled</div>
          <div className="k-val">{lastRecon ? fmtDate(lastRecon.statementDate, true) : <span className="muted">Never</span>}</div>
        </div>
      </div>

      {recon ? (
        <div className="panel section" style={{ marginTop: 'var(--s5)', borderColor: 'var(--ink)' }}>
          <div className="row wrap">
            <div className="grow">
              <h3>Reconciling to the statement of {fmtDate(recon.date, true)}</h3>
              <p className="small muted">Tick every transaction that appears on the statement. When the difference is zero, finish.</p>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div className="small muted">Statement · Cleared · Difference</div>
              <div>
                <Money v={recon.balance} /> · <Money v={reconCleared} /> ·{' '}
                <b style={{ color: diff === 0 ? 'var(--moss)' : 'var(--plum)' }}>
                  <Money v={diff} sign />
                </b>
              </div>
            </div>
          </div>
          <div className="row" style={{ marginTop: 12, justifyContent: 'flex-end' }}>
            <button className="btn ghost" onClick={() => setRecon(null)}>Cancel</button>
            {diff !== 0 ? (
              <button className="btn" onClick={() => finish(true)} title="Adds a transaction for the difference">
                Finish with adjustment of {fmtMoney(diff)}
              </button>
            ) : null}
            <button className="btn good" disabled={diff !== 0} onClick={() => finish(false)}>
              <Icon name="check" size={16} /> Finish reconciliation
            </button>
          </div>
        </div>
      ) : null}

      <div className="row wrap section" style={{ marginTop: 'var(--s5)' }}>
        <div style={{ position: 'relative', flex: '1 1 240px' }}>
          <input className="input" placeholder="Search payee, memo, category or amount" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
        </div>
        {!recon ? (
          <select className="input" style={{ width: 'auto' }} value={status} onChange={(e) => setStatus(e.target.value as any)} aria-label="Status filter">
            <option value="all">All</option>
            <option value="uncleared">Not cleared</option>
            <option value="cleared">Cleared & reconciled</option>
          </select>
        ) : null}
      </div>
      <div className="panel flush" style={{ marginTop: 'var(--s3)' }}>
        {recon ? (
          <TxTable m={m} txs={reconTx} selectable selected={sel} onToggle={(t) => setSel((s) => { const n = new Set(s); n.has(t.id) ? n.delete(t.id) : n.add(t.id); return n; })} pageSize={1000} />
        ) : (
          <TxTable m={m} txs={shown} running={running} />
        )}
      </div>
      <p className="small muted" style={{ marginTop: 8 }}>
        Opening balance <Money v={acc.openingBalance} cur={acc.currency} /> on {fmtDate(acc.openingDate, true)}. C = cleared, R = reconciled.
      </p>

      {setup ? <ReconcileSetup defaultBalance={acc.statementBalance ?? clearedBal} onStart={startRecon} onClose={() => setSetup(false)} /> : null}
      {edit ? <AccountForm initial={acc} onClose={() => setEdit(false)} /> : null}
    </div>
  );
}

function ReconcileSetup({ defaultBalance, onStart, onClose }: { defaultBalance: number; onStart: (d: string, b: number) => void; onClose: () => void }) {
  const [date, setDate] = useState(today());
  const [bal, setBal] = useState(defaultBalance);
  return (
    <Modal
      title="Reconcile with your bank statement"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={() => onStart(date, bal)}>Start reconciling</button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Statement date">
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Ending balance on the statement">
          <AmountInput value={bal} onChange={setBal} autoFocus />
        </Field>
      </div>
    </Modal>
  );
}
