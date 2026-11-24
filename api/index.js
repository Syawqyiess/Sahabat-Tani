'use strict';
// Titik masuk Vercel (serverless function). Seluruh permintaan diarahkan ke sini oleh vercel.json.
// Aplikasi Express yang sama dengan `npm start`, tetapi tanpa app.listen() dan tanpa timer latar belakang:
// tugas berkala dijalankan Vercel Cron lewat /cron/harian (lihat src/routes/cron.js).
// Pastikan database Supabase sudah dimigrasi (npm run migrate dengan DB_DRIVER=postgres) sebelum deploy.
const { createApp } = require('../src/app');

module.exports = createApp();
