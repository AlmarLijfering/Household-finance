import { isClosedMonth } from './calc/yearclose';
// Mass update of transactions. The type (money in, money out, transfer) never changes.
import type { ID, Transaction } from './types';
import { kindOf, categoryActiveOn, type Model } from './calc/model';
import { lastBookableDate, lastBookableMonth, monthOfDate } from './calc/period';
import { nowIso } from './util';
import type { Change } from './importer/commit';

export interface BulkChanges {
  accountId?: ID;
  categoryId?: ID | null; // null = remove the category
  budgetMonth?: string | null; // null = count for the month of the date again
  payee?: string;
  date?: string;
}

export interface BulkResult {
  changes: Change[];
  before: Transaction[];
  updated: number;
  skipped: Array<{ reason: string; count: number }>;
}

export function planBulk(m: Model, ids: ID[], c: BulkChanges): BulkResult {
  const byId = new Map(m.transactions.map((t) => [t.id, t]));
  const out = new Map<ID, Transaction>(); // id → new version
  const skipped = new Map<string, number>();
  const skip = (r: string) => skipped.set(r, (skipped.get(r) ?? 0) + 1);
  const at = nowIso();
  const maxMonth = lastBookableMonth(m);
  const maxDate = lastBookableDate(m);
  const target = c.accountId ? m.accountById.get(c.accountId) : undefined;
  const catKind = c.categoryId ? kindOf(m, c.categoryId) : null;

  // work per "item": a transfer is handled as its pair
  const seen = new Set<ID>();
  for (const id of ids) {
    const t = byId.get(id);
    if (!t || seen.has(id)) continue;
    const pair = t.transferId ? m.transactions.find((x) => x.transferId === t.transferId && x.id !== t.id) : undefined;
    seen.add(id);
    if (pair) seen.add(pair.id);
    const items = [t, ...(pair ? [pair] : [])].map((x) => ({ ...(out.get(x.id) ?? x) }));
    const self = items[0];
    const other = items[1];
    let changed = false;

    if (c.accountId !== undefined && c.accountId !== self.accountId) {
      const from = m.accountById.get(self.accountId);
      if (!target) skip('Account not found');
      else if (other && other.accountId === c.accountId) skip('Transfer would go to the same account on both sides');
      else if (from && from.currency !== target.currency) skip(`Different currency (${from.currency} → ${target.currency})`);
      else {
        self.accountId = c.accountId;
        if (other) other.transferAccountId = c.accountId;
        changed = true;
      }
    }

    if (c.categoryId !== undefined) {
      const outSide = pair ? (self.amount < 0 ? self : other!) : self;
      const newCat = c.categoryId ? m.categoryById.get(c.categoryId) : undefined;
      if (self.splits?.length) skip('Split transactions keep their split categories');
      else if (newCat && !categoryActiveOn(newCat, c.date ?? self.date)) skip(`“${newCat.name}” ended before the transaction date`);
      else if (pair && c.categoryId && catKind !== 'reservation' && catKind !== 'transfer') skip('Transfers only take reservation or transfer categories');
      else if (!pair && c.categoryId && self.amount > 0 && catKind !== 'income' && catKind !== 'opening' && catKind !== 'transfer') skip('Money in needs an income category');
      else if (!pair && c.categoryId && self.amount < 0 && (catKind === 'income' || catKind === 'opening')) skip('Money out cannot take an income category');
      else if (outSide.categoryId !== c.categoryId) {
        outSide.categoryId = c.categoryId;
        changed = true;
      }
    }

    if (c.date !== undefined && c.date !== self.date) {
      const curCat = items.map((x) => (x.categoryId ? m.categoryById.get(x.categoryId) : undefined)).find((x) => x && !categoryActiveOn(x, c.date!));
      if (c.date > maxDate) skip('Date is after the last day open for booking');
      else if (!items.some((x) => x.budgetMonth) && isClosedMonth(m, monthOfDate(m, c.date))) skip('The new date is in a closed year');
      else if (curCat) skip(`Its category “${curCat.name}” ended before the new date`);
      else {
        for (const x of items) x.date = c.date;
        changed = true;
      }
    }

    if (c.budgetMonth !== undefined) {
      const want = c.budgetMonth;
      if (want && want > maxMonth) skip('Budget month is not open for booking yet');
      else if (want && isClosedMonth(m, want)) skip('That budget month is in a closed year');
      else
        for (const x of items) {
          const v = want && want !== monthOfDate(m, x.date) ? want : undefined;
          if (x.budgetMonth !== v) {
            x.budgetMonth = v;
            x.monthConfirmed = v ? undefined : true;
            changed = true;
          }
        }
    } else if (c.date !== undefined) {
      // a new date in the month a transaction was already counted for needs no separate setting
      for (const x of items) if (x.budgetMonth && x.budgetMonth === monthOfDate(m, x.date)) x.budgetMonth = undefined;
    }

    if (c.payee !== undefined && c.payee !== self.payee) {
      for (const x of items) x.payee = c.payee || undefined;
      changed = true;
    }

    if (changed) for (const x of items) out.set(x.id, { ...x, updatedAt: at });
  }

  const before = [...out.keys()].map((id) => byId.get(id)!);
  return {
    changes: [...out.values()].map((t) => ({ table: 'transactions' as const, put: t })),
    before,
    updated: new Set([...out.values()].map((t) => t.transferId ?? t.id)).size,
    skipped: [...skipped.entries()].map(([reason, count]) => ({ reason, count }))
  };
}
