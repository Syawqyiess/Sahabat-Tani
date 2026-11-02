'use strict';
const express = require('express');
const db = require('../db');
const config = require('../config');
const farmers = require('../services/farmers');
const storage = require('../services/storage');
const v = require('../lib/validate');
const { requireRole, verifyCsrf } = require('../middleware/security');
const { normalizePhone, normalizeEmail, safeJson } = require('../lib/util');

const router = express.Router();
const farmerOnly = requireRole('farmer');

router.get('/dashboard', farmerOnly, (req, res) => {
  const uid = req.user.id;
  const profile = farmers.getProfile(uid);
  const lands = db.all('SELECT * FROM lands WHERE user_id = ? ORDER BY created_at', uid);
  const scans = db.all(
    `SELECT s.id, s.status, s.mode, s.result_json, s.created_at, s.image_path, s.chat_session_id, l.name AS land_name
       FROM pest_scans s LEFT JOIN lands l ON l.id = s.land_id WHERE s.user_id = ? ORDER BY s.id DESC LIMIT 4`, uid,
  )
    .map((s) => ({ ...s, result: safeJson(s.result_json) }));
  const lastChat = db.get(
    `SELECT s.*, (SELECT content FROM chat_messages m WHERE m.session_id = s.id AND m.role != 'system' ORDER BY m.id DESC LIMIT 1) AS last_message
       FROM chat_sessions s WHERE s.user_id = ? ORDER BY s.updated_at DESC, s.id DESC LIMIT 1`, uid,
  );
  const articles = db.all(
    `SELECT a.id, a.slug, a.title, a.summary, a.body_md, a.image_url, a.image_alt, a.published_at, a.is_demo, a.origin, a.source_name, c.name AS category_name
       FROM articles a LEFT JOIN article_categories c ON c.id = a.category_id
      WHERE a.status = 'published' ORDER BY a.published_at DESC LIMIT 3`,
  );
  const airLand = lands.find((l) => l.lat != null && l.lng != null);
  res.render('farmer/dashboard', {
    title: 'Dashboard',
    profile,
    completeness: farmers.completeness(profile),
    summary: farmers.landSummary(uid),
    lands: lands.map((l) => ({ ...l, polygon: safeJson(l.polygon_json) })),
    scans,
    lastChat,
    articles,
    airLand,
    maps: config.maps,
  });
});

router.get('/profil', farmerOnly, (req, res) => {
  const profile = farmers.getProfile(req.user.id);
  res.render('farmer/profile', {
    title: 'Profil Saya', profile, completeness: farmers.completeness(profile), summary: farmers.landSummary(req.user.id),
  });
});

router.get('/profil/ubah', farmerOnly, (req, res) => {
  res.render('farmer/profile-edit', { title: 'Ubah Profil', values: farmers.getProfile(req.user.id), errors: {} });
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

function parseContact(body, userId, errors) {
  const phone = normalizePhone(body.phone);
  const email = normalizeEmail(body.email);
  if (phone === undefined) errors.phone = 'Nomor HP tidak valid. Contoh: 081234567890.';
  if (email === undefined) errors.email = 'Format email tidak valid.';
  if (!phone && !email && !errors.phone && !errors.email) errors.phone = 'Isi minimal nomor HP atau email untuk login.';
  if (phone && db.get('SELECT 1 FROM users WHERE phone = ? AND id != ?', phone, userId)) errors.phone = 'Nomor HP sudah dipakai akun lain.';
  if (email && db.get('SELECT 1 FROM users WHERE email = ? AND id != ?', email, userId)) errors.email = 'Email sudah dipakai akun lain.';
  return { phone: phone || null, email: email || null };
}

router.post('/profil/ubah', farmerOnly, (req, res) => {
  const errors = {};
  const data = parseProfile(req.body, errors);
  const contact = parseContact(req.body, req.user.id, errors);
  if (Object.keys(errors).length) {
    return res.status(422).render('farmer/profile-edit', { title: 'Ubah Profil', values: { ...req.body, photo_path: req.user.photo_path }, errors });
  }
  db.tx(() => {
    farmers.updateProfile(req.user.id, data);
    db.run('UPDATE users SET phone = ?, email = ? WHERE id = ?', contact.phone, contact.email, req.user.id);
  });
  req.session.flash = { type: 'success', text: 'Profil berhasil disimpan.' };
  res.redirect('/profil');
});

router.post('/profil/foto', farmerOnly, storage.single('photo'), verifyCsrf, (req, res) => {
  try {
    if (req.uploadError) throw new storage.UploadError(req.uploadError);
    const saved = storage.saveImage(req.file, req.user.id, 'profile');
    db.run(
      `INSERT INTO farmer_profiles (user_id, photo_path) VALUES (?, ?)
       ON CONFLICT(user_id) DO UPDATE SET photo_path = excluded.photo_path, updated_at = datetime('now')`, req.user.id, saved.relPath,
    );
    req.session.flash = { type: 'success', text: 'Foto profil diperbarui.' };
  } catch (err) {
    if (!(err instanceof storage.UploadError)) throw err;
    req.session.flash = { type: 'error', text: err.message };
  }
  res.redirect('/profil/ubah');
});

router.parseProfile = parseProfile;
router.parseContact = parseContact;
module.exports = router;
