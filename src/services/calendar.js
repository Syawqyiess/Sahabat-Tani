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

// Standar paket kegiatan rekomendasi PTT Padi Sawah / Jarwo Super Balitbangtan Kementan
const STANDARD_TASKS = [
  { hst: 0, category: 'tanam', title: 'Tanam bibit padi', note: 'Tanam bibit (umur 15-21 HSS), sistem jajar legowo kondisi air macak-macak.' },
  { hst: 0, category: 'pemupukan', title: 'Pemupukan dasar P & K', note: 'Seluruh pupuk P (SP-36) dan KCl dosis dasar diberikan saat tanam atau 0-7 HST sesuai PUTS.' },
  { hst: 5, category: 'pengamatan-hama', title: 'Pengamatan keong mas & pasang perangkap tikus', note: 'Periksa telur dan keong mas di saluran air/pematang; kendalikan manual sebelum merusak bibit muda.' },
  { hst: 7, category: 'pengamatan-hama', title: 'Pemeriksaan populasi rumpun & penyulaman awal', note: 'Cek rumpun mati/kosong; segera sulam agar pertumbuhan seragam sebelum 14 HST.' },
  { hst: 10, category: 'pemupukan', title: 'Pemupukan Urea tahap I', note: 'Aplikasi 50-75 kg Urea/ha (sekitar 1/3 dosis total N). Jangan berlebihan agar anakan produktif.' },
  { hst: 12, category: 'perawatan', title: 'Penyiangan gulma awal (gosrok / manual)', note: 'Gunakan landak/gosrok atau cabut manual dengan kondisi air dangkal 2-3 cm untuk membenamkan gulma.' },
  { hst: 14, category: 'perawatan', title: 'Batas akhir penyulaman bibit', note: 'Selesaikan penyulaman agar populasi tanaman optimal dan panen serempak.' },
  { hst: 21, category: 'perawatan', title: 'Penyiangan gulma kedua', note: 'Lakukan penyiangan kedua sebelum kanopi menutup ruang antar rumpun.' },
  { hst: 21, category: 'pengamatan-hama', title: 'Pengamatan wereng batang cokelat & penggerek (sundep)', note: 'Amati pangkal batang dekat air untuk nimfa wereng dan pucuk layu tanda sundep.' },
  { hst: 28, category: 'pemupukan', title: 'Pengukuran BWD & Pemupukan Urea tahap II', note: 'Ukur warna daun dengan Bagan Warna Daun (BWD) pada 10 rumpun. Bila skala <4, beri 50-75 kg Urea/ha.' },
  { hst: 35, category: 'pengamatan-hama', title: 'Pemantauan intensif OPT (WBC, sundep, tikus)', note: 'Pengamatan rutin 5 titik acak; periksa gejala hopperburn dan sarang tikus di pematang.' },
  { hst: 42, category: 'pemupukan', title: 'Pemupukan Urea tahap III (bila BWD <4)', note: 'Aplikasi susulan terakhir bila daun masih pucat (BWD <4). Jangan tambah N bila daun sudah hijau tua.' },
  { hst: 48, category: 'perawatan', title: 'Pengeringan berkala (intermittent) / macak-macak', note: 'Keringkan sawah hingga retak rambut selama 4-5 hari untuk menekan anakan tidak produktif dan memperkuat akar.' },
  { hst: 50, category: 'pemupukan', title: 'Pemupukan K susulan / primordia (bila dosis K tinggi)', note: 'Aplikasi 50% sisa KCl untuk memperkuat malai dan pengisian bulir.' },
  { hst: 55, category: 'pengamatan-hama', title: 'Pengamatan inisiasi primordia (fase bunting awal)', note: 'Batang mulai membengkak; pastikan air kembali digenang 3-5 cm, jangan sampai tanaman kekeringan.' },
  { hst: 65, category: 'pengamatan-hama', title: 'Pengamatan hama malai & penyakit hawar/blast', note: 'Periksa pelepah daun bendera dari bercak blast atau hawar daun bakteri (HDB).' },
  { hst: 70, category: 'pengamatan-hama', title: 'Pengamatan 50% pembungaan & walang sangit', note: 'Catat tanggal mekar bunga; amati walang sangit pada malai saat pagi hari.' },
  { hst: 80, category: 'pengamatan-hama', title: 'Pengamatan masak susu / pengisian bulir', note: 'Jaga air tetap tergenang 3-5 cm selama pengisian bulir; cegah serangan burung dan tikus.' },
  { hst: 85, category: 'pengamatan-hama', title: 'Pengendalian tikus & burung komunal', note: 'Pasang orang-orangan sawah, kincir, atau ronda petakan karena bulir mulai menguning.' },
  { hst: 95, category: 'pengamatan-hama', title: 'Pemeriksaan kematangan gabah & persiapan panen', note: 'Cek persentase gabah kuning (target 90-95% menguning); siapkan alat/mesin panen.' },
  { hst: 100, category: 'perawatan', title: 'Pengeringan petakan menjelang panen (7-10 hari pra-panen)', note: 'Kuras dan keringkan sawah agar permukaan tanah padat saat pemanenan dan gabah tidak kotor.' },
  { hst: 110, category: 'panen', title: 'Panen padi (90-95% bulir menguning)', note: 'Lakukan panen dengan sabit bergerigi atau combine harvester untuk meminimalkan kehilangan hasil.' },
  { hst: 112, category: 'perawatan', title: 'Perontokan dan pengeringan gabah (target KA 14%)', note: 'Segera rontokkan dan jemur gabah dengan ketebalan 5-7 cm, balik setiap 2 jam.' },
];

async function generateAutoReminders(userId, land) {
  if (!land || !land.planting_date) return 0;
  const existing = await db.all(
    'SELECT title, due_date FROM land_reminders WHERE user_id = ? AND land_id = ? AND season_start = ?',
    userId, land.id, land.planting_date,
  );
  const existingKeys = new Set(existing.map((e) => `${e.title}|${e.due_date}`));

  let added = 0;
  await db.tx(async () => {
    for (const t of STANDARD_TASKS) {
      const dueDate = crop.addDays(land.planting_date, t.hst);
      const key = `${t.title}|${dueDate}`;
      if (!existingKeys.has(key)) {
        await db.run(
          'INSERT INTO land_reminders (user_id, land_id, season_start, due_date, category, title, note) VALUES (?, ?, ?, ?, ?, ?, ?)',
          userId, land.id, land.planting_date, dueDate, t.category, t.title, t.note,
        );
        added++;
      }
    }
  });
  return added;
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
  STANDARD_TASKS, generateAutoReminders,
};
