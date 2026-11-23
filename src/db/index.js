'use strict';
// Lapisan database aplikasi. Semua fungsi asinkron (await db.get/all/run/tx).
// Driver dipilih lewat DB_DRIVER: 'postgres' (Supabase) atau 'sqlite' (bawaan: uji otomatis & mode offline).
// Di dalam db.tx(), semua query otomatis memakai koneksi transaksi yang sama (AsyncLocalStorage).
const fs = require('node:fs');
const path = require('node:path');
const { AsyncLocalStorage } = require('node:async_hooks');
const config = require('../config');

const als = new AsyncLocalStorage();
let driver;

function open(opts = {}) {
  if (driver) return driver;
  if ((opts.driver || config.db.driver) === 'postgres') {
    driver = require('./pg-driver').create({
      connectionString: opts.connectionString || config.db.url,
      fallbackConnectionString: opts.fallbackConnectionString || config.db.fallbackUrl,
      schema: opts.schema || config.db.schema,
      ssl: config.db.ssl,
    });
  } else {
    driver = require('./sqlite-driver').create(opts.path || config.dbPath);
  }
  return driver;
}

function current() {
  return als.getStore() || open().conn;
}

async function close() {
  if (driver) await driver.close();
  driver = undefined;
}

async function tx(fn) {
  if (als.getStore()) return fn(); // transaksi bertingkat: pakai transaksi yang sedang berjalan
  return open().transaction((conn) => als.run(conn, fn));
}

// ---------- Migrasi ----------
// SQLite: berkas di migrations/ dijalankan berurutan (riwayat lengkap 001…).
// Postgres: migrations-pg/000_skema.sql adalah skema lengkap setara SQLite 001–009; migrasi
// berikutnya (010…) ditambahkan di kedua folder.
async function migrate() {
  const d = open();
  if (d.name === 'postgres') return migratePg(d);
  const raw = d.raw;
  raw.exec("CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')))");
  const dir = path.join(__dirname, 'migrations');
  const applied = new Set(raw.prepare('SELECT name FROM schema_migrations').all().map((r) => r.name));
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const done = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    // Migrasi yang membangun ulang tabel induk (mis. users) mematikan foreign key sementara,
    // agar DROP TABLE tidak menjalankan ON DELETE CASCADE ke tabel turunan.
    const fkOff = /^--\s*migrate:foreign-keys-off/m.test(sql);
    if (fkOff) raw.exec('PRAGMA foreign_keys = OFF');
    try {
      raw.exec('BEGIN');
      try {
        raw.exec(sql);
        if (fkOff) {
          const bad = raw.prepare('PRAGMA foreign_key_check').all();
          if (bad.length) throw new Error(`Migrasi ${file}: ${bad.length} pelanggaran foreign key`);
        }
        raw.prepare('INSERT INTO schema_migrations (name) VALUES (?)').run(file);
        raw.exec('COMMIT');
      } catch (err) {
        raw.exec('ROLLBACK');
        throw err;
      }
    } finally {
      if (fkOff) raw.exec('PRAGMA foreign_keys = ON');
    }
    done.push(file);
  }
  return done;
}

async function migratePg(d) {
  const dir = path.join(__dirname, 'migrations-pg');
  const done = [];
  await d.transaction(async (c) => {
    if (d.schema !== 'public') await c.exec(`CREATE SCHEMA IF NOT EXISTS ${d.schema}; SET search_path TO ${d.schema}, public`);
    await c.exec("CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS')))");
    const applied = new Set((await c.all('SELECT name FROM schema_migrations', [])).map((r) => r.name));
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
      if (applied.has(file)) continue;
      await c.exec(fs.readFileSync(path.join(dir, file), 'utf8'));
      await c.run('INSERT INTO schema_migrations (name) VALUES (?)', [file]);
      done.push(file);
    }
  });
  return done;
}

module.exports = {
  open,
  close,
  migrate,
  tx,
  get driverName() { return open().name; },
  get: (sql, ...p) => current().get(sql, p),
  all: (sql, ...p) => current().all(sql, p),
  run: (sql, ...p) => current().run(sql, p),
  exec: (sql) => current().exec(sql),
};
