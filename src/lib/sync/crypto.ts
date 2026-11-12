// Authenticated encryption for everything stored on OneDrive.
//
// Key design
// - One random 256-bit household data key (DEK) encrypts the snapshot and backups (AES-GCM).
// - The DEK is stored only in wrapped form in Data/keyring.json, once per unlock method:
//   the household passphrase and a one-time recovery code, each through PBKDF2-SHA256.
// - Changing the passphrase re-wraps the DEK. Rotating the DEK (e.g. after someone leaves)
//   creates a new key; the previous key stays in the keyring, wrapped by the new one, so
//   older backups remain readable.

const enc = new TextEncoder();
const dec = new TextDecoder();
const ITER = 600_000;

export const b64 = {
  enc(buf: ArrayBuffer | Uint8Array): string {
    const u = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    let s = '';
    for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
    return btoa(s);
  },
  dec(s: string): Uint8Array {
    const bin = atob(s);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u;
  }
};

const rand = (n: number) => crypto.getRandomValues(new Uint8Array(n));

export interface Wrap {
  method: 'passphrase' | 'recovery';
  salt: string;
  iterations: number;
  iv: string;
  wrapped: string;
}
export interface Keyring {
  format: 'pfm-keyring';
  version: 1;
  keyId: string;
  wraps: Wrap[];
  previous: Array<{ keyId: string; iv: string; wrapped: string }>; // older DEKs wrapped by the current DEK
  createdAt: string;
  rotatedAt?: string;
}
export interface Envelope {
  format: 'pfm-encrypted';
  version: 1;
  keyId: string;
  iv: string;
  gzip: boolean;
  ct: string;
}

async function kek(secret: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', enc.encode(secret.normalize('NFKC')), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

async function wrapWith(dekRaw: Uint8Array, secret: string, method: Wrap['method']): Promise<Wrap> {
  const salt = rand(16);
  const iv = rand(12);
  const k = await kek(secret, salt, ITER);
  const wrapped = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource, additionalData: enc.encode('pfm-dek') }, k, dekRaw as BufferSource);
  return { method, salt: b64.enc(salt), iterations: ITER, iv: b64.enc(iv), wrapped: b64.enc(wrapped) };
}

export const importDek = (raw: Uint8Array, extractable = false) =>
  crypto.subtle.importKey('raw', raw as BufferSource, { name: 'AES-GCM' }, extractable, ['encrypt', 'decrypt']);

export function recoveryCode(): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const r = rand(24);
  const chars = Array.from(r, (x) => alphabet[x % alphabet.length]).join('');
  return chars.match(/.{4}/g)!.join('-');
}

export async function createKeyring(passphrase: string): Promise<{ keyring: Keyring; key: CryptoKey; recovery: string }> {
  const raw = rand(32);
  const recovery = recoveryCode();
  const keyring: Keyring = {
    format: 'pfm-keyring',
    version: 1,
    keyId: b64.enc(rand(9)),
    wraps: [await wrapWith(raw, passphrase, 'passphrase'), await wrapWith(raw, recovery.replace(/-/g, ''), 'recovery')],
    previous: [],
    createdAt: new Date().toISOString()
  };
  return { keyring, key: await importDek(raw), recovery };
}

export async function unwrapRaw(keyring: Keyring, secret: string): Promise<Uint8Array> {
  const candidates = [secret, secret.replace(/[-\s]/g, '').toUpperCase()];
  for (const w of keyring.wraps)
    for (const s of candidates) {
      try {
        const k = await kek(s, b64.dec(w.salt), w.iterations);
        const raw = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64.dec(w.iv) as BufferSource, additionalData: enc.encode('pfm-dek') }, k, b64.dec(w.wrapped) as BufferSource);
        return new Uint8Array(raw);
      } catch {
        /* try next */
      }
    }
  throw new Error('That passphrase or recovery code does not unlock this household.');
}

export async function unlock(keyring: Keyring, secret: string): Promise<CryptoKey> {
  return importDek(await unwrapRaw(keyring, secret));
}

/** New passphrase, same data key. */
export async function changePassphrase(keyring: Keyring, current: string, next: string): Promise<Keyring> {
  const raw = await unwrapRaw(keyring, current);
  return { ...keyring, wraps: [await wrapWith(raw, next, 'passphrase'), ...keyring.wraps.filter((w) => w.method === 'recovery')], rotatedAt: new Date().toISOString() };
}

/** New data key + new passphrase + new recovery code. Old key kept (wrapped) for old backups. */
export async function rotateKey(keyring: Keyring, current: string, nextPassphrase: string): Promise<{ keyring: Keyring; key: CryptoKey; recovery: string }> {
  const oldRaw = await unwrapRaw(keyring, current);
  const fresh = await createKeyring(nextPassphrase);
  const newRaw = await unwrapRaw(fresh.keyring, nextPassphrase);
  const k = await importDek(newRaw);
  const iv = rand(12);
  const wrappedOld = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, k, oldRaw as BufferSource);
  const previous = [{ keyId: keyring.keyId, iv: b64.enc(iv), wrapped: b64.enc(wrappedOld) }];
  // carry forward older keys, re-wrapped under the new key
  const oldKey = await importDek(oldRaw);
  for (const p of keyring.previous) {
    const raw = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64.dec(p.iv) as BufferSource }, oldKey, b64.dec(p.wrapped) as BufferSource));
    const iv2 = rand(12);
    previous.push({ keyId: p.keyId, iv: b64.enc(iv2), wrapped: b64.enc(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv2 as BufferSource }, k, raw as BufferSource)) });
  }
  return { keyring: { ...fresh.keyring, previous, rotatedAt: new Date().toISOString() }, key: k, recovery: fresh.recovery };
}

async function gzip(data: Uint8Array): Promise<Uint8Array | null> {
  if (typeof CompressionStream === 'undefined') return null;
  const s = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}
async function gunzip(data: Uint8Array): Promise<Uint8Array> {
  const s = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}

export async function encryptJson(key: CryptoKey, keyId: string, value: unknown): Promise<Envelope> {
  const plain = enc.encode(JSON.stringify(value));
  const z = await gzip(plain);
  const iv = rand(12);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource, additionalData: enc.encode(keyId) }, key, (z ?? plain) as BufferSource);
  return { format: 'pfm-encrypted', version: 1, keyId, iv: b64.enc(iv), gzip: !!z, ct: b64.enc(ct) };
}

export async function decryptJson<T>(key: CryptoKey, env: Envelope, keyring?: Keyring): Promise<T> {
  let k = key;
  if (keyring && env.keyId !== keyring.keyId) {
    const p = keyring.previous.find((x) => x.keyId === env.keyId);
    if (!p) throw new Error('This file was encrypted with a key that is no longer in the keyring.');
    const raw = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64.dec(p.iv) as BufferSource }, key, b64.dec(p.wrapped) as BufferSource));
    k = await importDek(raw);
  }
  const buf = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64.dec(env.iv) as BufferSource, additionalData: enc.encode(env.keyId) }, k, b64.dec(env.ct) as BufferSource));
  const plain = env.gzip ? await gunzip(buf) : buf;
  return JSON.parse(dec.decode(plain)) as T;
}
