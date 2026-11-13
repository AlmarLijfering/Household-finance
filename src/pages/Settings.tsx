import { useEffect, useState } from 'react';
import { useModel } from '../lib/useModel';
import { put, commit, db, exportSnapshot, loadSnapshot } from '../lib/db';
import { AmountInput, Field, Icon, Modal, Money, Seg, useToast, Confirm } from '../components/ui';
import { today, fmtDate } from '../lib/util';
import type { Snapshot } from '../lib/types';
import Categories from './Categories';
import { useSyncStatus, runSync } from '../lib/useSync';
import * as G from '../lib/sync/graph';
import * as S from '../lib/sync/sync';
import { changePassphrase, createKeyring, rotateKey, unlock } from '../lib/sync/crypto';

type Tab = 'sync' | 'categories' | 'household' | 'data';

export default function Settings() {
  const [tab, setTab] = useState<Tab>('sync');
  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <p className="sub">Sync and sharing, categories, currencies and your data.</p>
        </div>
        <Seg value={tab} onChange={setTab} options={[['sync', 'Sync & sharing'], ['categories', 'Categories'], ['household', 'Household & currency'], ['data', 'Data']]} />
      </div>
      {tab === 'sync' ? <SyncSettings /> : tab === 'categories' ? <Categories /> : tab === 'household' ? <Household /> : <DataSettings />}
    </div>
  );
}

// ------------------------------------------------------------------ sync
function SyncSettings() {
  const toast = useToast();
  const st = useSyncStatus();
  const [clientId, setClientId] = useState(G.clientId());
  const [who, setWho] = useState<string | null>(null);
  const [shared, setShared] = useState<G.Location[] | null>(null);
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pass, setPass] = useState('');
  const [pass2, setPass2] = useState('');
  const [recovery, setRecovery] = useState<string | null>(null);
  const [needsKey, setNeedsKey] = useState<'create' | 'unlock' | null>(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [perms, setPerms] = useState<Awaited<ReturnType<typeof G.permissions>>['value'] | null>(null);
  const [backups, setBackups] = useState<G.DriveItem[] | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [rotate, setRotate] = useState<'pass' | 'key' | null>(null);
  const [restore, setRestore] = useState<string | null>(null);
  const [disc, setDisc] = useState(false);
  const loc = st.state.location;

  useEffect(() => {
    const e = sessionStorage.getItem('pfm.signinError');
    if (e) {
      setErr(`Sign-in did not complete: ${e}. Check that the redirect URI above is registered exactly like this, as a Single-page application.`);
      sessionStorage.removeItem('pfm.signinError');
    }
    if (!G.clientId()) return;
    G.currentAccount().then((a) => setWho(a ? a.username : null));
  }, []);
  useEffect(() => {
    if (!loc) return;
    (async () => {
      let ring;
      try {
        ring = await S.readKeyring(loc);
      } catch (e: any) {
        // Could not read the folder: never offer to create a new passphrase on top of an existing one.
        setNeedsKey(null);
        setErr(String(e?.message ?? e));
        return;
      }
      const has = await S.restoreKey();
      if (!ring) setNeedsKey('create');
      else if (!has) setNeedsKey('unlock');
      else setNeedsKey(null);
    })();
  }, [loc, st.phase]);

  const run = async (label: string, f: () => Promise<void>) => {
    setBusy(label);
    setErr(null);
    try {
      await f();
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="stack">
      <div className="notice info">
        Household data lives in one encrypted file in a OneDrive folder owned by one of you and shared with the other. Each of you signs in with your own personal Microsoft account. Without sync, everything stays on this device only.
      </div>

      <section className="panel">
        <h3>1 · Microsoft app registration</h3>
        <p className="small muted" style={{ margin: '4px 0 12px' }}>
          A free app registration in Microsoft Entra gives this app permission to ask you to sign in. Set it up once (see SETUP.md), then paste its Application (client) ID here. The same ID is used on every device.
        </p>
        <p className="small" style={{ margin: '0 0 12px' }}>
          Redirect URI to register (platform “Single-page application”): <code className="code-inline">{G.redirectUri()}</code>
        </p>
        <div className="row wrap">
          <input className="input" style={{ flex: '1 1 320px' }} value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="00000000-0000-0000-0000-000000000000" aria-label="Client ID" />
          <button className="btn" onClick={() => { localStorage.setItem('pfm.clientId', clientId.trim()); location.reload(); }}>Save</button>
        </div>
      </section>

      <section className="panel">
        <h3>2 · Sign in</h3>
        <div className="row wrap" style={{ marginTop: 8 }}>
          {who ? (
            <>
              <span>Signed in as <b>{who}</b></span>
              <span className="spacer" />
              <button className="btn" onClick={() => G.signOut()}>Sign out</button>
            </>
          ) : (
            <button className="btn primary" disabled={!G.clientId()} onClick={() => run('signin', G.signIn)}>
              Sign in with Microsoft
            </button>
          )}
        </div>
      </section>

      {who ? (
        <section className="panel">
          <h3>3 · Household folder</h3>
          {loc ? (
            <div className="stack" style={{ marginTop: 8 }}>
              <div className="row wrap">
                <span>
                  Using <b>{loc.name}</b> {loc.owner === 'me' ? '(in your OneDrive)' : '(shared with you)'}
                </span>
                <span className="spacer" />
                <button className="btn sm ghost" onClick={() => setDisc(true)}>Disconnect this device</button>
              </div>
              <div className="small muted">
                Revision {st.state.revision} · last sync {st.state.lastSyncAt ? new Date(st.state.lastSyncAt).toLocaleString('en-GB') : 'never'} · last backup {st.state.lastBackupAt ? new Date(st.state.lastBackupAt).toLocaleString('en-GB') : 'none yet'}
              </div>
              {st.state.lastError ? <div className="notice bad">{st.state.lastError}</div> : null}
            </div>
          ) : (
            <div className="grid-2e" style={{ marginTop: 8 }}>
              <div className="stack">
                <b>I keep the household folder</b>
                <p className="small muted">Creates “Household Finance” with Data, Reports and Backups in your OneDrive.</p>
                <button className="btn primary" disabled={!!busy} onClick={() => run('create', async () => { const l = await G.createHouseholdFolder(); await S.connectLocation(l); await S.loadState(); toast('Folder ready'); })}>
                  Create household folder
                </button>
              </div>
              <div className="stack">
                <b>My partner shared the folder with me</b>
                <div className="row wrap">
                  <button className="btn" disabled={!!busy} onClick={() => run('shared', async () => setShared(await G.sharedFolders()))}>Find shared folders</button>
                </div>
                {shared ? (
                  shared.length ? (
                    <div className="list">
                      {shared.map((s) => (
                        <div className="list-row" key={s.folderId}>
                          <div className="grow title">{s.name}</div>
                          <button className="btn sm" onClick={() => run('join', async () => { await S.connectLocation(s); await S.loadState(); })}>Use this folder</button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="small muted">No shared folders found. Paste the sharing link instead.</p>
                  )
                ) : null}
                <div className="row">
                  <input className="input" placeholder="Or paste the OneDrive sharing link" value={link} onChange={(e) => setLink(e.target.value)} aria-label="Sharing link" />
                  <button className="btn" disabled={!link} onClick={() => run('link', async () => { await S.connectLocation(await G.resolveShareLink(link)); await S.loadState(); })}>Use</button>
                </div>
              </div>
            </div>
          )}
        </section>
      ) : null}

      {loc && needsKey ? (
        <section className="panel" style={{ borderColor: 'var(--ink)' }}>
          <h3>4 · {needsKey === 'create' ? 'Choose a household passphrase' : 'Unlock with the household passphrase'}</h3>
          <p className="small muted" style={{ margin: '4px 0 12px' }}>
            {needsKey === 'create'
              ? 'Everything in the Data and Backups folders is encrypted with a key that only this passphrase (or the recovery code) can open. Share the passphrase with your partner in person. Microsoft cannot read the data, and neither can anyone who gets hold of the files.'
              : 'Enter the passphrase your household chose, or the recovery code.'}
          </p>
          <div className="form-grid">
            <Field label="Passphrase"><input className="input" type="password" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="new-password" /></Field>
            {needsKey === 'create' ? <Field label="Repeat passphrase"><input className="input" type="password" value={pass2} onChange={(e) => setPass2(e.target.value)} autoComplete="new-password" /></Field> : null}
          </div>
          {needsKey === 'create' && pass && pass.length < 12 ? <p className="small" style={{ color: 'var(--plum)', marginTop: 6 }}>Use at least 12 characters — a short sentence works well.</p> : null}
          <div className="row" style={{ marginTop: 12 }}>
            <button
              className="btn primary"
              disabled={!!busy || (needsKey === 'create' ? pass.length < 12 || pass !== pass2 : !pass)}
              onClick={() =>
                run('key', async () => {
                  if (needsKey === 'create') {
                    const { keyring, key, recovery } = await createKeyring(pass);
                    await S.writeKeyring(loc, keyring, null);
                    await S.persistKey(key, keyring);
                    setRecovery(recovery);
                    // first upload: everything on this device becomes the household snapshot
                    await S.forceResave();
                  } else {
                    const r = await S.readKeyring(loc);
                    if (!r) throw new Error('No keyring found in the household folder.');
                    const key = await unlock(r.ring, pass);
                    await S.persistKey(key, r.ring);
                    await db.pending.clear(); // joining: the household file is the source of truth
                    await runSync();
                  }
                  setPass('');
                  setPass2('');
                  setNeedsKey(null);
                })
              }
            >
              <Icon name="lock" size={16} /> {needsKey === 'create' ? 'Encrypt and upload' : 'Unlock and sync'}
            </button>
          </div>
        </section>
      ) : null}

      {loc && !needsKey ? (
        <>
          <section className="panel">
            <div className="row wrap">
              <h3 className="grow">Sync</h3>
              <button className="btn" onClick={() => runSync()} disabled={st.phase === 'syncing'}>Sync now</button>
            </div>
            <p className="small muted" style={{ marginTop: 4 }}>
              Status: {st.message || st.phase}. Saves are conditional: if your partner saved first, the app loads their version, replays your changes on top and saves again.
            </p>
          </section>

          {loc.owner === 'me' ? (
            <section className="panel">
              <h3>Who has access</h3>
              <div className="row wrap" style={{ marginTop: 8 }}>
                <input className="input" style={{ flex: '1 1 260px' }} type="email" placeholder="partner@outlook.com" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} aria-label="Email to invite" />
                <button className="btn" disabled={!inviteEmail || !!busy} onClick={() => run('invite', async () => { await G.invite(loc, inviteEmail); setInviteEmail(''); toast('Invitation sent'); setPerms((await G.permissions(loc)).value); })}>Invite with edit access</button>
                <button className="btn ghost" onClick={() => run('perms', async () => setPerms((await G.permissions(loc)).value))}>Show access list</button>
              </div>
              {perms ? (
                <div className="list" style={{ marginTop: 12 }}>
                  {perms.map((p) => (
                    <div className="list-row" key={p.id}>
                      <div className="grow">
                        <div className="title">{p.grantedToV2?.user?.displayName ?? p.grantedTo?.user?.displayName ?? 'Link'}</div>
                        <div className="meta">{p.grantedToV2?.user?.email ?? ''} · {p.roles.join(', ')}</div>
                      </div>
                      {!p.roles.includes('owner') ? <button className="btn sm danger" onClick={() => run('revoke', async () => { await G.revoke(loc, p.id); setPerms((await G.permissions(loc)).value); toast('Access removed. Rotate the key next.'); })}>Remove access</button> : null}
                    </div>
                  ))}
                </div>
              ) : null}
              <p className="small muted" style={{ marginTop: 8 }}>When someone leaves: remove their access, then rotate the key below. Copies they already downloaded cannot be recalled.</p>
            </section>
          ) : null}

          <section className="panel">
            <h3>Encryption</h3>
            <div className="actions" style={{ marginTop: 8 }}>
              <button className="btn" onClick={() => setRotate('pass')}>Change passphrase</button>
              <button className="btn" onClick={() => setRotate('key')}>Rotate key</button>
              <button className="btn ghost" onClick={async () => { await S.forgetKey(); setNeedsKey('unlock'); }}>Lock this device</button>
            </div>
          </section>

          <section className="panel">
            <div className="row wrap">
              <h3 className="grow">Backups</h3>
              <button className="btn sm" onClick={() => run('backups', async () => setBackups(await S.listBackups()))}>Show backups</button>
            </div>
            <p className="small muted">A dated encrypted snapshot is written to Backups at most once a day after a successful sync.</p>
            {backups ? (
              <div className="list" style={{ marginTop: 8, maxHeight: 300, overflow: 'auto' }}>
                {backups.map((b) => (
                  <div className="list-row" key={b.id}>
                    <div className="grow">
                      <div className="title">{b.name}</div>
                      <div className="meta">{b.lastModifiedDateTime ? new Date(b.lastModifiedDateTime).toLocaleString('en-GB') : ''} · {Math.round((b.size ?? 0) / 1024)} KB</div>
                    </div>
                    <button className="btn sm" onClick={() => setRestore(b.name)}>Restore</button>
                  </div>
                ))}
                {!backups.length ? <div className="list-row muted">No backups yet.</div> : null}
              </div>
            ) : null}
          </section>

          <section className="panel">
            <h3>Check the write path</h3>
            <p className="small muted" style={{ margin: '4px 0 8px' }}>Writes a test file and then tries to overwrite it with an outdated version. Run it once from each of your accounts before relying on shared edits.</p>
            <button className="btn" disabled={!!busy} onClick={() => run('test', async () => setTestResult((await G.staleWriteTest(loc)).detail))}>Run stale-write test</button>
            {testResult ? <div className={`notice ${/rejected/.test(testResult) ? 'good' : 'bad'}`} style={{ marginTop: 8 }}>{testResult}</div> : null}
          </section>
        </>
      ) : null}

      {busy ? <p className="muted small">Working…</p> : null}
      {err ? <div className="notice bad">{err}</div> : null}

      {recovery ? (
        <Modal title="Save your recovery code" onClose={() => setRecovery(null)} footer={<button className="btn primary" onClick={() => setRecovery(null)}>I have written it down</button>}>
          <p>If both of you forget the passphrase, this code is the only way to open the household data. Write it down and keep it somewhere safe, away from your devices. It is shown only once.</p>
          <div className="code-box" style={{ marginTop: 16 }}>{recovery}</div>
        </Modal>
      ) : null}
      {rotate && loc ? <RotateDialog kind={rotate} loc={loc} onRecovery={setRecovery} onClose={() => setRotate(null)} /> : null}
      {restore ? <Confirm title={`Restore ${restore}?`} body="The household data is replaced by this backup for both of you. Changes made after the backup are lost, but the current version stays available as the next daily backup." confirm="Restore backup" danger onClose={() => setRestore(null)} onYes={() => run('restore', async () => { await S.restoreBackup(restore); toast('Backup restored'); })} /> : null}
      {disc ? <Confirm title="Disconnect this device?" body="Sync stops on this device and the key is removed from it. Data on OneDrive is not touched, and data on this device stays until you erase it under Data." confirm="Disconnect" onClose={() => setDisc(false)} onYes={async () => { await S.disconnect(); }} /> : null}
    </div>
  );
}

function RotateDialog({ kind, loc, onClose, onRecovery }: { kind: 'pass' | 'key'; loc: G.Location; onClose: () => void; onRecovery: (r: string) => void }) {
  const toast = useToast();
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      title={kind === 'pass' ? 'Change passphrase' : 'Rotate the household key'}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button
            className="btn primary"
            disabled={busy || !cur || next.length < 12}
            onClick={async () => {
              setBusy(true);
              setErr(null);
              try {
                const r = await S.readKeyring(loc);
                if (!r) throw new Error('No keyring found');
                if (kind === 'pass') {
                  const ring = await changePassphrase(r.ring, cur, next);
                  await S.writeKeyring(loc, ring, r.etag);
                  const key = await unlock(ring, next);
                  await S.persistKey(key, ring);
                  toast('Passphrase changed');
                } else {
                  const { keyring, key, recovery } = await rotateKey(r.ring, cur, next);
                  await S.writeKeyring(loc, keyring, r.etag);
                  await S.persistKey(key, keyring);
                  await S.forceResave();
                  onRecovery(recovery);
                  toast('New key in use');
                }
                onClose();
              } catch (e: any) {
                setErr(String(e?.message ?? e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {kind === 'pass' ? 'Change passphrase' : 'Rotate key'}
          </button>
        </>
      }
    >
      <p className="small muted">
        {kind === 'pass'
          ? 'The data key stays the same; only the passphrase that unlocks it changes. Your partner needs the new passphrase on their next sync.'
          : 'A new data key re-encrypts the household file, with a new passphrase and recovery code. Use this after removing someone’s access. Older backups stay readable.'}
      </p>
      <div className="form-grid" style={{ marginTop: 12 }}>
        <Field label="Current passphrase or recovery code"><input className="input" type="password" value={cur} onChange={(e) => setCur(e.target.value)} /></Field>
        <Field label="New passphrase (12+ characters)"><input className="input" type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" /></Field>
      </div>
      {err ? <div className="notice bad" style={{ marginTop: 12 }}>{err}</div> : null}
    </Modal>
  );
}

// ------------------------------------------------------------------ household
function Household() {
  const m = useModel();
  const toast = useToast();
  const [s, setS] = useState(m.settings);
  const [cur, setCur] = useState('');
  const [rate, setRate] = useState({ currency: m.settings.currencies.find((c) => c !== m.settings.baseCurrency) ?? 'EUR', date: today(), rate: '' });
  const latest = (c: string) => m.ratesByCurrency.get(c)?.slice(-1)[0];
  return (
    <div className="stack">
      <section className="panel">
        <div className="form-grid">
          <Field label="Household name"><input className="input" value={s.householdName} onChange={(e) => setS({ ...s, householdName: e.target.value })} /></Field>
          <Field label="Base currency" help="All reports and budgets are in this currency">
            <select className="input" value={s.baseCurrency} onChange={(e) => setS({ ...s, baseCurrency: e.target.value })}>
              {s.currencies.map((c) => <option key={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Budget months" help="You can still change the dates of any single month on the Budget page">
            <select className="input" value={s.budgetPeriods ?? 'weeks'} onChange={(e) => setS({ ...s, budgetPeriods: e.target.value as 'weeks' | 'calendar' })}>
              <option value="weeks">Whole weeks — start on the Monday nearest the 1st</option>
              <option value="calendar">Calendar months — 1st to last day</option>
            </select>
          </Field>
          <Field label="Default account for new transactions">
            <select className="input" value={s.defaultAccountId ?? ''} onChange={(e) => setS({ ...s, defaultAccountId: e.target.value || undefined })}>
              <option value="">First current account</option>
              {m.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </Field>
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn primary" onClick={async () => { await put('settings', s); toast('Saved'); }}>Save</button>
        </div>
      </section>
      <section className="panel">
        <h3>Currencies & exchange rates</h3>
        <p className="small muted">Rates are base-currency units per 1 unit of the other currency (e.g. 1 EUR = 4.97 RON). The rate on or before a transaction’s date is used.</p>
        <table className="t" style={{ marginTop: 8 }}>
          <thead><tr><th>Currency</th><th className="r">Latest rate</th><th>Date</th><th className="r">Rates stored</th></tr></thead>
          <tbody>
            {s.currencies.map((c) => (
              <tr key={c}><td>{c}{c === s.baseCurrency ? <span className="badge" style={{ marginLeft: 8 }}>base</span> : null}</td><td className="r">{c === s.baseCurrency ? '1' : latest(c)?.rate ?? '—'}</td><td>{latest(c) ? fmtDate(latest(c)!.date, true) : ''}</td><td className="r">{m.ratesByCurrency.get(c)?.length ?? 0}</td></tr>
            ))}
          </tbody>
        </table>
        <div className="row wrap" style={{ marginTop: 12 }}>
          <input className="input" style={{ width: 100 }} placeholder="USD" value={cur} onChange={(e) => setCur(e.target.value.toUpperCase().slice(0, 3))} aria-label="New currency" />
          <button className="btn" disabled={cur.length !== 3} onClick={async () => { const n = { ...s, currencies: Array.from(new Set([...s.currencies, cur])) }; setS(n); await put('settings', n); setCur(''); }}>Add currency</button>
          <span className="spacer" />
          <select className="input" style={{ width: 100 }} value={rate.currency} onChange={(e) => setRate({ ...rate, currency: e.target.value })} aria-label="Rate currency">
            {s.currencies.filter((c) => c !== s.baseCurrency).map((c) => <option key={c}>{c}</option>)}
          </select>
          <input className="input" style={{ width: 160 }} type="date" value={rate.date} onChange={(e) => setRate({ ...rate, date: e.target.value })} aria-label="Rate date" />
          <input className="input num" style={{ width: 110 }} placeholder="4.9750" value={rate.rate} onChange={(e) => setRate({ ...rate, rate: e.target.value })} aria-label="Rate" />
          <button className="btn" disabled={!Number(rate.rate.replace(',', '.'))} onClick={async () => { await put('fxRates', { id: `${rate.currency}:${rate.date}`, currency: rate.currency, date: rate.date, rate: Number(rate.rate.replace(',', '.')), updatedAt: '' }); setRate({ ...rate, rate: '' }); toast('Rate saved'); }}>Save rate</button>
        </div>
      </section>
    </div>
  );
}

// ------------------------------------------------------------------ data
function DataSettings() {
  const m = useModel();
  const toast = useToast();
  const [erase, setErase] = useState(false);
  return (
    <div className="stack">
      <section className="panel">
        <h3>Export to Excel</h3>
        <p className="small muted" style={{ margin: '4px 0 8px' }}>One workbook with every transaction, account (with bank balance and difference), category, budget line, bill and income, yearly expense and planned entry, each as an Excel table you can filter and pivot.</p>
        <button className="btn primary" onClick={async () => { const { exportAll, downloadXlsx } = await import('../lib/excel/export'); downloadXlsx(await exportAll(m), `Household Finance export ${today()}.xlsx`); toast('Excel export downloaded'); }}>
          <Icon name="download" size={16} /> Export everything to Excel
        </button>
      </section>
      <section className="panel">
        <h3>Backup copy (JSON)</h3>
        <p className="small muted" style={{ margin: '4px 0 8px' }}>Every record in the app’s own format, for restoring below. It is not encrypted — keep it somewhere private.</p>
        <button className="btn" onClick={async () => { const s = await exportSnapshot(0, []); const url = URL.createObjectURL(new Blob([JSON.stringify(s)], { type: 'application/json' })); const a = document.createElement('a'); a.href = url; a.download = `household-finance-${today()}.json`; a.click(); }}>
          <Icon name="download" size={16} /> Download data
        </button>
      </section>
      <section className="panel">
        <h3>Restore from an exported copy</h3>
        <p className="small muted" style={{ margin: '4px 0 8px' }}>Replaces everything on this device. With sync on, the restored data is uploaded as the new household version.</p>
        <label className="btn">
          Choose file
          <input type="file" accept=".json" hidden onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            const snap = JSON.parse(await f.text()) as Snapshot;
            if (snap.format !== 'pfm-snapshot') return toast('That file is not a Household Finance export');
            await loadSnapshot(snap);
            const ops = Object.entries(snap.data).flatMap(([t, rows]) => (rows as any[]).map((r) => ({ table: t as any, put: r })));
            await commit(ops, 'Restore export');
            toast('Data restored');
          }} />
        </label>
      </section>
      <section className="panel">
        <h3>Erase this device</h3>
        <p className="small muted" style={{ margin: '4px 0 8px' }}>
          Removes all data and keys from this browser. {m.transactions.length} transactions are stored here. OneDrive is not touched.
        </p>
        <button className="btn danger" onClick={() => setErase(true)}>Erase data on this device</button>
      </section>
      {erase ? <Confirm title="Erase all data on this device?" body="Unsynced changes are lost. Data on OneDrive is not touched." confirm="Erase" danger onClose={() => setErase(false)} onYes={async () => { await db.delete(); localStorage.clear(); location.reload(); }} /> : null}
    </div>
  );
}

void AmountInput;
