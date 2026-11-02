'use strict';
const crypto = require('node:crypto');
const sanitizeHtml = require('sanitize-html');
const { marked } = require('marked');

const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

// SQLite menyimpan datetime('now') dalam UTC tanpa zona; tandai sebagai UTC saat parsing.
function toDate(v) {
  if (!v) return null;
  if (v instanceof Date) return v;
  const s = String(v);
  const d = new Date(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(s) ? s.replace(' ', 'T') + 'Z' : s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function fmtDate(v, withTime = false, tz = 'Asia/Jakarta') {
  const d = toDate(v);
  if (!d) return '—';
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(d).map((p) => [p.type, p.value]),
  );
  let out = `${Number(parts.day)} ${MONTHS[Number(parts.month) - 1]} ${parts.year}`;
  if (withTime) out += `, ${parts.hour}.${parts.minute} ${tz === 'Asia/Jakarta' ? 'WIB' : tz}`;
  return out;
}

function timeAgo(v) {
  const d = toDate(v);
  if (!d) return '—';
  const s = Math.round((Date.now() - d.getTime()) / 1000);
  if (s < 60) return 'baru saja';
  if (s < 3600) return `${Math.floor(s / 60)} menit lalu`;
  if (s < 86400) return `${Math.floor(s / 3600)} jam lalu`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)} hari lalu`;
  return fmtDate(d);
}

function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'artikel';
}

const SANITIZE_OPTS = {
  allowedTags: ['p', 'br', 'strong', 'em', 'b', 'i', 'ul', 'ol', 'li', 'h2', 'h3', 'h4', 'blockquote', 'a', 'img', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'hr', 'code', 'pre'],
  allowedAttributes: { a: ['href', 'title', 'rel', 'target'], img: ['src', 'alt', 'title', 'loading', 'width', 'height'] },
  allowedSchemes: ['http', 'https', 'mailto'],
  transformTags: {
    a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer nofollow', target: '_blank' }),
    img: sanitizeHtml.simpleTransform('img', { loading: 'lazy' }),
  },
};

function renderMarkdown(md) {
  return sanitizeHtml(marked.parse(String(md || ''), { async: false }), SANITIZE_OPTS);
}

function stripHtml(s) {
  return sanitizeHtml(String(s || ''), { allowedTags: [], allowedAttributes: {} }).replace(/\s+/g, ' ').trim();
}

function truncate(s, n) {
  s = String(s || '');
  return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s;
}

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function sha256(s) {
  return crypto.createHash('sha256').update(String(s)).digest('hex');
}

// Normalisasi nomor HP Indonesia: 08xx / +628xx / 628xx → 08xx
function normalizePhone(v) {
  if (!v) return null;
  let p = String(v).replace(/[\s\-().]/g, '');
  if (p.startsWith('+62')) p = '0' + p.slice(3);
  else if (p.startsWith('62')) p = '0' + p.slice(2);
  return /^08\d{7,12}$/.test(p) ? p : undefined; // undefined = format salah
}

function normalizeEmail(v) {
  if (!v) return null;
  const e = String(v).trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 120 ? e : undefined;
}

function maskSecret(v) {
  return v ? 'Terkonfigurasi (nilai disembunyikan)' : 'Belum dikonfigurasi';
}

// Perkiraan durasi baca dari jumlah kata isi artikel (±200 kata/menit). null bila tidak ada isi.
function readMinutes(md) {
  const words = String(md || '').replace(/[#*_>`\-[\]()]/g, ' ').split(/\s+/).filter(Boolean).length;
  return words ? Math.max(1, Math.round(words / 200)) : null;
}

function safeJson(s, def = null) {
  try { return s ? JSON.parse(s) : def; } catch { return def; }
}

module.exports = {
  toDate, fmtDate, timeAgo, slugify, renderMarkdown, stripHtml, truncate,
  randomToken, sha256, normalizePhone, normalizeEmail, maskSecret, safeJson, readMinutes,
};
