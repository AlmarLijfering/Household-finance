// Microsoft sign-in (personal accounts) and the small slice of Microsoft Graph the app needs.
import type { PublicClientApplication, AccountInfo } from '@azure/msal-browser';

// Files.ReadWrite.All is required to open a folder someone else shared with you.
export const SCOPES = ['User.Read', 'Files.ReadWrite.All'];
const GRAPH = 'https://graph.microsoft.com/v1.0';

/** The address Microsoft returns to after sign-in. Register exactly this as the SPA redirect URI. */
export function redirectUri(): string {
  const p = location.pathname;
  return location.origin + (p.endsWith('/') || /\.[a-z0-9]+$/i.test(p) ? p : p + '/');
}

export function clientId(): string {
  return (localStorage.getItem('pfm.clientId') || import.meta.env.VITE_MSAL_CLIENT_ID || '').trim();
}

let msal: PublicClientApplication | null = null;
let ready: Promise<PublicClientApplication> | null = null;

export async function getMsal(): Promise<PublicClientApplication> {
  if (msal) return msal;
  if (!ready) {
    ready = (async () => {
      const id = clientId();
      if (!id) throw new Error('No Microsoft app (client) ID configured. Add it under Settings → Sync.');
      const { PublicClientApplication } = await import('@azure/msal-browser');
      const app = new PublicClientApplication({
        auth: {
          clientId: id,
          authority: 'https://login.microsoftonline.com/consumers',
          redirectUri: redirectUri(),
          // the app's own pages live after '#/': come back to the start page and let the app route
          navigateToLoginRequestUrl: false
        } as any,
        cache: { cacheLocation: 'localStorage' }
      });
      await app.initialize();
      const res = await app.handleRedirectPromise();
      if (res?.account) app.setActiveAccount(res.account);
      else if (!app.getActiveAccount() && app.getAllAccounts()[0]) app.setActiveAccount(app.getAllAccounts()[0]);
      msal = app;
      return app;
    })();
  }
  return ready;
}

export async function currentAccount(): Promise<AccountInfo | null> {
  try {
    return (await getMsal()).getActiveAccount();
  } catch {
    return null;
  }
}

export async function signIn() {
  const app = await getMsal();
  // Redirect works in installed iOS/iPadOS web apps, where popups are unreliable.
  await app.loginRedirect({ scopes: SCOPES, prompt: 'select_account' });
}
export async function signOut() {
  const app = await getMsal();
  await app.logoutRedirect({ account: app.getActiveAccount() ?? undefined });
}

async function token(): Promise<string> {
  const app = await getMsal();
  const account = app.getActiveAccount();
  if (!account) throw new AuthRequired();
  try {
    return (await app.acquireTokenSilent({ scopes: SCOPES, account })).accessToken;
  } catch {
    throw new AuthRequired();
  }
}

export class AuthRequired extends Error {
  constructor() {
    super('Sign in with your Microsoft account to sync.');
  }
}
export class PreconditionFailed extends Error {
  constructor() {
    super('The household file changed on OneDrive since it was loaded.');
  }
}
/** OneDrive answered, but the browser could not read the file from OneDrive's download server. */
export class DownloadBlocked extends Error {
  constructor(public host: string) {
    super(
      `Uploads work, but this browser is not allowed to read files back from OneDrive's download server (${host}). ` +
        `Nothing is lost: your changes stay on this device. Set up the free download helper (SETUP.md, "Download helper") ` +
        `and paste its address under Settings → Sync & sharing.`
    );
  }
}
export class GraphError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Graph request with retry + backoff for throttling and transient failures. */
export async function gfetch(path: string, init: RequestInit = {}, attempt = 0): Promise<Response> {
  const t = await token();
  let res: Response;
  try {
    res = await fetch(path.startsWith('http') ? path : GRAPH + path, { ...init, headers: { Authorization: `Bearer ${t}`, ...(init.headers || {}) } });
  } catch (e) {
    if (attempt < 4) {
      await sleep(500 * 2 ** attempt + Math.random() * 300);
      return gfetch(path, init, attempt + 1);
    }
    throw e;
  }
  if ((res.status === 429 || res.status >= 500) && attempt < 4) {
    const ra = Number(res.headers.get('Retry-After'));
    await sleep(ra ? ra * 1000 : 800 * 2 ** attempt + Math.random() * 400);
    return gfetch(path, init, attempt + 1);
  }
  if (res.status === 412) throw new PreconditionFailed();
  if (res.status === 401) throw new AuthRequired();
  return res;
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const j = await res.json();
      msg = j?.error?.message || msg;
    } catch {
      /* ignore */
    }
    throw new GraphError(res.status, msg);
  }
  return res.json();
}

export interface Location {
  driveId: string;
  folderId: string;
  name: string;
  owner: 'me' | 'shared';
}
export interface DriveItem {
  id: string;
  name: string;
  eTag?: string;
  size?: number;
  lastModifiedDateTime?: string;
  lastModifiedBy?: { user?: { displayName?: string } };
  folder?: unknown;
  remoteItem?: { id: string; name: string; parentReference: { driveId: string }; folder?: unknown };
  parentReference?: { driveId: string };
}

export async function me(): Promise<{ displayName: string; mail?: string; userPrincipalName?: string }> {
  return json(await gfetch('/me'));
}

/** Create (or reuse) a household folder at the root of the signed-in user's OneDrive. */
export async function createHouseholdFolder(name = 'Household Finance'): Promise<Location> {
  let item: DriveItem;
  const existing = await gfetch(`/me/drive/root:/${encodeURIComponent(name)}`);
  if (existing.ok) item = await existing.json();
  else
    item = await json(
      await gfetch('/me/drive/root/children', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, folder: {}, '@microsoft.graph.conflictBehavior': 'fail' })
      })
    );
  const loc: Location = { driveId: item.parentReference!.driveId, folderId: item.id, name: item.name, owner: 'me' };
  await ensureSubfolders(loc);
  return loc;
}

export async function ensureSubfolders(loc: Location) {
  for (const sub of ['Data', 'Reports', 'Backups', 'Archive']) {
    const r = await gfetch(`/drives/${loc.driveId}/items/${loc.folderId}:/${sub}`);
    if (r.ok) continue;
    if (r.status !== 404) await json(r);
    await json(
      await gfetch(`/drives/${loc.driveId}/items/${loc.folderId}/children`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: sub, folder: {}, '@microsoft.graph.conflictBehavior': 'replace' })
      })
    );
  }
}

/** Folders other household members shared with me. */
export async function sharedFolders(): Promise<Location[]> {
  const r = await json<{ value: DriveItem[] }>(await gfetch('/me/drive/sharedWithMe'));
  return r.value
    .filter((x) => x.remoteItem?.folder || x.folder)
    .map((x) => ({ driveId: x.remoteItem!.parentReference.driveId, folderId: x.remoteItem!.id, name: x.remoteItem!.name || x.name, owner: 'shared' as const }));
}

/** Resolve a OneDrive sharing link to the folder it points at. */
export async function resolveShareLink(url: string): Promise<Location> {
  const encoded = 'u!' + btoa(url.trim()).replace(/=+$/, '').replace(/\//g, '_').replace(/\+/g, '-');
  const item = await json<DriveItem>(await gfetch(`/shares/${encoded}/driveItem`));
  return { driveId: item.parentReference!.driveId, folderId: item.id, name: item.name, owner: 'shared' };
}

/** Give a named household member edit access (an invitation email is sent by Microsoft). */
export async function invite(loc: Location, email: string, role: 'write' | 'read' = 'write') {
  return json(
    await gfetch(`/drives/${loc.driveId}/items/${loc.folderId}/invite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipients: [{ email }], roles: [role], requireSignIn: true, sendInvitation: true, message: 'Household finance folder' })
    })
  );
}

export async function permissions(loc: Location) {
  return json<{ value: Array<{ id: string; roles: string[]; grantedToV2?: { user?: { displayName?: string; email?: string } }; grantedTo?: { user?: { displayName?: string } } }> }>(
    await gfetch(`/drives/${loc.driveId}/items/${loc.folderId}/permissions`)
  );
}
export async function revoke(loc: Location, permissionId: string) {
  const r = await gfetch(`/drives/${loc.driveId}/items/${loc.folderId}/permissions/${permissionId}`, { method: 'DELETE' });
  if (!r.ok && r.status !== 204) await json(r);
}

/** Optional download helper (see SETUP.md): routes file downloads around OneDrive's download server. */
export function downloadHelper(): string {
  return (localStorage.getItem('pfm.downloadHelper') || '').trim();
}
let directBroken = false; // remembered for this session once a direct download failed

async function viaHelper(helper: string, url: string): Promise<Response> {
  try {
    return await fetch(helper, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: url, cache: 'no-store' });
  } catch {
    throw new Error(`The download helper at ${new URL(helper).host} could not be reached. Check its address under Settings → Sync & sharing.`);
  }
}

async function fetchContent(url: string): Promise<Response> {
  const helper = downloadHelper();
  if (helper && directBroken) return viaHelper(helper, url);
  try {
    return await fetch(url, { cache: 'no-store', credentials: 'omit' });
  } catch {
    directBroken = true;
    if (helper) return viaHelper(helper, url);
    throw new DownloadBlocked(new URL(url).host);
  }
}

const itemPath = (loc: Location, path: string) => `/drives/${loc.driveId}/items/${loc.folderId}:/${path.split('/').map(encodeURIComponent).join('/')}`;

export async function getMeta(loc: Location, path: string): Promise<DriveItem | null> {
  const r = await gfetch(itemPath(loc, path));
  if (r.status === 404) return null;
  return json(r);
}

/** Download a file. The ETag is read in the same metadata call that yields the download URL. */
export async function download(loc: Location, path: string): Promise<{ meta: DriveItem; body: ArrayBuffer } | null> {
  const r = await gfetch(itemPath(loc, path) + '?select=id,name,eTag,size,lastModifiedDateTime,lastModifiedBy,@microsoft.graph.downloadUrl');
  if (r.status === 404) return null;
  const meta = await json<DriveItem & { '@microsoft.graph.downloadUrl': string }>(r);
  const url = meta['@microsoft.graph.downloadUrl'];
  const res = await fetchContent(url);
  if (!res.ok) throw new GraphError(res.status, `Download of ${path} failed (${res.status})`);
  return { meta, body: await res.arrayBuffer() };
}

/**
 * Upload with a precondition.
 * - ifMatch: the eTag we loaded; Graph rejects the write with 412 when the file changed.
 * - ifMatch === null: the file must not exist yet (If-None-Match: *).
 * - ifMatch === undefined: unconditional (reports, backups).
 * Files over 4 MB go through an upload session with the same precondition.
 */
export async function upload(loc: Location, path: string, body: Blob, ifMatch?: string | null, contentType = 'application/json'): Promise<DriveItem> {
  const cond: Record<string, string> = ifMatch ? { 'If-Match': ifMatch } : ifMatch === null ? { 'If-None-Match': '*' } : {};
  if (body.size < 4 * 1024 * 1024) {
    return json(await gfetch(itemPath(loc, path) + ':/content', { method: 'PUT', headers: { 'Content-Type': contentType, ...cond }, body }));
  }
  const session = await json<{ uploadUrl: string }>(
    await gfetch(itemPath(loc, path) + ':/createUploadSession', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...cond },
      body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'replace' } })
    })
  );
  const chunk = 5 * 1024 * 1024 + 320 * 1024 - ((5 * 1024 * 1024) % (320 * 1024)); // multiple of 320 KiB
  let last: Response | null = null;
  for (let start = 0; start < body.size; start += chunk) {
    const end = Math.min(body.size, start + chunk);
    last = await fetch(session.uploadUrl, { method: 'PUT', headers: { 'Content-Range': `bytes ${start}-${end - 1}/${body.size}` }, body: body.slice(start, end) });
    if (last.status === 412) throw new PreconditionFailed();
    if (!last.ok && last.status !== 202) throw new GraphError(last.status, 'Upload failed');
  }
  return json(last!);
}

/** Rename a file in place (used to keep an old archive aside instead of deleting it). */
export async function renameItem(loc: Location, path: string, newName: string): Promise<void> {
  const r = await gfetch(itemPath(loc, path), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: newName, '@microsoft.graph.conflictBehavior': 'rename' })
  });
  if (r.status === 404) return;
  await json(r);
}

export async function listChildren(loc: Location, path: string): Promise<DriveItem[]> {
  const r = await gfetch(itemPath(loc, path) + ':/children?$top=200');
  if (r.status === 404) return [];
  return (await json<{ value: DriveItem[] }>(r)).value;
}

/**
 * Release-gate check from the brief: prove that a write with a stale ETag is rejected.
 * Writes a small test file twice and then retries with the first (now stale) ETag.
 */
export async function staleWriteTest(loc: Location): Promise<{ ok: boolean; detail: string }> {
  const path = 'Data/write-test.json';
  const a = await upload(loc, path, new Blob([JSON.stringify({ t: Date.now(), step: 1 })]));
  const b = await upload(loc, path, new Blob([JSON.stringify({ t: Date.now(), step: 2 })]), a.eTag);
  try {
    await upload(loc, path, new Blob([JSON.stringify({ t: Date.now(), step: 3 })]), a.eTag);
    return { ok: false, detail: `Failed. OneDrive accepted a save based on an outdated copy (${a.eTag} after ${b.eTag}). Do not share the household between two people until this passes.` };
  } catch (e) {
    if (e instanceof PreconditionFailed) return { ok: true, detail: 'Passed. OneDrive refused a save based on an outdated copy, as it should, so two devices cannot overwrite each other\'s changes.' };
    throw e;
  }
}
