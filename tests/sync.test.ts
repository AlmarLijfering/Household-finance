// Simulates OneDrive with ETag preconditions and a second household member saving in between.
import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeAll } from 'vitest';

const remote: { files: Map<string, { body: string; etag: string }>; n: number; failNextAfterWrite: boolean } = { files: new Map(), n: 0, failNextAfterWrite: false };
vi.mock('../src/lib/sync/graph', async () => {
  class PreconditionFailed extends Error {}
  class AuthRequired extends Error {}
  return {
    PreconditionFailed,
    AuthRequired,
    ensureSubfolders: async () => {},
    listChildren: async () => [],
    download: async (_l: any, path: string) => {
      const f = remote.files.get(path);
      return f ? { meta: { eTag: f.etag }, body: new TextEncoder().encode(f.body).buffer } : null;
    },
    upload: async (_l: any, path: string, blob: Blob, ifMatch?: string | null) => {
      const cur = remote.files.get(path);
      if (ifMatch === null && cur) throw new PreconditionFailed();
      if (ifMatch && (!cur || cur.etag !== ifMatch)) throw new PreconditionFailed();
      const etag = `"e${++remote.n}"`;
      remote.files.set(path, { body: await blob.text(), etag });
      if (remote.failNextAfterWrite) {
        remote.failNextAfterWrite = false;
        throw new Error('network dropped after upload'); // outcome uncertain for the client
      }
      return { eTag: etag };
    }
  };
});

import { db, put, exportSnapshot } from '../src/lib/db';
import * as S from '../src/lib/sync/sync';
import { createKeyring, encryptJson, decryptJson } from '../src/lib/sync/crypto';

const loc = { driveId: 'd', folderId: 'f', name: 'Household Finance', owner: 'me' as const };
let key: CryptoKey, ring: any;
const tx = (id: string, amount: number, payee: string) => ({ id, accountId: 'a', date: '2026-11-01', amount, payee, categoryId: null, status: 'uncleared', createdAt: '2026-11-01', updatedAt: '' }) as any;

async function remoteSnapshot() {
  const f = remote.files.get(S.SNAPSHOT_PATH)!;
  return decryptJson<any>(key, JSON.parse(f.body));
}
/** Another device saves a change straight to "OneDrive". */
async function partnerSaves(mut: (s: any) => void) {
  const s = await remoteSnapshot();
  mut(s);
  s.revision += 1;
  const f = remote.files.get(S.SNAPSHOT_PATH)!;
  remote.files.set(S.SNAPSHOT_PATH, { body: JSON.stringify(await encryptJson(key, ring.keyId, s)), etag: `"p${++remote.n}"` });
  void f;
}

describe('sync', () => {
  beforeAll(async () => {
    const k = await createKeyring('household passphrase');
    key = k.key;
    ring = k.keyring;
    await S.connectLocation(loc);
    await S.persistKey(key, ring);
  });

  it('first save creates the file; later saves are conditional', async () => {
    await put('transactions', tx('t1', -1000, 'Bakery'));
    await S.syncNow();
    expect(S.status.phase).toBe('idle');
    expect(await db.pending.count()).toBe(0);
    const s = await remoteSnapshot();
    expect(s.data.transactions.map((t: any) => t.id)).toEqual(['t1']);
  });

  it('a stale save is rejected, rebased on the partner’s version and retried', async () => {
    await put('transactions', tx('t2', -2000, 'Mine'));
    await partnerSaves((s) => s.data.transactions.push({ ...tx('p1', -5000, 'Partner'), updatedAt: new Date().toISOString() }));
    await S.syncNow();
    const s = await remoteSnapshot();
    expect(s.data.transactions.map((t: any) => t.id).sort()).toEqual(['p1', 't1', 't2']);
    expect((await db.transactions.toArray()).map((t) => t.id).sort()).toEqual(['p1', 't1', 't2']);
    expect(await db.pending.count()).toBe(0);
  });

  it('an upload whose outcome was uncertain is not applied twice on retry', async () => {
    await put('transactions', tx('t3', -3000, 'Once'));
    remote.failNextAfterWrite = true;
    await S.syncNow(); // upload landed but the client saw an error
    expect(await db.pending.count()).toBe(1);
    await S.syncNow(); // retry: the remote already lists the op id
    const s = await remoteSnapshot();
    expect(s.data.transactions.filter((t: any) => t.id === 't3')).toHaveLength(1);
    expect(await db.pending.count()).toBe(0);
  });

  it('overlapping edits to the same record are offered for review', async () => {
    const before = (await db.transactions.get('p1'))!;
    await new Promise((r) => setTimeout(r, 5));
    await partnerSaves((s) => { const t = s.data.transactions.find((x: any) => x.id === 'p1'); t.payee = 'Partner edit'; t.updatedAt = new Date().toISOString(); });
    await put('transactions', { ...before, payee: 'My edit' });
    await S.syncNow();
    expect(S.status.conflicts.length).toBe(1);
    expect((await db.transactions.get('p1'))!.payee).toBe('My edit');
    await S.keepTheirs(S.status.conflicts[0]);
    await S.syncNow();
    expect((await remoteSnapshot()).data.transactions.find((t: any) => t.id === 'p1').payee).toBe('Partner edit');
    void exportSnapshot;
  });
});
