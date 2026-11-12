import type { Account, BudgetLine, Category, CategoryGroup, FxRate, ImportBatch, PlannedEntry, Recurring, TableName, Transaction, YearlyFund, YearlyItem } from '../types';
import { GROUPS, costTypeFor } from '../structure';
import type { Model } from '../calc/model';
import type { ImportPlan } from './parse';
import { addMonths, nowIso, today, uid } from '../util';

export interface CommitOptions {
  accountMap: Record<string, string | 'new'>; // plan account code → existing account id or 'new'
  includeBudgets: boolean;
  includeYearly: boolean;
  includeFx: boolean;
  includeSubscriptions: boolean;
  skipAlreadyImported: boolean;
  subscriptionAccountId?: string;
}

export type Change = { table: TableName; put?: any; del?: string };

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

export function suggestAccountMap(plan: ImportPlan, m: Model): Record<string, string | 'new'> {
  const out: Record<string, string | 'new'> = {};
  for (const a of plan.accounts) {
    const byName = m.accounts.find((x) => norm(x.name) === norm(a.name));
    const byCode = m.accounts.find((x) => x.code === a.code);
    out[a.code] = byName?.id ?? byCode?.id ?? 'new';
  }
  return out;
}

/** Existing transactions keyed the same way as plan rows, for "already imported" detection. */
export function existingKeys(m: Model): Set<string> {
  const s = new Set<string>();
  for (const t of m.transactions) if (t.sourceRef) s.add(`${t.sourceRef}|${t.amount}`);
  return s;
}

export function buildCommit(plan: ImportPlan, m: Model, o: CommitOptions): { changes: Change[]; batch: ImportBatch; counts: Record<string, number> } {
  const at = nowIso();
  seqBase = Date.now();
  seq = 0;
  const batchId = uid();
  const changes: Change[] = [];
  const counts: Record<string, number> = {};
  const inc = (k: string, n = 1) => (counts[k] = (counts[k] ?? 0) + n);

  // groups
  const groupId = new Map<string, string>();
  for (const g of GROUPS) {
    const ex = m.groups.find((x) => x.code === g.code);
    if (ex) groupId.set(g.code, ex.id);
    else {
      const rec: CategoryGroup = { id: uid(), code: g.code, name: g.name, kind: g.kind, sort: g.sort, updatedAt: at };
      groupId.set(g.code, rec.id);
      changes.push({ table: 'groups', put: rec });
    }
  }
  // categories
  const catId = new Map<string, string>();
  for (const c of m.categories) catId.set(c.code, c.id);
  plan.categories.forEach((c, i) => {
    if (catId.has(c.code)) return;
    const rec: Category = {
      id: uid(),
      code: c.code,
      name: c.name,
      groupId: groupId.get(c.groupCode) ?? groupId.get('UC')!,
      section: c.section,
      costType: costTypeFor(c.code),
      rollover: 'none',
      sort: 100 + i,
      updatedAt: at
    };
    catId.set(c.code, rec.id);
    changes.push({ table: 'categories', put: rec });
    inc('categories');
  });
  const cat = (code: string | null) => (code ? catId.get(code) ?? null : null);

  // accounts
  const accId = new Map<string, string>();
  const isActuals = plan.mode === 'actuals';
  plan.accounts.forEach((a, i) => {
    const target = o.accountMap[a.code] ?? 'new';
    if (target !== 'new') {
      accId.set(a.code, target);
      const ex = m.accountById.get(target);
      if (ex && isActuals && a.statementBalance != null) {
        changes.push({ table: 'accounts', put: { ...ex, statementBalance: a.statementBalance, statementDate: today() } });
      }
      return;
    }
    const rec: Account = {
      id: uid(),
      code: a.code,
      name: a.name,
      type: a.type,
      currency: m.settings.baseCurrency,
      openingBalance: isActuals ? a.openingBalance : 0,
      openingDate: `${plan.year}-01-01`,
      statementBalance: isActuals ? a.statementBalance : undefined,
      statementDate: isActuals && a.statementBalance != null ? today() : undefined,
      sort: m.accounts.length + i,
      updatedAt: at
    };
    accId.set(a.code, rec.id);
    changes.push({ table: 'accounts', put: rec });
    inc('accounts');
  });
  // Existing accounts that receive an opening balance from this workbook
  if (isActuals)
    for (const a of plan.accounts) {
      const target = o.accountMap[a.code];
      if (target && target !== 'new' && a.openingBalance) {
        const ex = m.accountById.get(target)!;
        const already = m.transactions.some((t) => t.accountId === target && (t.sourceRef ?? '').startsWith(plan.fileName));
        if (!already) {
          changes.push({
            table: 'transactions',
            put: mkTx({ accountId: target, date: `${plan.year}-01-01`, amount: a.openingBalance, payee: 'Opening balance', categoryId: cat('SB001'), status: 'reconciled', importBatchId: batchId, sourceRef: `${plan.fileName}#opening` })
          });
          inc('openingBalances');
        }
        void ex;
      }
    }

  // transactions or planned entries
  const seen = o.skipAlreadyImported ? existingKeys(m) : new Set<string>();
  const pairOf = new Map<string, { other: string; transferId: string; categoryCode: string | null; side: 'out' | 'in' }>();
  for (const p of plan.transferPairs) {
    const id = uid();
    pairOf.set(p.out, { other: p.in, transferId: id, categoryCode: p.categoryCode, side: 'out' });
    pairOf.set(p.in, { other: p.out, transferId: id, categoryCode: p.categoryCode, side: 'in' });
  }
  const byKey = new Map(plan.transactions.map((t) => [t.key, t]));
  for (const t of plan.transactions) {
    if (!t.include) continue;
    const accountId = accId.get(t.accountCode);
    if (!accountId) continue;
    const sourceRef = `${plan.fileName}:${t.sourceRef}`;
    if (seen.has(`${sourceRef}|${t.amount}`)) {
      inc('skippedAlreadyImported');
      continue;
    }
    if (isActuals) {
      const pair = pairOf.get(t.key);
      const otherAcc = pair ? accId.get(byKey.get(pair.other)!.accountCode) : undefined;
      const isPair = !!(pair && otherAcc && byKey.get(pair.other)!.include);
      const categoryId = isPair ? (pair!.side === 'out' ? cat(pair!.categoryCode) : null) : cat(t.categoryCode);
      changes.push({
        table: 'transactions',
        put: mkTx({
          accountId,
          date: t.date,
          amount: t.amount,
          payee: t.payee || undefined,
          categoryId,
          transferId: isPair ? pair!.transferId : undefined,
          transferAccountId: isPair ? otherAcc : undefined,
          status: 'cleared',
          importBatchId: batchId,
          sourceRef
        })
      });
      inc(isPair ? 'transferSides' : 'transactions');
    } else {
      const rec: PlannedEntry = { id: uid(), scenarioId: null, date: t.date, accountId, amount: t.amount, categoryId: cat(t.categoryCode), memo: t.payee || undefined, importBatchId: batchId, updatedAt: at };
      changes.push({ table: 'planned', put: rec });
      inc('plannedEntries');
    }
  }

  // budgets — replace lines for the same month that came from an earlier import
  if (o.includeBudgets)
    for (const b of plan.budgets.filter((x) => x.include)) {
      for (const old of m.budgetLines.filter((l) => l.month === b.month && l.importBatchId)) changes.push({ table: 'budgetLines', del: old.id });
      for (const l of b.lines) {
        const categoryId = cat(l.categoryCode);
        if (!categoryId) continue;
        const rec: BudgetLine = { id: uid(), month: b.month, categoryId, label: l.label, week: l.week, baseline: l.baseline, estimate: l.estimate, closed: l.closed, sort: l.sort, importBatchId: batchId, updatedAt: at };
        changes.push({ table: 'budgetLines', put: rec });
        inc('budgetLines');
      }
    }

  if (o.includeYearly && plan.yearly) {
    const y = plan.yearly;
    for (const old of m.yearlyItems.filter((x) => x.year === y.year && x.importBatchId)) changes.push({ table: 'yearlyItems', del: old.id });
    for (const it of y.items) {
      const rec: YearlyItem = { id: uid(), year: y.year, name: it.name, categoryId: cat(it.categoryCode), estimated: it.estimated, actualOverride: it.actual ?? undefined, dueDate: it.dueDate, paid: it.paid, importBatchId: batchId, updatedAt: at };
      changes.push({ table: 'yearlyItems', put: rec });
      inc('yearlyItems');
    }
    const fund: YearlyFund = { id: String(y.year), year: y.year, accountId: y.fundAccountCode ? accId.get(y.fundAccountCode) ?? null : null, monthlyContribution: y.monthlyContribution, updatedAt: at };
    changes.push({ table: 'yearlyFunds', put: fund });
  }

  if (o.includeFx)
    for (const r of plan.fx) {
      const rec: FxRate = { id: `${r.currency}:${r.date}`, date: r.date, currency: r.currency, rate: r.rate, updatedAt: at };
      changes.push({ table: 'fxRates', put: rec });
      inc('fxRates');
    }

  if (o.includeSubscriptions && plan.subscriptions.length) {
    const accountId = o.subscriptionAccountId ?? accId.get('CUR001') ?? m.accounts[0]?.id;
    const next = addMonths(`${today().slice(0, 7)}-01`, 1);
    for (const s of plan.subscriptions) {
      if (m.recurring.some((r) => norm(r.name) === norm(s.name))) continue;
      if (!accountId) break;
      const rec: Recurring = { id: uid(), name: s.name, kind: 'subscription', accountId, categoryId: cat('PC032'), amount: s.amount, frequency: 'monthly', interval: 1, startDate: next, nextDate: next, active: true, importBatchId: batchId, updatedAt: at };
      changes.push({ table: 'recurring', put: rec });
      inc('subscriptions');
    }
  }

  const batch: ImportBatch = {
    id: batchId,
    fileName: plan.fileName,
    mode: plan.mode,
    importedAt: at,
    counts,
    totals: {
      inflow: plan.transactions.filter((t) => t.include && t.amount > 0).reduce((s, t) => s + t.amount, 0),
      outflow: plan.transactions.filter((t) => t.include && t.amount < 0).reduce((s, t) => s + t.amount, 0)
    },
    updatedAt: at
  };
  changes.push({ table: 'importBatches', put: batch });
  return { changes, batch, counts };
}

// createdAt follows workbook row order, so same-day rows keep their order in registers.
let seqBase = 0;
let seq = 0;
function mkTx(p: Partial<Transaction> & Pick<Transaction, 'accountId' | 'date' | 'amount'>): Transaction {
  const at = nowIso();
  if (!seqBase) seqBase = Date.now();
  const createdAt = new Date(seqBase + seq++).toISOString();
  return { id: uid(), categoryId: null, status: 'uncleared', createdAt, updatedAt: at, ...p } as Transaction;
}

/** Changes that remove everything an import batch created. */
export function undoChanges(m: Model, batchId: string): Change[] {
  const out: Change[] = [];
  for (const t of m.transactions) if (t.importBatchId === batchId) out.push({ table: 'transactions', del: t.id });
  for (const t of m.planned) if (t.importBatchId === batchId) out.push({ table: 'planned', del: t.id });
  for (const t of m.budgetLines) if (t.importBatchId === batchId) out.push({ table: 'budgetLines', del: t.id });
  for (const t of m.yearlyItems) if (t.importBatchId === batchId) out.push({ table: 'yearlyItems', del: t.id });
  for (const t of m.recurring) if (t.importBatchId === batchId) out.push({ table: 'recurring', del: t.id });
  const b = m.importBatches.find((x) => x.id === batchId);
  if (b) out.push({ table: 'importBatches', put: { ...b, undone: true } });
  return out;
}
