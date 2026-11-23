'use strict';
const crypto = require('node:crypto');
const express = require('express');
const db = require('../db');
const crop = require('../lib/crop');
const config = require('../config');
const scans = require('../services/scans');
const storage = require('../services/storage');
const v = require('../lib/validate');
const { requireRole, verifyCsrf, limits, wantsJson } = require('../middleware/security');
const { safeJson } = require('../lib/util');

const router = express.Router();
const farmerOnly = requireRole('farmer');
const AFFECTED_PARTS = ['Daun', 'Batang', 'Pangkal batang', 'Akar', 'Malai/bulir', 'Seluruh tanaman', 'Tidak yakin'];

router.get('/scan', farmerOnly, async (req, res) => {
  // HST tiap lahan dari perhitungan terpusat (tanggal tanam musim aktif, zona Asia/Jakarta).
  const lands = (await db.all('SELECT id, name, commodity, planting_date, season_status FROM lands WHERE user_id = ? ORDER BY name', req.user.id))
    .map((l) => ({ ...l, age: crop.cropAge(l) }));
  const recent = (await db.all(
    `SELECT s.id, s.status, s.mode, s.result_json, s.created_at, s.image_path, s.chat_session_id, l.name AS land_name
       FROM pest_scans s LEFT JOIN lands l ON l.id = s.land_id WHERE s.user_id = ? ORDER BY s.id DESC LIMIT 3`, req.user.id,
  )).map((s) => ({ ...s, result: safeJson(s.result_json) }));
  res.render('scans/new', {
    title: 'Scan Hama Padi', lands, recent, parts: AFFECTED_PARTS, maxMb: Math.round(config.maxUploadBytes / 1048576), idemKey: crypto.randomUUID(),
  });
});

function fail(req, res, status, message) {
  if (wantsJson(req)) return res.status(status).json({ error: message });
  req.session.flash = { type: 'error', text: message };
  res.redirect('/scan');
}

router.post('/scan', farmerOnly, limits.scan, storage.single('photo'), verifyCsrf, async (req, res) => {
  if (req.uploadError) return fail(req, res, 422, req.uploadError);
  if (!req.file) return fail(req, res, 422, 'Belum ada foto. Ambil foto atau pilih dari galeri terlebih dahulu.');
  const key = String(req.body.idempotency_key || '');
  if (!/^[A-Za-z0-9-]{8,64}$/.test(key)) return fail(req, res, 400, 'Formulir tidak lengkap. Muat ulang halaman lalu coba lagi.');

  const errors = {};
  let landId = v.num(req.body.land_id, { min: 1, int: true, label: 'Lahan' }, errors, 'land_id');
  if (landId && !await db.get('SELECT 1 FROM lands WHERE id = ? AND user_id = ?', landId, req.user.id)) errors.land_id = 'Lahan tidak ditemukan.';
  const plantAge = v.num(req.body.plant_age_days, { min: 0, max: 200, int: true, label: 'Umur tanaman' }, errors, 'plant_age_days');
  const affectedPart = v.oneOf(req.body.affected_part || null, AFFECTED_PARTS, { label: 'Bagian tanaman' }, errors, 'affected_part');
  const symptoms = v.str(req.body.symptoms, { max: 500, label: 'Gejala' }, errors, 'symptoms');
  // Asal HST disimpan bersama snapshot umurnya: otomatis dari tanggal tanam, atau diisi/dikoreksi petani.
  const plantAgeSource = plantAge == null ? null : (req.body.plant_age_source === 'tanggal-tanam' ? 'tanggal-tanam' : 'manual');
  if (Object.keys(errors).length) return fail(req, res, 422, Object.values(errors).join(' '));

  let out;
  try {
    out = await scans.createScan(req.user, { file: req.file, idempotencyKey: key, landId: landId || null, plantAge, plantAgeSource, affectedPart, symptoms });
  } catch (err) {
    if (err instanceof storage.UploadError) return fail(req, res, 422, err.message);
    throw err;
  }
  const redirect = `/asisten/${out.sessionId}`;
  if (wantsJson(req)) return res.json({ ok: out.ok !== false, duplicate: !!out.duplicate, error: out.error || null, redirect, scanId: out.scanId });
  res.redirect(redirect);
});

router.get('/scan/riwayat', farmerOnly, async (req, res) => {
  const rows = (await db.all(
    `SELECT s.id, s.status, s.mode, s.result_json, s.created_at, s.image_path, s.chat_session_id, s.error_message, l.name AS land_name
       FROM pest_scans s LEFT JOIN lands l ON l.id = s.land_id WHERE s.user_id = ? ORDER BY s.id DESC LIMIT 100`, req.user.id,
  )).map((s) => ({ ...s, result: safeJson(s.result_json) }));
  res.render('scans/index', { title: 'Riwayat Scan', scans: rows });
});

router.get('/scan/:id', farmerOnly, async (req, res) => {
  const s = await scans.getOwnedScan(req.user.id, req.params.id);
  if (!s) return res.status(404).render('errors/error', { title: 'Scan tidak ditemukan', status: 404, message: 'Scan tidak ditemukan atau bukan milik Anda.' });
  res.render('scans/show', { title: `Scan #${s.id}`, scan: scans.scanView(s), SUBJECT_LABEL: scans.SUBJECT_LABEL });
});

router.post('/scan/:id/ulang', farmerOnly, limits.scan, async (req, res) => {
  const out = await scans.retryScan(req.user, req.params.id);
  if (!out) return res.status(404).render('errors/error', { title: 'Scan tidak ditemukan', status: 404, message: 'Scan tidak ditemukan atau bukan milik Anda.' });
  if (wantsJson(req)) return res.json({ ok: out.ok, error: out.error || null, redirect: `/asisten/${out.sessionId}` });
  req.session.flash = out.ok ? { type: 'success', text: 'Foto berhasil dianalisis.' } : { type: 'error', text: out.error || 'Analisis belum berhasil.' };
  res.redirect(`/asisten/${out.sessionId}`);
});

router.AFFECTED_PARTS = AFFECTED_PARTS;
module.exports = router;
