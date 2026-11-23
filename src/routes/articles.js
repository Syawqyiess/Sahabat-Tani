'use strict';
const express = require('express');
const db = require('../db');
const { requireRole } = require('../middleware/security');
const { PUBLIC_WHERE, isPublic } = require('../lib/articles');

const router = express.Router();
// Halaman 1: satu headline + 12 kartu. Halaman berikutnya: 12 kartu. 12 habis dibagi 1, 2, 3, dan 4 kolom,
// jadi baris terakhir grid selalu penuh di semua lebar layar (grid auto-fill bisa 1–4 kolom).
const FIRST_PAGE = 13;
const PER_PAGE = 12;
function pageWindow(page) {
  return page === 1 ? { limit: FIRST_PAGE, offset: 0 } : { limit: PER_PAGE, offset: FIRST_PAGE + (page - 2) * PER_PAGE };
}
function pageCount(total) {
  return total <= FIRST_PAGE ? 1 : 1 + Math.ceil((total - FIRST_PAGE) / PER_PAGE);
}

router.get('/artikel', async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 100);
  const cat = String(req.query.kategori || '').trim();
  // Parameter lama ?jenis=… (tab yang sudah dihapus) diabaikan dengan mengarahkan ke daftar yang sama tanpa parameter itu.
  if (req.query.jenis !== undefined) {
    const p = new URLSearchParams(req.query);
    p.delete('jenis');
    const s = p.toString();
    return res.redirect(301, '/artikel' + (s ? '?' + s : ''));
  }
  const page = Math.max(1, Number.parseInt(req.query.hal, 10) || 1);
  // Penyaringan di query: hanya berita dari sumber eksternal nyata (lihat src/lib/articles.js).
  const where = [PUBLIC_WHERE];
  const params = [];
  if (q) {
    where.push("(a.title LIKE ? ESCAPE '\\' OR a.summary LIKE ? ESCAPE '\\' OR a.tags LIKE ? ESCAPE '\\')");
    const like = `%${q.replace(/[\\%_]/g, (m) => '\\' + m)}%`;
    params.push(like, like, like);
  }
  if (cat) { where.push('c.slug = ?'); params.push(cat); }
  const w = where.join(' AND ');
  const total = (await db.get(`SELECT COUNT(*) AS n FROM articles a LEFT JOIN article_categories c ON c.id = a.category_id WHERE ${w}`, ...params)).n;
  // Nomor halaman melewati batas (mis. tautan lama) → ke halaman terakhir yang berisi, bukan halaman kosong.
  if (total > 0 && page > pageCount(total)) {
    const p = new URLSearchParams(req.query);
    p.set('hal', String(pageCount(total)));
    if (pageCount(total) === 1) p.delete('hal');
    const s = p.toString();
    return res.redirect('/artikel' + (s ? '?' + s : ''));
  }
  const articles = await db.all(
    `SELECT a.id, a.slug, a.title, a.summary, a.body_md, a.image_url, a.image_alt, a.image_credit, a.image_kind, a.published_at, a.is_demo, a.origin, a.source_name, a.source_url,
            c.name AS category_name, c.slug AS category_slug
       FROM articles a LEFT JOIN article_categories c ON c.id = a.category_id
      WHERE ${w}
      ORDER BY a.published_at IS NULL, a.published_at DESC, a.id DESC
      LIMIT ? OFFSET ?`, ...params, pageWindow(page).limit, pageWindow(page).offset,
  );
  const saved = req.user && req.user.role === 'farmer' ? new Set((await db.all('SELECT article_id FROM saved_articles WHERE user_id = ?', req.user.id)).map((r) => r.article_id)) : null;
  const freshness = await db.get(
    `SELECT MAX(a.fetched_at) AS last, (SELECT COUNT(*) FROM news_sources WHERE is_active = 1) AS sources
       FROM articles a WHERE a.origin = 'external'`,
  );
  res.render('articles/index', {
    title: 'Berita & Artikel Pertanian',
    articles, saved, q, cat, freshness,
    // Kategori dihitung dari berita yang benar-benar tampil (kategori tanpa berita eksternal disembunyikan).
    categories: await db.all(`SELECT c.*, COUNT(a.id) AS n FROM article_categories c LEFT JOIN articles a ON a.category_id = c.id AND ${PUBLIC_WHERE}
                          GROUP BY c.id HAVING COUNT(a.id) > 0 OR c.slug = ? ORDER BY c.id`, cat),
    page, pages: pageCount(total), total,
  });
});

router.get('/artikel/:slug', async (req, res) => {
  const isAdmin = req.user && req.user.role === 'admin';
  const a = await db.get(
    `SELECT a.*, c.name AS category_name, c.slug AS category_slug FROM articles a
       LEFT JOIN article_categories c ON c.id = a.category_id WHERE a.slug = ?`, req.params.slug,
  );
  if (!a || (a.status !== 'published' && !isAdmin)) {
    return res.status(404).render('errors/error', { title: 'Artikel tidak ditemukan', status: 404, message: 'Artikel tidak ditemukan atau belum diterbitkan.' });
  }
  // Artikel internal (URL lama) tidak lagi tersedia untuk umum; admin tetap dapat meninjau dari panel admin.
  if (!isPublic(a) && !isAdmin) {
    return res.status(410).render('articles/unavailable', { title: 'Konten tidak lagi tersedia' });
  }
  const related = await db.all(
    `SELECT a.slug, a.title, a.published_at, a.source_name FROM articles a WHERE ${PUBLIC_WHERE} AND a.id != ? AND a.category_id IS ?
      ORDER BY a.published_at IS NULL, a.published_at DESC LIMIT 3`, a.id, a.category_id,
  );
  const isSaved = req.user ? !!await db.get('SELECT 1 FROM saved_articles WHERE user_id = ? AND article_id = ?', req.user.id, a.id) : false;
  res.render('articles/show', { title: a.title, article: a, related, isSaved });
});

router.post('/artikel/:id/simpan', requireRole('farmer'), async (req, res) => {
  const id = Number(req.params.id);
  const a = await db.get('SELECT * FROM articles WHERE id = ?', id);
  const existing = a && await db.get('SELECT 1 FROM saved_articles WHERE user_id = ? AND article_id = ?', req.user.id, id);
  // Konten yang tidak lagi tersedia hanya boleh DIHAPUS dari simpanan, tidak bisa disimpan baru.
  if (!a || (!isPublic(a) && !existing)) return res.status(404).render('errors/error', { title: 'Artikel tidak ditemukan', status: 404, message: 'Artikel tidak ditemukan.' });
  if (existing) await db.run('DELETE FROM saved_articles WHERE user_id = ? AND article_id = ?', req.user.id, id);
  else await db.run('INSERT INTO saved_articles (user_id, article_id) VALUES (?, ?)', req.user.id, id);
  req.session.flash = { type: 'success', text: existing ? 'Artikel dihapus dari daftar tersimpan.' : 'Artikel disimpan.' };
  const back = String(req.body.back || '');
  res.redirect(back.startsWith('/') && !back.startsWith('//') ? back : (isPublic(a) ? `/artikel/${a.slug}` : '/artikel-tersimpan'));
});

router.get('/artikel-tersimpan', requireRole('farmer'), async (req, res) => {
  const articles = (await db.all(
    `SELECT a.id, a.slug, a.title, a.summary, a.body_md, a.image_url, a.image_alt, a.image_credit, a.image_kind, a.published_at, a.is_demo, a.origin, a.source_name, a.source_url, a.status,
            c.name AS category_name, s.created_at AS saved_at
       FROM saved_articles s JOIN articles a ON a.id = s.article_id LEFT JOIN article_categories c ON c.id = a.category_id
      WHERE s.user_id = ? ORDER BY s.created_at DESC`, req.user.id,
  )).map((a) => ({ ...a, unavailable: !isPublic(a) })); // simpanan lama ke konten internal ditandai, tidak dihapus
  res.render('articles/saved', { title: 'Artikel Tersimpan', articles, layout: 'fill' });
});

module.exports = router;
