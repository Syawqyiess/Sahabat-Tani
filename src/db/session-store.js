'use strict';
const session = require('express-session');
const db = require('./index');

// Penyimpanan sesi di SQLite agar login tetap berlaku setelah server dimulai ulang.
class SqliteStore extends session.Store {
  get(sid, cb) {
    try {
      const row = db.get('SELECT sess, expires FROM sessions WHERE sid = ?', sid);
      if (!row) return cb(null, null);
      if (row.expires < Date.now()) {
        this.destroy(sid, () => {});
        return cb(null, null);
      }
      cb(null, JSON.parse(row.sess));
    } catch (e) { cb(e); }
  }

  set(sid, sess, cb = () => {}) {
    try {
      const maxAge = (sess.cookie && sess.cookie.maxAge) || 86400000;
      db.run(
        `INSERT INTO sessions (sid, sess, expires) VALUES (?, ?, ?)
         ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expires = excluded.expires`,
        sid, JSON.stringify(sess), Date.now() + maxAge,
      );
      cb(null);
    } catch (e) { cb(e); }
  }

  touch(sid, sess, cb = () => {}) {
    this.set(sid, sess, cb);
  }

  destroy(sid, cb = () => {}) {
    try { db.run('DELETE FROM sessions WHERE sid = ?', sid); cb(null); } catch (e) { cb(e); }
  }

  prune() {
    db.run('DELETE FROM sessions WHERE expires < ?', Date.now());
  }
}

module.exports = SqliteStore;
