'use strict';
// Pemeriksa robots.txt sederhana (RFC 9309): grup User-agent yang paling cocok, Allow/Disallow dengan
// pencocokan terpanjang, wildcard * dan $, serta Crawl-delay. robots.txt hanya izin MERAYAPI, bukan izin
// menyalin isi — aplikasi tetap hanya menyimpan judul, ringkasan singkat, tanggal & tautan.
const { politeFetch, setHostDelay } = require('./fetcher');

const AGENT = 'sahabattanibot';
const cache = new Map(); // origin -> { rules, delay, status, at }
const TTL_MS = 6 * 3600 * 1000;

function parse(text) {
  const groups = [];
  let cur = null;
  let lastWasAgent = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    if (!line.includes(':')) continue;
    const idx = line.indexOf(':');
    const key = line.slice(0, idx).trim().toLowerCase();
    const val = line.slice(idx + 1).trim();
    if (key === 'user-agent') {
      if (!lastWasAgent) { cur = { agents: [], rules: [], delay: null }; groups.push(cur); }
      cur.agents.push(val.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!cur) continue;
    if (key === 'allow' || key === 'disallow') cur.rules.push({ allow: key === 'allow', path: val });
    else if (key === 'crawl-delay' && Number.isFinite(Number(val))) cur.delay = Number(val);
  }
  const exact = groups.find((g) => g.agents.some((a) => a !== '*' && AGENT.includes(a)));
  return exact || groups.find((g) => g.agents.includes('*')) || { rules: [], delay: null };
}

function toRegex(path) {
  const anchored = path.endsWith('$');
  const body = (anchored ? path.slice(0, -1) : path).replace(/[.+?^{}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp('^' + body + (anchored ? '$' : ''));
}

function allowedBy(group, pathWithQuery) {
  let best = null;
  for (const r of group.rules) {
    if (!r.path) continue; // "Disallow:" kosong berarti tidak ada larangan
    if (toRegex(r.path).test(pathWithQuery) && (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow))) best = r;
  }
  return !best || best.allow;
}

async function rulesFor(origin) {
  const c = cache.get(origin);
  if (c && Date.now() - c.at < TTL_MS) return c;
  let entry;
  try {
    const res = await politeFetch(origin + '/robots.txt', { accept: 'text/plain,*/*;q=0.5' });
    // Beberapa situs mengalihkan robots.txt ke beranda HTML: berarti tidak ada aturan.
    if (/text\/html/i.test(res.contentType) && /<html/i.test(res.text)) entry = { group: { rules: [] }, status: 'tidak ada robots.txt (diizinkan)' };
    else { const group = parse(res.text); entry = { group, status: 'robots.txt dibaca' }; }
  } catch (err) {
    if (err.status === 404 || err.status === 410) entry = { group: { rules: [] }, status: 'tidak ada robots.txt (diizinkan)' };
    else if (err.blocked) entry = { group: { rules: [{ allow: false, path: '/' }] }, status: `robots.txt tidak dapat diakses (${err.message}) — dianggap melarang` };
    else entry = { group: { rules: [{ allow: false, path: '/' }] }, status: `robots.txt gagal dibaca (${err.message}) — dianggap melarang sementara` };
  }
  entry.at = Date.now();
  entry.delay = entry.group.delay;
  if (entry.delay) setHostDelay(new URL(origin).host, entry.delay * 1000);
  cache.set(origin, entry);
  return entry;
}

async function isAllowed(url) {
  const u = new URL(url);
  const entry = await rulesFor(u.origin);
  return { allowed: allowedBy(entry.group, u.pathname + u.search), status: entry.status, delay: entry.delay };
}

module.exports = { isAllowed, parse, allowedBy, _reset() { cache.clear(); } };
