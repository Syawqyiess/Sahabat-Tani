'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const config = require('../config');
const ai = require('../services/ai');
const news = require('../services/news');
const farmers = require('../services/farmers');
const v = require('../lib/validate');
const { requireRole } = require('../middleware/security');
const { slugify, renderMarkdown, randomToken, maskSecret } = require('../lib/util');
const { parseProfile, parseContact } = require('./farmer');
const { parseLand, SEASON_STATUSES } = require('./lands');
const { BCRYPT_ROUNDS } = require('./auth');

const router = express.Router();
router.use(requireRole('admin'));

function flash(req, type, text) { req.session.flash = { type, text }; }
function notFound(res, what = 'Data') {
  return res.status(404).render('errors/error', { title: `${what} tidak ditemukan`, status: 404, message: `${what} tidak ditemukan.` });
}

// ---------- Dashboard: statistik agregat, tanpa membuka isi percakapan ----------
router.get('/', (req, res) => {
  const stats = {
    farmers: db.get("SELECT COUNT(*) n, SUM(is_active) active FROM users WHERE role = 'farmer'"),
    lands: db.get("SELECT COUNT(*) n, SUM(data_source = 'demo') demo, SUM(lat IS NOT NULL) geo FROM lands"),
    scans: db.all('SELECT status, COUNT(*) n FROM pest_scans GROUP BY status'),
    scans7: db.get("SELECT COUNT(*) n FROM pest_scans WHERE created_at >= datetime('now', '-7 days')").n,
    sessions: db.get('SELECT COUNT(*) n FROM chat_sessions').n,
    messages: db.get("SELECT COUNT(*) n FROM chat_messages WHERE role = 'user'").n,
    articles: db.all('SELECT status, COUNT(*) n FROM articles GROUP BY status'),
    incomplete: db.get(
      `SELECT COUNT(*) n FROM users u LEFT JOIN farmer_profiles p ON p.user_id = u.id
        WHERE u.role = 'farmer' AND (p.full_name IS NULL OR p.village IS NULL OR p.regency IS NULL OR p.province IS NULL)`,
    ).n,
  };
  res.render('admin/dashboard', { title: 'Dashboard Admin', stats });
});

// ---------- Pengguna ----------
router.get('/pengguna', (req, res) => {
  const q = String(req.query.q || '').trim();
  const like = `%${q}%`;
  const users = db.all(
    `SELECT u.*, p.full_name, p.regency, (SELECT COUNT(*) FROM lands l WHERE l.user_id = u.id) AS land_count,
            (SELECT COUNT(*) FROM pest_scans s WHERE s.user_id = u.id) AS scan_count
       FROM users u LEFT JOIN farmer_profiles p ON p.user_id = u.id
      WHERE (? = '' OR p.full_name LIKE ? OR u.phone LIKE ? OR u.email LIKE ?) ORDER BY u.role, u.id`, q, like, like, like,
  );
  res.render('admin/users', { title: 'Manajemen Pengguna', users, q });
});

router.get('/pengguna/baru', (req, res) => res.render('admin/user-new', { title: 'Tambah Akun Petani', values: {}, errors: {}, created: null }));

router.post('/pengguna', async (req, res) => {
  const errors = {};
  const name = v.str(req.body.full_name, { max: 100, required: true, label: 'Nama' }, errors, 'full_name');
  const contact = parseContact(req.body, 0, errors);
  if (Object.keys(errors).length) return res.status(422).render('admin/user-new', { title: 'Tambah Akun Petani', values: req.body, errors, created: null });
  // Kata sandi sementara acak; petani diminta menggantinya lewat "Lupa kata sandi" atau admin menyampaikannya langsung.
  const tempPassword = randomToken(9);
  const hash = await bcrypt.hash(tempPassword, BCRYPT_ROUNDS);
  const id = db.tx(() => {
    const r = db.run("INSERT INTO users (phone, email, password_hash, role) VALUES (?, ?, ?, 'farmer')", contact.phone, contact.email, hash);
    db.run('INSERT INTO farmer_profiles (user_id, full_name) VALUES (?, ?)', r.lastInsertRowid, name);
    return Number(r.lastInsertRowid);
  });
  res.render('admin/user-new', { title: 'Tambah Akun Petani', values: {}, errors: {}, created: { id, name, tempPassword } });
});

router.get('/pengguna/:id', (req, res) => {
  const profile = farmers.getProfile(Number(req.params.id));
  if (!profile) return notFound(res, 'Pengguna');
  const lands = db.all('SELECT * FROM lands WHERE user_id = ? ORDER BY created_at', profile.user_id);
  res.render('admin/user-edit', { title: 'Data Petani', values: profile, profile, errors: {}, lands, completeness: farmers.completeness(profile) });
});

router.post('/pengguna/:id', (req, res) => {
  const profile = farmers.getProfile(Number(req.params.id));
  if (!profile) return notFound(res, 'Pengguna');
  const errors = {};
  const data = parseProfile(req.body, errors);
  const contact = parseContact(req.body, profile.user_id, errors);
  if (Object.keys(errors).length) {
    const lands = db.all('SELECT * FROM lands WHERE user_id = ?', profile.user_id);
    return res.status(422).render('admin/user-edit', { title: 'Data Petani', values: { ...profile, ...req.body }, profile, errors, lands, completeness: farmers.completeness(profile) });
  }
  db.tx(() => {
    farmers.updateProfile(profile.user_id, data);
    db.run('UPDATE users SET phone = ?, email = ? WHERE id = ?', contact.phone, contact.email, profile.user_id);
  });
  flash(req, 'success', 'Data petani disimpan.');
  res.redirect(`/admin/pengguna/${profile.user_id}`);
});

router.post('/pengguna/:id/status', (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) { flash(req, 'error', 'Anda tidak dapat menonaktifkan akun sendiri.'); return res.redirect('/admin/pengguna'); }
  const u = db.get('SELECT id, is_active FROM users WHERE id = ?', id);
  if (!u) return notFound(res, 'Pengguna');
  db.run('UPDATE users SET is_active = ? WHERE id = ?', u.is_active ? 0 : 1, id);
  if (u.is_active) db.run("DELETE FROM sessions WHERE json_extract(sess, '$.userId') = ?", id);
  flash(req, 'success', u.is_active ? 'Akun dinonaktifkan.' : 'Akun diaktifkan kembali.');
  res.redirect('/admin/pengguna');
});

// ---------- Lahan ----------
router.get('/lahan', (req, res) => {
  const lands = db.all(
    `SELECT l.*, p.full_name AS owner_name, u.phone AS owner_phone FROM lands l JOIN users u ON u.id = l.user_id
       LEFT JOIN farmer_profiles p ON p.user_id = l.user_id ORDER BY l.user_id, l.id`,
  );
  res.render('admin/lands', { title: 'Manajemen Data Lahan', lands });
});

function farmerOptions() {
  return db.all("SELECT u.id, COALESCE(p.full_name, u.phone, u.email) AS name FROM users u LEFT JOIN farmer_profiles p ON p.user_id = u.id WHERE u.role = 'farmer' ORDER BY name");
}

router.get('/lahan/baru', (req, res) => {
  res.render('admin/land-form', { title: 'Tambah Lahan Petani', land: { user_id: Number(req.query.user) || '' }, errors: {}, statuses: SEASON_STATUSES, owners: farmerOptions(), action: '/admin/lahan' });
});

router.post('/lahan', (req, res) => {
  const errors = {};
  const d = parseLand(req.body, errors);
  const owner = db.get("SELECT id FROM users WHERE id = ? AND role = 'farmer'", Number(req.body.user_id));
  if (!owner) errors.user_id = 'Pilih pemilik lahan.';
  const source = req.body.data_source === 'demo' ? 'demo' : 'real';
  if (Object.keys(errors).length) {
    return res.status(422).render('admin/land-form', { title: 'Tambah Lahan Petani', land: req.body, errors, statuses: SEASON_STATUSES, owners: farmerOptions(), action: '/admin/lahan' });
  }
  db.run(
    `INSERT INTO lands (user_id, name, address_desc, area_ha, commodity, variety, planting_date, season_status, lat, lng, polygon_json, data_source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    owner.id, d.name, d.address_desc, d.area_ha, d.commodity, d.variety, d.planting_date, d.season_status, d.lat, d.lng, d.polygon_json, source,
  );
  flash(req, 'success', 'Lahan ditambahkan.');
  res.redirect('/admin/lahan');
});

router.get('/lahan/:id/ubah', (req, res) => {
  const land = db.get('SELECT * FROM lands WHERE id = ?', Number(req.params.id));
  if (!land) return notFound(res, 'Lahan');
  res.render('admin/land-form', { title: 'Ubah Lahan', land, errors: {}, statuses: SEASON_STATUSES, owners: farmerOptions(), action: `/admin/lahan/${land.id}` });
});

router.post('/lahan/:id', (req, res) => {
  const land = db.get('SELECT * FROM lands WHERE id = ?', Number(req.params.id));
  if (!land) return notFound(res, 'Lahan');
  const errors = {};
  const d = parseLand(req.body, errors);
  const owner = db.get("SELECT id FROM users WHERE id = ? AND role = 'farmer'", Number(req.body.user_id));
  if (!owner) errors.user_id = 'Pilih pemilik lahan.';
  if (Object.keys(errors).length) {
    return res.status(422).render('admin/land-form', { title: 'Ubah Lahan', land: { ...req.body, id: land.id }, errors, statuses: SEASON_STATUSES, owners: farmerOptions(), action: `/admin/lahan/${land.id}` });
  }
  db.run(
    `UPDATE lands SET user_id = ?, name = ?, address_desc = ?, area_ha = ?, commodity = ?, variety = ?, planting_date = ?, season_status = ?,
            lat = ?, lng = ?, polygon_json = ?, data_source = ?, updated_at = datetime('now') WHERE id = ?`,
    owner.id, d.name, d.address_desc, d.area_ha, d.commodity, d.variety, d.planting_date, d.season_status, d.lat, d.lng, d.polygon_json,
    req.body.data_source === 'demo' ? 'demo' : 'real', land.id,
  );
  flash(req, 'success', 'Lahan disimpan.');
  res.redirect('/admin/lahan');
});

router.post('/lahan/:id/hapus', (req, res) => {
  db.run('DELETE FROM lands WHERE id = ?', Number(req.params.id));
  flash(req, 'success', 'Lahan dihapus.');
  res.redirect('/admin/lahan');
});

// ---------- Artikel ----------
router.get('/artikel', (req, res) => {
  const status = ['draft', 'published', 'archived'].includes(req.query.status) ? req.query.status : '';
  const articles = db.all(
    `SELECT a.id, a.slug, a.title, a.status, a.origin, a.is_demo, a.published_at, a.updated_at, a.source_name, c.name AS category_name
       FROM articles a LEFT JOIN article_categories c ON c.id = a.category_id
      WHERE (? = '' OR a.status = ?) ORDER BY a.updated_at DESC LIMIT 200`, status, status,
  );
  res.render('admin/articles', { title: 'Manajemen Artikel', articles, status });
});

function articleForm(res, article, errors, status = 200) {
  res.status(status).render('admin/article-form', {
    title: article.id ? 'Ubah Artikel' : 'Tulis Artikel', article, errors,
    categories: db.all('SELECT * FROM article_categories ORDER BY name'),
  });
}

function parseArticle(body, errors) {
  const d = {
    title: v.str(body.title, { max: 200, required: true, label: 'Judul' }, errors, 'title'),
    summary: v.str(body.summary, { max: 400, label: 'Ringkasan' }, errors, 'summary'),
    body_md: v.str(body.body_md, { max: 60000, label: 'Isi' }, errors, 'body_md'),
    image_url: v.str(body.image_url, { max: 500, label: 'URL gambar' }, errors, 'image_url'),
    image_alt: v.str(body.image_alt, { max: 200, label: 'Teks alternatif gambar' }, errors, 'image_alt'),
    author_name: v.str(body.author_name, { max: 100, label: 'Penulis' }, errors, 'author_name'),
    tags: v.str(body.tags, { max: 200, label: 'Tag' }, errors, 'tags'),
    source_name: v.str(body.source_name, { max: 120, label: 'Nama sumber' }, errors, 'source_name'),
    source_url: v.str(body.source_url, { max: 500, label: 'Tautan sumber' }, errors, 'source_url'),
    category_id: v.num(body.category_id, { min: 1, int: true, label: 'Kategori' }, errors, 'category_id'),
  };
  if (d.image_url && !/^https:\/\//.test(d.image_url)) errors.image_url = 'URL gambar harus diawali https://';
  if (d.image_url && !d.image_alt) errors.image_alt = 'Teks alternatif wajib diisi bila ada gambar.';
  if (d.source_url && !/^https?:\/\//.test(d.source_url)) errors.source_url = 'Tautan sumber harus diawali http:// atau https://';
  if (body.action === 'publish' && !d.body_md) errors.body_md = 'Isi artikel wajib diisi sebelum diterbitkan.';
  return d;
}

function nextStatus(action, current) {
  if (action === 'publish') return 'published';
  if (action === 'archive') return 'archived';
  if (action === 'draft') return 'draft';
  return current || 'draft';
}

router.get('/artikel/baru', (req, res) => articleForm(res, { author_name: 'Tim Sahabat Tani' }, {}));

router.post('/artikel', (req, res) => {
  const errors = {};
  const d = parseArticle(req.body, errors);
  if (Object.keys(errors).length) return articleForm(res, req.body, errors, 422);
  const status = nextStatus(req.body.action, 'draft');
  let slug = slugify(d.title);
  if (db.get('SELECT 1 FROM articles WHERE slug = ?', slug)) slug += '-' + Date.now().toString(36);
  const r = db.run(
    `INSERT INTO articles (slug, title, summary, body_md, body_html, image_url, image_alt, author_name, author_id, category_id, tags,
                           status, source_name, source_url, published_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    slug, d.title, d.summary, d.body_md, renderMarkdown(d.body_md), d.image_url, d.image_alt, d.author_name, req.user.id, d.category_id, d.tags,
    status, d.source_name, d.source_url, status === 'published' ? new Date().toISOString() : null,
  );
  flash(req, 'success', status === 'published' ? 'Artikel diterbitkan.' : 'Draft disimpan.');
  res.redirect(`/admin/artikel/${r.lastInsertRowid}/ubah`);
});

router.get('/artikel/:id/ubah', (req, res) => {
  const a = db.get('SELECT * FROM articles WHERE id = ?', Number(req.params.id));
  if (!a) return notFound(res, 'Artikel');
  articleForm(res, a, {});
});

router.post('/artikel/:id', (req, res) => {
  const a = db.get('SELECT * FROM articles WHERE id = ?', Number(req.params.id));
  if (!a) return notFound(res, 'Artikel');
  const errors = {};
  const d = parseArticle(req.body, errors);
  if (Object.keys(errors).length) return articleForm(res, { ...req.body, id: a.id, status: a.status, origin: a.origin, slug: a.slug }, errors, 422);
  const status = nextStatus(req.body.action, a.status);
  const publishedAt = status === 'published' && !a.published_at ? new Date().toISOString() : a.published_at;
  db.run(
    `UPDATE articles SET title = ?, summary = ?, body_md = ?, body_html = ?, image_url = ?, image_alt = ?, author_name = ?, category_id = ?,
            tags = ?, status = ?, source_name = ?, source_url = ?, published_at = ?, updated_at = datetime('now') WHERE id = ?`,
    d.title, d.summary, d.body_md, renderMarkdown(d.body_md), d.image_url, d.image_alt, d.author_name, d.category_id, d.tags,
    status, d.source_name, d.source_url, publishedAt, a.id,
  );
  flash(req, 'success', { published: 'Artikel diterbitkan.', archived: 'Artikel diarsipkan.', draft: 'Disimpan sebagai draft.' }[status]);
  res.redirect(`/admin/artikel/${a.id}/ubah`);
});

router.post('/artikel/:id/status', (req, res) => {
  const a = db.get('SELECT * FROM articles WHERE id = ?', Number(req.params.id));
  if (!a) return notFound(res, 'Artikel');
  const status = nextStatus(req.body.action, a.status);
  if (status === 'published' && a.origin === 'internal' && !a.body_md) {
    flash(req, 'error', 'Isi artikel masih kosong. Lengkapi sebelum diterbitkan.');
    return res.redirect('/admin/artikel');
  }
  db.run("UPDATE articles SET status = ?, published_at = COALESCE(published_at, CASE WHEN ? = 'published' THEN ? END), updated_at = datetime('now') WHERE id = ?",
    status, status, new Date().toISOString(), a.id);
  flash(req, 'success', 'Status artikel diperbarui.');
  res.redirect('/admin/artikel');
});

// ---------- Kategori ----------
router.get('/kategori', (req, res) => {
  const categories = db.all('SELECT c.*, (SELECT COUNT(*) FROM articles a WHERE a.category_id = c.id) AS n FROM article_categories c ORDER BY c.id');
  res.render('admin/categories', { title: 'Kategori Artikel', categories, errors: {} });
});

router.post('/kategori', (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 60);
  if (!name) { flash(req, 'error', 'Nama kategori wajib diisi.'); return res.redirect('/admin/kategori'); }
  try {
    db.run('INSERT INTO article_categories (name, slug) VALUES (?, ?)', name, slugify(name));
    flash(req, 'success', 'Kategori ditambahkan.');
  } catch { flash(req, 'error', 'Kategori dengan nama itu sudah ada.'); }
  res.redirect('/admin/kategori');
});

router.post('/kategori/:id', (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 60);
  if (!name) { flash(req, 'error', 'Nama kategori wajib diisi.'); return res.redirect('/admin/kategori'); }
  try {
    db.run('UPDATE article_categories SET name = ?, slug = ? WHERE id = ?', name, slugify(name), Number(req.params.id));
    flash(req, 'success', 'Kategori diperbarui.');
  } catch { flash(req, 'error', 'Kategori dengan nama itu sudah ada.'); }
  res.redirect('/admin/kategori');
});

router.post('/kategori/:id/hapus', (req, res) => {
  db.run('DELETE FROM article_categories WHERE id = ?', Number(req.params.id));
  flash(req, 'success', 'Kategori dihapus. Artikel di dalamnya menjadi tanpa kategori.');
  res.redirect('/admin/kategori');
});

// ---------- Sumber berita (RSS) ----------
router.get('/sumber-berita', (req, res) => {
  const sources = db.all('SELECT s.*, (SELECT COUNT(*) FROM articles a WHERE a.source_id = s.id) AS n FROM news_sources s ORDER BY s.id');
  res.render('admin/sources', { title: 'Sumber Berita', sources, categories: db.all('SELECT * FROM article_categories ORDER BY name'), errors: {}, values: {} });
});

router.post('/sumber-berita', (req, res) => {
  const errors = {};
  const name = v.str(req.body.name, { max: 120, required: true, label: 'Nama sumber' }, errors, 'name');
  const feed = v.str(req.body.feed_url, { max: 500, required: true, label: 'URL feed RSS' }, errors, 'feed_url');
  const home = v.str(req.body.homepage_url, { max: 500, label: 'Situs penerbit' }, errors, 'homepage_url');
  const note = v.str(req.body.usage_note, { max: 500, label: 'Catatan izin' }, errors, 'usage_note');
  const cat = v.num(req.body.category_id, { min: 1, int: true, label: 'Kategori' }, errors, 'category_id');
  if (feed && !/^https?:\/\//.test(feed)) errors.feed_url = 'URL feed harus diawali http:// atau https://';
  if (!note && !errors.usage_note) errors.usage_note = 'Catat dasar izin penggunaan feed (mis. syarat penerbit) sebelum menambahkan.';
  if (Object.keys(errors).length) {
    const sources = db.all('SELECT s.*, 0 AS n FROM news_sources s ORDER BY s.id');
    return res.status(422).render('admin/sources', { title: 'Sumber Berita', sources, categories: db.all('SELECT * FROM article_categories ORDER BY name'), errors, values: req.body });
  }
  try {
    db.run('INSERT INTO news_sources (name, feed_url, homepage_url, usage_note, category_id) VALUES (?, ?, ?, ?, ?)', name, feed, home, note, cat);
    flash(req, 'success', 'Sumber berita ditambahkan. Tekan "Ambil sekarang" untuk mengambil berita.');
  } catch { flash(req, 'error', 'URL feed tersebut sudah terdaftar.'); }
  res.redirect('/admin/sumber-berita');
});

router.post('/sumber-berita/:id/ambil', async (req, res) => {
  const s = db.get('SELECT * FROM news_sources WHERE id = ?', Number(req.params.id));
  if (!s) return notFound(res, 'Sumber');
  const out = await news.fetchSource(s);
  flash(req, out.error ? 'error' : 'success', out.error ? `Gagal mengambil feed: ${out.error}` : `${out.added} berita baru ditambahkan.`);
  res.redirect('/admin/sumber-berita');
});

router.post('/sumber-berita/:id/status', (req, res) => {
  db.run('UPDATE news_sources SET is_active = 1 - is_active WHERE id = ?', Number(req.params.id));
  res.redirect('/admin/sumber-berita');
});

router.post('/sumber-berita/:id/hapus', (req, res) => {
  db.run('DELETE FROM news_sources WHERE id = ?', Number(req.params.id));
  flash(req, 'success', 'Sumber dihapus. Berita yang sudah diambil tetap ada dan bisa diarsipkan.');
  res.redirect('/admin/sumber-berita');
});

// ---------- Referensi hama ----------
router.get('/referensi-hama', (req, res) => {
  res.render('admin/pests', { title: 'Referensi Hama', pests: db.all('SELECT * FROM pest_references ORDER BY name') });
});

function parsePest(body, errors) {
  const d = {
    name: v.str(body.name, { max: 120, required: true, label: 'Nama hama' }, errors, 'name'),
    scientific_name: v.str(body.scientific_name, { max: 120, label: 'Nama ilmiah' }, errors, 'scientific_name'),
    aliases: v.str(body.aliases, { max: 300, label: 'Nama lain' }, errors, 'aliases'),
    symptoms: v.str(body.symptoms, { max: 3000, label: 'Gejala' }, errors, 'symptoms'),
    visual_signs: v.str(body.visual_signs, { max: 3000, label: 'Ciri visual' }, errors, 'visual_signs'),
    ipm_control: v.str(body.ipm_control, { max: 3000, label: 'Pengendalian' }, errors, 'ipm_control'),
    prevention: v.str(body.prevention, { max: 3000, label: 'Pencegahan' }, errors, 'prevention'),
    when_to_consult: v.str(body.when_to_consult, { max: 1000, label: 'Kapan ke penyuluh' }, errors, 'when_to_consult'),
    source_name: v.str(body.source_name, { max: 200, label: 'Nama sumber' }, errors, 'source_name'),
    source_url: v.str(body.source_url, { max: 500, label: 'Tautan sumber' }, errors, 'source_url'),
  };
  if (d.source_url && !/^https?:\/\//.test(d.source_url)) errors.source_url = 'Tautan harus diawali http:// atau https://';
  return d;
}

router.get('/referensi-hama/baru', (req, res) => res.render('admin/pest-form', { title: 'Tambah Referensi Hama', pest: {}, errors: {} }));

router.post('/referensi-hama', (req, res) => {
  const errors = {};
  const d = parsePest(req.body, errors);
  if (Object.keys(errors).length) return res.status(422).render('admin/pest-form', { title: 'Tambah Referensi Hama', pest: req.body, errors });
  let slug = slugify(d.name);
  if (db.get('SELECT 1 FROM pest_references WHERE slug = ?', slug)) slug += '-' + Date.now().toString(36);
  db.run(
    `INSERT INTO pest_references (slug, name, scientific_name, aliases, symptoms, visual_signs, ipm_control, prevention, when_to_consult, source_name, source_url)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    slug, d.name, d.scientific_name, d.aliases, d.symptoms, d.visual_signs, d.ipm_control, d.prevention, d.when_to_consult, d.source_name, d.source_url,
  );
  flash(req, 'success', 'Referensi ditambahkan (belum diverifikasi).');
  res.redirect('/admin/referensi-hama');
});

router.get('/referensi-hama/:id/ubah', (req, res) => {
  const pest = db.get('SELECT * FROM pest_references WHERE id = ?', Number(req.params.id));
  if (!pest) return notFound(res, 'Referensi');
  res.render('admin/pest-form', { title: 'Ubah Referensi Hama', pest, errors: {} });
});

router.post('/referensi-hama/:id', (req, res) => {
  const pest = db.get('SELECT * FROM pest_references WHERE id = ?', Number(req.params.id));
  if (!pest) return notFound(res, 'Referensi');
  const errors = {};
  const d = parsePest(req.body, errors);
  if (Object.keys(errors).length) return res.status(422).render('admin/pest-form', { title: 'Ubah Referensi Hama', pest: { ...req.body, id: pest.id }, errors });
  // Perubahan isi membatalkan status verifikasi; perlu diverifikasi ulang.
  db.run(
    `UPDATE pest_references SET name = ?, scientific_name = ?, aliases = ?, symptoms = ?, visual_signs = ?, ipm_control = ?, prevention = ?,
            when_to_consult = ?, source_name = ?, source_url = ?, is_verified = 0, verified_by = NULL, verified_at = NULL, updated_at = datetime('now')
      WHERE id = ?`,
    d.name, d.scientific_name, d.aliases, d.symptoms, d.visual_signs, d.ipm_control, d.prevention, d.when_to_consult, d.source_name, d.source_url, pest.id,
  );
  flash(req, 'success', 'Referensi disimpan. Status verifikasi direset — verifikasi ulang bila sudah diperiksa.');
  res.redirect('/admin/referensi-hama');
});

router.post('/referensi-hama/:id/verifikasi', (req, res) => {
  const pest = db.get('SELECT * FROM pest_references WHERE id = ?', Number(req.params.id));
  if (!pest) return notFound(res, 'Referensi');
  const verifier = String(req.body.verified_by || '').trim().slice(0, 120);
  if (!pest.is_verified) {
    if (!verifier) { flash(req, 'error', 'Isi nama/instansi pemverifikasi (mis. penyuluh atau POPT).'); return res.redirect('/admin/referensi-hama'); }
    if (!pest.source_name) { flash(req, 'error', 'Isi sumber rujukan terlebih dahulu sebelum memverifikasi.'); return res.redirect('/admin/referensi-hama'); }
    db.run("UPDATE pest_references SET is_verified = 1, verified_by = ?, verified_at = datetime('now'), is_demo = 0 WHERE id = ?", verifier, pest.id);
    flash(req, 'success', 'Referensi ditandai terverifikasi.');
  } else {
    db.run('UPDATE pest_references SET is_verified = 0, verified_by = NULL, verified_at = NULL WHERE id = ?', pest.id);
    flash(req, 'success', 'Status verifikasi dicabut.');
  }
  res.redirect('/admin/referensi-hama');
});

// ---------- Status integrasi (tanpa menampilkan nilai kunci) ----------
router.get('/integrasi', (req, res) => {
  const lastAir = db.get("SELECT * FROM integration_events WHERE service = 'open-meteo' ORDER BY id DESC LIMIT 1");
  const lastScanAi = db.get("SELECT provider, model, status, error_message, completed_at FROM pest_scans WHERE mode = 'ai' ORDER BY id DESC LIMIT 1");
  const vision = ai.vision();
  const chat = ai.chat();
  const aiKeys = `ANTHROPIC_API_KEY: ${maskSecret(config.ai.anthropicKey)} · GEMINI_API_KEY: ${maskSecret(config.ai.geminiKey)}`;
  res.render('admin/integrations', {
    title: 'Status Integrasi',
    items: [
      {
        name: 'Analisis gambar (AI)', status: vision.mode === 'ai' ? 'aktif' : 'demo',
        detail: vision.mode === 'ai' ? `Penyedia: ${vision.name}, model: ${vision.model}` : 'Mode demo — foto tidak dianalisis oleh model.',
        secret: aiKeys,
        last: lastScanAi ? `Scan AI terakhir: ${lastScanAi.status}${lastScanAi.error_message ? ` (${lastScanAi.error_message})` : ''}` : 'Belum ada scan dengan AI.',
      },
      {
        name: 'Asisten percakapan (AI)', status: chat.mode === 'ai' ? 'aktif' : 'demo',
        detail: chat.mode === 'ai' ? `Penyedia: ${chat.name}, model: ${chat.model}, dukung gambar: ${chat.supportsImages ? 'ya' : 'tidak'}` : 'Mode demo — "Simulasi respons AI".',
        secret: aiKeys,
      },
      {
        name: 'Catatan privasi AI', status: [vision.name, chat.name].includes('gemini') ? 'perhatian' : 'aktif',
        detail: [vision.name, chat.name].includes('gemini')
          ? 'Gemini free tier: Google dapat memakai foto & pesan yang dikirim untuk meningkatkan produknya. Cocok untuk demo; untuk data petani asli gunakan tier berbayar atau beri tahu petani.'
          : 'Tidak ada catatan khusus untuk penyedia yang aktif.',
        secret: '—',
      },
      {
        name: 'Google Maps JavaScript API', status: config.maps.browserKey ? 'aktif' : 'belum',
        detail: config.maps.browserKey ? 'Browser key terpasang. Pastikan dibatasi per domain (HTTP referrer) dan hanya Maps JavaScript API.' : 'Peta menampilkan placeholder informatif.',
        secret: `GOOGLE_MAPS_BROWSER_KEY: ${maskSecret(config.maps.browserKey)}`,
      },
      {
        name: 'Open-Meteo Air Quality API', status: lastAir ? (lastAir.ok ? 'aktif' : 'galat') : 'belum dipakai',
        detail: 'Tanpa API key untuk penggunaan non-komersial. Cache ' + config.air.cacheMinutes + ' menit.',
        secret: 'Tidak memerlukan kunci',
        last: lastAir ? `Permintaan terakhir: ${lastAir.ok ? 'berhasil' : 'gagal'} — ${lastAir.message} (${lastAir.created_at} UTC)` : null,
      },
      {
        name: 'Berita RSS', status: db.get('SELECT COUNT(*) n FROM news_sources WHERE is_active = 1').n ? 'aktif' : 'belum',
        detail: 'Sumber dikelola di menu Sumber Berita.',
        secret: 'Tidak memerlukan kunci',
      },
      {
        name: 'Email/SMS (reset kata sandi)', status: 'belum',
        detail: config.mail.showResetLinkOnScreen ? 'Belum terhubung. Mode demo: tautan reset ditampilkan di layar & log server.' : 'Belum terhubung. Tautan reset hanya tercatat di log server.',
        secret: '—',
      },
    ],
  });
});

module.exports = router;
