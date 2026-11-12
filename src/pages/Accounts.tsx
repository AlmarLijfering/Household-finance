import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useModel } from '../lib/useModel';
import { balancesByAccount, isReserve, isSpendable, toBase } from '../lib/calc/model';
import { Field, Icon, Modal, Money, AmountInput, useToast } from '../components/ui';
import { put } from '../lib/db';
import type { Account, AccountType } from '../lib/types';
import { BankBalanceForm, bankDifference } from './Register';
import { today, uid, sum } from '../lib/util';

export function AccountForm({ initial, onClose }: { initial?: Account; onClose: () => void }) {
  const m = useModel();
  const toast = useToast();
  const [a, setA] = useState<Account>(
    initial ?? {
      id: uid(),
      code: `ACC${String(m.accounts.length + 1).padStart(3, '0')}`,
      name: '',
      type: 'current',
      currency: m.settings.baseCurrency,
      openingBalance: 0,
      openingDate: today(),
      sort: m.accounts.length,
      updatedAt: ''
    }
  );
  const set = (p: Partial<Account>) => setA({ ...a, ...p });
  return (
    <Modal
      title={initial ? `Edit ${initial.name}` : 'New account'}
      onClose={onClose}
      footer={
        <>
          {initial ? (
            <button className="btn danger" onClick={async () => { await put('accounts', { ...a, archived: !a.archived }); toast(a.archived ? 'Account restored' : 'Account archived'); onClose(); }}>
              {a.archived ? 'Restore account' : 'Archive account'}
            </button>
          ) : null}
          <span className="spacer" />
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!a.name.trim()} onClick={async () => { await put('accounts', a, initial ? 'Edit account' : 'Add account'); toast('Account saved'); onClose(); }}>
            Save account
          </button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Name" className="full">
          <input className="input" value={a.name} onChange={(e) => set({ name: e.target.value })} autoFocus placeholder="e.g. BRD Almar, Holiday fund" />
        </Field>
        <Field label="Kind">
          <select className="input" value={a.type} onChange={(e) => set({ type: e.target.value as AccountType })}>
            <option value="current">Current account</option>
            <option value="cash">Cash / wallet</option>
            <option value="reserve">Reserve fund (money set aside)</option>
            <option value="savings">Savings</option>
          </select>
        </Field>
        <Field label="Currency">
          <select className="input" value={a.currency} onChange={(e) => set({ currency: e.target.value })}>
            {m.settings.currencies.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </Field>
        <Field label="Opening balance">
          <AmountInput value={a.openingBalance} onChange={(v) => set({ openingBalance: v })} />
        </Field>
        <Field label="Opening date">
          <input className="input" type="date" value={a.openingDate} onChange={(e) => set({ openingDate: e.target.value })} />
        </Field>
        <Field label="Code" help="Kept from your workbook (CUR001, RES003…)">
          <input className="input" value={a.code} onChange={(e) => set({ code: e.target.value })} />
        </Field>
        <Field label="Owner">
          <input className="input" value={a.owner ?? ''} onChange={(e) => set({ owner: e.target.value || undefined })} placeholder="Shared" />
        </Field>
        {a.type === 'reserve' || a.type === 'savings' ? (
          <>
            <Field label="What it is for" className="full">
              <input className="input" value={a.purpose ?? ''} onChange={(e) => set({ purpose: e.target.value || undefined })} />
            </Field>
            <Field label="Goal (optional)">
              <AmountInput value={a.targetAmount ?? 0} onChange={(v) => set({ targetAmount: v || undefined })} />
            </Field>
          </>
        ) : null}
      </div>
    </Modal>
  );
}

export default function Accounts() {
  const m = useModel();
  const nav = useNavigate();
  const [edit, setEdit] = useState<Account | 'new' | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [bankFor, setBankFor] = useState<Account | null>(null);
  const bal = balancesByAccount(m);
  const base = (a: Account) => toBase(m, bal.get(a.id) ?? 0, a.currency, today());
  const groups: Array<[string, (a: Account) => boolean]> = [
    ['Everyday', isSpendable],
    ['Reserves & savings', isReserve]
  ];
  const visible = m.accounts.filter((a) => showArchived || !a.archived);

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Accounts</h1>
          <p className="sub">
            Net worth in scope: <Money v={sum(m.accounts.filter((a) => !a.archived).map(base))} /> {m.settings.baseCurrency}
          </p>
        </div>
        <div className="actions">
          <label className="check small">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Show archived
          </label>
          <button className="btn primary" onClick={() => setEdit('new')}>
            <Icon name="plus" size={16} /> New account
          </button>
        </div>
      </div>
      {groups.map(([label, f]) => {
        const list = visible.filter(f);
        if (!list.length) return null;
        return (
          <div className="section" key={label} style={{ marginTop: 'var(--s5)' }}>
            <div className="section-head">
              <h2>{label}</h2>
              <span className="money">{<Money v={sum(list.filter((a) => !a.archived).map(base))} />}</span>
            </div>
            <div className="list">
              {list.map((a) => {
                const stmtDiff = bankDifference(m, a);
                return (
                  <div key={a.id} className="list-row click" onClick={() => nav(`/accounts/${a.id}`)}>
                    <div className="grow">
                      <div className="title">
                        {a.name} {a.archived ? <span className="badge">Archived</span> : null}
                      </div>
                      <div className="meta">
                        {a.code} · {a.type === 'current' ? 'Current account' : a.type === 'cash' ? 'Cash' : a.type === 'reserve' ? a.purpose || 'Reserve fund' : 'Savings'}
                        {a.statementDate ? ` · bank balance of ${a.statementDate.slice(8, 10)}.${a.statementDate.slice(5, 7)}` : ''}
                      </div>
                    </div>
                    {stmtDiff != null && stmtDiff !== 0 ? <span className="badge warn" title="The bank balance you entered differs from the app">Bank differs by <Money v={-stmtDiff} sign /></span> : stmtDiff === 0 ? <span className="badge good desk-only">Matches bank</span> : null}
                    <div style={{ textAlign: 'right' }}>
                      <Money v={bal.get(a.id) ?? 0} cur={a.currency} className="title" />
                      {a.currency !== m.settings.baseCurrency ? (
                        <div className="meta">
                          ≈ <Money v={base(a)} /> {m.settings.baseCurrency}
                        </div>
                      ) : null}
                    </div>
                    <button
                      className="icon-btn"
                      aria-label={`Enter bank balance for ${a.name}`}
                      title="Enter bank balance"
                      onClick={(e) => {
                        e.stopPropagation();
                        setBankFor(a);
                      }}
                    >
                      <Icon name="scale" size={18} />
                    </button>
                    <button
                      className="icon-btn"
                      aria-label={`Edit ${a.name}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setEdit(a);
                      }}
                    >
                      <Icon name="settings" size={18} />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
      <p className="small muted section">
        Stocks, investment accounts and portfolios are not tracked here. <Link to="/import">Import your workbook</Link> to bring in history.
      </p>
      {bankFor ? <BankBalanceForm account={bankFor} onClose={() => setBankFor(null)} /> : null}
      {edit ? <AccountForm initial={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} /> : null}
    </div>
  );
}
