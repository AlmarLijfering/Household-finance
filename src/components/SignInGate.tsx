import { useState } from 'react';
import { useSyncStatus } from '../lib/useSync';
import { knownAccount, signIn } from '../lib/sync/graph';
import { ARCHIVE_YEAR } from '../lib/db';
import { Icon } from './ui';

const skipped = () => {
  try {
    return !!sessionStorage.getItem('pfm.skipSignIn');
  } catch {
    return false;
  }
};

/**
 * When this device is connected to a household but Microsoft signed it out, ask to sign in
 * before working. Skipping needs a second, explicit choice and lasts until the browser closes.
 */
export function SignInGate({ pending }: { pending: number }) {
  const s = useSyncStatus();
  const [skip, setSkip] = useState(skipped);
  const [confirmSkip, setConfirmSkip] = useState(false);
  const [busy, setBusy] = useState(false);
  if (ARCHIVE_YEAR || skip || s.phase !== 'signed-out' || !s.state.location) return null;
  const who = knownAccount();
  const last = s.state.lastSyncAt ? new Date(s.state.lastSyncAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : null;
  const go = async () => {
    setBusy(true);
    try {
      await signIn();
    } catch {
      setBusy(false);
    }
  };
  const goSwitch = async () => {
    setBusy(true);
    try {
      await signIn({ switchAccount: true });
    } catch {
      setBusy(false);
    }
  };
  const stayOffline = () => {
    try {
      sessionStorage.setItem('pfm.skipSignIn', '1');
    } catch {}
    setSkip(true);
  };

  return (
    <div className="overlay gate" role="presentation">
      <div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="gate-title">
        {!confirmSkip ? (
          <>
            <div className="dialog-head">
              <h2 id="gate-title">Sign in to keep your household in sync</h2>
            </div>
            <div className="dialog-body stack">
              <p style={{ margin: 0 }}>
                This device is connected to your household on OneDrive, but Microsoft has signed it out. That happens after the browser was closed, or after about a day without a fresh sign-in.
              </p>
              <p style={{ margin: 0 }} className="muted">
                {last ? `Last synced ${last}. ` : ''}
                {pending ? `${pending} change${pending === 1 ? ' is' : 's are'} waiting on this device.` : ''}
              </p>
              <div className="notice info small" style={{ margin: 0 }}>
                <Icon name="check" size={14} /> When Microsoft asks <b>“Stay signed in?”</b>, choose <b>Yes</b>. Then this device stays signed in after you close the browser.
              </div>
            </div>
            <div className="dialog-foot gate-foot">
              <button className="btn ghost sm" onClick={() => setConfirmSkip(true)}>Continue without signing in</button>
              <span className="spacer" />
              {who ? <button className="btn" disabled={busy} onClick={goSwitch}>Other account</button> : null}
              <button className="btn primary" disabled={busy} onClick={go} autoFocus>
                {busy ? 'Opening Microsoft…' : who ? `Sign in as ${who.username}` : 'Sign in with Microsoft'}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="dialog-head">
              <h2 id="gate-title">Work without signing in?</h2>
            </div>
            <div className="dialog-body">
              <ul className="plain-list" style={{ marginTop: 0 }}>
                <li>You will not see changes made on other devices{last ? ` since ${last}` : ''}.</li>
                <li>What you change here stays on this device and is not backed up until you sign in.</li>
                <li>If the same things are changed on another device in the meantime, you will have to choose which version to keep.</li>
              </ul>
              <p className="small muted" style={{ marginBottom: 0 }}>You will be asked again the next time you open the app. You can also sign in any time from the sync status at the bottom of the menu.</p>
            </div>
            <div className="dialog-foot gate-foot">
              <button className="btn danger" onClick={stayOffline}>Continue without signing in</button>
              <span className="spacer" />
              <button className="btn primary" disabled={busy} onClick={go} autoFocus>
                Sign in
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
