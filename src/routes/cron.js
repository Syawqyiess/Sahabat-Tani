'use strict';
// Tugas berkala untuk hosting serverless (Vercel Cron). Di server biasa (npm start) tugas ini dijalankan
// oleh timer di src/server.js; di Vercel tidak ada proses yang menyala terus, jadi Vercel memanggil rute ini
// sesuai jadwal di vercel.json dengan header "Authorization: Bearer <CRON_SECRET>".
const crypto = require('node:crypto');
const express = require('express');
const config = require('../config');
const db = require('../db');

const router = express.Router();

function authorized(req) {
  const secret = config.cronSecret;
  if (!secret) return false;
  const sent = Buffer.from(String(req.get('authorization') || ''));
  const want = Buffer.from(`Bearer ${secret}`);
  return sent.length === want.length && crypto.timingSafeEqual(sent, want);
}

router.get('/cron/harian', async (req, res) => {
  // Tanpa CRON_SECRET rute ini tidak ada; dengan secret yang salah juga tampak tidak ada.
  if (!authorized(req)) return res.status(404).end();
  const out = { mulai: new Date().toISOString() };
  try {
    const rdkk = require('../services/rdkk');
    if (await rdkk.isStale()) {
      const r = await rdkk.refresh();
      out.rdkk = r.ok ? 'diperbarui' : `gagal: ${r.error}`;
    } else out.rdkk = 'masih baru';
  } catch (err) { out.rdkk = `gagal: ${err.message}`; }
  try {
    const r = await require('../services/news').fetchAll();
    out.berita = r.map((s) => `${s.source}: +${s.added}${s.error ? ' (galat: ' + s.error + ')' : ''}`);
  } catch (err) { out.berita = `gagal: ${err.message}`; }
  try {
    const r = await db.run('DELETE FROM sessions WHERE expires < ?', Date.now());
    out.sesiDibersihkan = r.changes;
  } catch (err) { out.sesiDibersihkan = `gagal: ${err.message}`; }
  out.selesai = new Date().toISOString();
  console.log('[cron/harian]', JSON.stringify(out));
  res.set('Cache-Control', 'no-store').json(out);
});

module.exports = router;
