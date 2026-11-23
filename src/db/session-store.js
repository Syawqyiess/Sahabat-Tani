'use strict';
const session = require('express-session');
const db = require('./index');

// Penyimpanan sesi di database (SQLite/Postgres) agar login tetap berlaku setelah server dimulai ulang.
// Database Supabase berjarak ±280 ms per query, jadi:
// - sesi yang baru dibaca/ditulis disimpan sebentar di memori (satu proses server) agar permintaan beruntun
//   (mis. 20 foto di satu halaman) tidak membaca database berulang-ulang;
// - "touch" (perpanjang masa berlaku tanpa perubahan isi) hanya ditulis bila sudah lewat 10 menit.
const CACHE_MS = 30 * 1000;
// Satu cache untuk seluruh proses (dipakai bersama oleh semua instance store).
const cache = new Map(); // sid → { sess, expires, at }
const touched = new Map(); // sid → waktu terakhir masa berlaku ditulis
const TOUCH_EVERY_MS = 10 * 60 * 1000;

class SqliteStore extends session.Store {
  constructor() {
    super();
    this.cache = cache;
    this.touched = touched;
  }

  remember(sid, sess, expires) {
    this.cache.set(sid, { sess, expires, at: Date.now() });
    if (this.cache.size > 5000) this.cache.delete(this.cache.keys().next().value);
  }

  async get(sid, cb) {
    try {
      const hit = this.cache.get(sid);
      if (hit && Date.now() - hit.at < CACHE_MS && hit.expires > Date.now()) return cb(null, JSON.parse(hit.sess));
      const row = await db.get('SELECT sess, expires FROM sessions WHERE sid = ?', sid);
      if (!row) { this.cache.delete(sid); return cb(null, null); }
      if (row.expires < Date.now()) {
        this.destroy(sid, () => {});
        return cb(null, null);
      }
      this.remember(sid, row.sess, row.expires);
      cb(null, JSON.parse(row.sess));
    } catch (e) { cb(e); }
  }

  async set(sid, sess, cb = () => {}) {
    try {
      const maxAge = (sess.cookie && sess.cookie.maxAge) || 86400000;
      const json = JSON.stringify(sess);
      const expires = Date.now() + maxAge;
      await db.run(
        `INSERT INTO sessions (sid, sess, expires) VALUES (?, ?, ?)
         ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expires = excluded.expires`,
        sid, json, expires,
      );
      this.remember(sid, json, expires);
      this.touched.set(sid, Date.now());
      cb(null);
    } catch (e) { cb(e); }
  }

  touch(sid, sess, cb = () => {}) {
    const last = this.touched.get(sid) || 0;
    if (Date.now() - last < TOUCH_EVERY_MS) return cb(null);
    this.set(sid, sess, cb);
  }

  async destroy(sid, cb = () => {}) {
    this.cache.delete(sid);
    this.touched.delete(sid);
    try { await db.run('DELETE FROM sessions WHERE sid = ?', sid); cb(null); } catch (e) { cb(e); }
  }

  async prune() {
    await db.run('DELETE FROM sessions WHERE expires < ?', Date.now());
  }
}

// Hapus sesi milik satu pengguna dari cache memori (dipanggil setelah sesinya dihapus dari database,
// mis. reset kata sandi atau akun dinonaktifkan) agar langsung berlaku, bukan setelah cache kedaluwarsa.
function forgetUser(userId) {
  for (const [sid, v] of cache) {
    try { if (JSON.parse(v.sess).userId === Number(userId)) { cache.delete(sid); touched.delete(sid); } } catch { cache.delete(sid); }
  }
}

module.exports = SqliteStore;
module.exports.forgetUser = forgetUser;
