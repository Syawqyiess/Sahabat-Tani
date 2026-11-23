'use strict';
// Pengambilan berita pertanian dari sumber nyata (RSS resmi atau halaman HTML yang diizinkan).
// Yang disimpan hanya: judul, ringkasan singkat dari penerbit, tanggal terbit asli (atau kosong bila
// tidak ada — tidak pernah dikarang), nama sumber, dan tautan ke artikel asli.
const db = require('../db');
const { slugify } = require('../lib/util');
const { politeFetch, FetchError } = require('./news/fetcher');
const robots = require('./news/robots');
const ex = require('./news/extract');
const { isRelevant, classify } = require('./news/classify');
const images = require('./news/images');

function config(source) {
  if (source.kind !== 'html') return null;
  try { return JSON.parse(source.config_json || '{}'); } catch { throw new Error('Konfigurasi HTML sumber tidak valid (JSON).'); }
}

function categoryId(slug) {
  const r = db.get('SELECT id FROM article_categories WHERE slug = ?', slug) || db.get("SELECT id FROM article_categories WHERE slug = 'berita-pertanian-umum'");
  return r ? r.id : null;
}

function exists(url, titleKey) {
  const guid = 'url:' + ex.urlKey(url);
  if (db.get('SELECT 1 FROM articles WHERE external_guid = ?', guid)) return 'duplikat (tautan sama)';
  if (titleKey && db.get("SELECT 1 FROM articles WHERE origin = 'external' AND title_key = ?", titleKey)) return 'duplikat (judul sama dari sumber lain)';
  return null;
}

async function ensureAllowed(url, report) {
  const r = await robots.isAllowed(url);
  report.robots = r.status + (r.delay ? `; crawl-delay ${r.delay} dtk` : '');
  if (!r.allowed) throw Object.assign(new FetchError(`diblokir robots.txt untuk ${new URL(url).pathname}`), { robotsBlocked: true });
}

// Mengumpulkan kandidat dari satu sumber. Tidak menyimpan apa pun.
async function collect(source, report) {
  const limit = Math.max(1, Math.min(source.max_items || 10, 30));
  if (source.kind === 'rss') {
    await ensureAllowed(source.feed_url, report);
    const res = await politeFetch(source.feed_url, { accept: 'application/rss+xml,application/xml,text/xml;q=0.9,*/*;q=0.5' });
    return (await ex.parseRss(res.text)).slice(0, source.filter_keywords ? limit * 3 : limit);
  }
  const cfg = config(source);
  await ensureAllowed(source.feed_url, report);
  const list = await politeFetch(source.feed_url);
  const links = ex.parseListing(list.text, list.url, cfg).slice(0, limit * 2);
  if (!links.length) throw new Error('tidak menemukan tautan berita di halaman daftar — struktur situs mungkin berubah; periksa pola tautan');
  const out = [];
  for (const l of links) {
    if (out.length >= limit) break;
    // Lewati yang sudah tersimpan sebelum membuka halamannya — hemat permintaan ke situs sumber.
    if (exists(l.url, null)) { report.skipped.push({ url: l.url, title: l.listTitle, reason: 'duplikat (tautan sama)' }); continue; }
    const r = await robots.isAllowed(l.url);
    if (!r.allowed) { report.skipped.push({ url: l.url, title: l.listTitle, reason: 'diblokir robots.txt' }); continue; }
    let art;
    let html;
    try {
      html = (await politeFetch(l.url)).text;
      art = ex.parseArticle(html, cfg);
    } catch (err) {
      if (err.blocked) throw err; // situs membatasi akses: hentikan sumber ini
      report.skipped.push({ url: l.url, title: l.listTitle, reason: `gagal dibuka (${err.message})` });
      continue;
    }
    const publishedAt = art.publishedAt || l.listDate || null;
    out.push({
      url: l.url,
      title: art.title || l.listTitle,
      summary: art.summary,
      publishedAt,
      dateSource: art.publishedAt ? 'artikel' : (l.listDate ? 'daftar berita' : null),
      guid: l.url,
      html, // dipakai ulang untuk mencari gambar utama tanpa membuka halaman lagi
    });
  }
  return out;
}

async function fetchSource(source, { dryRun = false } = {}) {
  const report = { source: source.name, added: 0, items: [], skipped: [], robots: null, error: null };
  let candidates = [];
  try {
    candidates = await collect(source, report);
  } catch (err) {
    report.error = err.message;
  }
  const limit = Math.max(1, Math.min(source.max_items || 10, 30));
  for (const c of candidates) {
    if (report.items.length >= limit) break;
    const title = (c.title || '').replace(/\s+/g, ' ').trim();
    if (!title || !c.url || !/^https?:\/\//.test(c.url)) { report.skipped.push({ url: c.url, title, reason: 'judul/tautan tidak lengkap' }); continue; }
    if (source.filter_keywords && !isRelevant(title, c.summary)) { report.skipped.push({ url: c.url, title, reason: 'bukan topik pertanian' }); continue; }
    const tKey = ex.titleKey(title);
    const dup = exists(c.url, tKey) || (report.items.some((i) => i.titleKey === tKey) && 'duplikat dalam satu pengambilan');
    if (dup) { report.skipped.push({ url: c.url, title, reason: dup }); continue; }
    const slug = classify(title, c.summary);
    report.items.push({ ...c, title, titleKey: tKey, categorySlug: slug });
  }

  if (!dryRun) {
    db.tx(() => {
      for (const it of report.items) {
        it.id = db.run(
          `INSERT INTO articles (slug, title, summary, category_id, status, origin, source_id, source_name, source_url, external_guid,
                                 published_at, date_source, fetched_at, title_key)
           VALUES (?, ?, ?, ?, 'published', 'external', ?, ?, ?, ?, ?, ?, datetime('now'), ?)`,
          `${slugify(it.title).slice(0, 70)}-${source.id}-${Date.now().toString(36)}${report.added}`,
          it.title, it.summary || null, categoryId(it.categorySlug), source.id, source.name, it.url, 'url:' + ex.urlKey(it.url),
          it.publishedAt ? it.publishedAt.toISOString() : null, it.dateSource, it.titleKey,
        ).lastInsertRowid;
        report.added++;
      }
      db.run(
        `UPDATE news_sources SET last_fetched_at = datetime('now'), last_error = ?, robots_status = ?, last_report = ?,
                last_ok_at = CASE WHEN ? IS NULL THEN datetime('now') ELSE last_ok_at END WHERE id = ?`,
        report.error, report.robots, JSON.stringify({ added: report.added, skipped: report.skipped.length, reasons: countReasons(report.skipped) }),
        report.error, source.id,
      );
    });
  }
  await attachImages(source, report, dryRun);
  return report;
}

// Gambar utama untuk berita yang baru diambil (atau pratinjau mode uji). Halaman artikel yang sudah
// diunduh dipakai ulang; kegagalan gambar tidak membatalkan berita.
async function attachImages(source, report, dryRun) {
  report.images = { ok: 0, fallback: 0 };
  for (const it of report.items) {
    let r;
    try {
      r = await images.resolve({ id: it.id || 0, title: it.title, source_url: it.url }, source, { html: it.html || null, rssItem: it.media || null });
    } catch (err) {
      r = { status: 'gagal', note: err.message };
    }
    it.image = r;
    if (r.status === 'ok') report.images.ok++; else report.images.fallback++;
    if (!dryRun && it.id) images.save(Number(it.id), r);
    delete it.html;
  }
}

function countReasons(skipped) {
  return skipped.reduce((m, s) => { const k = s.reason.replace(/ \(.*$/, ''); m[k] = (m[k] || 0) + 1; return m; }, {});
}

async function fetchAll() {
  const out = [];
  for (const s of db.all('SELECT * FROM news_sources WHERE is_active = 1 ORDER BY id')) {
    const r = await fetchSource(s);
    out.push({ source: s.name, added: r.added, skipped: r.skipped.length, error: r.error });
  }
  // Sinkronisasi berikutnya ikut melanjutkan backfill gambar berita lama secara bertahap.
  try { await images.processPending({ limit: 40 }); } catch (err) { console.error('Backfill gambar berita gagal:', err.message); }
  return out;
}

module.exports = { fetchSource, fetchAll };
