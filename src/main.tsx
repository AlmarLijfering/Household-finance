import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App';
import './styles.css';

/**
 * After signing in, Microsoft sends the browser back with the result in the address
 * (#code=…&state=… or ?code=…). The app uses #/… for its pages, so that result must be
 * handed to the sign-in library first; then the app opens on Settings.
 */
function isAuthResponse(): boolean {
  const h = location.hash;
  const hashAuth = h.length > 1 && !h.startsWith('#/') && /(^#|&)(code|error|state)=/.test(h);
  const queryAuth = /[?&](code|error)=/.test(location.search) && /[?&]state=/.test(location.search);
  return hashAuth || queryAuth;
}

async function boot() {
  if (isAuthResponse()) {
    try {
      const { getMsal } = await import('./lib/sync/graph');
      await getMsal(); // completes the sign-in and remembers the account
    } catch (e) {
      console.error('Sign-in could not be completed', e);
      sessionStorage.setItem('pfm.signinError', String((e as Error)?.message ?? e));
    }
    history.replaceState(null, '', location.pathname + '#/settings');
  }
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <HashRouter>
        <App />
      </HashRouter>
    </React.StrictMode>
  );
}
boot();
