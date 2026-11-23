'use strict';
// Kalender Tanam: kalender bulanan per lahan & musim tanam; klik tanggal → panel detail untuk
// tambah/ubah/tandai selesai/hapus kegiatan. Semua perubahan memakai pola POST → redirect (tanpa kiriman ganda).
const express = require('express');
const db = require('../db');
const v = require('../lib/validate');
const crop = require('../lib/crop');
const cal = require('../services/calendar');
const { requireRole } = require('../middleware/security');

const router = express.Router();
const farmerOnly = requireRole('farmer');
const BASE = '/kalender-tanam';

// URL halaman kalender dengan konteks lahan, musim, bulan, dan tanggal terpilih.
function calUrl({ lahan, musim, bulan, tanggal, ubah } = {}, hash = '') {
  const p = new URLSearchParams();
  if (lahan) p.set('lahan', lahan);
  if (musim) p.set('musim', musim);
  if (bulan) p.set('bulan', bulan);
  if (tanggal) p.set('tanggal', tanggal);
  if (ubah) p.set('ubah', ubah);
  const s = p.toString();
  return BASE + (s ? '?' + s : '') + hash;
}

function render(req, res, { status = 200, errors = {}, values = null, editing = null, landId = null, date = null } = {}) {
  const uid = req.user.id;
  const lands = cal.ownedLands(uid);
  const land = cal.pickLand(lands, landId, req.query.lahan, req.session.calLand);
  if (land) req.session.calLand = land.id; // konteks lahan dipakai bersama dengan kartu Dashboard
  const today = crop.todayISO();
  const tanggal = cal.isISODate(date || req.query.tanggal) ? (date || req.query.tanggal) : today;
  const bulan = !date && cal.isMonth(req.query.bulan) ? req.query.bulan : tanggal.slice(0, 7);
  // Tanggal terpilih harus berada di bulan yang ditampilkan; pindah bulan → hari ini (bila di bulan itu) atau tanggal 1.
  const selected = tanggal.slice(0, 7) === bulan ? tanggal : (today.slice(0, 7) === bulan ? today : `${bulan}-01`);

  let seasons = [];
  let musim = '';
  let items = [];
  if (land) {
    seasons = cal.seasons(uid, land);
    musim = seasons.some((s) => s.value && s.value === req.query.musim) ? req.query.musim : '';
    items = cal.forSeason(uid, land, musim, today);
  }
  const byDate = items.reduce((m, r) => { (m[r.due_date] = m[r.due_date] || []).push(r); return m; }, {});
  const dayItems = byDate[selected] || [];
  const editRow = editing ? (values || db.get('SELECT * FROM land_reminders WHERE id = ? AND user_id = ?', editing, uid)) : null;

  res.status(status).render('farmer/calendar', {
    title: 'Kalender Tanam',
    lands, land, today, selected, bulan, musim, seasons,
    age: land ? crop.cropAge(land, today) : null,
    weeks: cal.monthGrid(bulan),
    monthLabel: cal.monthLabel(bulan),
    prevMonth: cal.shiftMonth(bulan, -1), nextMonth: cal.shiftMonth(bulan, 1),
    byDate, dayItems, longDate: cal.longDate, calUrl,
    categories: cal.CATEGORIES,
    errors, values: values || editRow || { due_date: selected }, editing: editRow ? editRow.id : null,
  });
}

router.get(BASE, farmerOnly, (req, res) => {
  const editing = Number(req.query.ubah) || null;
  render(req, res, { editing });
});

// Rute lama → halaman Kalender Tanam (konteks lahan dipertahankan).
router.get('/kalender', farmerOnly, (req, res) => {
  res.redirect(301, calUrl({ lahan: Number(req.query.lahan) || null }));
});

function ownedLand(req, id) {
  return db.get('SELECT * FROM lands WHERE id = ? AND user_id = ?', Number(id), req.user.id);
}
function ownedReminder(req) {
  return db.get('SELECT * FROM land_reminders WHERE id = ? AND user_id = ?', Number(req.params.id), req.user.id);
}
function notFound(res, what) {
  return res.status(404).render('errors/error', { title: `${what} tidak ditemukan`, status: 404, message: `${what} tidak ditemukan atau bukan milik Anda.` });
}
function validate(body, errors) {
  const d = cal.parse(body, v, errors);
  if (!d.due_date && !errors.due_date) errors.due_date = 'Tanggal wajib diisi.';
  if (!d.category && !errors.category) errors.category = 'Pilih kategori kegiatan.';
  return d;
}
// Kembali ke tanggal kegiatan (dan musim yang sedang dilihat) setelah menyimpan.
function backTo(req, landId, date) {
  const musim = cal.isISODate(req.body.musim) ? req.body.musim : '';
  return calUrl({ lahan: landId, musim, tanggal: date }, '#detail-hari');
}

router.post('/kalender', farmerOnly, (req, res) => {
  const land = ownedLand(req, req.body.land_id);
  if (!land) return notFound(res, 'Lahan');
  const errors = {};
  const d = validate(req.body, errors);
  if (Object.keys(errors).length) {
    return render(req, res, { status: 422, errors, values: req.body, landId: land.id, date: cal.isISODate(req.body.due_date) ? req.body.due_date : null });
  }
  db.run(
    'INSERT INTO land_reminders (user_id, land_id, season_start, due_date, category, title, note) VALUES (?, ?, ?, ?, ?, ?, ?)',
    req.user.id, land.id, land.planting_date || null, d.due_date, d.category, d.title, d.note,
  );
  req.session.flash = { type: 'success', text: 'Kegiatan ditambahkan.' };
  res.redirect(backTo(req, land.id, d.due_date));
});

router.post('/kalender/:id', farmerOnly, (req, res) => {
  const r = ownedReminder(req);
  if (!r) return notFound(res, 'Kegiatan');
  const errors = {};
  const d = validate(req.body, errors);
  if (Object.keys(errors).length) {
    return render(req, res, { status: 422, errors, values: { ...req.body, id: r.id }, editing: r.id, landId: r.land_id, date: r.due_date });
  }
  db.run("UPDATE land_reminders SET title = ?, due_date = ?, category = ?, note = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?",
    d.title, d.due_date, d.category, d.note, r.id, req.user.id);
  req.session.flash = { type: 'success', text: 'Kegiatan diperbarui.' };
  res.redirect(backTo(req, r.land_id, d.due_date));
});

router.post('/kalender/:id/selesai', farmerOnly, (req, res) => {
  const r = ownedReminder(req);
  if (!r) return notFound(res, 'Kegiatan');
  db.run("UPDATE land_reminders SET done_at = CASE WHEN done_at IS NULL THEN datetime('now') ELSE NULL END, updated_at = datetime('now') WHERE id = ? AND user_id = ?", r.id, req.user.id);
  res.redirect(backTo(req, r.land_id, r.due_date));
});

router.post('/kalender/:id/hapus', farmerOnly, (req, res) => {
  const r = ownedReminder(req);
  if (!r) return notFound(res, 'Kegiatan');
  db.run('DELETE FROM land_reminders WHERE id = ? AND user_id = ?', r.id, req.user.id);
  req.session.flash = { type: 'success', text: 'Kegiatan dihapus.' };
  res.redirect(backTo(req, r.land_id, r.due_date));
});

module.exports = router;
