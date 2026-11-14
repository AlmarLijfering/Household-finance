import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useModel, loadModel } from '../lib/useModel';
import { db, ARCHIVE_YEAR } from '../lib/db';
import { useSyncStatus } from '../lib/useSync';
import { Icon, Modal, useToast } from '../components/ui';
import { closeCheck, lastClosed, planClose, yearsOverview } from '../lib/calc/yearclose';
import { closeYear, openArchiveView, reopenYear, uploadDeviceArchive, backToLive } from '../lib/archive';
import { droppedForClosed } from '../lib/sync/sync';
import type { ClosedYear } from '../lib/types';
import { fmtDate, today } from '../lib/util';

const n = (v: number, one: string, many = one + 's') => `${v.toLocaleString('en-GB')} ${v === 1 ? one : many}`;

export default function Years() {
  const m = useModel();
  const toast = useToast();
  const sync = useSyncStatus();
  const pending = useLiveQuery(() => db.pending.count(), []) ?? 0;
  const years = useMemo(() => yearsOverview(m), [m]);
  const open = years.filter((y) => !y.closed);
  const closed = m.closedYears;
  const latest = lastClosed(m);
  const [closing, setClosing] = useState<number | null>(null);
  const [reopening, setReopening] = useState<ClosedYear | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const synced = !!sync.state.location;

  async function run(label: string, f: () => Promise<void>) {
    setBusy(label);
    setErr(null);
    try {
      await f();
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    } finally {
      setBusy(null);
    }
  }

  if (ARCHIVE_YEAR)
    return (
      <div>
        <div className="page-head">
          <h1>{ARCHIVE_YEAR} archive</h1>
          <p className="sub">You are looking at the closed year {ARCHIVE_YEAR}, read-only. Everything in the app shows only this year.</p>
        </div>
        <div className="row wrap">
          <button className="btn primary" onClick={backToLive}>Back to live data</button>
          <button
            className="btn"
            onClick={async () => {
              const { exportAll, downloadXlsx } = await import('../lib/excel/export');
              downloadXlsx(await exportAll(m), `Household Finance ${ARCHIVE_YEAR}.xlsx`);
              toast('Excel file downloaded');
            }}
          >
            <Icon name="download" size={16} /> Download {ARCHIVE_YEAR} as Excel
          </button>
        </div>
      </div>
    );

  return (
    <div>
      <div className="page-head">
        <h1>Years &amp; archive</h1>
        <p className="sub">
          Close a year when it is done. Everything that counts for its budget months moves into an encrypted archive{synced ? ' on OneDrive' : ''}. Balances, rollovers and report totals carry on, and you can open the year read-only any time.
        </p>
      </div>

      {droppedForClosed ? <div className="notice warn">{n(droppedForClosed, 'change')} made on this device to a year that was closed on another device {droppedForClosed === 1 ? 'was' : 'were'} not applied.</div> : null}
      {err ? <div className="notice bad">{err}</div> : null}
      {busy ? <div className="notice info">{busy}…</div> : null}

      <section className="section">
        <div className="section-head"><h2>Open years</h2></div>
        {open.length ? (
          <div className="list">
            {open.map((y) => {
              const chk = closeCheck(m, y.year, today(), synced ? pending : 0);
              return (
                <div className="list-row years-row" key={y.year}>
                  <div className="year-tag">{y.year}</div>
                  <div className="grow">
                    <div className="title">{n(y.transactions, 'transaction')} · {n(y.budgetLines, 'budget line')}{y.yearlyItems ? ` · ${n(y.yearlyItems, 'yearly expense')}` : ''}</div>
                    <div className="meta">{chk.ok ? `December budget month ended ${fmtDate(y.lastDay)}. Ready to close.` : chk.problems[0]}</div>
                  </div>
                  <button className="btn" disabled={!chk.ok || !!busy} onClick={() => setClosing(y.year)}>
                    <Icon name="archive" size={16} /> Close {y.year}…
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="empty"><p>No open years with data.</p></div>
        )}
      </section>

      <section className="section">
        <div className="section-head"><h2>Closed years</h2></div>
        {closed.length ? (
          <div className="list">
            {[...closed].reverse().map((c) => (
              <div className="list-row years-row" key={c.id}>
                <div className="year-tag closed">{c.year}</div>
                <div className="grow">
                  <div className="title">{n(c.counts.transactions ?? 0, 'transaction')} · {n(c.counts.budgetLines ?? 0, 'budget line')}{c.counts.yearlyItems ? ` · ${n(c.counts.yearlyItems, 'yearly expense')}` : ''}</div>
                  <div className="meta">
                    Closed {new Date(c.closedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} ·{' '}
                    {c.storage === 'onedrive' ? `OneDrive, Archive/${c.fileName}` : 'stored on this device only'}
                  </div>
                </div>
                <div className="row wrap" style={{ gap: 6 }}>
                  <button className="btn primary sm" disabled={!!busy} onClick={() => run(`Opening ${c.year}`, () => openArchiveView(c))}>Open read-only</button>
                  {c.storage === 'device' && synced ? (
                    <button className="btn sm" disabled={!!busy} onClick={() => run(`Uploading ${c.year}`, async () => { await uploadDeviceArchive(c); toast(`${c.year} archive is now on OneDrive`); })}>Put on OneDrive</button>
                  ) : null}
                  {latest?.id === c.id ? (
                    <button className="btn sm ghost" disabled={!!busy} onClick={() => setReopening(c)}>Reopen…</button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty"><p>No year has been closed yet.</p></div>
        )}
        <p className="small muted" style={{ marginTop: 8 }}>
          The budget month decides the year, never the date. A salary dated 25 December that counts for January stays open; a payment dated 3 January that counts for December goes with the old year.
        </p>
      </section>

      {closing ? (
        <CloseDialog
          year={closing}
          synced={synced}
          pending={pending}
          busy={!!busy}
          onClose={() => setClosing(null)}
          onYes={() =>
            run(`Closing ${closing}`, async () => {
              const y = closing;
              setClosing(null);
              await closeYear(loadModel, y);
              toast(`${y} is closed and archived`);
            })
          }
        />
      ) : null}

      {reopening ? (
        <Modal
          title={`Reopen ${reopening.year}?`}
          onClose={() => setReopening(null)}
          footer={
            <>
              <button className="btn" onClick={() => setReopening(null)}>Cancel</button>
              <button
                className="btn danger"
                onClick={() =>
                  run(`Reopening ${reopening.year}`, async () => {
                    const c = reopening;
                    setReopening(null);
                    await reopenYear(loadModel, c);
                    toast(`${c.year} is open again`);
                  })
                }
              >
                Reopen {reopening.year}
              </button>
            </>
          }
        >
          <p>All of {reopening.year} comes back into the live data and opening balances return to what they were before closing. You can change it again and close it later.</p>
          {reopening.storage === 'onedrive' ? <p className="small muted">The archive file is kept on OneDrive under a new name (…-reopened-…), as a backup.</p> : null}
        </Modal>
      ) : null}
    </div>
  );
}

function CloseDialog({ year, synced, pending, busy, onClose, onYes }: { year: number; synced: boolean; pending: number; busy: boolean; onClose: () => void; onYes: () => void }) {
  const m = useModel();
  const chk = closeCheck(m, year, today(), synced ? pending : 0);
  const preview = useMemo(() => planClose(m, year, 'preview', synced ? 'onedrive' : 'device'), [m, year, synced]);
  const c = preview.summary.counts;
  const accounts = Object.keys(preview.summary.moved).length;
  return (
    <Modal
      title={`Close ${year}`}
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!chk.ok || busy} onClick={onYes}>
            <Icon name="archive" size={16} /> Close and archive {year}
          </button>
        </>
      }
    >
      <div className="stack">
        <div>
          <h3>Moves to the archive</h3>
          <ul className="plain-list">
            <li>{n(c.transactions, 'transaction')} that count for a {year} budget month</li>
            <li>{n(c.budgetLines, 'budget line')}{c.monthPlans ? ` and ${n(c.monthPlans, 'month setting')}` : ''}</li>
            {c.yearlyItems ? <li>{n(c.yearlyItems, 'yearly expense')}</li> : null}
            {c.planned ? <li>{n(c.planned, 'planned entry', 'planned entries')} dated in {year} or earlier</li> : null}
          </ul>
        </div>
        <div>
          <h3>Stays in the live data</h3>
          <ul className="plain-list">
            <li>Accounts, categories, bills and income. Opening balances of {n(accounts, 'account')} take over the archived money, so every balance stays the same.</li>
            <li>Monthly totals per category, so reports, the year view and rollover into January keep working.</li>
          </ul>
        </div>
        {chk.notes.length ? (
          <div className="notice info">
            <ul className="plain-list">{chk.notes.map((x) => <li key={x}>{x}</li>)}</ul>
          </div>
        ) : null}
        {chk.problems.length ? (
          <div className="notice bad">
            <ul className="plain-list">{chk.problems.map((x) => <li key={x}>{x}</li>)}</ul>
          </div>
        ) : null}
        {!synced ? (
          <div className="notice warn">OneDrive sync is not set up on this device, so the archive is kept on this device only. Set up sync first if you want it on OneDrive; you can also put it there later.</div>
        ) : (
          <p className="small muted">The archive is encrypted with your household passphrase and saved as Archive/household-{year}.json before anything changes here. Edits to {year} that are still waiting on your partner's device will not be applied after the close.</p>
        )}
      </div>
    </Modal>
  );
}
