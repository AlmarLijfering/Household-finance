import { useMemo, useState } from 'react';
import type { Model } from '../lib/calc/model';
import type { Recurring } from '../lib/types';
import { billsInPeriod, draftFor, signedAmount, type BillInPeriod } from '../lib/calc/recurring';
import { monthOfDate } from '../lib/calc/period';
import { fmtDate, today, cx, daysBetween, monthLabel } from '../lib/util';
import { Icon, Modal, Money } from './ui';
import { RecurringForm, FREQ } from '../pages/Recurring';
import { useTxEditor } from '../App';

const every = (r: Recurring) => `every ${r.interval > 1 ? `${r.interval} ` : ''}${FREQ[r.frequency]}`;

/** "Paid 3 Nov", "Due 5 Dec", "3 days late" or "Not paid" for one bill in the period. */
function statusOf(b: BillInPeriod, now: string): { text: string; tone: 'paid' | 'due' | 'late' } {
  if (b.paid) return { text: `Paid ${fmtDate(b.paid.date)}`, tone: 'paid' };
  if (!b.due) return { text: 'Not paid', tone: 'late' };
  const late = daysBetween(b.due, now);
  if (late > 0) return { text: late > 45 ? 'Not paid' : `${late} day${late === 1 ? '' : 's'} late`, tone: 'late' };
  return { text: late === 0 ? 'Due today' : `Due ${fmtDate(b.due)}`, tone: 'due' };
}

/**
 * Icon on a budget line (one budget month) or yearly item (one year): the bills that fall in
 * that period and whether they are paid. Opens the list to pay or edit them, or add a new one.
 */
export function BillsBadge({ m, categoryId, name, period, defaults, readOnly }: { m: Model; categoryId: string; name: string; period: { month: string } | { year: number }; defaults?: Partial<Recurring>; readOnly?: boolean }) {
  const now = today();
  const bills = useMemo(() => billsInPeriod(m, categoryId, period), [m, categoryId, 'month' in period ? period.month : period.year]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Recurring | 'new' | null>(null);
  const openTx = useTxEditor();
  if (!bills.length && readOnly) return null;
  const cat = m.categoryById.get(categoryId);
  const income = m.groupById.get(cat?.groupId ?? '')?.kind === 'income';
  const when = 'month' in period ? monthLabel(period.month) : String(period.year);
  const unpaid = bills.filter((b) => !b.paid);
  const late = unpaid.some((b) => statusOf(b, now).tone === 'late');
  const tip = bills.length ? bills.map((b) => `${b.paid ? '✓' : '○'} ${b.rec.name}: ${statusOf(b, now).text}`).join('\n') : `Add a bill or subscription for ${name}`;
  const pay = (b: BillInPeriod) => {
    const date = !b.due || b.due < now ? now : b.due;
    const d = { ...draftFor(b.rec, now), date, dueDate: b.due ?? undefined };
    // count it for the month it belongs to, even when paid later
    const month = b.month ?? undefined;
    setOpen(false);
    openTx({ ...d, budgetMonth: month && month !== monthOfDate(m, date) ? month : undefined });
  };
  return (
    <span className="bills-badge-wrap" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        className={cx('icon-btn bills-badge', !bills.length ? 'none' : unpaid.length ? (late ? 'late' : 'open') : 'paid')}
        title={tip}
        aria-label={bills.length ? `${name}: ${bills.length - unpaid.length} of ${bills.length} bill${bills.length === 1 ? '' : 's'} paid in ${when}` : `Add a bill or subscription to ${name}`}
        onClick={() => (bills.length ? setOpen(true) : setForm('new'))}
      >
        <Icon name="repeat" size={14} />
        {bills.length ? <span className="bills-count">{unpaid.length ? unpaid.length : <Icon name="check" size={9} />}</span> : null}
      </button>
      {open ? (
        <Modal
          title={`Bills · ${name}`}
          onClose={() => setOpen(false)}
          footer={
            <>
              {!readOnly ? (
                <button className="btn ghost" onClick={() => setForm('new')}>
                  <Icon name="plus" size={14} /> New bill
                </button>
              ) : null}
              <span className="spacer" />
              <button className="btn primary" onClick={() => setOpen(false)}>Close</button>
            </>
          }
        >
          <p className="small muted" style={{ marginTop: 0 }}>
            {cat?.code} · {when}: {bills.length - unpaid.length} of {bills.length} paid.
          </p>
          <div className="bill-status-list">
            {bills.map((b) => {
              const st = statusOf(b, now);
              return (
                <div key={b.rec.id} className="bill-status">
                  <span className={cx('bill-dot', st.tone)} aria-hidden="true">{st.tone === 'paid' ? <Icon name="check" size={11} /> : null}</span>
                  <button type="button" className="bill-status-name" disabled={readOnly} title="Edit this bill" onClick={() => setForm(b.rec)}>
                    {b.rec.name}
                    <small>{every(b.rec)} · {m.accountById.get(b.rec.accountId)?.name}</small>
                  </button>
                  <span className={cx('bill-status-when', st.tone)}>{st.text}</span>
                  <Money v={b.paid ? b.paid.amount : signedAmount(b.rec)} />
                  {!b.paid && !readOnly ? (
                    <button className="btn sm" onClick={() => pay(b)}>{b.rec.kind === 'income' ? 'Receive' : 'Pay'}</button>
                  ) : (
                    <span />
                  )}
                </div>
              );
            })}
          </div>
        </Modal>
      ) : null}
      {form ? (
        <RecurringForm
          m={m}
          initial={form === 'new' ? undefined : form}
          defaults={{ name: cat?.name ?? name, categoryId, kind: income ? 'income' : 'bill', ...defaults }}
          onClose={() => setForm(null)}
        />
      ) : null}
    </span>
  );
}
