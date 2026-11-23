'use strict';
// Pindahkan SEMUA data dari SQLite lokal (storage/sahabat-tani.db) ke Postgres Supabase, dan semua foto
// dari storage/uploads ke Supabase Storage (bucket privat). File SQLite & foto lokal TIDAK dihapus (cadangan).
//
//   npm run pindah-supabase            → menolak bila database Supabase sudah berisi pengguna
//   npm run pindah-supabase -- --timpa → kosongkan tabel Supabase lalu salin ulang
//
// Kredensial dibaca dari .env: SUPABASE_DB_URL, SUPABASE_URL, SUPABASE_SECRET_KEY. Tidak ada yang dicetak ke log.
require('dotenv').config({ quiet: true });
const fs = require('node:fs');
const path = require('node:path');

process.env.DB_DRIVER = 'postgres';
process.env.STORAGE_DRIVER = 'supabase';
const config = require('../config');
const db = require('./index');
const storage = require('../services/storage');

// Urutan aman terhadap foreign key. pest_scans.chat_session_id diisi setelah chat_sessions ada (referensi melingkar).
const TABLES = [
  'users', 'password_resets', 'farmer_profiles', 'lands', 'pest_scans', 'chat_sessions', 'chat_messages',
  'article_categories', 'news_sources', 'articles', 'saved_articles', 'pest_references', 'air_quality_cache',
  'sessions', 'integration_events', 'rdkk_snapshots', 'land_reminders', 'user_identities',
];
const TIMPA = process.argv.includes('--timpa');

function openSqlite() {
  const origEmit = process.emitWarning;
  process.emitWarning = function (w, ...a) { if (String(w && w.message || w).includes('SQLite is an experimental')) return; return origEmit.call(process, w, ...a); };
  const { DatabaseSync } = require('node:sqlite');
  if (!fs.existsSync(config.dbPath)) throw new Error(`Database SQLite tidak ditemukan: ${config.dbPath}`);
  return new DatabaseSync(config.dbPath, { readOnly: true });
}

function listUploads(dir, base = dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) listUploads(p, base, out);
    else out.push(path.relative(base, p).split(path.sep).join('/'));
  }
  return out;
}

async function main() {
  const src = openSqlite();
  const pgDriver = db.open();
  console.log(`Sumber : SQLite ${path.relative(config.root, config.dbPath)}`);
  console.log(`Tujuan : Postgres Supabase (skema ${config.db.schema}) + Storage bucket "${config.storage.bucket}"\n`);

  const applied = await db.migrate();
  if (applied.length) console.log(`Skema dibuat: ${applied.join(', ')}`);

  const existing = (await db.get('SELECT COUNT(*) AS n FROM users')).n;
  if (existing && !TIMPA) {
    console.error(`Database Supabase sudah berisi ${existing} pengguna. Batal agar data tidak tertimpa.\nJalankan dengan "-- --timpa" untuk mengosongkan lalu menyalin ulang.`);
    process.exitCode = 1;
    return;
  }

  // ---------- 1) Data ----------
  const counts = {};
  await db.tx(async () => {
    // Selalu kosongkan dulu: tabel bisa berisi data awal dari migrasi (kategori & sumber berita) yang akan
    // digantikan salinan persis dari SQLite. (Bila sudah ada pengguna, langkah ini hanya terjadi dengan --timpa.)
    await db.exec(`TRUNCATE ${TABLES.slice().reverse().join(', ')} RESTART IDENTITY CASCADE`);
    if (existing) console.log('Tabel Supabase dikosongkan (--timpa).');
    const scanSessions = [];
    for (const table of TABLES) {
      const pgCols = new Set((await db.all('SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = ?', table)).map((r) => r.column_name));
      const srcCols = src.prepare(`PRAGMA table_info("${table}")`).all().map((c) => c.name);
      const cols = srcCols.filter((c) => pgCols.has(c));
      const missing = srcCols.filter((c) => !pgCols.has(c));
      if (missing.length) throw new Error(`Kolom ${table} tidak ada di Postgres: ${missing.join(', ')}`);
      const rows = src.prepare(`SELECT * FROM "${table}"`).all();
      const BATCH = 200;
      for (let i = 0; i < rows.length; i += BATCH) {
        const chunk = rows.slice(i, i + BATCH);
        const params = [];
        const values = chunk.map((r) => {
          const ph = cols.map((c) => {
            let v = r[c];
            if (table === 'pest_scans' && c === 'chat_session_id') { if (v != null) scanSessions.push([r.id, v]); v = null; }
            params.push(v === undefined ? null : v);
            return '?';
          });
          return `(${ph.join(', ')})`;
        });
        await db.run(`INSERT INTO ${table} (${cols.join(', ')}) VALUES ${values.join(', ')}`, ...params);
      }
      counts[table] = rows.length;
    }
    for (const [scanId, sessionId] of scanSessions) await db.run('UPDATE pest_scans SET chat_session_id = ? WHERE id = ?', sessionId, scanId);
    // Penomoran id berikutnya dilanjutkan dari id terbesar yang disalin.
    for (const table of TABLES) {
      const hasId = await db.get("SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = ? AND column_name = 'id'", table);
      if (hasId) await db.exec(`SELECT setval(pg_get_serial_sequence('${table}', 'id'), COALESCE((SELECT MAX(id) FROM ${table}), 1), (SELECT MAX(id) FROM ${table}) IS NOT NULL)`);
    }
  });

  // ---------- 2) Verifikasi jumlah baris ----------
  let okData = true;
  console.log('Tabel                  SQLite  Supabase');
  for (const table of TABLES) {
    const n = (await db.get(`SELECT COUNT(*) AS n FROM ${table}`)).n;
    const same = n === counts[table];
    if (!same) okData = false;
    console.log(`${table.padEnd(22)} ${String(counts[table]).padStart(6)}  ${String(n).padStart(8)}${same ? '' : '  ← BERBEDA'}`);
  }

  // ---------- 3) Foto ----------
  const files = listUploads(config.uploadDir).filter((rel) => /^[a-z0-9-]+\/[a-z0-9._-]+$/i.test(rel) && !rel.startsWith('cek-ai/'));
  let uploaded = 0;
  const failed = [];
  for (const rel of files) {
    const buf = fs.readFileSync(path.join(config.uploadDir, rel));
    try {
      await storage.putFile(rel, buf, storage.mimeOf(rel));
      const back = await storage.readFile(rel);
      if (!back || back.length !== buf.length) throw new Error('ukuran tidak sama setelah diunggah');
      uploaded++;
    } catch (err) {
      failed.push(`${rel}: ${err.message}`);
    }
  }
  console.log(`\nFoto: ${uploaded}/${files.length} diunggah & diverifikasi ke bucket "${config.storage.bucket}" (privat).`);
  failed.forEach((f) => console.log('  GAGAL ' + f));

  // Setiap foto yang dirujuk database harus ada di Storage.
  const refs = new Set();
  for (const [t, c] of [['pest_scans', 'image_path'], ['chat_messages', 'image_path'], ['farmer_profiles', 'photo_path'], ['lands', 'photo_path']]) {
    for (const r of await db.all(`SELECT ${c} AS p FROM ${t} WHERE ${c} IS NOT NULL`)) refs.add(r.p);
  }
  const uploadedSet = new Set(files);
  const notFound = [...refs].filter((p) => !uploadedSet.has(p));
  console.log(`Rujukan foto di database: ${refs.size}, tanpa berkas: ${notFound.length}${notFound.length ? ' (' + notFound.slice(0, 5).join(', ') + (notFound.length > 5 ? ', …' : '') + ')' : ''}`);

  console.log(okData && !failed.length ? '\nSELESAI: semua data & foto berhasil dipindahkan.' : '\nSELESAI DENGAN CATATAN — periksa baris bertanda di atas.');
  if (!okData || failed.length) process.exitCode = 1;
  src.close();
  void pgDriver;
}

main()
  .catch((err) => { console.error('Pemindahan gagal:', err.message); process.exitCode = 1; })
  .finally(() => db.close());
