'use strict';
const express = require('express');
const db = require('../db');
const config = require('../config');
const farmers = require('../services/farmers');
const crop = require('../lib/crop');
const storage = require('../services/storage');
const v = require('../lib/validate');
const { requireRole, verifyCsrf } = require('../middleware/security');
const { normalizePhone, normalizeEmail, safeJson } = require('../lib/util');

const router = express.Router();
const farmerOnly = requireRole('farmer');

router.get('/dashboard', farmerOnly, async (req, res) => {
  res.set('Cache-Control', 'no-store'); // kartu Kalender Tanam selalu segar saat kembali dari halaman kalender
  const uid = req.user.id;
  const profile = await farmers.getProfile(uid);
  const lands = await db.all('SELECT * FROM lands WHERE user_id = ? ORDER BY created_at', uid);
  const scans = (await db.all(
    `SELECT s.id, s.status, s.mode, s.result_json, s.created_at, s.image_path, s.chat_session_id, l.name AS land_name
       FROM pest_scans s LEFT JOIN lands l ON l.id = s.land_id WHERE s.user_id = ? ORDER BY s.id DESC LIMIT 4`, uid,
  ))
    .map((s) => ({ ...s, result: safeJson(s.result_json) }));
  const lastChat = await db.get(
    `SELECT s.*, (SELECT content FROM chat_messages m WHERE m.session_id = s.id AND m.role != 'system' ORDER BY m.id DESC LIMIT 1) AS last_message
       FROM chat_sessions s WHERE s.user_id = ? AND s.archived_at IS NULL ORDER BY s.updated_at DESC, s.id DESC LIMIT 1`, uid,
  );
  const articles = await db.all(
    `SELECT a.id, a.slug, a.title, a.summary, a.body_md, a.image_url, a.image_alt, a.image_credit, a.image_kind, a.published_at, a.is_demo, a.origin, a.source_name, c.name AS category_name
       FROM articles a LEFT JOIN article_categories c ON c.id = a.category_id
      WHERE ${require('../lib/articles').PUBLIC_WHERE} ORDER BY a.published_at IS NULL, a.published_at DESC LIMIT 4`,
  );
  const airLand = lands.find((l) => l.lat != null && l.lng != null);
  // Kartu Kalender Masa Tanam: lahan pilihan (?kalender=ID) atau lahan pertama yang punya tanggal tanam.
  // Kartu Kalender Tanam: pratinjau HARI INI (Asia/Jakarta) dari sumber data yang sama dengan halaman kalender.
  // Lahan: pilihan di Dashboard (?kalender=ID) → lahan terakhir dibuka di kalender → lahan bertanggal tanam → lahan pertama.
  const cal = require('../services/calendar');
  const today = crop.todayISO();
  const calLand = cal.pickLand(lands, req.query.kalender, req.session.calLand);
  if (calLand) req.session.calLand = calLand.id;
  const calendar = { today, todayLabel: cal.longDate(today), land: calLand, age: calLand ? crop.cropAge(calLand, today) : null, ...(calLand ? await cal.todayPreview(uid, calLand, today) : { items: [], more: 0, total: 0 }) };
  res.render('farmer/dashboard', {
    title: 'Dashboard',
    profile,
    completeness: farmers.completeness(profile),
    summary: await farmers.landSummary(uid),
    lands: lands.map((l) => ({ ...l, polygon: safeJson(l.polygon_json) })),
    scans,
    lastChat,
    articles,
    airLand,
    calendar,
    maps: config.maps,
    rdkk: { ...await require('../services/rdkk').latest(), title: config.rdkk.title, author: config.rdkk.author, publicUrl: config.rdkk.publicUrl },
  });
});

// Ringkasan aktivitas dari data nyata pengguna (tanpa aktivitas rekaan).
async function activitySummary(uid) {
  const scansN = (await db.get('SELECT COUNT(*) AS n FROM pest_scans WHERE user_id = ?', uid)).n;
  const saved = (await db.get('SELECT COUNT(*) AS n FROM saved_articles WHERE user_id = ?', uid)).n;
  const events = [
    ['scan hama', (await db.get('SELECT MAX(created_at) AS t FROM pest_scans WHERE user_id = ?', uid)).t],
    ['percakapan dengan Asisten AI', (await db.get('SELECT MAX(updated_at) AS t FROM chat_sessions WHERE user_id = ? AND archived_at IS NULL', uid)).t],
    ['memperbarui data lahan', (await db.get("SELECT MAX(updated_at) AS t FROM lands WHERE user_id = ? AND data_source = 'real'", uid)).t],
    ['memperbarui kalender tanam', (await db.get('SELECT MAX(updated_at) AS t FROM land_reminders WHERE user_id = ?', uid)).t],
    ['menyimpan artikel', (await db.get('SELECT MAX(created_at) AS t FROM saved_articles WHERE user_id = ?', uid)).t],
  ].filter((e) => e[1]).sort((a, b) => (a[1] < b[1] ? 1 : -1));
  return { scans: scansN, saved, last: events[0] ? { label: events[0][0], at: events[0][1] } : null };
}

router.get('/profil', farmerOnly, async (req, res) => {
  const profile = await farmers.getProfile(req.user.id);
  res.render('farmer/profile', {
    title: 'Profil Saya', profile, completeness: farmers.completeness(profile), summary: await farmers.landSummary(req.user.id),
    activity: await activitySummary(req.user.id),
    googleIdentity: await db.get("SELECT email FROM user_identities WHERE user_id = ? AND provider = 'google'", req.user.id) || null,
  });
});

// Profil singkat setelah daftar dengan Google: nomor HP, desa, kelompok tani — semuanya opsional.
router.get('/profil/lengkapi', farmerOnly, async (req, res) => {
  const p = await farmers.getProfile(req.user.id) || {};
  res.render('farmer/profile-quick', { title: 'Lengkapi Profil', values: { phone: req.user.phone || '', village: p.village || '', farmer_group: p.farmer_group || '' }, errors: {} });
});

router.post('/profil/lengkapi', farmerOnly, async (req, res) => {
  const errors = {};
  const values = { phone: String(req.body.phone || '').trim(), village: String(req.body.village || '').trim(), farmer_group: String(req.body.farmer_group || '').trim() };
  const phone = values.phone ? normalizePhone(values.phone) : null;
  if (phone === undefined) errors.phone = 'Nomor HP tidak valid. Contoh: 081234567890.';
  else if (phone && await db.get('SELECT 1 FROM users WHERE phone = ? AND id != ?', phone, req.user.id)) errors.phone = 'Nomor HP sudah dipakai akun lain.';
  const village = v.str(values.village, { max: 100, label: 'Desa/kelurahan' }, errors, 'village');
  const group = v.str(values.farmer_group, { max: 120, label: 'Kelompok tani' }, errors, 'farmer_group');
  if (Object.keys(errors).length) return res.status(422).render('farmer/profile-quick', { title: 'Lengkapi Profil', values, errors });
  await db.tx(async () => {
    if (phone) await db.run('UPDATE users SET phone = ? WHERE id = ?', phone, req.user.id);
    await db.run(`INSERT INTO farmer_profiles (user_id, village, farmer_group) VALUES (?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET village = excluded.village, farmer_group = excluded.farmer_group, updated_at = datetime('now')`,
      req.user.id, village || null, group || null);
  });
  req.session.flash = { type: 'success', text: 'Profil disimpan. Selamat datang di Sahabat Tani!' };
  res.redirect('/dashboard');
});

router.get('/profil/ubah', farmerOnly, async (req, res) => {
  res.render('farmer/profile-edit', { title: 'Ubah Profil', values: await farmers.getProfile(req.user.id), errors: {} });
});

function parseProfile(body, errors) {
  return {
    full_name: v.str(body.full_name, { max: 100, label: 'Nama lengkap' }, errors, 'full_name'),
    village: v.str(body.village, { max: 100, label: 'Desa/kelurahan' }, errors, 'village'),
    district: v.str(body.district, { max: 100, label: 'Kecamatan' }, errors, 'district'),
    regency: v.str(body.regency, { max: 100, label: 'Kabupaten/kota' }, errors, 'regency'),
    province: v.str(body.province, { max: 100, label: 'Provinsi' }, errors, 'province'),
    farmer_group: v.str(body.farmer_group, { max: 120, label: 'Kelompok tani' }, errors, 'farmer_group'),
    experience_years: v.num(body.experience_years, { min: 0, max: 80, int: true, label: 'Pengalaman bertani' }, errors, 'experience_years'),
    main_commodity: v.str(body.main_commodity, { max: 80, label: 'Komoditas utama' }, errors, 'main_commodity'),
  };
}

async function parseContact(body, userId, errors) {
  const phone = normalizePhone(body.phone);
  const email = normalizeEmail(body.email);
  if (phone === undefined) errors.phone = 'Nomor HP tidak valid. Contoh: 081234567890.';
  if (email === undefined) errors.email = 'Format email tidak valid.';
  if (!phone && !email && !errors.phone && !errors.email) errors.phone = 'Isi minimal nomor HP atau email untuk login.';
  if (phone && await db.get('SELECT 1 FROM users WHERE phone = ? AND id != ?', phone, userId)) errors.phone = 'Nomor HP sudah dipakai akun lain.';
  if (email && await db.get('SELECT 1 FROM users WHERE email = ? AND id != ?', email, userId)) errors.email = 'Email sudah dipakai akun lain.';
  return { phone: phone || null, email: email || null };
}

router.post('/profil/ubah', farmerOnly, async (req, res) => {
  const errors = {};
  const data = parseProfile(req.body, errors);
  const contact = await parseContact(req.body, req.user.id, errors);
  if (Object.keys(errors).length) {
    return res.status(422).render('farmer/profile-edit', { title: 'Ubah Profil', values: { ...req.body, photo_path: req.user.photo_path }, errors });
  }
  await db.tx(async () => {
    await farmers.updateProfile(req.user.id, data);
    await db.run('UPDATE users SET phone = ?, email = ? WHERE id = ?', contact.phone, contact.email, req.user.id);
  });
  req.session.flash = { type: 'success', text: 'Profil berhasil disimpan.' };
  res.redirect('/profil');
});

router.post('/profil/foto', farmerOnly, storage.single('photo'), verifyCsrf, async (req, res) => {
  try {
    if (req.uploadError) throw new storage.UploadError(req.uploadError);
    const saved = await storage.saveImage(req.file, req.user.id, 'profile');
    await db.run(
      `INSERT INTO farmer_profiles (user_id, photo_path) VALUES (?, ?)
       ON CONFLICT(user_id) DO UPDATE SET photo_path = excluded.photo_path, updated_at = datetime('now')`, req.user.id, saved.relPath,
    );
    req.session.flash = { type: 'success', text: 'Foto profil diperbarui.' };
  } catch (err) {
    if (!(err instanceof storage.UploadError)) throw err;
    req.session.flash = { type: 'error', text: err.message };
  }
  res.redirect(req.body && req.body.back === '/profil' ? '/profil' : '/profil/ubah');
});

router.parseProfile = parseProfile;
router.parseContact = parseContact;
module.exports = router;
