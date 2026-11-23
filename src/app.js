'use strict';
const path = require('node:path');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const config = require('./config');
const db = require('./db');
const SqliteStore = require('./db/session-store');
const { loadUser, csrf } = require('./middleware/security');
const util = require('./lib/util');
const { icon } = require('./lib/icons');
const ai = require('./services/ai');

function createApp() {
  db.open();
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(config.root, 'views'));
  if (config.isProd) app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        // Leaflet disajikan dari server sendiri; ubin peta (OSM/Esri) dimuat sebagai gambar https.
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
        connectSrc: ["'self'"],
        mediaSrc: ["'self'", 'blob:'],
        workerSrc: ["'self'", 'blob:'],
        // Peta kualitas udara Windy disematkan sebagai iframe.
        // Peta kualitas udara Windy disematkan sebagai iframe.
        frameSrc: ["'self'", 'https://embed.windy.com'],
        // Tombol "Lanjutkan dengan Google" mengirim formulir ke server yang lalu mengalihkan ke halaman login Google.
        formAction: ["'self'", 'https://accounts.google.com'],
        upgradeInsecureRequests: config.isProd ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false,
  }));

  app.use('/static', express.static(path.join(config.root, 'public'), { maxAge: config.isProd ? '7d' : 0 }));
  // Leaflet (pustaka peta terbuka) disajikan langsung dari paket npm.
  // Salinan gambar berita (hanya untuk sumber yang mengizinkan penyalinan) — publik seperti beritanya.
  app.use('/media-berita', express.static(path.join(config.uploadDir, 'berita'), { maxAge: '7d', index: false, fallthrough: false,
    setHeaders: (res) => res.set('X-Content-Type-Options', 'nosniff') }));
  app.use('/static/vendor/leaflet', express.static(path.join(config.root, 'node_modules', 'leaflet', 'dist'), { maxAge: config.isProd ? '30d' : 0 }));
  app.use(express.urlencoded({ extended: false, limit: '200kb' }));
  app.use(express.json({ limit: '200kb' }));

  app.use(session({
    name: 'st.sid',
    store: new SqliteStore(),
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: { httpOnly: true, sameSite: 'lax', secure: config.isProd, maxAge: 1000 * 60 * 60 * 24 * 14 },
  }));

  // Variabel umum untuk semua tampilan (disiapkan sebelum CSRF agar halaman galat pun bisa dirender)
  app.use((req, res, next) => {
    res.locals.currentUser = null;
    res.locals.u = util;
    res.locals.crop = require('./lib/crop');
    res.locals.icon = icon;
    res.locals.path = req.path;
    res.locals.flash = req.session.flash || null;
    delete req.session.flash;
    res.locals.aiMode = { vision: ai.vision().mode, chat: ai.chat().mode };
    res.locals.title = 'Sahabat Tani';
    res.locals.uploadMaxMb = Math.round(config.maxUploadBytes / 1024 / 1024);
    res.locals.googleEnabled = config.google.enabled; // tombol Google hanya tampil bila client ID & secret terpasang
    next();
  });
  app.use(csrf);
  app.use(loadUser);

  app.use(require('./routes/public'));
  app.use(require('./routes/auth'));
  app.use(require('./routes/google'));
  app.use(require('./routes/media'));
  app.use(require('./routes/farmer'));
  app.use(require('./routes/lands'));
  app.use(require('./routes/calendar'));
  app.use(require('./routes/scans'));
  app.use(require('./routes/chat'));
  app.use(require('./routes/air'));
  app.use(require('./routes/articles'));
  app.use('/admin', require('./routes/admin'));

  app.use((req, res) => {
    res.status(404).render('errors/error', { title: 'Halaman tidak ditemukan', status: 404, message: 'Halaman yang Anda cari tidak ada atau bukan milik akun Anda.' });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error(err);
    const message = 'Terjadi kesalahan di server. Silakan coba lagi.';
    if (res.headersSent) return;
    if ((req.get('accept') || '').includes('application/json')) return res.status(500).json({ error: message });
    res.status(500).render('errors/error', { title: 'Terjadi kesalahan', status: 500, message });
  });

  return app;
}

module.exports = { createApp };
