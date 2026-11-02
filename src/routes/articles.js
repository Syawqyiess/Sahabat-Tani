'use strict';
const express = require('express');
const db = require('../db');
const { requireRole } = require('../middleware/security');

const router = express.Router();
const PER_PAGE = 9;

router.get('/artikel', (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 100);
  const cat = String(req.query.kategori || '').trim();
  const page = Math.max(1, Number.parseInt(req.query.hal, 10) || 1);
  const where = ["a.status = 'published'"];
  const params = [];
  if (q) {
    where.push("(a.title LIKE ? ESCAPE '\\' OR a.summary LIKE ? ESCAPE '\\' OR a.tags LIKE ? ESCAPE '\\')");
    const like = `%${q.replace(/[\\%_]/g, (m) => '\\' + m)}%`;
    params.push(like, like, like);
  }
  if (cat) { where.push('c.slug = ?'); params.push(cat); }
  const w = where.join(' AND ');
  const total = db.get(`SELECT COUNT(*) AS n FROM articles a LEFT JOIN article_categories c ON c.id = a.category_id WHERE ${w}`, ...params).n;
  const articles = db.all(
    `SELECT a.id, a.slug, a.title, a.summary, a.body_md, a.image_url, a.image_alt, a.published_at, a.is_demo, a.origin, a.source_name, a.source_url,
            c.name AS category_name, c.slug AS category_slug
       FROM articles a LEFT JOIN article_categories c ON c.id = a.category_id
      WHERE ${w} ORDER BY a.published_at DESC, a.id DESC LIMIT ? OFFSET ?`, ...params, PER_PAGE, (page - 1) * PER_PAGE,
  );
  const saved = req.user && req.user.role === 'farmer' ? new Set(db.all('SELECT article_id FROM saved_articles WHERE user_id = ?', req.user.id).map((r) => r.article_id)) : null;
  res.render('articles/index', {
    title: 'Artikel & Berita',
    articles, saved, q, cat,
    categories: db.all('SELECT * FROM article_categories ORDER BY id'),
    page, pages: Math.max(1, Math.ceil(total / PER_PAGE)), total,
  });
});

router.get('/artikel/:slug', (req, res) => {
  const isAdmin = req.user && req.user.role === 'admin';
  const a = db.get(
    `SELECT a.*, c.name AS category_name, c.slug AS category_slug FROM articles a
       LEFT JOIN article_categories c ON c.id = a.category_id WHERE a.slug = ?`, req.params.slug,
  );
  if (!a || (a.status !== 'published' && !isAdmin)) {
    return res.status(404).render('errors/error', { title: 'Artikel tidak ditemukan', status: 404, message: 'Artikel tidak ditemukan atau belum diterbitkan.' });
  }
  const related = db.all(
    `SELECT slug, title, published_at, is_demo FROM articles WHERE status = 'published' AND id != ? AND category_id IS ?
      ORDER BY published_at DESC LIMIT 3`, a.id, a.category_id,
  );
  const isSaved = req.user ? !!db.get('SELECT 1 FROM saved_articles WHERE user_id = ? AND article_id = ?', req.user.id, a.id) : false;
  res.render('articles/show', { title: a.title, article: a, related, isSaved });
});

router.post('/artikel/:id/simpan', requireRole('farmer'), (req, res) => {
  const id = Number(req.params.id);
  const a = db.get("SELECT id, slug FROM articles WHERE id = ? AND status = 'published'", id);
  if (!a) return res.status(404).render('errors/error', { title: 'Artikel tidak ditemukan', status: 404, message: 'Artikel tidak ditemukan.' });
  const existing = db.get('SELECT 1 FROM saved_articles WHERE user_id = ? AND article_id = ?', req.user.id, id);
  if (existing) db.run('DELETE FROM saved_articles WHERE user_id = ? AND article_id = ?', req.user.id, id);
  else db.run('INSERT INTO saved_articles (user_id, article_id) VALUES (?, ?)', req.user.id, id);
  req.session.flash = { type: 'success', text: existing ? 'Artikel dihapus dari daftar tersimpan.' : 'Artikel disimpan.' };
  const back = String(req.body.back || '');
  res.redirect(back.startsWith('/') && !back.startsWith('//') ? back : `/artikel/${a.slug}`);
});

router.get('/artikel-tersimpan', requireRole('farmer'), (req, res) => {
  const articles = db.all(
    `SELECT a.id, a.slug, a.title, a.summary, a.body_md, a.image_url, a.image_alt, a.published_at, a.is_demo, a.origin, a.source_name, a.source_url, c.name AS category_name, s.created_at AS saved_at
       FROM saved_articles s JOIN articles a ON a.id = s.article_id LEFT JOIN article_categories c ON c.id = a.category_id
      WHERE s.user_id = ? AND a.status = 'published' ORDER BY s.created_at DESC`, req.user.id,
  );
  res.render('articles/saved', { title: 'Artikel Tersimpan', articles });
});

module.exports = router;
