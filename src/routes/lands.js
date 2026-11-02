'use strict';
const express = require('express');
const db = require('../db');
const config = require('../config');
const v = require('../lib/validate');
const { requireRole } = require('../middleware/security');
const { safeJson } = require('../lib/util');

const router = express.Router();
const farmerOnly = requireRole('farmer');

const SEASON_STATUSES = ['Persiapan lahan', 'Persemaian', 'Tanam', 'Vegetatif', 'Generatif', 'Menjelang panen', 'Panen', 'Bera'];

function parseLand(body, errors) {
  const data = {
    name: v.str(body.name, { max: 100, required: true, label: 'Nama lahan' }, errors, 'name'),
    address_desc: v.str(body.address_desc, { max: 300, label: 'Lokasi' }, errors, 'address_desc'),
    area_ha: v.num(body.area_ha, { min: 0.001, max: 10000, label: 'Luas lahan' }, errors, 'area_ha'),
    commodity: v.str(body.commodity, { max: 80, label: 'Komoditas' }, errors, 'commodity'),
    variety: v.str(body.variety, { max: 80, label: 'Varietas' }, errors, 'variety'),
    planting_date: v.date(body.planting_date, { label: 'Tanggal tanam' }, errors, 'planting_date'),
    season_status: v.oneOf(body.season_status, SEASON_STATUSES, { label: 'Status musim tanam' }, errors, 'season_status'),
    lat: v.num(body.lat, { min: -11.5, max: 6.5, label: 'Lintang (latitude)' }, errors, 'lat'),
    lng: v.num(body.lng, { min: 94, max: 141.5, label: 'Bujur (longitude)' }, errors, 'lng'),
    polygon_json: v.polygon(body.polygon_json, errors, 'polygon_json'),
  };
  if ((data.lat == null) !== (data.lng == null) && !errors.lat && !errors.lng) errors.lat = 'Isi lintang dan bujur sekaligus, atau kosongkan keduanya.';
  return data;
}

// Semua query lahan selalu dibatasi user_id pemilik.
function ownedLand(req) {
  return db.get('SELECT * FROM lands WHERE id = ? AND user_id = ?', Number(req.params.id), req.user.id);
}

function withShape(l) {
  return { ...l, polygon: safeJson(l.polygon_json) };
}

router.get('/lahan', farmerOnly, (req, res) => {
  const lands = db.all(
    `SELECT l.*, (SELECT COUNT(*) FROM pest_scans s WHERE s.land_id = l.id) AS scan_count
       FROM lands l WHERE l.user_id = ? ORDER BY l.created_at`, req.user.id,
  ).map(withShape);
  res.render('lands/index', { title: 'Lahan Saya', lands });
});

router.get('/lahan/peta', farmerOnly, (req, res) => {
  const lands = db.all('SELECT * FROM lands WHERE user_id = ? ORDER BY created_at', req.user.id).map(withShape);
  res.render('lands/map', { title: 'Peta Lahan', lands, maps: config.maps, selected: Number(req.query.pilih) || null });
});

router.get('/lahan/baru', farmerOnly, (req, res) => {
  res.render('lands/form', { title: 'Tambah Lahan', land: {}, errors: {}, statuses: SEASON_STATUSES, action: '/lahan' });
});

router.post('/lahan', farmerOnly, (req, res) => {
  const errors = {};
  const d = parseLand(req.body, errors);
  if (Object.keys(errors).length) {
    return res.status(422).render('lands/form', { title: 'Tambah Lahan', land: req.body, errors, statuses: SEASON_STATUSES, action: '/lahan' });
  }
  const r = db.run(
    `INSERT INTO lands (user_id, name, address_desc, area_ha, commodity, variety, planting_date, season_status, lat, lng, polygon_json, data_source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'real')`,
    req.user.id, d.name, d.address_desc, d.area_ha, d.commodity, d.variety, d.planting_date, d.season_status, d.lat, d.lng, d.polygon_json,
  );
  req.session.flash = { type: 'success', text: 'Lahan berhasil ditambahkan.' };
  res.redirect(`/lahan/${r.lastInsertRowid}`);
});

router.get('/lahan/:id', farmerOnly, (req, res) => {
  const land = ownedLand(req);
  if (!land) return res.status(404).render('errors/error', { title: 'Lahan tidak ditemukan', status: 404, message: 'Lahan tidak ditemukan atau bukan milik Anda.' });
  const scans = db.all('SELECT id, status, mode, result_json, created_at FROM pest_scans WHERE land_id = ? AND user_id = ? ORDER BY id DESC LIMIT 10', land.id, req.user.id)
    .map((s) => ({ ...s, result: safeJson(s.result_json) }));
  res.render('lands/show', { title: land.name, land: withShape(land), scans, maps: config.maps });
});

router.get('/lahan/:id/ubah', farmerOnly, (req, res) => {
  const land = ownedLand(req);
  if (!land) return res.status(404).render('errors/error', { title: 'Lahan tidak ditemukan', status: 404, message: 'Lahan tidak ditemukan atau bukan milik Anda.' });
  res.render('lands/form', { title: 'Ubah Lahan', land, errors: {}, statuses: SEASON_STATUSES, action: `/lahan/${land.id}` });
});

router.post('/lahan/:id', farmerOnly, (req, res) => {
  const land = ownedLand(req);
  if (!land) return res.status(404).render('errors/error', { title: 'Lahan tidak ditemukan', status: 404, message: 'Lahan tidak ditemukan atau bukan milik Anda.' });
  const errors = {};
  const d = parseLand(req.body, errors);
  if (Object.keys(errors).length) {
    return res.status(422).render('lands/form', { title: 'Ubah Lahan', land: { ...req.body, id: land.id, data_source: land.data_source }, errors, statuses: SEASON_STATUSES, action: `/lahan/${land.id}` });
  }
  // Lahan demo menjadi data asli hanya bila petani menyatakannya secara eksplisit.
  const source = req.body.mark_real === '1' ? 'real' : land.data_source;
  db.run(
    `UPDATE lands SET name = ?, address_desc = ?, area_ha = ?, commodity = ?, variety = ?, planting_date = ?, season_status = ?,
            lat = ?, lng = ?, polygon_json = ?, data_source = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?`,
    d.name, d.address_desc, d.area_ha, d.commodity, d.variety, d.planting_date, d.season_status, d.lat, d.lng, d.polygon_json, source, land.id, req.user.id,
  );
  req.session.flash = { type: 'success', text: 'Data lahan disimpan.' };
  res.redirect(`/lahan/${land.id}`);
});

router.post('/lahan/:id/hapus', farmerOnly, (req, res) => {
  const r = db.run('DELETE FROM lands WHERE id = ? AND user_id = ?', Number(req.params.id), req.user.id);
  req.session.flash = r.changes ? { type: 'success', text: 'Lahan dihapus. Riwayat scan tetap tersimpan.' } : { type: 'error', text: 'Lahan tidak ditemukan.' };
  res.redirect('/lahan');
});

router.parseLand = parseLand;
router.SEASON_STATUSES = SEASON_STATUSES;
module.exports = router;
