-- Data RDKK Mojopuro Wetan yang diambil dari ekspor CSV workbook Tableau Public "SITANI".
-- Setiap pengambilan dicatat; Dashboard memakai snapshot terakhir yang lolos validasi.
CREATE TABLE IF NOT EXISTS rdkk_snapshots (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  fetched_at  TEXT NOT NULL DEFAULT (datetime('now')),
  status      TEXT NOT NULL CHECK (status IN ('ok', 'gagal')),
  data_json   TEXT,          -- data yang sudah dinormalisasi (hanya bila status ok)
  error       TEXT,
  warnings    TEXT           -- catatan validasi (JSON array)
);
CREATE INDEX IF NOT EXISTS idx_rdkk_status ON rdkk_snapshots(status, id);
