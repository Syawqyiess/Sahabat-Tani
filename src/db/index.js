'use strict';
const fs = require('node:fs');
const path = require('node:path');
const config = require('../config');

// node:sqlite masih berstatus experimental di Node 22; sembunyikan peringatannya saja.
const origEmit = process.emitWarning;
process.emitWarning = function (warning, ...args) {
  const msg = typeof warning === 'string' ? warning : warning && warning.message;
  if (msg && msg.includes('SQLite is an experimental feature')) return;
  return origEmit.call(process, warning, ...args);
};
const { DatabaseSync } = require('node:sqlite');

let db;

function open(dbPath = config.dbPath) {
  if (db) return db;
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  return db;
}

function get() {
  return db || open();
}

function close() {
  if (db) db.close();
  db = undefined;
}

function migrate() {
  const d = get();
  d.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime(\'now\')))');
  const dir = path.join(__dirname, 'migrations');
  const applied = new Set(d.prepare('SELECT name FROM schema_migrations').all().map((r) => r.name));
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const done = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    tx(() => {
      d.exec(sql);
      d.prepare('INSERT INTO schema_migrations (name) VALUES (?)').run(file);
    });
    done.push(file);
  }
  return done;
}

function tx(fn) {
  const d = get();
  d.exec('BEGIN');
  try {
    const out = fn();
    d.exec('COMMIT');
    return out;
  } catch (err) {
    d.exec('ROLLBACK');
    throw err;
  }
}

// Helper ringkas
const q = {
  get: (sql, ...p) => get().prepare(sql).get(...p),
  all: (sql, ...p) => get().prepare(sql).all(...p),
  run: (sql, ...p) => get().prepare(sql).run(...p),
};

module.exports = { open, get, close, migrate, tx, ...q };
