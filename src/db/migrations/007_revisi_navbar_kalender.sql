-- Revisi besar: sesi chat kosong diarsipkan (bukan dihapus), pin artikel, pengingat kalender tanam,
-- sumber HST pada scan, serta perapian teks data demo.

-- 1.3 Sesi chat kosong: diarsipkan agar keluar dari riwayat tetapi tetap bisa ditinjau.
ALTER TABLE chat_sessions ADD COLUMN archived_at TEXT;
ALTER TABLE chat_sessions ADD COLUMN archive_reason TEXT;
UPDATE chat_sessions SET archived_at = datetime('now'), archive_reason = 'kosong: tanpa pesan, foto, maupun scan'
 WHERE archived_at IS NULL AND scan_id IS NULL
   AND NOT EXISTS (SELECT 1 FROM chat_messages m WHERE m.session_id = chat_sessions.id)
   AND NOT EXISTS (SELECT 1 FROM pest_scans p WHERE p.chat_session_id = chat_sessions.id);

-- 1.4 Artikel disematkan (pin) dengan urutan.
ALTER TABLE articles ADD COLUMN is_pinned INTEGER NOT NULL DEFAULT 0;
ALTER TABLE articles ADD COLUMN pin_order INTEGER;
CREATE INDEX IF NOT EXISTS idx_articles_pin ON articles(is_pinned, pin_order);

-- 4.1 Pengingat kalender per lahan & musim tanam (musim = tanggal tanam yang berlaku saat dibuat).
CREATE TABLE IF NOT EXISTS land_reminders (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  land_id      INTEGER NOT NULL REFERENCES lands(id) ON DELETE CASCADE,
  season_start TEXT,            -- tanggal tanam musim tanam saat pengingat dibuat (NULL bila belum ada)
  due_date     TEXT NOT NULL,   -- YYYY-MM-DD
  category     TEXT NOT NULL CHECK (category IN ('perawatan', 'pemupukan', 'pengamatan-hama', 'lainnya')),
  title        TEXT NOT NULL,
  note         TEXT,
  done_at      TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_reminders_land ON land_reminders(user_id, land_id, due_date);

-- 5.3 Asal nilai HST pada scan: 'tanggal-tanam' (otomatis) atau 'manual' (diisi/dikoreksi petani).
ALTER TABLE pest_scans ADD COLUMN plant_age_source TEXT;

-- 6.3 Nama akun demo tanpa "(Akun Demo)"; status demo ditampilkan sebagai badge dari users.is_demo.
UPDATE farmer_profiles SET full_name = TRIM(REPLACE(full_name, '(Akun Demo)', ''))
 WHERE full_name LIKE '%(Akun Demo)%' AND user_id IN (SELECT id FROM users WHERE is_demo = 1);

-- 4.2 Alamat lahan demo dirapikan: penanda demo cukup satu (badge), bukan diulang di teks alamat.
UPDATE lands SET address_desc = 'Desa Mojopuro Wetan, Bungah, Gresik — sawah utara permukiman'
 WHERE data_source = 'demo' AND name = 'Sawah Blok A (Demo)' AND address_desc LIKE '%lokasi contoh, bukan lahan asli%';
UPDATE lands SET address_desc = 'Desa Mojopuro Wetan, Bungah, Gresik — timur Blok A'
 WHERE data_source = 'demo' AND name = 'Sawah Blok B (Demo)' AND address_desc LIKE '%lokasi contoh, bukan lahan asli%';
