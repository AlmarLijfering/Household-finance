import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useModel } from '../lib/useModel';
import { accountBalance, runningBalances, txOrder } from '../lib/calc/model';
import { TxTable, matchesSearch } from '../components/TxTable';
import { AmountInput, Field, Icon, Modal, Money, useToast } from '../components/ui';
import { useTxEditor } from '../App';
import { put } from '../lib/db';
import { fmtDate, today } from '../lib/util';
import type { Account } from '../lib/types';
import { AccountForm } from './Accounts';

/** How far the app's balance is from the bank balance you entered (on that date). */
export function bankDifference(m: ReturnType<typeof useModel>, a: Account): number | null {
  if (a.statementBalance == null) return null;
  return accountBalance(m, a.id, a.statementDate ?? today()) - a.statementBalance;
}

export default function Register() {
  const { id } = useParams();
  const m = useModel();
  const open = useTxEditor();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [bankEdit, setBankEdit] = useState(false);
  const [edit, setEdit] = useState(false);

  const all = useMemo(() => m.transactions.filter((t) => t.accountId === id).sort((a, b) => txOrder(b, a)), [m, id]);
  const running = useMemo(() => runningBalances(m, id ?? ''), [m, id]);
  const acc = m.accountById.get(id ?? '');
  if (!acc) return <p>Account not found. <Link to="/accounts">Back to accounts</Link></p>;

  const balance = accountBalance(m, acc.id);
  const diff = bankDifference(m, acc);
  const shown = all.filter((t) => matchesSearch(m, t, q));

  return (
    <div>
      <div className="page-head">
        <div>
          <p className="small">
            <Link to="/accounts">Accounts</Link>
          </p>
          <h1>{acc.name}</h1>
          <p className="sub">
            {acc.purpose ?? (acc.type === 'cash' ? 'Cash' : acc.type === 'current' ? 'Current account' : acc.type === 'savings' ? 'Savings' : 'Reserve fund')} · {acc.currency}
          </p>
        </div>
        <div className="actions">
          <button className="btn" onClick={() => setEdit(true)}>
            <Icon name="settings" size={16} /> Edit
          </button>
          <button className="btn" onClick={() => setBankEdit(true)}>
            <Icon name="scale" size={16} /> Enter bank balance
          </button>
          <button className="btn primary" onClick={() => open({ accountId: acc.id })}>
            <Icon name="plus" size={16} /> Add
          </button>
        </div>
      </div>

      <div className="kpis">
        <div>
          <div className="k-label">Balance in the app</div>
          <div className="k-val">
            <Money v={balance} cur={acc.currency} />
          </div>
        </div>
        <div>
          <div className="k-label">Bank balance</div>
          <div className="k-val">{acc.statementBalance != null ? <Money v={acc.statementBalance} cur={acc.currency} /> : <span className="muted">—</span>}</div>
          <div className="small muted">{acc.statementDate ? `entered for ${fmtDate(acc.statementDate, true)}` : 'not entered yet'}</div>
        </div>
        <div>
          <div className="k-label">Difference</div>
          <div className="k-val" style={{ color: diff ? 'var(--plum)' : undefined }}>
            {diff == null ? <span className="muted">—</span> : diff === 0 ? 'None' : <Money v={-diff} sign cur={acc.currency} />}
          </div>
          <div className="small muted">
            {diff == null ? 'enter a bank balance to compare' : diff === 0 ? 'the app matches the bank' : diff > 0 ? 'the bank has less than the app' : 'the bank has more than the app'}
          </div>
        </div>
        <div>
          <div className="k-label">Transactions</div>
          <div className="k-val">{all.length}</div>
        </div>
      </div>

      {diff ? (
        <div className="notice section" style={{ marginTop: 'var(--s4)' }}>
          <b>Money missing in the app: </b>
          the bank shows <Money v={acc.statementBalance!} cur={acc.currency} /> on {fmtDate(acc.statementDate ?? today(), true)}, the app <Money v={acc.statementBalance! + diff} cur={acc.currency} />. Add the transactions that are missing, or record the difference yourself.{' '}
          <button
            className="btn sm"
            style={{ marginLeft: 8 }}
            onClick={() => open({ accountId: acc.id, kind: diff > 0 ? 'expense' : 'income', amount: Math.abs(diff), date: acc.statementDate ?? today(), payee: 'Difference with bank' })}
          >
            Add a transaction for <Money v={Math.abs(diff)} cur={acc.currency} />
          </button>
          <button
            className="btn sm"
            style={{ marginLeft: 6 }}
            title="Use when the app is right, e.g. the bank still has to process a payment"
            onClick={async () => {
              const now = accountBalance(m, acc.id, today());
              await put('accounts', { ...acc, statementBalance: now, statementDate: today() }, 'Bank balance set to app balance');
              toast('Bank balance set to the app’s current balance');
            }}
          >
            Set bank balance to the app’s <Money v={accountBalance(m, acc.id, today())} cur={acc.currency} />
          </button>
        </div>
      ) : null}

      <div className="row wrap section" style={{ marginTop: 'var(--s5)' }}>
        <input className="input" style={{ flex: '1 1 240px' }} placeholder="Search payee, memo, category or amount" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
      </div>
      <div className="panel flush" style={{ marginTop: 'var(--s3)' }}>
        <TxTable m={m} txs={shown} running={running} />
      </div>
      <p className="small muted" style={{ marginTop: 8 }}>
        Opening balance <Money v={acc.openingBalance} cur={acc.currency} /> on {fmtDate(acc.openingDate, true)}.
      </p>

      {bankEdit ? <BankBalanceForm account={acc} onClose={() => setBankEdit(false)} /> : null}
      {edit ? <AccountForm initial={acc} onClose={() => setEdit(false)} /> : null}
    </div>
  );
}

export function BankBalanceForm({ account, onClose }: { account: Account; onClose: () => void }) {
  const m = useModel();
  const toast = useToast();
  const [date, setDate] = useState(today());
  const [bal, setBal] = useState(account.statementBalance ?? accountBalance(m, account.id));
  const appOnDate = accountBalance(m, account.id, date);
  return (
    <Modal
      title={`Bank balance · ${account.name}`}
      onClose={onClose}
      footer={
        <>
          {account.statementBalance != null ? (
            <button className="btn ghost" onClick={async () => { await put('accounts', { ...account, statementBalance: undefined, statementDate: undefined }); onClose(); }}>
              Clear
            </button>
          ) : null}
          <span className="spacer" />
          <button className="btn" onClick={onClose}>Cancel</button>
          <button
            className="btn primary"
            onClick={async () => {
              await put('accounts', { ...account, statementBalance: bal, statementDate: date }, 'Bank balance');
              toast(bal === appOnDate ? 'Bank balance saved — matches the app' : 'Bank balance saved');
              onClose();
            }}
          >
            Save bank balance
          </button>
        </>
      }
    >
      <p className="muted small" style={{ marginBottom: 12 }}>Type what your bank app or statement shows. The app compares it with its own balance on the same date and shows any difference; nothing is changed automatically.</p>
      <div className="form-grid">
        <Field label="Balance at the bank" help={bal !== appOnDate ? undefined : 'Same as the app'}>
          <AmountInput value={bal} onChange={setBal} autoFocus />
          {bal !== appOnDate ? (
            <button type="button" className="btn sm ghost" style={{ marginTop: 6 }} onClick={() => setBal(appOnDate)}>
              Use the app’s balance (<Money v={appOnDate} cur={account.currency} />)
            </button>
          ) : null}
        </Field>
        <Field label="On date">
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
      </div>
      <p className="small" style={{ marginTop: 12 }}>
        App balance on that date: <Money v={appOnDate} cur={account.currency} />
        {bal !== appOnDate ? (
          <span style={{ color: 'var(--plum)' }}>
            {' '}
            · difference <Money v={bal - appOnDate} sign cur={account.currency} />
          </span>
        ) : (
          <span style={{ color: 'var(--moss)' }}> · matches</span>
        )}
      </p>
    </Modal>
  );
}
