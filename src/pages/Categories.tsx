import { Fragment, useMemo, useState } from 'react';
import { GroupDot, groupVar } from '../components/Group';
import { useModel } from '../lib/useModel';
import { commit } from '../lib/db';
import { Icon, Modal, useToast } from '../components/ui';
import { CategoryForm } from '../components/CategoryForm';
import { scopeLabel, ACCOUNT_TYPE_LABEL } from '../lib/calc/model';
import type { AccountType, Category } from '../lib/types';
import { fmtDate, today } from '../lib/util';

/** Scopes derived from where each category was actually used. */
function suggestScopes(m: ReturnType<typeof useModel>) {
  const out: Array<{ c: Category; accountTypes?: AccountType[]; accountIds?: string[]; label: string }> = [];
  for (const c of m.categories) {
    if (c.accountTypes?.length || c.accountIds?.length) continue;
    const accs = new Set<string>();
    for (const t of m.transactions) {
      if (t.categoryId === c.id || t.splits?.some((s) => s.categoryId === c.id)) accs.add(t.accountId);
    }
    if (!accs.size) continue;
    const accounts = [...accs].map((id) => m.accountById.get(id)!).filter(Boolean);
    const types = Array.from(new Set(accounts.map((a) => a.type)));
    const everyday = types.every((t) => t === 'current' || t === 'cash');
    const reserves = types.every((t) => t === 'reserve' || t === 'savings');
    if (accounts.length === 1 && reserves) out.push({ c, accountIds: [accounts[0].id], label: accounts[0].name });
    else if (reserves) out.push({ c, accountTypes: ['reserve', 'savings'], label: 'Reserve funds, Savings' });
    else if (everyday) out.push({ c, accountTypes: ['current', 'cash'], label: 'Current accounts, Cash' });
  }
  return out;
}

export default function Categories() {
  const m = useModel();
  const toast = useToast();
  const [edit, setEdit] = useState<Category | 'new' | null>(null);
  const [suggest, setSuggest] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const suggestions = useMemo(() => suggestScopes(m), [m]);
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of m.transactions) {
      if (t.categoryId) map.set(t.categoryId, (map.get(t.categoryId) ?? 0) + 1);
      for (const s of t.splits ?? []) if (s.categoryId) map.set(s.categoryId, (map.get(s.categoryId) ?? 0) + 1);
    }
    return map;
  }, [m.transactions]);

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Categories</h1>
          <p className="sub">Codes come from your workbook. Limit a category to an account or account type so it only shows where it belongs.</p>
        </div>
        <div className="actions">
          <label className="check small">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Show archived
          </label>
          {suggestions.length ? <button className="btn" onClick={() => setSuggest(true)}>Set scopes from history ({suggestions.length})</button> : null}
          <button className="btn primary" onClick={() => setEdit('new')}>
            <Icon name="plus" size={16} /> New category
          </button>
        </div>
      </div>
      {m.groups.map((g) => {
        const cats = m.categories.filter((c) => c.groupId === g.id && (showArchived || !c.archived));
        if (!cats.length) return null;
        // sub-headings per budget section (Bucharest, Joshua, Car…) when a group has several
        const sectionNames = Array.from(new Set(cats.map((c) => c.section ?? '')));
        const showSections = sectionNames.length > 1;
        return (
          <section key={g.id} className="bgroup" style={groupVar(g.code)}>
            <div className="bgroup-head static">
              <span className="bgroup-title">
                <GroupDot code={g.code} /> {g.name}
              </span>
              <span className="bgroup-sub">
                {g.code} · {cats.length} categor{cats.length === 1 ? 'y' : 'ies'}
              </span>
            </div>
            <div className="list flat">
              {sectionNames.map((sec) => (
                <Fragment key={sec}>
                  {showSections ? <div className="list-sub">{sec || 'No section'}</div> : null}
                  {cats
                    .filter((c) => (c.section ?? '') === sec)
                    .map((c) => {
                      const limited = !!(c.accountTypes?.length || c.accountIds?.length);
                      const n = counts.get(c.id) ?? 0;
                      return (
                        <div key={c.id} className="list-row click compact" onClick={() => setEdit(c)} style={{ opacity: c.archived ? 0.55 : 1 }}>
                          <span className="code-tag">{c.code}</span>
                          <div className="grow title">{c.name}</div>
                          {limited ? <span className="badge info" title="Only offered on these accounts">{scopeLabel(m, c)}</span> : null}
                          {c.rollover && c.rollover !== 'none' ? <span className="badge">Rollover</span> : null}
                          {c.archived ? <span className="badge">Archived</span> : null}
                          {c.activeUntil ? (
                            <span className={c.activeUntil < today() ? 'badge' : 'badge warn'}>{c.activeUntil < today() ? `Ended ${fmtDate(c.activeUntil, true)}` : `Until ${fmtDate(c.activeUntil, true)}`}</span>
                          ) : null}
                          <span className="muted small desk-only" style={{ width: 120, textAlign: 'right' }}>{n ? `${n} transaction${n === 1 ? '' : 's'}` : 'not used yet'}</span>
                          <Icon name="chev" size={16} className="muted" />
                        </div>
                      );
                    })}
                </Fragment>
              ))}
            </div>
          </section>
        );
      })}
      {edit ? <CategoryForm initial={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} /> : null}
      {suggest ? (
        <Modal
          title="Set scopes from history"
          wide
          onClose={() => setSuggest(false)}
          footer={
            <>
              <button className="btn" onClick={() => setSuggest(false)}>Cancel</button>
              <button
                className="btn primary"
                onClick={async () => {
                  await commit(suggestions.map((s) => ({ table: 'categories' as const, put: { ...s.c, accountTypes: s.accountTypes, accountIds: s.accountIds } })), 'Set category scopes');
                  toast(`${suggestions.length} categories limited`);
                  setSuggest(false);
                }}
              >
                Apply to {suggestions.length} categories
              </button>
            </>
          }
        >
          <p className="muted" style={{ marginBottom: 12 }}>
            Based on where each category has been used so far. Categories used only in everyday accounts are kept to current accounts and cash; ones used only in reserve funds are kept there. Categories used in both stay available everywhere. You can change any of these later.
          </p>
          <div className="list">
            {suggestions.map((s) => (
              <div className="list-row" key={s.c.id}>
                <span className="muted small" style={{ width: 58 }}>{s.c.code}</span>
                <div className="grow title">{s.c.name}</div>
                <span className="badge info">{s.label}</span>
              </div>
            ))}
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
