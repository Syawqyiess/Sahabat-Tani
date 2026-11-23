'use strict';
// Satu sumber perhitungan untuk luas lahan dan umur tanaman (HST), dipakai Dashboard, Lahan Saya,
// Peta Lahan, Profil, kalender, dan scanner — agar angka di semua halaman selalu sama.

const TZ = process.env.APP_TIMEZONE || 'Asia/Jakarta';

// ---------- Luas ----------
// Luas disimpan sebagai angka (REAL, hektare). Tampilan: lokal Indonesia, dua desimal ("0,85 ha").
function roundHa(n) {
  return Math.round(Number(n) * 100) / 100;
}
function fmtHa(n) {
  if (n == null || n === '' || Number.isNaN(Number(n))) return null;
  return roundHa(n).toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ha';
}
// Ringkasan dari daftar lahan (bukan SUM SQL) agar pembulatan sama di mana pun.
function areaSummary(lands) {
  const withArea = lands.filter((l) => l.area_ha != null && l.area_ha !== '');
  const total = withArea.reduce((s, l) => s + Math.round(Number(l.area_ha) * 1000), 0) / 1000; // jumlahkan dalam meter-ish agar bebas galat float
  return {
    count: lands.length,
    withArea: withArea.length,
    missing: lands.length - withArea.length,
    total: withArea.length ? roundHa(total) : null,
    totalLabel: withArea.length ? fmtHa(total) : null,
  };
}

// ---------- Tanggal & HST ----------
// Tanggal "hari ini" menurut zona waktu aplikasi, sebagai YYYY-MM-DD (tanpa jam).
function todayISO(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
function dayNumber(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86400000;
}
function addDays(iso, n) {
  const d = new Date((dayNumber(iso) + n) * 86400000);
  return d.toISOString().slice(0, 10);
}

// Perkiraan fase padi sawah (varietas umur ±110–120 hari) mengikuti pembagian umum fase vegetatif,
// reproduktif (generatif), dan pemasakan. Hanya perkiraan dari umur; tidak dipakai untuk tanaman lain.
const PADI_PHASES = [
  { until: 59, label: 'Vegetatif' },
  { until: 89, label: 'Generatif' },
  { until: 120, label: 'Pemasakan' },
];
function isPadi(commodity) {
  return /\bpadi\b/i.test(String(commodity || ''));
}
function estimatePhase(commodity, days) {
  if (!isPadi(commodity) || days == null || days < 0) return null;
  const p = PADI_PHASES.find((x) => days <= x.until);
  return p ? p.label : 'Melewati perkiraan umur panen';
}

// Umur tanaman satu lahan. Tanggal tanam = HST 0; tanggal mendatang = jadwal tanam (bukan HST negatif).
// Fase: utamakan fase yang diisi petani; bila kosong dan tanamannya padi, pakai perkiraan dari umur.
function cropAge(land, today = todayISO()) {
  const out = { plantingDate: land.planting_date || null, status: 'none', days: null, phase: null, phaseEstimated: false };
  const p = dayNumber(land.planting_date);
  if (p == null) return { ...out, label: 'Tanggal tanam belum diisi' };
  const days = dayNumber(today) - p;
  if (days < 0) {
    return { ...out, status: 'scheduled', daysUntil: -days, label: `Jadwal tanam ${-days} hari lagi`, phase: land.season_status || null };
  }
  const est = estimatePhase(land.commodity, days);
  const phase = land.season_status || est;
  return {
    ...out, status: 'growing', days, label: `${days} HST`,
    phase, phaseEstimated: !land.season_status && !!est,
  };
}
// "Vegetatif (35 HST)" — hanya bila datanya mendukung.
function phaseAgeLabel(age) {
  if (age.status === 'growing') return age.phase ? `${age.phase} (${age.days} HST)` : `${age.days} HST`;
  if (age.status === 'scheduled') return age.label;
  return null;
}

module.exports = { TZ, roundHa, fmtHa, areaSummary, todayISO, dayNumber, addDays, cropAge, phaseAgeLabel, estimatePhase, isPadi };
