import { useSyncStatus } from '../lib/useSync';
import { dismissConflict, keepTheirs } from '../lib/sync/sync';
import { Modal } from './ui';

const TABLE_LABEL: Record<string, string> = {
  transactions: 'Transaction',
  budgetLines: 'Budget line',
  accounts: 'Account',
  categories: 'Category',
  recurring: 'Recurring item',
  yearlyItems: 'Yearly item',
  planned: 'Planned entry'
};

function describe(rec: any): string {
  if (!rec) return 'deleted';
  return [rec.date, rec.name ?? rec.payee ?? rec.label ?? rec.memo, typeof rec.amount === 'number' ? (rec.amount / 100).toFixed(2) : typeof rec.estimate === 'number' ? (rec.estimate / 100).toFixed(2) : '']
    .filter(Boolean)
    .join(' · ');
}

/** After a stale save, lists local edits that overwrote something your partner changed. */
export function ConflictReview() {
  const s = useSyncStatus();
  if (!s.conflicts.length) return null;
  return (
    <Modal title="Review overlapping changes" onClose={() => s.conflicts.forEach(dismissConflict)} wide footer={<button className="btn primary" onClick={() => s.conflicts.forEach(dismissConflict)}>Keep all my changes</button>}>
      <p className="muted" style={{ marginBottom: 12 }}>
        While you were editing, the household file was also changed on another device. Your edits were applied on top of the newer version. For these records both of you made a change — choose which to keep.
      </p>
      <div className="list">
        {s.conflicts.map((c) => (
          <div className="list-row" key={c.op.opId}>
            <div className="grow">
              <div className="title">{TABLE_LABEL[c.op.table] ?? c.op.table}</div>
              <div className="meta">Yours: {c.op.kind === 'delete' ? 'deleted' : describe(c.op.record)}</div>
              <div className="meta">Other device: {describe(c.remote)}</div>
            </div>
            <button className="btn sm" onClick={() => dismissConflict(c)}>Keep mine</button>
            <button className="btn sm" onClick={() => keepTheirs(c)}>Keep theirs</button>
          </div>
        ))}
      </div>
    </Modal>
  );
}
