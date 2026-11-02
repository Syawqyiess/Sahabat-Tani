'use strict';
const Parser = require('rss-parser');
const db = require('../db');
const { stripHtml, truncate, slugify, toDate } = require('../lib/util');

// Integrasi berita eksternal via RSS. Hanya judul, ringkasan pendek, tanggal asli, sumber,
// dan tautan ke penerbit yang disimpan — isi artikel lengkap TIDAK disalin.

const parser = new Parser({ timeout: 10000, headers: { 'user-agent': 'SahabatTani/0.1 (+agregator berita pertanian)' } });
const SUMMARY_MAX = 280;

async function fetchSource(source) {
  let feed;
  try {
    feed = await parser.parseURL(source.feed_url);
  } catch (err) {
    db.run("UPDATE news_sources SET last_error = ?, last_fetched_at = datetime('now') WHERE id = ?", `Gagal mengambil feed: ${err.message}`.slice(0, 300), source.id);
    return { added: 0, error: err.message };
  }
  let added = 0;
  for (const item of feed.items || []) {
    const link = item.link && /^https?:\/\//.test(item.link) ? item.link : null;
    const guid = `${source.id}:${item.guid || link || item.title}`;
    if (!link || !item.title) continue;
    // Cegah duplikat berdasarkan GUID maupun tautan asli.
    if (db.get('SELECT 1 FROM articles WHERE external_guid = ? OR source_url = ?', guid, link)) continue;
    const pub = toDate(item.isoDate || item.pubDate);
    const title = truncate(stripHtml(item.title), 200);
    db.run(
      `INSERT INTO articles (slug, title, summary, category_id, status, origin, source_id, source_name, source_url, external_guid, published_at, author_name)
       VALUES (?, ?, ?, ?, 'published', 'external', ?, ?, ?, ?, ?, ?)`,
      `${slugify(title)}-${Date.now().toString(36)}${added}`, title,
      truncate(stripHtml(item.contentSnippet || item.summary || item.content || ''), SUMMARY_MAX),
      source.category_id, source.id, source.name, link, guid,
      pub ? pub.toISOString() : null, item.creator || item.author || null,
    );
    added++;
  }
  db.run("UPDATE news_sources SET last_error = NULL, last_fetched_at = datetime('now') WHERE id = ?", source.id);
  return { added };
}

async function fetchAll() {
  const sources = db.all('SELECT * FROM news_sources WHERE is_active = 1');
  const out = [];
  for (const s of sources) out.push({ source: s.name, ...(await fetchSource(s)) });
  return out;
}

module.exports = { fetchSource, fetchAll };
