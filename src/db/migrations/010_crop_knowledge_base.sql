-- 010_crop_knowledge_base.sql
-- Knowledge Base Masa Tanam Padi dan Varietas Unggul (Jawa Timur / Gresik)

CREATE TABLE IF NOT EXISTS crop_stages (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  stage_id         TEXT UNIQUE NOT NULL,
  min_hst          INTEGER NOT NULL,
  max_hst          INTEGER NOT NULL,
  nama_fase        TEXT NOT NULL,
  kategori_fase    TEXT NOT NULL,
  ciri_fisik       TEXT,
  manajemen_air    TEXT,
  kegiatan_json    TEXT,
  ancaman_opt_json TEXT,
  tips_pht_json    TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_crop_stages_hst ON crop_stages(min_hst, max_hst);

CREATE TABLE IF NOT EXISTS crop_varieties (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  variety_id         TEXT UNIQUE NOT NULL,
  nama               TEXT NOT NULL,
  tipe               TEXT,
  umur_hss           TEXT,
  min_hst            INTEGER,
  max_hst            INTEGER,
  rata_rata_hasil    TEXT,
  potensi_hasil      TEXT,
  ketahanan_opt      TEXT,
  manajemen_air      TEXT,
  pemupukan          TEXT,
  kesesuaian_lahan   TEXT,
  is_priority_gresik INTEGER NOT NULL DEFAULT 0,
  created_at         TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_crop_varieties_nama ON crop_varieties(nama);
