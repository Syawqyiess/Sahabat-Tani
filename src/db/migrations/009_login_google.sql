-- migrate:foreign-keys-off
-- Masuk/daftar dengan Google.
-- 1) users.password_hash boleh kosong: akun yang dibuat lewat Google tidak punya kata sandi lokal
--    (tidak memakai kata sandi tiruan). SQLite tidak bisa mengubah NOT NULL, jadi tabel dibangun ulang
--    dengan prosedur resmi SQLite (foreign key dimatikan sementara oleh migrator agar tabel turunan
--    tidak ikut terhapus; diperiksa ulang dengan foreign_key_check sebelum commit).
CREATE TABLE users_new (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  phone         TEXT UNIQUE,
  email         TEXT UNIQUE,
  password_hash TEXT,
  role          TEXT NOT NULL DEFAULT 'farmer' CHECK (role IN ('farmer', 'admin')),
  is_active     INTEGER NOT NULL DEFAULT 1,
  is_demo       INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at TEXT,
  CHECK (phone IS NOT NULL OR email IS NOT NULL)
);
INSERT INTO users_new (id, phone, email, password_hash, role, is_active, is_demo, created_at, last_login_at)
  SELECT id, phone, email, password_hash, role, is_active, is_demo, created_at, last_login_at FROM users;
DROP TABLE users;
ALTER TABLE users_new RENAME TO users;

-- 2) Hubungan akun penyedia login. Satu pengguna dapat memiliki login lokal dan Google sekaligus.
--    Identitas permanen = `sub` Google (bukan email). UNIQUE mencegah satu akun Google terhubung ke dua pengguna,
--    dan satu pengguna hanya punya satu tautan per penyedia.
CREATE TABLE user_identities (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider      TEXT NOT NULL CHECK (provider IN ('google')),
  subject       TEXT NOT NULL,
  email         TEXT,            -- email terakhir dari penyedia (informasi saja, bukan kunci)
  linked_at     TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at TEXT,
  UNIQUE (provider, subject),
  UNIQUE (user_id, provider)
);
