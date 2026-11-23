-- Kalender Tanam: tambah kategori kegiatan 'tanam' dan 'panen' (CHECK lama hanya 4 kategori).
-- SQLite tidak bisa mengubah CHECK, jadi tabel dibangun ulang; seluruh data pengingat disalin apa adanya.
CREATE TABLE land_reminders_new (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  land_id      INTEGER NOT NULL REFERENCES lands(id) ON DELETE CASCADE,
  season_start TEXT,
  due_date     TEXT NOT NULL,
  category     TEXT NOT NULL CHECK (category IN ('tanam', 'pemupukan', 'perawatan', 'pengamatan-hama', 'panen', 'lainnya')),
  title        TEXT NOT NULL,
  note         TEXT,
  done_at      TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO land_reminders_new (id, user_id, land_id, season_start, due_date, category, title, note, done_at, created_at, updated_at)
  SELECT id, user_id, land_id, season_start, due_date, category, title, note, done_at, created_at, updated_at FROM land_reminders;
DROP TABLE land_reminders;
ALTER TABLE land_reminders_new RENAME TO land_reminders;
CREATE INDEX IF NOT EXISTS idx_reminders_land ON land_reminders(user_id, land_id, due_date);
