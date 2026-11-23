'use strict';
// Kalender Tanam: kegiatan per lahan & musim tanam (musim = tanggal tanam yang berlaku).
// Isinya hanya jadwal yang dibuat petani — tidak ada jadwal atau dosis pupuk yang dikarang aplikasi.
// Satu sumber data (tabel land_reminders) dipakai bersama oleh kartu Dashboard dan halaman kalender lengkap.
const db = require('../db');
const crop = require('../lib/crop');

const CATEGORIES = [
  ['tanam', 'Tanam'],
  ['pemupukan', 'Pemupukan'],
  ['perawatan', 'Perawatan'],
  ['pengamatan-hama', 'Pengamatan hama'],
  ['panen', 'Panen'],
  ['lainnya', 'Lainnya'],
];
const CAT_LABEL = Object.fromEntries(CATEGORIES);

const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const DAYS = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

async function ownedLands(userId) {
  return await db.all('SELECT * FROM lands WHERE user_id = ? ORDER BY created_at, id', userId);
}

// Lahan terpilih: id yang diminta (bila milik pengguna) → lahan terakhir dipakai → lahan bertanggal tanam → lahan pertama.
function pickLand(lands, ...ids) {
  for (const raw of ids) {
    const id = Number(raw) || null;
    const l = id && lands.find((x) => x.id === id);
    if (l) return l;
  }
  return lands.find((l) => l.planting_date) || lands[0] || null;
}

// Status tampilan: selesai / terlewat / hari ini / mendatang.
function decorate(r, land, today) {
  const diff = crop.dayNumber(r.due_date) - crop.dayNumber(today);
  const status = r.done_at ? 'selesai' : (diff < 0 ? 'terlewat' : (diff === 0 ? 'hari-ini' : 'mendatang'));
  // HST pada tanggal kegiatan (dihitung dari tanggal tanam musim ini), bila ada.
  const pd = crop.dayNumber(land && land.planting_date);
  const hstAt = pd != null && r.season_start === land.planting_date ? crop.dayNumber(r.due_date) - pd : null;
  return { ...r, status, inDays: diff, categoryLabel: CAT_LABEL[r.category] || r.category, hstAt: hstAt != null && hstAt >= 0 ? hstAt : null };
}

function isCurrent(r, land) {
  return r.season_start == null || r.season_start === land.planting_date;
}

// Pengingat lahan untuk musim tanam aktif (+ yang dibuat sebelum tanggal tanam diisi), dan musim sebelumnya terpisah.
async function forLand(userId, land, today = crop.todayISO()) {
  const rows = (await db.all('SELECT * FROM land_reminders WHERE user_id = ? AND land_id = ? ORDER BY due_date, id', userId, land.id)).map((r) => decorate(r, land, today));
  const current = rows.filter((r) => isCurrent(r, land));
  const previous = rows.filter((r) => !isCurrent(r, land));
  return { current, previous };
}

// Daftar musim tanam yang punya data: musim aktif + musim sebelumnya (berdasarkan tanggal tanam saat kegiatan dibuat).
async function seasons(userId, land) {
  const past = (await db.all(
    'SELECT DISTINCT season_start FROM land_reminders WHERE user_id = ? AND land_id = ? AND season_start IS NOT NULL AND season_start IS NOT ? ORDER BY season_start DESC',
    userId, land.id, land.planting_date || null,
  )).map((r) => r.season_start);
  return [
    { value: '', start: land.planting_date || null, current: true },
    ...past.map((s) => ({ value: s, start: s, current: false })),
  ];
}

// Kegiatan untuk musim yang dipilih ('' = musim aktif).
async function forSeason(userId, land, season, today = crop.todayISO()) {
  const { current, previous } = await forLand(userId, land, today);
  return season ? previous.filter((r) => r.season_start === season) : current;
}

// Pratinjau Dashboard: kegiatan musim aktif yang jatuh HARI INI (bukan besok/lainnya).
async function todayPreview(userId, land, today = crop.todayISO(), max = 3) {
  const items = (await forLand(userId, land, today)).current.filter((r) => r.due_date === today);
  // Belum selesai lebih dulu, lalu yang selesai.
  items.sort((a, b) => (a.done_at ? 1 : 0) - (b.done_at ? 1 : 0) || a.id - b.id);
  return { items: items.slice(0, max), more: Math.max(0, items.length - max), total: items.length };
}

// Pengingat terdekat yang belum selesai (terlewat lebih dulu, lalu yang paling dekat).
async function nextReminder(userId, land, today = crop.todayISO()) {
  const { current } = await forLand(userId, land, today);
  const open = current.filter((r) => r.status !== 'selesai');
  const overdue = open.filter((r) => r.status === 'terlewat');
  const upcoming = open.filter((r) => r.status !== 'terlewat');
  return { next: upcoming[0] || null, overdue: overdue.length, lastOverdue: overdue[overdue.length - 1] || null, total: current.length };
}

// ---------- Tanggal ----------
function isISODate(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && crop.addDays(s, 0) === s;
}
function isMonth(s) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(s || ''));
}
function shiftMonth(ym, n) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}
function monthLabel(ym) {
  const [y, m] = ym.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}
function weekday(iso) {
  return new Date(crop.dayNumber(iso) * 86400000).getUTCDay(); // 0 = Minggu
}
// Label lengkap tanggal: "Kamis, 19 November 2026".
function longDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return `${DAYS[weekday(iso)]}, ${d} ${MONTHS[m - 1]} ${y}`;
}
// Kisi bulan Senin–Minggu: minggu-minggu berisi 7 tanggal (termasuk tanggal bulan sebelum/sesudah agar kisi penuh).
function monthGrid(ym) {
  const first = `${ym}-01`;
  const offset = (weekday(first) + 6) % 7; // Senin = 0
  const start = crop.addDays(first, -offset);
  const last = crop.addDays(`${shiftMonth(ym, 1)}-01`, -1);
  const weeks = [];
  let d = start;
  while (weeks.length < 6 && (weeks.length === 0 || d <= last)) {
    const w = [];
    for (let i = 0; i < 7; i++) { w.push({ iso: d, day: Number(d.slice(8)), inMonth: d.slice(0, 7) === ym }); d = crop.addDays(d, 1); }
    weeks.push(w);
  }
  return weeks;
}

function parse(body, v, errors) {
  return {
    title: v.str(body.title, { max: 120, required: true, label: 'Nama kegiatan' }, errors, 'title'),
    due_date: v.date(body.due_date, { label: 'Tanggal' }, errors, 'due_date'),
    category: v.oneOf(body.category, CATEGORIES.map((c) => c[0]), { label: 'Kategori' }, errors, 'category'),
    note: v.str(body.note, { max: 500, label: 'Catatan' }, errors, 'note'),
  };
}

module.exports = {
  CATEGORIES, CAT_LABEL, MONTHS, DAYS, ownedLands, pickLand, forLand, forSeason, seasons, todayPreview, nextReminder, parse, decorate,
  isISODate, isMonth, shiftMonth, monthLabel, longDate, monthGrid, weekday,
};
