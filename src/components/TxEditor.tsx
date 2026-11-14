import { useMemo, useState } from 'react';
import { commit } from '../lib/db';
import type { Split, Transaction, ID } from '../lib/types';
import { useModel } from '../lib/useModel';
import { nowIso, today, uid, fmtMoney, sum } from '../lib/util';
import { AmountInput, Field, Icon, Modal, Seg, useToast, Money } from './ui';
import { categoryAllowed, categoryActiveOn, moveTarget, type Model } from '../lib/calc/model';
import { CategoryForm } from './CategoryForm';
import { nextOccurrence } from '../lib/calc/recurring';
import { BudgetDatePicker } from './BudgetDatePicker';
import { lastBookableMonth, monthOfDate } from '../lib/calc/period';
import { isClosedMonth } from '../lib/calc/yearclose';
import { monthLabel, shiftMonth } from '../lib/util';

export interface TxDraft {
  id?: ID; // edit existing
  accountId?: ID;
  kind?: 'expense' | 'income' | 'transfer';
  date?: string;
  amount?: number;
  categoryId?: ID | null;
  payee?: string;
  memo?: string;
  toAccountId?: ID;
  recurringId?: ID; // posting a bill/income: the schedule advances when saved
}

export function CategorySelect({ value, onChange, m, filter, allowEmpty = true, id, ariaLabel, accountId, allowNew = true, date, showEnded, emptyLabel }: { emptyLabel?: string; value: ID | null; onChange: (v: ID | null) => void; m: Model; filter?: (kind: string) => boolean; allowEmpty?: boolean; id?: string; ariaLabel?: string; accountId?: ID; allowNew?: boolean; date?: string; showEnded?: boolean }) {
  const [creating, setCreating] = useState(false);
  const account = accountId ? m.accountById.get(accountId) : undefined;
  const on = date ?? today();
  // ended categories are only offered for dates up to their end (filters can show them all)
  const visible = (c: Model['categories'][number]) => !c.archived && (c.id === value || (categoryAllowed(c, account) && (showEnded || categoryActiveOn(c, on))));
  const firstGroup = m.groups.find((g) => !filter || filter(g.kind));
  return (
    <>
    <select
      id={id}
      aria-label={ariaLabel}
      className="input"
      value={value ?? ''}
      onChange={(e) => (e.target.value === '__new' ? setCreating(true) : onChange(e.target.value || null))}
    >
      {allowEmpty ? <option value="">{emptyLabel ?? '— No category —'}</option> : null}
      {m.groups
        .filter((g) => !filter || filter(g.kind))
        .filter((g) => m.categories.some((c) => c.groupId === g.id && visible(c)))
        .map((g) => (
          <optgroup key={g.id} label={g.name}>
            {m.categories
              .filter((c) => c.groupId === g.id && visible(c))
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {!categoryActiveOn(c, on) ? ` (ended ${c.activeUntil})` : ''}
                  {c.section && c.section !== g.name ? ` · ${c.section}` : ''}
                </option>
              ))}
          </optgroup>
        ))}
      {allowNew ? <option value="__new">+ New category…</option> : null}
    </select>
    {creating ? <CategoryForm defaultGroupCode={firstGroup?.code} onClose={() => setCreating(false)} onSaved={(c) => onChange(c.id)} /> : null}
    </>
  );
}

export function AccountSelect({ value, onChange, m, exclude, ariaLabel }: { value: ID; onChange: (v: ID) => void; m: Model; exclude?: ID; ariaLabel?: string }) {
  const groups: Array<[string, (t: string) => boolean]> = [
    ['Everyday', (t) => t === 'current' || t === 'cash'],
    ['Reserves & savings', (t) => t === 'reserve' || t === 'savings']
  ];
  return (
    <select className="input" aria-label={ariaLabel} value={value} onChange={(e) => onChange(e.target.value)}>
      {groups.map(([label, f]) => (
        <optgroup key={label} label={label}>
          {m.accounts
            .filter((a) => !a.archived && f(a.type) && a.id !== exclude)
            .map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
                {a.currency !== m.settings.baseCurrency ? ` (${a.currency})` : ''}
              </option>
            ))}
        </optgroup>
      ))}
    </select>
  );
}

export function TxEditor({ draft, onClose }: { draft: TxDraft; onClose: () => void }) {
  const m = useModel();
  const toast = useToast();
  const existing = draft.id ? m.transactions.find((t) => t.id === draft.id) : undefined;
  const pair = existing?.transferId ? m.transactions.find((t) => t.transferId === existing.transferId && t.id !== existing.id) : undefined;
  const outSide = existing && pair ? (existing.amount < 0 ? existing : pair) : undefined;
  const inSide = existing && pair ? (existing.amount < 0 ? pair : existing) : undefined;

  const defaultAcc = draft.accountId ?? m.settings.defaultAccountId ?? m.accounts.find((a) => !a.archived && a.type === 'current')?.id ?? m.accounts[0]?.id ?? '';
  // a new booking on a reservation/savings category that moves money starts as a transfer to that account
  const draftTarget = !existing && (draft.kind ?? 'expense') === 'expense' ? moveTarget(m, draft.categoryId) : undefined;
  const [kind, setKind] = useState<'expense' | 'income' | 'transfer'>(existing ? (pair ? 'transfer' : existing.amount >= 0 ? 'income' : 'expense') : draftTarget ? 'transfer' : draft.kind ?? 'expense');
  const [accountId, setAccountId] = useState<ID>(outSide?.accountId ?? existing?.accountId ?? defaultAcc);
  const [toAccountId, setToAccountId] = useState<ID>(inSide?.accountId ?? draft.toAccountId ?? draftTarget?.id ?? m.accounts.find((a) => a.id !== defaultAcc && !a.archived)?.id ?? '');
  const [autoTransfer, setAutoTransfer] = useState<string | null>(draftTarget ? draftTarget.name : null);
  const rec = draft.recurringId ? m.recurring.find((r) => r.id === draft.recurringId) : undefined;
  const [date, setDate] = useState(existing?.date ?? draft.date ?? today());
  const [amount, setAmount] = useState(Math.abs(existing?.amount ?? draft.amount ?? 0));
  const [payee, setPayee] = useState(existing?.payee ?? draft.payee ?? '');
  const [memo, setMemo] = useState(existing?.memo ?? draft.memo ?? '');
  // bills/income meant for next month (e.g. a salary advance) start out counted for the next budget month
  const [budgetMonth, setBudgetMonth] = useState<string>(
    (outSide ?? existing)?.budgetMonth ?? (!existing && rec?.countsFor === 'next' ? shiftMonth(monthOfDate(m, draft.date ?? today()), 1) : '')
  );
  const [monthTouched, setMonthTouched] = useState(false);
  const [categoryId, setCategoryId] = useState<ID | null>((outSide ?? existing)?.categoryId ?? draft.categoryId ?? null);
  const [splits, setSplits] = useState<Split[]>(existing?.splits?.map((s) => ({ ...s, amount: Math.abs(s.amount) })) ?? []);
  // Clearing and reconciliation are not used: the status is kept only for older data.
  const cleared = existing ? existing.status !== 'uncleared' : true;
  const reconciled = false;

  const payees = useMemo(() => {
    const map = new Map<string, ID | null>();
    for (const t of [...m.transactions].sort((a, b) => a.date.localeCompare(b.date))) if (t.payee && !t.transferId) map.set(t.payee, t.categoryId);
    return map;
  }, [m.transactions]);

  const splitTotal = sum(splits.map((s) => s.amount));
  const splitLeft = amount - splitTotal;
  const acc = m.accountById.get(accountId);
  const dateMonth = monthOfDate(m, date);
  const effMonth = budgetMonth || dateMonth;
  const maxMonth = lastBookableMonth(m);
  const tooEarly = effMonth > maxMonth;
  const inClosed = isClosedMonth(m, effMonth);
  const monthOptions = [shiftMonth(dateMonth, -1), dateMonth, shiftMonth(dateMonth, 1)].filter((x) => x <= maxMonth && !isClosedMonth(m, x));
  const endedCats = (splits.length ? splits.map((s) => s.categoryId) : [categoryId])
    .map((id) => (id ? m.categoryById.get(id) : undefined))
    .filter((c) => c && !categoryActiveOn(c, date)) as Array<{ name: string; activeUntil?: string }>;
  const valid = !endedCats.length && !tooEarly && !inClosed && amount > 0 && accountId && (kind !== 'transfer' || (toAccountId && toAccountId !== accountId)) && (!splits.length || splitLeft === 0);

  function pickCategory(id: ID | null) {
    setCategoryId(id);
    const target = moveTarget(m, id);
    if (target && target.id !== accountId && (kind === 'expense' || kind === 'transfer')) {
      setKind('transfer');
      setToAccountId(target.id);
      setAutoTransfer(target.name);
    } else if (autoTransfer && kind === 'transfer' && !target) {
      // moved away from a category that made this a transfer: back to money out
      setKind('expense');
      setAutoTransfer(null);
    }
  }
  const splitMoves = kind !== 'transfer' ? splits.map((x) => moveTarget(m, x.categoryId) && m.categoryById.get(x.categoryId!)?.name).filter(Boolean) as string[] : [];

  async function save() {
    const at = nowIso();
    const sign = kind === 'income' ? 1 : -1;
    const status = reconciled ? 'reconciled' : cleared ? 'cleared' : 'uncleared';
    const changes: any[] = [];
    if (kind === 'transfer') {
      const transferId = existing?.transferId ?? uid();
      const base = { date, payee: payee || undefined, memo: memo || undefined, status, transferId, createdAt: existing?.createdAt ?? at, updatedAt: at } as const;
      const out: Transaction = { ...(outSide ?? ({} as Transaction)), ...base, id: outSide?.id ?? existing?.id ?? uid(), accountId, amount: -amount, categoryId, splits: undefined, transferAccountId: toAccountId };
      const toAcc = m.accountById.get(toAccountId);
      const inAmount = toAcc && acc && toAcc.currency !== acc.currency ? Math.round((amount * rateOf(m, acc.currency, date)) / rateOf(m, toAcc.currency, date)) : amount;
      const inn: Transaction = { ...(inSide ?? ({} as Transaction)), ...base, id: inSide?.id ?? uid(), accountId: toAccountId, amount: inAmount, categoryId: null, splits: undefined, transferAccountId: accountId };
      // an ordinary transaction turned into a transfer keeps its id on the outgoing side
      changes.push({ table: 'transactions', put: out }, { table: 'transactions', put: inn });
    } else {
      if (pair) changes.push({ table: 'transactions', del: pair.id });
      const t: Transaction = {
        ...(existing ?? ({} as Transaction)),
        id: existing?.id ?? uid(),
        accountId,
        date,
        amount: sign * amount,
        payee: payee || undefined,
        memo: memo || undefined,
        categoryId: splits.length ? null : categoryId,
        splits: splits.length ? splits.map((s) => ({ ...s, amount: sign * s.amount })) : undefined,
        transferId: undefined,
        transferAccountId: undefined,
        status,
        createdAt: existing?.createdAt ?? at,
        updatedAt: at
      };
      changes.push({ table: 'transactions', put: t });
    }
    if (rec) for (const c of changes) if (c.put && c.put.accountId === accountId) c.put.recurringId = rec.id;
    if (rec) changes.push({ table: 'recurring', put: { ...rec, nextDate: nextOccurrence(rec, rec.nextDate) } });
    for (const c of changes)
      if (c.put) {
        c.put.budgetMonth = budgetMonth && budgetMonth !== monthOfDate(m, c.put.date) ? budgetMonth : undefined;
        // choosing the date's own month on purpose means: checked, no earmark warning
        if (monthTouched && !c.put.budgetMonth) c.put.monthConfirmed = true;
        if (c.put.budgetMonth) c.put.monthConfirmed = undefined;
      }
    await commit(changes, existing ? 'Edit transaction' : rec ? `Paid ${rec.name}` : 'Add transaction');
    toast(existing ? 'Transaction saved' : rec ? `${rec.name} recorded — next due ${nextOccurrence(rec, rec.nextDate)}` : 'Transaction added');
    onClose();
  }

  async function remove() {
    const ids = [existing!.id, ...(pair ? [pair.id] : [])];
    const before = [existing!, ...(pair ? [pair] : [])];
    await commit(ids.map((id) => ({ table: 'transactions' as const, del: id })), 'Delete transaction');
    toast({ text: 'Transaction deleted', action: { label: 'Undo', run: () => commit(before.map((t) => ({ table: 'transactions' as const, put: t })), 'Undo delete') } });
    onClose();
  }

  const catFilter = kind === 'income' ? (k: string) => k === 'income' || k === 'opening' : kind === 'transfer' ? (k: string) => k === 'reservation' || k === 'transfer' : (k: string) => k !== 'income' && k !== 'opening';

  return (
    <Modal
      title={existing ? 'Edit transaction' : rec ? `${rec.kind === 'income' ? 'Receive' : 'Pay'} ${rec.name}` : 'New transaction'}
      onClose={onClose}
      footer={
        <>
          {existing ? (
            <button className="btn danger" onClick={remove} disabled={reconciled}>
              <Icon name="trash" size={16} /> Delete
            </button>
          ) : null}
          <span className="spacer" />
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={!valid} onClick={save}>
            {existing ? 'Save changes' : rec ? (rec.kind === 'income' ? 'Record income' : 'Record payment') : 'Add transaction'}
          </button>
        </>
      }
    >
      <div className="stack">
        <Seg
          ariaLabel="Type"
          value={kind}
          onChange={(k) => {
            setKind(k);
            setAutoTransfer(null);
          }}
          options={[
            ['expense', 'Money out'],
            ['income', 'Money in'],
            ['transfer', 'Transfer']
          ]}
        />
        {rec ? <div className="notice info small">Check the amount and date before saving — this {rec.kind === 'income' ? 'income' : 'payment'} was due {rec.nextDate}. Saving records it and moves the schedule to the next date.</div> : null}
        {reconciled ? <div className="notice info">This transaction is part of a completed reconciliation. Amount and account are locked; you can still change the description and category.</div> : null}
        <div className="form-grid">
          <Field label={kind === 'transfer' ? 'From account' : 'Account'}>
            <AccountSelect m={m} value={accountId} onChange={setAccountId} />
          </Field>
          {kind === 'transfer' ? (
            <Field label="To account">
              <AccountSelect m={m} value={toAccountId} onChange={setToAccountId} exclude={accountId} />
            </Field>
          ) : (
            <Field label="Date">
              <BudgetDatePicker m={m} value={date} onChange={setDate} />
            </Field>
          )}
          <Field label={`Amount${acc && acc.currency !== m.settings.baseCurrency ? ` (${acc.currency})` : ''}`}>
            <AmountInput live value={amount} onChange={setAmount} autoFocus={!existing} />
          </Field>
          {kind === 'transfer' ? (
            <Field label="Date">
              <BudgetDatePicker m={m} value={date} onChange={setDate} />
            </Field>
          ) : (
            <Field label={kind === 'income' ? 'From' : 'Payee'}>
              <input
                className="input"
                list="payees"
                value={payee}
                onChange={(e) => {
                  setPayee(e.target.value);
                  const c = payees.get(e.target.value);
                  if (c && !categoryId) setCategoryId(c);
                }}
                placeholder={kind === 'income' ? 'Employer, client…' : 'Shop, person…'}
              />
              <datalist id="payees">
                {[...payees.keys()].slice(-300).map((p) => (
                  <option key={p} value={p} />
                ))}
              </datalist>
            </Field>
          )}
          {!splits.length ? (
            <Field label={kind === 'transfer' ? 'Budget category (optional)' : 'Category'} className="full" help={kind === 'transfer' ? 'Use a reservation category when this transfer sets money aside, so it counts in the budget.' : undefined}>
              <CategorySelect m={m} value={categoryId} onChange={pickCategory} filter={catFilter} accountId={accountId} date={date} />
            </Field>
          ) : null}
        </div>
        {autoTransfer && kind === 'transfer' ? (
          <div className="notice info small">
            Saved as a transfer to <b>{autoTransfer}</b>: the money counts once as set aside, and {autoTransfer}’s balance goes up by the same amount.
          </div>
        ) : null}
        {splitMoves.length ? (
          <div className="notice small">
            Split lines stay one booking, so {splitMoves.join(', ')} will not move money to a reserve account. Book {splitMoves.length === 1 ? 'it' : 'them'} separately to move the money.
          </div>
        ) : null}

        {kind !== 'transfer' ? (
          <div className="panel" style={{ background: 'var(--paper)' }}>
            <div className="row">
              <Icon name="split" size={18} />
              <b>Split across categories</b>
              <span className="spacer" />
              <button
                className="btn sm"
                type="button"
                onClick={() =>
                  setSplits(splits.length ? [...splits, { id: uid(), categoryId: null, amount: Math.max(0, splitLeft) }] : [{ id: uid(), categoryId, amount }, { id: uid(), categoryId: null, amount: 0 }])
                }
              >
                <Icon name="plus" size={14} /> {splits.length ? 'Add line' : 'Split'}
              </button>
            </div>
            {splits.length ? (
              <div className="stack" style={{ marginTop: 12 }}>
                {splits.map((s, i) => (
                  <div className="split-row" key={s.id}>
                    <CategorySelect ariaLabel={`Split ${i + 1} category`} m={m} value={s.categoryId} onChange={(v) => setSplits(splits.map((x) => (x.id === s.id ? { ...x, categoryId: v } : x)))} filter={catFilter} accountId={accountId} date={date} />
                    <AmountInput live ariaLabel={`Split ${i + 1} amount`} value={s.amount} onChange={(v) => setSplits(splits.map((x) => (x.id === s.id ? { ...x, amount: v } : x)))} />
                    <button className="icon-btn" aria-label="Remove split line" onClick={() => setSplits(splits.filter((x) => x.id !== s.id))}>
                      <Icon name="x" size={16} />
                    </button>
                  </div>
                ))}
                <div className={splitLeft === 0 ? 'muted small' : 'small'} style={{ color: splitLeft === 0 ? undefined : 'var(--plum)' }}>
                  {splitLeft === 0 ? 'Splits add up to the total.' : `${fmtMoney(Math.abs(splitLeft))} ${splitLeft > 0 ? 'still to assign' : 'more than the total'}.`}
                </div>
              </div>
            ) : (
              <p className="muted small" style={{ marginTop: 4 }}>
                One payment covering several categories, e.g. a supermarket receipt with food and household items.
              </p>
            )}
          </div>
        ) : null}

        <div className="form-grid">
          <Field label="Counts for budget month" help={budgetMonth && budgetMonth !== dateMonth ? `Booked on ${date} but counted in ${monthLabel(budgetMonth)}: not in ${monthLabel(dateMonth)}'s budget or balance.` : 'Change this for money meant for another month, e.g. the salary advance for next month.'}>
            <select className="input" aria-label="Counts for budget month" value={budgetMonth && budgetMonth !== dateMonth ? budgetMonth : ''} onChange={(e) => { setBudgetMonth(e.target.value); setMonthTouched(true); }}>
              <option value="">{monthLabel(dateMonth)} (from the date)</option>
              {monthOptions.filter((x) => x !== dateMonth).map((x) => (
                <option key={x} value={x}>
                  {monthLabel(x)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Memo">
            <input className="input" value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="Optional note" />
          </Field>
        </div>

        {endedCats.length ? (
          <div className="notice bad small">
            {endedCats.map((c) => `“${c.name}” ended on ${c.activeUntil}`).join(', ')} — pick another category or an earlier date.
          </div>
        ) : null}
        {inClosed ? (
          <div className="notice bad small">
            {monthLabel(effMonth)} belongs to the closed year {effMonth.slice(0, 4)}. Pick a later date or budget month, or reopen the year under Years &amp; archive.
          </div>
        ) : null}
        {tooEarly ? (
          <div className="notice bad small">
            {monthLabel(effMonth)} is not open for booking yet. You can book up to {monthLabel(maxMonth)}; plan later months in the budget or the forecast instead.
          </div>
        ) : null}
        {kind === 'transfer' && acc && m.accountById.get(toAccountId)?.currency !== acc.currency ? (
          <div className="notice info small">
            Different currencies: the receiving side is converted at the rate for {date}. <Money v={amount} cur={acc.currency} />
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

function rateOf(m: Model, cur: string, date: string) {
  if (cur === m.settings.baseCurrency) return 1;
  const arr = m.ratesByCurrency.get(cur) ?? [];
  let r = arr[0]?.rate ?? 1;
  for (const x of arr) if (x.date <= date) r = x.rate;
  return r;
}
