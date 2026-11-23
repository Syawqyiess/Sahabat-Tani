'use strict';
// Ekstraksi metadata artikel dari RSS & HTML. Hanya judul, ringkasan singkat dari penerbit,
// tanggal terbit asli, dan tautan yang diambil — isi artikel & gambar tidak disalin.
const cheerio = require('cheerio');
const Parser = require('rss-parser');
const { stripHtml, truncate } = require('../../lib/util');

const SUMMARY_MAX = 280;
const MONTHS = {
  jan: 0, januari: 0, january: 0, feb: 1, februari: 1, february: 1, mar: 2, maret: 2, march: 2, apr: 3, april: 3,
  mei: 4, may: 4, jun: 5, juni: 5, june: 5, jul: 6, juli: 6, july: 6, agu: 7, agt: 7, ags: 7, agustus: 7, aug: 7, august: 7,
  sep: 8, sept: 8, september: 8, okt: 9, oktober: 9, oct: 9, october: 9, nov: 10, november: 10, des: 11, desember: 11, dec: 11, december: 11,
};

// Tanggal dari teks: ISO 8601, "08 Nov 2026, 20:14 WIB", "20 Okt 2026", "26-07-2026 19:49:23".
// Tanpa zona waktu dianggap WIB (UTC+7). Mengembalikan null bila tidak yakin — tanggal tidak pernah ditebak.
function parseDate(input) {
  if (!input) return null;
  const s = String(input).replace(/\s+/g, ' ').trim();
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) {
    const d = new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(s) ? s : s + '+07:00');
    return valid(d);
  }
  let m = s.match(/(\d{1,2})\s+([A-Za-z]{3,9})\.?\s+(\d{4})(?:[,\s]+(?:pukul\s+)?(\d{1,2})[:.](\d{2}))?/i);
  if (m && MONTHS[m[2].toLowerCase()] !== undefined) {
    return wib(+m[3], MONTHS[m[2].toLowerCase()], +m[1], m[4] ? +m[4] : 0, m[5] ? +m[5] : 0);
  }
  m = s.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (m) return wib(+m[3], +m[2] - 1, +m[1], m[4] ? +m[4] : 0, m[5] ? +m[5] : 0);
  const d = new Date(s); // format RFC 822 di RSS ("Sat, 14 Nov 2026 10:00:00 +0700")
  return /\d{4}/.test(s) ? valid(d) : null;
}

function wib(y, mo, d, h, mi) {
  if (mo < 0 || mo > 11 || d < 1 || d > 31) return null;
  return valid(new Date(Date.UTC(y, mo, d, h - 7, mi)));
}

function valid(d) {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return null;
  // Tolak tanggal yang mustahil (jauh di masa depan / terlalu lampau) daripada menyimpannya.
  if (d.getTime() > Date.now() + 36 * 3600 * 1000 || d.getUTCFullYear() < 2000) return null;
  return d;
}

// Kunci URL untuk mencegah duplikat: tanpa fragmen, parameter pelacak, garis miring ganda/akhir.
function urlKey(u) {
  try {
    const x = new URL(u);
    x.hash = '';
    [...x.searchParams.keys()].filter((k) => /^(utm_|fbclid|gclid|ref$|amp$)/i.test(k)).forEach((k) => x.searchParams.delete(k));
    const path = x.pathname.replace(/\/{2,}/g, '/').replace(/\/$/, '');
    return `${x.host.replace(/^www\./, '').toLowerCase()}${path}${x.search}`;
  } catch { return String(u); }
}

// Kunci judul untuk mencegah berita yang sama dari beberapa sumber (mis. siaran pers).
function titleKey(t) {
  return stripHtml(t).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 160);
}

function cleanSummary(s) {
  const t = stripHtml(s || '').replace(/\s*(\.\.\.|…)\s*$/, '').trim();
  return t ? truncate(t, SUMMARY_MAX) : '';
}

const rss = new Parser({
  timeout: 15000,
  // Gambar berita dari RSS resmi (media RSS & enclosure) — dipakai sebagai kandidat gambar utama.
  customFields: { item: [['media:content', 'mediaContent', { keepArray: true }], ['media:thumbnail', 'mediaThumbnail', { keepArray: true }]] },
});

async function parseRss(xml) {
  const feed = await rss.parseString(xml);
  return (feed.items || []).map((it) => ({
    url: it.link,
    title: stripHtml(it.title || ''),
    summary: cleanSummary(it.contentSnippet || it.summary || it.content || ''),
    publishedAt: parseDate(it.isoDate || it.pubDate),
    dateSource: (it.isoDate || it.pubDate) ? 'rss' : null,
    guid: it.guid || it.link,
    categories: (it.categories || []).map(String),
    media: { mediaContent: it.mediaContent, mediaThumbnail: it.mediaThumbnail, enclosure: it.enclosure },
  }));
}

function first($, selectors) {
  for (const sel of selectors || []) {
    const el = $(sel).first();
    if (!el.length) continue;
    const v = (el.attr('content') ?? el.attr('datetime') ?? el.text() ?? '').replace(/\s+/g, ' ').trim();
    if (v) return v;
  }
  return '';
}

// Halaman daftar: tautan artikel yang cocok pola, beserta tanggal dari daftar bila dikonfigurasi.
function parseListing(html, baseUrl, cfg) {
  const $ = cheerio.load(html);
  const re = new RegExp(cfg.link_pattern);
  const out = [];
  const byKey = new Map();
  // Satu berita sering punya beberapa tautan (gambar + judul): gabungkan, lengkapi judul/tanggal dari tautan mana pun.
  $('a[href]').each((_, a) => {
    let href;
    try { href = new URL($(a).attr('href'), baseUrl).toString(); } catch { return; }
    if (!re.test(href)) return;
    const key = urlKey(href);
    let item = byKey.get(key);
    if (!item) { item = { url: href, listTitle: '', listDate: null }; byKey.set(key, item); out.push(item); }
    const text = $(a).text().replace(/\s+/g, ' ').trim();
    if (text.length > item.listTitle.length) item.listTitle = text;
    if (!item.listDate && cfg.list_item && cfg.list_date) {
      item.listDate = parseDate($(a).closest(cfg.list_item).find(cfg.list_date).first().text());
    }
  });
  return out;
}

// Halaman artikel: hanya metadata (judul, ringkasan meta, tanggal) — isi tidak disimpan.
function parseArticle(html, cfg) {
  const $ = cheerio.load(html);
  const a = cfg.article || {};
  const dateText = first($, a.date);
  const canonical = $('link[rel="canonical"]').attr('href') || $('meta[property="og:url"]').attr('content') || null;
  return {
    title: stripHtml(first($, a.title || ['meta[property="og:title"]', 'h1'])),
    summary: cleanSummary(first($, a.summary || ['meta[property="og:description"]', 'meta[name="description"]'])),
    publishedAt: parseDate(dateText),
    dateText,
    canonical,
  };
}

module.exports = { parseDate, urlKey, titleKey, cleanSummary, parseRss, parseListing, parseArticle, SUMMARY_MAX };
