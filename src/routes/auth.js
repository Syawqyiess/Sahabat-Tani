'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const config = require('../config');
const { limits } = require('../middleware/security');
const { normalizePhone, normalizeEmail, randomToken, sha256 } = require('../lib/util');

const router = express.Router();
const BCRYPT_ROUNDS = config.isTest ? 4 : 12;
// Hash tiruan agar waktu respons login sama untuk akun yang ada maupun tidak.
const DUMMY_HASH = bcrypt.hashSync('tidak-dipakai', BCRYPT_ROUNDS);

function findByIdentifier(id) {
  const phone = normalizePhone(id);
  if (phone) return db.get('SELECT * FROM users WHERE phone = ?', phone);
  const email = normalizeEmail(id);
  if (email) return db.get('SELECT * FROM users WHERE email = ?', email);
  return null;
}

function startSession(req, user, cb) {
  // Ganti ID sesi saat login untuk mencegah session fixation.
  const returnTo = req.session.returnTo;
  req.session.regenerate((err) => {
    if (err) return cb(err);
    req.session.userId = user.id;
    db.run("UPDATE users SET last_login_at = datetime('now') WHERE id = ?", user.id);
    cb(null, returnTo && returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : null);
  });
}

router.get('/masuk', (req, res) => {
  if (req.user) return res.redirect(req.user.role === 'admin' ? '/admin' : '/dashboard');
  res.render('auth/login', { title: 'Masuk', errors: {}, values: {}, inactive: req.query.nonaktif === '1', resetDone: req.query.reset === '1' });
});

router.post('/masuk', limits.login, async (req, res, next) => {
  const identifier = String(req.body.identifier || '').trim();
  const password = String(req.body.password || '');
  const user = findByIdentifier(identifier);
  const ok = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);
  if (!user || !ok) {
    return res.status(401).render('auth/login', { title: 'Masuk', errors: { form: 'Nomor HP/email atau kata sandi salah.' }, values: { identifier }, inactive: false, resetDone: false });
  }
  if (!user.is_active) {
    return res.status(403).render('auth/login', { title: 'Masuk', errors: { form: 'Akun Anda sedang dinonaktifkan. Hubungi admin.' }, values: { identifier }, inactive: false, resetDone: false });
  }
  startSession(req, user, (err, returnTo) => {
    if (err) return next(err);
    res.redirect(returnTo || (user.role === 'admin' ? '/admin' : '/dashboard'));
  });
});

router.get('/daftar', (req, res) => {
  if (req.user) return res.redirect('/dashboard');
  res.render('auth/register', { title: 'Daftar', errors: {}, values: {} });
});

router.post('/daftar', limits.login, async (req, res, next) => {
  const values = { full_name: String(req.body.full_name || '').trim(), phone: String(req.body.phone || '').trim(), email: String(req.body.email || '').trim() };
  const errors = {};
  if (!values.full_name) errors.full_name = 'Nama wajib diisi.';
  else if (values.full_name.length > 100) errors.full_name = 'Nama terlalu panjang.';
  const phone = normalizePhone(values.phone);
  if (!values.phone) errors.phone = 'Nomor HP wajib diisi.';
  else if (phone === undefined) errors.phone = 'Nomor HP tidak valid. Contoh: 081234567890.';
  const email = normalizeEmail(values.email);
  if (email === undefined) errors.email = 'Format email tidak valid.';
  const password = String(req.body.password || '');
  if (password.length < 8) errors.password = 'Kata sandi minimal 8 karakter.';
  else if (password.length > 72) errors.password = 'Kata sandi maksimal 72 karakter.';
  if (password !== String(req.body.password_confirm || '')) errors.password_confirm = 'Konfirmasi kata sandi tidak sama.';
  if (!errors.phone && phone && db.get('SELECT 1 FROM users WHERE phone = ?', phone)) errors.phone = 'Nomor HP sudah terdaftar. Silakan masuk.';
  if (!errors.email && email && db.get('SELECT 1 FROM users WHERE email = ?', email)) errors.email = 'Email sudah terdaftar.';
  if (Object.keys(errors).length) return res.status(422).render('auth/register', { title: 'Daftar', errors, values });

  const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const user = db.tx(() => {
    const r = db.run("INSERT INTO users (phone, email, password_hash, role) VALUES (?, ?, ?, 'farmer')", phone, email, hash);
    const id = Number(r.lastInsertRowid);
    db.run('INSERT INTO farmer_profiles (user_id, full_name) VALUES (?, ?)', id, values.full_name);
    return { id, role: 'farmer' };
  });
  startSession(req, user, (err) => {
    if (err) return next(err);
    req.session.flash = { type: 'success', text: 'Akun berhasil dibuat. Selamat datang di Sahabat Tani!' };
    res.redirect('/dashboard');
  });
});

router.post('/keluar', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('st.sid');
    res.redirect('/masuk');
  });
});

// ---------- Pemulihan kata sandi ----------

router.get('/lupa-sandi', (req, res) => {
  res.render('auth/forgot', { title: 'Lupa kata sandi', errors: {}, values: {}, sent: false, demoLink: null });
});

router.post('/lupa-sandi', limits.reset, (req, res) => {
  const identifier = String(req.body.identifier || '').trim();
  const user = findByIdentifier(identifier);
  let demoLink = null;
  if (user && user.is_active) {
    const token = randomToken();
    db.run("INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES (?, ?, datetime('now', '+30 minutes'))", user.id, sha256(token));
    const link = `${config.appUrl}/reset-sandi/${token}`;
    // Layanan SMS/email belum terhubung. Di mode demo tautan ditampilkan di layar dan dicatat di log server.
    console.log(`[reset sandi] user ${user.id}: ${link}`);
    if (config.mail.showResetLinkOnScreen) demoLink = link;
  }
  // Pesan sama untuk akun yang ada maupun tidak, agar tidak membocorkan daftar akun.
  res.render('auth/forgot', { title: 'Lupa kata sandi', errors: {}, values: { identifier }, sent: true, demoLink });
});

function validReset(token) {
  return db.get(
    "SELECT * FROM password_resets WHERE token_hash = ? AND used_at IS NULL AND expires_at > datetime('now')", sha256(token),
  );
}

router.get('/reset-sandi/:token', (req, res) => {
  const ok = !!validReset(req.params.token);
  res.render('auth/reset', { title: 'Atur ulang kata sandi', errors: {}, token: req.params.token, invalid: !ok });
});

router.post('/reset-sandi/:token', limits.reset, async (req, res) => {
  const reset = validReset(req.params.token);
  if (!reset) return res.status(400).render('auth/reset', { title: 'Atur ulang kata sandi', errors: {}, token: req.params.token, invalid: true });
  const password = String(req.body.password || '');
  const errors = {};
  if (password.length < 8 || password.length > 72) errors.password = 'Kata sandi harus 8–72 karakter.';
  if (password !== String(req.body.password_confirm || '')) errors.password_confirm = 'Konfirmasi kata sandi tidak sama.';
  if (Object.keys(errors).length) return res.status(422).render('auth/reset', { title: 'Atur ulang kata sandi', errors, token: req.params.token, invalid: false });
  const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  db.tx(() => {
    db.run('UPDATE users SET password_hash = ? WHERE id = ?', hash, reset.user_id);
    db.run("UPDATE password_resets SET used_at = datetime('now') WHERE user_id = ? AND used_at IS NULL", reset.user_id);
    // Keluarkan semua sesi lama pengguna ini.
    db.run("DELETE FROM sessions WHERE json_extract(sess, '$.userId') = ?", reset.user_id);
  });
  res.redirect('/masuk?reset=1');
});

router.BCRYPT_ROUNDS = BCRYPT_ROUNDS;
module.exports = router;
