'use strict';
// Masuk / daftar / tautkan akun dengan Google. Sesi tetap memakai express-session milik aplikasi
// (tidak ada sistem sesi kedua). Lihat docs/LOGIN-GOOGLE.md untuk konfigurasi Google Cloud.
const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const config = require('../config');
const google = require('../services/google-auth');
const storage = require('../services/storage');
const { limits, requireRole } = require('../middleware/security');
const auth = require('./auth');

const router = express.Router();
const PENDING_TTL_MS = 10 * 60 * 1000;

// Pesan ramah untuk pengguna — tanpa token, secret, atau detail internal.
const MESSAGES = {
  unavailable: 'Masuk dengan Google belum tersedia. Silakan masuk dengan nomor HP/email dan kata sandi.',
  cancelled: 'Masuk dengan Google dibatalkan. Anda tetap bisa masuk dengan nomor HP/email.',
  denied: 'Akun Google ini belum diizinkan. Bila aplikasi masih tahap uji, hanya akun penguji yang terdaftar di Google Cloud yang dapat masuk.',
  state: 'Sesi masuk dengan Google sudah kedaluwarsa atau tidak valid. Silakan coba lagi.',
  expired: 'Sesi masuk dengan Google sudah kedaluwarsa. Silakan coba lagi.',
  network: 'Tidak dapat terhubung ke Google. Periksa koneksi internet lalu coba lagi.',
  exchange: 'Google menolak permintaan masuk. Kemungkinan konfigurasi alamat callback belum sesuai — hubungi admin.',
  invalid_token: 'Verifikasi akun Google gagal. Silakan coba lagi.',
  email_unverified: 'Email akun Google ini belum terverifikasi oleh Google. Gunakan akun Google lain atau masuk dengan nomor HP/email.',
  no_email: 'Akun Google tidak memberikan alamat email. Silakan masuk dengan nomor HP/email.',
  disabled: 'Akun Sahabat Tani Anda sedang dinonaktifkan. Hubungi admin.',
  taken: 'Akun Google ini sudah terhubung ke akun Sahabat Tani lain.',
  generic: 'Masuk dengan Google gagal. Silakan coba lagi atau masuk dengan nomor HP/email.',
};
const CODE_TO_MESSAGE = { state: 'state', expired: 'expired', no_code: 'state', network: 'network', exchange: 'exchange', no_id_token: 'invalid_token', invalid_token: 'invalid_token', nonce: 'invalid_token' };

function fail(req, res, key, to = '/masuk') {
  req.session.flash = { type: 'error', text: MESSAGES[key] || MESSAGES.generic };
  res.redirect(to);
}
function homeFor(user) { return user.role === 'admin' ? '/admin' : '/dashboard'; }

// ---------- Mulai alur ----------
// POST (dengan token CSRF) agar alur tidak bisa dipicu dari situs lain.
router.post('/auth/google', limits.login, async (req, res, next) => {
  const intent = req.body.intent === 'link' ? 'link' : 'login';
  const back = intent === 'link' ? '/profil/google' : (req.body.from === 'daftar' ? '/daftar' : '/masuk');
  if (!google.enabled) return fail(req, res, 'unavailable', back);
  try {
    let userId = null;
    if (intent === 'link') {
      // Menautkan Google ke akun yang sedang masuk: wajib autentikasi ulang dengan kata sandi.
      if (!req.user || req.user.role !== 'farmer') return res.redirect('/masuk');
      const row = db.get('SELECT password_hash FROM users WHERE id = ?', req.user.id);
      const ok = row && row.password_hash && await bcrypt.compare(String(req.body.password || ''), row.password_hash);
      if (!ok) {
        req.session.flash = { type: 'error', text: 'Kata sandi salah. Google belum ditautkan.' };
        return res.redirect('/profil/google');
      }
      userId = req.user.id;
    } else if (req.user) {
      return res.redirect(homeFor(req.user));
    }
    const { flow, url } = await google.begin({ intent, userId });
    req.session.googleFlow = flow;
    req.session.save((err) => (err ? next(err) : res.redirect(url)));
  } catch (err) {
    next(err);
  }
});

// ---------- Callback dari Google ----------
router.get('/auth/google/callback', async (req, res, next) => {
  const flow = req.session.googleFlow;
  delete req.session.googleFlow; // satu kali pakai
  const back = flow && flow.intent === 'link' ? '/profil/google' : '/masuk';
  if (!google.enabled) return fail(req, res, 'unavailable');
  if (req.query.error) {
    const e = String(req.query.error);
    return fail(req, res, e === 'access_denied' ? (flow ? 'cancelled' : 'denied') : (e === 'org_internal' || e === 'admin_policy_enforced' ? 'denied' : 'generic'), back);
  }
  let id;
  try {
    id = await google.complete(flow, { code: req.query.code, state: req.query.state });
  } catch (err) {
    const code = err instanceof google.GoogleAuthError ? err.code : 'generic';
    // Log hanya kode singkat & jenis galat. Pesan galat library TIDAK dicatat karena dapat memuat token.
    if (!config.isTest) console.warn(`[google] gagal: ${code}${err && err.cause ? ' (' + (err.cause.name || 'Error') + (err.cause.response ? ' HTTP ' + err.cause.response.status : '') + ')' : ''}`);
    return fail(req, res, CODE_TO_MESSAGE[code] || 'generic', back);
  }
  try {
    if (flow.intent === 'link') return linkToCurrent(req, res, flow, id);
    return loginOrRegister(req, res, next, id);
  } catch (err) {
    return next(err);
  }
});

function identityOf(sub) {
  return db.get("SELECT * FROM user_identities WHERE provider = 'google' AND subject = ?", sub);
}

function touchIdentity(identityId, email) {
  db.run("UPDATE user_identities SET last_login_at = datetime('now'), email = ? WHERE id = ?", email, identityId);
}

function linkToCurrent(req, res, flow, id) {
  if (!req.user || req.user.id !== flow.userId) return fail(req, res, 'state');
  const existing = identityOf(id.sub);
  if (existing && existing.user_id !== req.user.id) return fail(req, res, 'taken', '/profil/google');
  if (!existing) {
    try {
      db.run("INSERT INTO user_identities (user_id, provider, subject, email) VALUES (?, 'google', ?, ?)", req.user.id, id.sub, id.email);
    } catch (err) {
      if (/UNIQUE/i.test(String(err.message))) return fail(req, res, 'taken', '/profil/google');
      throw err;
    }
  }
  req.session.flash = { type: 'success', text: `Google terhubung${id.email ? ' (' + id.email + ')' : ''}. Anda kini bisa masuk dengan Google.` };
  res.redirect('/profil/google');
}

function loginOrRegister(req, res, next, id) {
  // 1) Identitas Google sudah terhubung → masuk ke akun yang sama (tidak membuat akun baru).
  const linked = identityOf(id.sub);
  if (linked) {
    const user = db.get('SELECT * FROM users WHERE id = ?', linked.user_id);
    if (!user) return fail(req, res, 'generic');
    if (!user.is_active) return fail(req, res, 'disabled');
    touchIdentity(linked.id, id.email);
    return auth.startSession(req, user, (err, returnTo) => (err ? next(err) : res.redirect(returnTo || homeFor(user))));
  }
  if (!id.email) return fail(req, res, 'no_email');
  if (!id.emailVerified) return fail(req, res, 'email_unverified');

  // 2) Email sama dengan akun lokal → TIDAK digabung otomatis. Pengguna harus membuktikan kepemilikan akun lama.
  const local = db.get('SELECT id, is_active FROM users WHERE email = ?', id.email);
  if (local) {
    if (!local.is_active) return fail(req, res, 'disabled');
    req.session.googlePending = { sub: id.sub, email: id.email, at: Date.now() };
    return req.session.save((err) => (err ? next(err) : res.redirect('/auth/google/tautkan')));
  }

  // 3) Pengguna baru → buat akun petani (tanpa kata sandi lokal) + profil, lalu lengkapi profil singkat.
  return createFromGoogle(req, res, next, id);
}

async function fetchGooglePhoto(url, userId) {
  try {
    const u = new URL(url);
    // Hanya dari server foto Google, lewat HTTPS.
    if (u.protocol !== 'https:' || !/(^|\.)googleusercontent\.com$/i.test(u.hostname)) return null;
    const r = await fetch(u, { redirect: 'error', signal: AbortSignal.timeout(6000) });
    if (!r.ok) return null;
    const len = Number(r.headers.get('content-length') || 0);
    if (len > 2 * 1024 * 1024) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > 2 * 1024 * 1024) return null;
    const saved = await storage.saveOptimizedImage({ buffer: buf, size: buf.length }, userId, 'profile');
    return saved.relPath;
  } catch {
    return null; // tanpa foto → avatar inisial
  }
}

async function createFromGoogle(req, res, next, id) {
  let user;
  try {
    user = db.tx(() => {
      const r = db.run("INSERT INTO users (email, password_hash, role) VALUES (?, NULL, 'farmer')", id.email);
      const uid = Number(r.lastInsertRowid);
      db.run('INSERT INTO farmer_profiles (user_id, full_name) VALUES (?, ?)', uid, id.name);
      db.run("INSERT INTO user_identities (user_id, provider, subject, email, last_login_at) VALUES (?, 'google', ?, ?, datetime('now'))", uid, id.sub, id.email);
      return { id: uid, role: 'farmer' };
    });
  } catch (err) {
    // Dua callback bersamaan untuk akun Google yang sama: constraint UNIQUE mencegah duplikat → pakai akun yang sudah dibuat.
    if (/UNIQUE/i.test(String(err.message))) {
      const again = identityOf(id.sub);
      if (again) return loginOrRegister(req, res, next, id);
      return fail(req, res, 'generic');
    }
    return next(err);
  }
  if (id.picture) {
    const photo = await fetchGooglePhoto(id.picture, user.id);
    if (photo) db.run("UPDATE farmer_profiles SET photo_path = ?, updated_at = datetime('now') WHERE user_id = ?", photo, user.id);
  }
  auth.startSession(req, user, (err) => {
    if (err) return next(err);
    req.session.flash = { type: 'success', text: 'Akun Sahabat Tani berhasil dibuat dengan Google. Lengkapi profil singkat Anda.' };
    res.redirect('/profil/lengkapi');
  });
}

// ---------- Email sama dengan akun lama: buktikan kepemilikan dengan kata sandi ----------
function pendingOf(req) {
  const p = req.session.googlePending;
  if (!p || Date.now() - p.at > PENDING_TTL_MS) { delete req.session.googlePending; return null; }
  return p;
}

router.get('/auth/google/tautkan', (req, res) => {
  const p = pendingOf(req);
  if (!p) return fail(req, res, 'expired');
  const local = db.get('SELECT id, password_hash FROM users WHERE email = ?', p.email);
  res.render('auth/google-link', { title: 'Tautkan Akun Google', email: p.email, hasPassword: !!(local && local.password_hash), errors: {} });
});

router.post('/auth/google/tautkan', limits.login, async (req, res, next) => {
  const p = pendingOf(req);
  if (!p) return fail(req, res, 'expired');
  if (req.body.action === 'batal') {
    delete req.session.googlePending;
    req.session.flash = { type: 'success', text: 'Penautan dibatalkan. Akun Google tidak dihubungkan.' };
    return res.redirect('/masuk');
  }
  const user = db.get('SELECT * FROM users WHERE email = ?', p.email);
  const ok = user && user.password_hash && await bcrypt.compare(String(req.body.password || ''), user.password_hash);
  if (!ok) {
    return res.status(401).render('auth/google-link', { title: 'Tautkan Akun Google', email: p.email, hasPassword: !!(user && user.password_hash), errors: { password: 'Kata sandi salah.' } });
  }
  if (!user.is_active) return fail(req, res, 'disabled');
  try {
    db.run("INSERT INTO user_identities (user_id, provider, subject, email, last_login_at) VALUES (?, 'google', ?, ?, datetime('now'))", user.id, p.sub, p.email);
  } catch (err) {
    if (/UNIQUE/i.test(String(err.message))) { delete req.session.googlePending; return fail(req, res, 'taken'); }
    return next(err);
  }
  delete req.session.googlePending;
  auth.startSession(req, user, (err, returnTo) => {
    if (err) return next(err);
    req.session.flash = { type: 'success', text: 'Akun Google berhasil ditautkan. Berikutnya Anda bisa masuk dengan Google.' };
    res.redirect(returnTo || homeFor(user));
  });
});

// ---------- Profil: status & kelola tautan Google ----------
const farmerOnly = requireRole('farmer');

router.get('/profil/google', farmerOnly, (req, res) => {
  const identity = db.get("SELECT email, linked_at, last_login_at FROM user_identities WHERE user_id = ? AND provider = 'google'", req.user.id);
  const hasPassword = !!db.get('SELECT 1 FROM users WHERE id = ? AND password_hash IS NOT NULL', req.user.id);
  res.render('farmer/google', { title: 'Akun Google', identity, hasPassword, googleEnabled: google.enabled });
});

router.post('/profil/google/putus', farmerOnly, (req, res) => {
  // Jangan biarkan akun kehilangan seluruh cara masuk.
  const hasPassword = !!db.get('SELECT 1 FROM users WHERE id = ? AND password_hash IS NOT NULL', req.user.id);
  if (!hasPassword) {
    req.session.flash = { type: 'error', text: 'Buat kata sandi terlebih dahulu sebelum memutus Google, agar Anda tetap bisa masuk.' };
    return res.redirect('/profil/google');
  }
  db.run("DELETE FROM user_identities WHERE user_id = ? AND provider = 'google'", req.user.id);
  req.session.flash = { type: 'success', text: 'Google diputus dari akun ini. Masuk berikutnya memakai nomor HP/email dan kata sandi.' };
  res.redirect('/profil/google');
});

// Pengguna Google tanpa kata sandi lokal dapat membuat kata sandi (opsional) agar punya cara masuk kedua.
router.post('/profil/google/sandi', farmerOnly, limits.login, async (req, res) => {
  const row = db.get('SELECT password_hash FROM users WHERE id = ?', req.user.id);
  if (row && row.password_hash) return res.redirect('/profil/google');
  const password = String(req.body.password || '');
  let error = null;
  if (password.length < 8 || password.length > 72) error = 'Kata sandi harus 8–72 karakter.';
  else if (password !== String(req.body.password_confirm || '')) error = 'Konfirmasi kata sandi tidak sama.';
  if (error) {
    req.session.flash = { type: 'error', text: error };
    return res.redirect('/profil/google');
  }
  db.run('UPDATE users SET password_hash = ? WHERE id = ? AND password_hash IS NULL', await bcrypt.hash(password, auth.BCRYPT_ROUNDS), req.user.id);
  req.session.flash = { type: 'success', text: 'Kata sandi dibuat. Anda kini bisa masuk dengan Google atau nomor HP/email.' };
  res.redirect('/profil/google');
});

module.exports = router;
