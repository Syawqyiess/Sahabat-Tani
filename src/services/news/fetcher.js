'use strict';
// Permintaan HTTP yang sopan untuk pengambilan berita:
// - User-Agent jujur yang menyebut tujuan (tanpa data pribadi).
// - Jeda minimal antar permintaan ke host yang sama (atau Crawl-delay dari robots.txt bila lebih lama).
// - Batas waktu & ukuran respons. Tidak pernah mengirim cookie/login dan tidak mencoba melewati blokir.

const USER_AGENT = 'SahabatTaniBot/0.1 (agregator judul berita pertanian untuk demo akademik; hanya judul, ringkasan & tautan)';
const MIN_DELAY_MS = Number(process.env.NEWS_MIN_DELAY_MS ?? 2000);
const TIMEOUT_MS = 15000;
const MAX_BYTES = 3 * 1024 * 1024;

const lastHit = new Map(); // host -> waktu permintaan terakhir
const hostDelay = new Map(); // host -> jeda (ms) dari robots.txt

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class FetchError extends Error {
  constructor(message, { status, blocked } = {}) {
    super(message);
    this.status = status;
    this.blocked = !!blocked;
  }
}

function setHostDelay(host, ms) {
  hostDelay.set(host, Math.max(MIN_DELAY_MS, ms || 0));
}

async function politeFetch(url, { accept = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' } = {}) {
  const host = new URL(url).host;
  const wait = (lastHit.get(host) || 0) + (hostDelay.get(host) ?? MIN_DELAY_MS) - Date.now();
  if (wait > 0) await sleep(wait);
  lastHit.set(host, Date.now());
  let res;
  try {
    res = await fetch(url, {
      headers: { 'user-agent': USER_AGENT, accept, 'accept-language': 'id,en;q=0.5' },
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw new FetchError(err.name === 'TimeoutError' ? 'waktu habis' : `tidak dapat terhubung (${err.cause?.code || err.message})`);
  }
  // Hormati pembatasan: 401/403/429 = berhenti untuk sumber ini, jangan dicoba akali.
  if ([401, 403, 429].includes(res.status)) throw new FetchError(`akses dibatasi oleh situs (HTTP ${res.status})`, { status: res.status, blocked: true });
  if (!res.ok) throw new FetchError(`HTTP ${res.status}`, { status: res.status });
  let buf;
  try {
    buf = Buffer.from(await res.arrayBuffer());
  } catch (err) {
    throw new FetchError(err.name === 'TimeoutError' || /timeout|aborted/i.test(err.message) ? 'waktu habis saat membaca halaman' : 'unduhan halaman terputus');
  }
  if (buf.length > MAX_BYTES) throw new FetchError('respons terlalu besar');
  const text = buf.toString('utf8');
  // Halaman verifikasi bot/CAPTCHA tidak diproses dan tidak dicoba diakali. Dikenali dari judul halamannya,
  // bukan sekadar adanya widget reCAPTCHA (banyak situs memasangnya di formulir kontak).
  const title = (text.match(/<title[^>]*>([^<]*)/i) || [])[1] || '';
  if (/just a moment|attention required|security check|verify you are human|captcha|access denied|ddos protection/i.test(title)) {
    throw new FetchError(`situs menampilkan halaman verifikasi ("${title.trim().slice(0, 60)}") — tidak diproses`, { blocked: true });
  }
  return { url: res.url || url, status: res.status, contentType: res.headers.get('content-type') || '', text };
}

// ---------- Gambar berita ----------
// Pengambilan gambar dari backend dengan pengaman:
// - hanya http(s) ke host yang diverifikasi untuk sumber itu, dicek ulang di setiap redirect (maks. 3);
// - alamat IP tujuan harus publik (bukan localhost/jaringan privat/link-local) — mencegah SSRF;
// - batas waktu, batas ukuran (dibaca bertahap), retry terbatas hanya untuk galat jaringan/5xx;
// - 401/403/429 dianggap "diblokir" (termasuk proteksi hotlink) dan tidak dicoba akali.
const dns = require('node:dns').promises;
const net = require('node:net');
const IMAGE_MAX_BYTES = 8 * 1024 * 1024;
let resolver = (host) => dns.lookup(host, { all: true });

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
      || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) return isPrivateIp(v.slice(7));
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80') || v.startsWith('ff');
}

async function assertPublicHost(host) {
  const h = host.replace(/^\[|\]$/g, '');
  if (/^localhost$/i.test(h) || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) throw new FetchError('tujuan jaringan lokal ditolak');
  const addrs = net.isIP(h) ? [{ address: h }] : await resolver(h).catch(() => { throw new FetchError('nama host tidak dapat di-resolve'); });
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) throw new FetchError('tujuan jaringan privat ditolak');
}

// Cek tujuan sebelum permintaan apa pun (termasuk robots.txt host gambar): protokol, kredensial, host terverifikasi, IP publik.
async function checkTarget(url, allowHost) {
  let u;
  try { u = new URL(url); } catch { throw new FetchError('URL gambar tidak valid'); }
  if (!/^https?:$/.test(u.protocol)) throw new FetchError('protokol gambar tidak didukung');
  if (u.username || u.password) throw new FetchError('URL gambar berisi kredensial');
  if (allowHost && !allowHost(u.hostname)) throw new FetchError(`host gambar belum diverifikasi (${u.hostname})`);
  await assertPublicHost(u.hostname);
  return u;
}

async function fetchImage(url, { allowHost, referer } = {}) {
  let current = url;
  for (let hop = 0; hop <= 3; hop++) {
    const u = await checkTarget(current, allowHost);
    const res = await imageRequest(u.href, referer);
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      current = new URL(res.headers.get('location'), u).href;
      continue;
    }
    if ([401, 403, 429].includes(res.status)) throw new FetchError(`diblokir situs (HTTP ${res.status})`, { status: res.status, blocked: true });
    if (!res.ok) throw new FetchError(`HTTP ${res.status}`, { status: res.status });
    const len = Number(res.headers.get('content-length') || 0);
    if (len > IMAGE_MAX_BYTES) throw new FetchError('berkas gambar terlalu besar');
    const chunks = [];
    let total = 0;
    try {
      for await (const chunk of res.body) {
        total += chunk.length;
        if (total > IMAGE_MAX_BYTES) throw new FetchError('berkas gambar terlalu besar');
        chunks.push(chunk);
      }
    } catch (err) {
      if (err instanceof FetchError) throw err;
      throw new FetchError(err.name === 'TimeoutError' || /timeout|aborted/i.test(err.message) ? 'waktu habis saat mengunduh gambar' : 'unduhan gambar terputus');
    }
    return { url: u.href, contentType: res.headers.get('content-type') || '', buffer: Buffer.concat(chunks) };
  }
  throw new FetchError('terlalu banyak redirect');
}

async function imageRequest(url, referer) {
  const host = new URL(url).host;
  for (let attempt = 0; attempt < 2; attempt++) {
    const wait = (lastHit.get(host) || 0) + (hostDelay.get(host) ?? MIN_DELAY_MS) - Date.now();
    if (wait > 0) await sleep(wait);
    lastHit.set(host, Date.now());
    try {
      const res = await fetch(url, {
        // Referer jujur: penerbit yang memasang proteksi hotlink tetap bisa menolak.
        headers: { 'user-agent': USER_AGENT, accept: 'image/avif,image/webp,image/jpeg,image/png,image/*;q=0.8', ...(referer ? { referer } : {}) },
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.status >= 500 && attempt === 0) { await sleep(1000); continue; }
      return res;
    } catch (err) {
      if (attempt === 0) { await sleep(1000); continue; }
      throw new FetchError(err.name === 'TimeoutError' ? 'waktu habis' : `tidak dapat terhubung (${err.cause?.code || err.message})`);
    }
  }
  throw new FetchError('gagal setelah percobaan ulang');
}

module.exports = {
  politeFetch, fetchImage, checkTarget, isPrivateIp, setHostDelay, FetchError, USER_AGENT,
  _reset() { lastHit.clear(); hostDelay.clear(); },
  _setResolver(fn) { resolver = fn || ((host) => dns.lookup(host, { all: true })); },
};
