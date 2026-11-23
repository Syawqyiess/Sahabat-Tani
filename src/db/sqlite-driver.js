'use strict';
// Driver SQLite (node:sqlite) — dipakai untuk uji otomatis & mode offline.
// Antarmukanya asinkron agar sama dengan driver Postgres, walau SQLite sendiri bekerja sinkron.
const fs = require('node:fs');
const path = require('node:path');

// node:sqlite masih berstatus experimental di Node 22; sembunyikan peringatannya saja.
const origEmit = process.emitWarning;
process.emitWarning = function (warning, ...args) {
  const msg = typeof warning === 'string' ? warning : warning && warning.message;
  if (msg && msg.includes('SQLite is an experimental feature')) return;
  return origEmit.call(process, warning, ...args);
};
const { DatabaseSync } = require('node:sqlite');

function create(dbPath) {
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const raw = new DatabaseSync(dbPath);
  raw.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');

  const conn = {
    async get(sql, params) { return raw.prepare(sql).get(...params); },
    async all(sql, params) { return raw.prepare(sql).all(...params); },
    async run(sql, params) {
      const r = raw.prepare(sql).run(...params);
      return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
    },
    async exec(sql) { raw.exec(sql); },
  };

  // SQLite hanya punya satu koneksi: transaksi diantrekan agar tidak saling tumpang tindih.
  let queue = Promise.resolve();
  async function transaction(fn) {
    const prev = queue;
    let release;
    queue = new Promise((r) => { release = r; });
    await prev;
    try {
      raw.exec('BEGIN');
      try {
        const out = await fn(conn);
        raw.exec('COMMIT');
        return out;
      } catch (err) {
        raw.exec('ROLLBACK');
        throw err;
      }
    } finally {
      release();
    }
  }

  return {
    name: 'sqlite',
    conn,
    transaction,
    raw,
    async close() { raw.close(); },
  };
}

module.exports = { create };
