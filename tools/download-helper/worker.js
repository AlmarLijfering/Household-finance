// Household Finance – download helper (Cloudflare Worker, free plan).
//
// Why: OneDrive serves file contents from a separate download server that does not let
// browser apps read the file. This worker fetches the file for the app and hands it back.
//
// What it can see: only the pre-authenticated, short-lived download link of one file and
// that file's bytes. The household file is encrypted in the browser before upload, so the
// worker only ever handles ciphertext. It stores and logs nothing.
//
// Setup: SETUP.md, section "Download helper".

const ALLOWED_ORIGIN = 'https://almarlijfering.github.io';
const ALLOWED_HOSTS = /(^|\.)(microsoftpersonalcontent\.com|1drv\.com|sharepoint\.com|onedrive\.live\.com|files\.1drv\.com)$/i;

export default {
  async fetch(request) {
    const cors = {
      'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin'
    };
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'POST') return new Response('Household Finance download helper is running.', { status: 200, headers: cors });
    if (request.headers.get('Origin') !== ALLOWED_ORIGIN) return new Response('Forbidden', { status: 403 });

    let target;
    try {
      target = new URL((await request.text()).trim());
    } catch {
      return new Response('Bad request', { status: 400, headers: cors });
    }
    if (target.protocol !== 'https:' || !ALLOWED_HOSTS.test(target.hostname)) {
      return new Response('Host not allowed', { status: 400, headers: cors });
    }

    const upstream = await fetch(target.toString(), { redirect: 'follow' });
    const headers = new Headers(cors);
    headers.set('Content-Type', upstream.headers.get('Content-Type') || 'application/octet-stream');
    headers.set('Cache-Control', 'no-store');
    return new Response(upstream.body, { status: upstream.status, headers });
  }
};
