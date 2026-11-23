'use strict';
const crypto = require('node:crypto');
const { rateLimit } = require('express-rate-limit');
const db = require('../db');
const config = require('../config');

// ---------- Autentikasi & peran ----------

async function loadUser(req, res, next) {
  res.locals.currentUser = null;
  const uid = req.session && req.session.userId;
  if (!uid) return next();
  const user = await db.get(
    `SELECT u.id, u.phone, u.email, u.role, u.is_active, u.is_demo, p.full_name, p.photo_path
       FROM users u LEFT JOIN farmer_profiles p ON p.user_id = u.id WHERE u.id = ?`, uid,
  );
  if (!user || !user.is_active) {
    // Akun dinonaktifkan admin: sesi langsung diputus.
    return req.session.destroy(() => {
      res.clearCookie('st.sid');
      res.redirect('/masuk?nonaktif=1');
    });
  }
  req.user = user;
  res.locals.currentUser = user;
  next();
}

function requireLogin(req, res, next) {
  if (req.user) return next();
  if (wantsJson(req)) return res.status(401).json({ error: 'Silakan masuk terlebih dahulu.' });
  req.session.returnTo = req.originalUrl;
  res.redirect('/masuk');
}

function requireRole(role) {
  return (req, res, next) => {
    if (!req.user) return requireLogin(req, res, next);
    if (req.user.role !== role) {
      return res.status(403).render('errors/error', { title: 'Akses ditolak', status: 403, message: 'Halaman ini tidak tersedia untuk akun Anda.' });
    }
    next();
  };
}

function wantsJson(req) {
  return req.xhr || (req.get('accept') || '').includes('application/json');
}

// ---------- CSRF (synchronizer token di sesi) ----------

function csrfToken(req) {
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(24).toString('base64url');
  return req.session.csrf;
}

function csrfValid(req) {
  const sent = (req.body && req.body._csrf) || req.get('x-csrf-token') || '';
  const real = req.session && req.session.csrf;
  if (!real || !sent || sent.length !== real.length) return false;
  return crypto.timingSafeEqual(Buffer.from(sent), Buffer.from(real));
}

function csrf(req, res, next) {
  res.locals.csrfToken = csrfToken(req);
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  // Form multipart diverifikasi setelah multer mem-parsing body (lihat verifyCsrf).
  if ((req.get('content-type') || '').startsWith('multipart/form-data')) return next();
  if (!csrfValid(req)) return csrfFail(req, res);
  next();
}

function verifyCsrf(req, res, next) {
  if (!csrfValid(req)) return csrfFail(req, res);
  next();
}

function csrfFail(req, res) {
  // Diagnosis ringkas (tanpa nilai token): membantu melacak "Formulir kedaluwarsa".
  if (!config.isTest) {
    const sent = (req.body && req.body._csrf) || req.get('x-csrf-token') || '';
    console.warn(`[csrf] ditolak ${req.method} ${req.path} — cookie sesi: ${/(?:^|;\s*)st\.sid=/.test(req.get('cookie') || '') ? 'ada' : 'TIDAK ADA'}, token sesi: ${req.session && req.session.csrf ? 'ada' : 'tidak ada'}, token form: ${sent ? 'ada' : 'TIDAK ADA'}, content-type: ${(req.get('content-type') || '-').split(';')[0]}`);
  }
  const message = 'Sesi formulir kedaluwarsa. Muat ulang halaman lalu coba lagi.';
  if (wantsJson(req)) return res.status(403).json({ error: message });
  res.status(403).render('errors/error', { title: 'Formulir kedaluwarsa', status: 403, message });
}

// ---------- Pembatasan permintaan ----------

const limiterBase = {
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: () => config.isTest && !process.env.TEST_RATE_LIMIT,
  handler: (req, res, _next, options) => {
    const message = options.message;
    if (wantsJson(req)) return res.status(429).json({ error: message });
    res.status(429).render('errors/error', { title: 'Terlalu banyak percobaan', status: 429, message });
  },
};

const limits = {
  login: rateLimit({ ...limiterBase, windowMs: 15 * 60 * 1000, limit: 10, message: 'Terlalu banyak percobaan masuk. Tunggu 15 menit lalu coba lagi.' }),
  reset: rateLimit({ ...limiterBase, windowMs: 60 * 60 * 1000, limit: 5, message: 'Terlalu banyak permintaan reset kata sandi. Coba lagi dalam 1 jam.' }),
  scan: rateLimit({
    ...limiterBase, windowMs: 60 * 60 * 1000, limit: 20,
    keyGenerator: (req) => `u${req.user ? req.user.id : 'anon'}`,
    message: 'Batas pemindaian per jam tercapai (20 foto). Coba lagi nanti.',
  }),
  chat: rateLimit({
    ...limiterBase, windowMs: 60 * 60 * 1000, limit: 60,
    keyGenerator: (req) => `u${req.user ? req.user.id : 'anon'}`,
    message: 'Batas pesan per jam tercapai. Coba lagi nanti.',
  }),
};

module.exports = { loadUser, requireLogin, requireRole, wantsJson, csrf, verifyCsrf, limits };
