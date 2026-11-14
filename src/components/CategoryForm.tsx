import { useState } from 'react';
import { useModel } from '../lib/useModel';
import { put } from '../lib/db';
import { Field, Modal, useToast } from './ui';
import { ACCOUNT_TYPE_LABEL, isReserve, moveHistory } from '../lib/calc/model';
import type { AccountType, Category, Rollover } from '../lib/types';
import { uid } from '../lib/util';

type ScopeMode = 'all' | 'types' | 'accounts';
const TYPES: AccountType[] = ['current', 'cash', 'reserve', 'savings'];

/** Suggests the next free code in a group, e.g. PC094 after PC093. */
function nextCode(existing: string[], prefix: string): string {
  const nums = existing.filter((c) => c.startsWith(prefix)).map((c) => Number(c.slice(prefix.length))).filter((n) => Number.isFinite(n));
  const n = nums.length ? Math.max(...nums) + 1 : 11;
  return `${prefix}${String(n).padStart(3, '0')}`;
}

export function CategoryForm({ initial, onClose, onSaved, defaultGroupCode }: { initial?: Category; onClose: () => void; onSaved?: (c: Category) => void; defaultGroupCode?: string }) {
  const m = useModel();
  const toast = useToast();
  const startGroup = m.groups.find((g) => g.code === (defaultGroupCode ?? 'UC')) ?? m.groups[0];
  const [c, setC] = useState<Category>(
    initial ?? {
      id: uid(),
      code: nextCode(m.categories.map((x) => x.code), startGroup?.code ?? 'UC'),
      name: '',
      groupId: startGroup?.id ?? '',
      sort: m.categories.length,
      rollover: 'none',
      updatedAt: ''
    }
  );
  const [mode, setMode] = useState<ScopeMode>(c.accountIds?.length ? 'accounts' : c.accountTypes?.length ? 'types' : 'all');
  const sections = Array.from(new Set(m.categories.map((x) => x.section).filter(Boolean))) as string[];
  const hist = initial ? moveHistory(m, initial.id).filter((h) => isReserve(h.account)) : [];
  const toggle = <T,>(arr: T[] | undefined, v: T) => (arr?.includes(v) ? arr.filter((x) => x !== v) : [...(arr ?? []), v]);

  async function save() {
    const rec: Category = {
      ...c,
      name: c.name.trim(),
      accountTypes: mode === 'types' && c.accountTypes?.length ? c.accountTypes : undefined,
      accountIds: mode === 'accounts' && c.accountIds?.length ? c.accountIds : undefined,
      moveToAccountId: m.groupById.get(c.groupId)?.kind === 'reservation' ? c.moveToAccountId : undefined
    };
    if (!initial && m.categories.some((x) => x.code === rec.code)) return toast(`Code ${rec.code} is already used`);
    await put('categories', rec, initial ? 'Edit category' : 'Add category');
    toast(initial ? 'Category saved' : `${rec.name} added`);
    onSaved?.(rec);
    onClose();
  }

  return (
    <Modal
      title={initial ? `Edit ${initial.name}` : 'New category'}
      onClose={onClose}
      footer={
        <>
          {initial ? (
            <button className="btn danger" onClick={async () => { await put('categories', { ...c, archived: !c.archived }); onClose(); }}>
              {c.archived ? 'Restore' : 'Archive'}
            </button>
          ) : null}
          <span className="spacer" />
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!c.name.trim() || !c.code} onClick={save}>
            {initial ? 'Save category' : 'Add category'}
          </button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Name">
          <input className="input" value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} autoFocus placeholder="e.g. Pet food" />
        </Field>
        <Field label="Group">
          <select
            className="input"
            value={c.groupId}
            onChange={(e) => {
              const g = m.groups.find((x) => x.id === e.target.value)!;
              setC({ ...c, groupId: g.id, code: initial ? c.code : nextCode(m.categories.map((x) => x.code), g.code) });
            }}
          >
            {m.groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </Field>
        <Field label="Code" help="Used in reports and imports">
          <input className="input" value={c.code} onChange={(e) => setC({ ...c, code: e.target.value.toUpperCase() })} />
        </Field>
        <Field label="Budget section" help="Groups lines on the budget, e.g. Car or Joshua">
          <input className="input" list="sections" value={c.section ?? ''} onChange={(e) => setC({ ...c, section: e.target.value || undefined })} />
          <datalist id="sections">{sections.map((s) => <option key={s} value={s} />)}</datalist>
        </Field>
        <Field label="Cost type">
          <select className="input" value={c.costType ?? ''} onChange={(e) => setC({ ...c, costType: (e.target.value || undefined) as any })}>
            <option value="">—</option>
            <option value="fixed">Fixed (same every month)</option>
            <option value="variable">Variable</option>
          </select>
        </Field>
        <Field label="Active until" help="Optional last day. After it you can’t book on this category and it drops out of later budget months.">
          <div className="row">
            <input className="input" type="date" value={c.activeUntil ?? ''} onChange={(e) => setC({ ...c, activeUntil: e.target.value || undefined })} />
            {c.activeUntil ? <button type="button" className="btn sm ghost" onClick={() => setC({ ...c, activeUntil: undefined })}>Clear</button> : null}
          </div>
        </Field>
        {m.groupById.get(c.groupId)?.kind === 'reservation' ? (
          <Field
            label="Moves money to"
            className="full"
            help={
              c.moveToAccountId
                ? 'Money out on this category is saved as a transfer to this account: it counts once as set aside, and the account’s balance goes up.'
                : hist[0]
                  ? `Before, this category mostly went to ${hist[0].account.name} (${hist[0].count}×).`
                  : 'Pick the reserve or savings account the money goes to. Leave empty when it leaves your accounts, e.g. a pension fund.'
            }
          >
            <div className="row">
              <select className="input" value={c.moveToAccountId ?? ''} onChange={(e) => setC({ ...c, moveToAccountId: e.target.value || undefined })}>
                <option value="">Nowhere: the money leaves your accounts</option>
                {m.accounts.filter((a) => isReserve(a) && (!a.archived || a.id === c.moveToAccountId)).map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
              {!c.moveToAccountId && hist[0] ? (
                <button type="button" className="btn sm" onClick={() => setC({ ...c, moveToAccountId: hist[0].account.id })}>Use {hist[0].account.name}</button>
              ) : null}
            </div>
          </Field>
        ) : null}
        <Field label="Rollover">
          <select className="input" value={c.rollover ?? 'none'} onChange={(e) => setC({ ...c, rollover: e.target.value as Rollover })}>
            <option value="none">None — each month starts fresh</option>
            <option value="carry-remaining">Carry unspent money</option>
            <option value="carry-overspend">Carry overspending</option>
            <option value="carry-both">Carry both</option>
          </select>
        </Field>
      </div>

      <div className="panel" style={{ background: 'var(--paper)', marginTop: 16 }}>
        <b>Used on</b>
        <p className="small muted" style={{ margin: '2px 0 10px' }}>Limits where the category shows up when you enter a transaction.</p>
        <div className="seg" role="group" aria-label="Scope">
          {([['all', 'All accounts'], ['types', 'Account types'], ['accounts', 'Specific accounts']] as Array<[ScopeMode, string]>).map(([k, l]) => (
            <button key={k} type="button" className={mode === k ? 'on' : ''} onClick={() => setMode(k)}>{l}</button>
          ))}
        </div>
        {mode === 'types' ? (
          <div className="row wrap" style={{ marginTop: 12 }}>
            {TYPES.map((t) => (
              <label key={t} className="check">
                <input type="checkbox" checked={c.accountTypes?.includes(t) ?? false} onChange={() => setC({ ...c, accountTypes: toggle(c.accountTypes, t) })} /> {ACCOUNT_TYPE_LABEL[t]}
              </label>
            ))}
          </div>
        ) : null}
        {mode === 'accounts' ? (
          <div className="row wrap" style={{ marginTop: 12 }}>
            {m.accounts.filter((a) => !a.archived).map((a) => (
              <label key={a.id} className="check">
                <input type="checkbox" checked={c.accountIds?.includes(a.id) ?? false} onChange={() => setC({ ...c, accountIds: toggle(c.accountIds, a.id) })} /> {a.name}
              </label>
            ))}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
