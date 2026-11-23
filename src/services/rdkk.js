'use strict';
// Data RDKK Mojopuro Wetan dari workbook Tableau Public "SITANI" (Angely Marcella).
// Server mengambil ekspor CSV tiap lembar (sheet) secara berkala, memvalidasi struktur & angkanya,
// lalu menyimpan snapshot. Dashboard hanya membaca snapshot terakhir yang lolos — halaman tidak
// pernah menunggu Tableau. Bila pengambilan gagal, data terakhir tetap dipakai beserta waktunya.
const db = require('../db');
const config = require('../config');

const USER_AGENT = 'SahabatTani/0.1 (visualisasi data RDKK untuk demo akademik)';
const TIMEOUT_MS = 20000;
const MAX_BYTES = 1024 * 1024;
const GAP_MS = Number(process.env.RDKK_GAP_MS ?? 1500); // jeda antar permintaan ke Tableau Public

// Lembar yang diambil beserta kolom wajibnya. Lembar "Perbandingan Kelompok Tani" dan "Heatmap" berisi
// data yang sama dengan dua lembar pertama, jadi tidak diunduh ulang. Lembar "Status Data RDKK"
// tidak menyediakan data lewat ekspor CSV (kosong), sehingga tidak dipakai.
const SHEETS = {
  perJenis: { sheet: 'KebutuhanPupukperJenis', title: 'Kebutuhan Pupuk per Jenis', cols: ['jenis_pupuk', 'kelompok_tani', 'jumlah_kebutuhan_sesuai_sumber'] },
  perMusim: { sheet: 'PupukperMusim', title: 'Pupuk per Musim', cols: ['jenis_pupuk', 'musim_tanam', 'jumlah_kebutuhan_sesuai_sumber'] },
  petani: { sheet: 'petaniterdaftar', title: 'Petani Terdaftar', kpi: true },
  kelompok: { sheet: 'kelompoktani', title: 'Kelompok Tani', kpi: true },
  total: { sheet: 'totalkebutuhan', title: 'Total Kebutuhan', kpi: true },
  rataRata: { sheet: 'ratarataPerpetani', title: 'Rata-rata per Petani', kpi: true },
};

const ORDER = ['UREA', 'NPK'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// CSV sederhana sesuai RFC 4180 (tanda kutip, koma & baris baru di dalam kutip).
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const s = String(text).replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') quoted = false; else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows;
}

// Angka dari ekspor Tableau berformat Indonesia: titik = pemisah ribuan ("42.328" = 42.328 kg),
// koma = desimal. Satuan seperti "kg" dibuang. Mengembalikan null bila tidak yakin.
function parseIdNumber(raw) {
  const s = String(raw ?? '').replace(/\s*(kg|ton|ha)\s*$/i, '').replace(/\s/g, '').trim();
  if (!s) return null;
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) return Number(s.replace(/\./g, '').replace(',', '.'));
  if (/^-?\d+(,\d+)?$/.test(s)) return Number(s.replace(',', '.'));
  return null;
}

async function fetchSheet(key) {
  const def = SHEETS[key];
  const url = `${config.rdkk.baseUrl}${encodeURIComponent(config.rdkk.workbook)}/${def.sheet}.csv?:showVizHome=no`;
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': USER_AGENT, accept: 'text/csv' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
      if ([401, 403, 429].includes(res.status)) throw new Error(`Tableau Public menolak akses (HTTP ${res.status})`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (!/text\/csv/i.test(res.headers.get('content-type') || '')) throw new Error('respons bukan CSV (lembar mungkin dihapus atau unduhan data dimatikan)');
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > MAX_BYTES) throw new Error('respons terlalu besar');
      const rows = parseCsv(buf.toString('utf8'));
      if (!rows.length) throw new Error('lembar tidak berisi data');
      return rows;
    } catch (err) {
      lastErr = err;
      if (/menolak|bukan CSV|tidak berisi/.test(err.message)) break; // tidak perlu diulang
      if (attempt === 0) await sleep(1000);
    }
  }
  throw new Error(`${def.title}: ${lastErr.name === 'TimeoutError' ? 'waktu habis' : lastErr.message}`);
}

function table(key, rows) {
  const def = SHEETS[key];
  const head = rows[0].map((h) => h.trim().toLowerCase());
  const idx = def.cols.map((c) => head.indexOf(c));
  if (idx.some((i) => i < 0)) throw new Error(`${def.title}: kolom berubah (ditemukan: ${head.join(', ')}; diperlukan: ${def.cols.join(', ')})`);
  return rows.slice(1).map((r, n) => {
    const kg = parseIdNumber(r[idx[2]]);
    if (kg == null || kg < 0) throw new Error(`${def.title}: angka tidak terbaca di baris ${n + 2} ("${r[idx[2]]}")`);
    return { jenis: r[idx[0]].trim().toUpperCase(), dim: r[idx[1]].trim().toUpperCase(), kg };
  });
}

function kpi(key, rows) {
  const v = parseIdNumber((rows[1] || rows[0] || [])[0]);
  if (v == null) throw new Error(`${SHEETS[key].title}: angka KPI tidak terbaca`);
  return v;
}

// Mengubah CSV mentah menjadi struktur untuk diagram + memeriksa konsistensi antarlembar.
function normalize(raw) {
  const perJenis = table('perJenis', raw.perJenis);
  const perMusim = table('perMusim', raw.perMusim);
  const data = {
    kpi: { petani: kpi('petani', raw.petani), kelompok: kpi('kelompok', raw.kelompok), total: kpi('total', raw.total), rataRata: kpi('rataRata', raw.rataRata) },
    // Urutan tetap (Urea lalu NPK, seperti di dashboard asli); jenis lain menyusul berurutan abjad.
    jenis: [...new Set([...perJenis, ...perMusim].map((r) => r.jenis))].sort((x, y) => (ORDER.indexOf(x) + 1 || 99) - (ORDER.indexOf(y) + 1 || 99) || x.localeCompare(y)),
    kelompok: [...new Set(perJenis.map((r) => r.dim))].sort(),
    musim: [...new Set(perMusim.map((r) => r.dim))].sort(),
    perKelompok: perJenis.map((r) => ({ jenis: r.jenis, kelompok: r.dim, kg: r.kg })),
    perMusim: perMusim.map((r) => ({ jenis: r.jenis, musim: r.dim, kg: r.kg })),
  };
  const warnings = [];
  const sum = (rows) => rows.reduce((n, r) => n + r.kg, 0);
  const totalA = sum(data.perKelompok);
  const totalB = sum(data.perMusim);
  if (Math.abs(totalA - data.kpi.total) > 1) warnings.push(`Total per kelompok (${totalA}) berbeda dengan KPI total (${data.kpi.total}).`);
  if (Math.abs(totalB - data.kpi.total) > 1) warnings.push(`Total per musim (${totalB}) berbeda dengan KPI total (${data.kpi.total}).`);
  if (data.kelompok.length !== data.kpi.kelompok) warnings.push(`Jumlah kelompok di data (${data.kelompok.length}) berbeda dengan KPI (${data.kpi.kelompok}).`);
  // Bila angka antarlembar tidak cocok, kemungkinan besar format angka salah dibaca → jangan dipakai.
  if (warnings.some((w) => w.startsWith('Total'))) throw new Error('Data tidak konsisten antarlembar: ' + warnings.join(' '));
  return { data, warnings };
}

async function refresh() {
  try {
    const raw = {};
    let first = true;
    for (const key of Object.keys(SHEETS)) {
      if (!first) await sleep(GAP_MS);
      first = false;
      raw[key] = await fetchSheet(key);
    }
    const { data, warnings } = normalize(raw);
    db.run("INSERT INTO rdkk_snapshots (status, data_json, warnings) VALUES ('ok', ?, ?)", JSON.stringify(data), JSON.stringify(warnings));
    prune();
    return { ok: true, warnings };
  } catch (err) {
    db.run("INSERT INTO rdkk_snapshots (status, error) VALUES ('gagal', ?)", String(err.message).slice(0, 500));
    prune();
    return { ok: false, error: err.message };
  }
}

// Simpan 20 catatan terakhir saja.
function prune() {
  db.run('DELETE FROM rdkk_snapshots WHERE id NOT IN (SELECT id FROM rdkk_snapshots ORDER BY id DESC LIMIT 20)');
}

function latest() {
  const good = db.get("SELECT * FROM rdkk_snapshots WHERE status = 'ok' ORDER BY id DESC LIMIT 1");
  const lastTry = db.get('SELECT * FROM rdkk_snapshots ORDER BY id DESC LIMIT 1');
  return {
    data: good ? JSON.parse(good.data_json) : null,
    fetchedAt: good ? good.fetched_at : null,
    warnings: good && good.warnings ? JSON.parse(good.warnings) : [],
    lastError: lastTry && lastTry.status === 'gagal' ? { at: lastTry.fetched_at, message: lastTry.error } : null,
  };
}

function isStale() {
  const r = db.get("SELECT fetched_at FROM rdkk_snapshots WHERE status = 'ok' ORDER BY id DESC LIMIT 1");
  if (!r) return true;
  return Date.now() - new Date(r.fetched_at.replace(' ', 'T') + 'Z').getTime() > config.rdkk.refreshHours * 3600 * 1000;
}

module.exports = { refresh, latest, isStale, parseCsv, parseIdNumber, normalize, SHEETS };
