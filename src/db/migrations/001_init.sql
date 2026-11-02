-- Sahabat Tani — skema awal
-- Data autentikasi (users) dipisah dari data profil (farmer_profiles).

CREATE TABLE users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  phone         TEXT UNIQUE,
  email         TEXT UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'farmer' CHECK (role IN ('farmer', 'admin')),
  is_active     INTEGER NOT NULL DEFAULT 1,
  is_demo       INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at TEXT,
  CHECK (phone IS NOT NULL OR email IS NOT NULL)
);

CREATE TABLE password_resets (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at    TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE farmer_profiles (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id          INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  full_name        TEXT,
  photo_path       TEXT,
  village          TEXT,
  district         TEXT,
  regency          TEXT,
  province         TEXT,
  farmer_group     TEXT,
  experience_years INTEGER,
  main_commodity   TEXT,
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE lands (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  address_desc   TEXT,
  area_ha        REAL,
  commodity      TEXT,
  variety        TEXT,
  planting_date  TEXT,
  season_status  TEXT,
  lat            REAL,
  lng            REAL,
  -- Batas lahan: JSON array [[lat,lng], ...]. Boleh kosong.
  polygon_json   TEXT,
  data_source    TEXT NOT NULL DEFAULT 'real' CHECK (data_source IN ('demo', 'real')),
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_lands_user ON lands(user_id);

CREATE TABLE chat_sessions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scan_id    INTEGER UNIQUE REFERENCES pest_scans(id) ON DELETE SET NULL,
  title      TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_chat_sessions_user ON chat_sessions(user_id, updated_at);

CREATE TABLE pest_scans (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  land_id         INTEGER REFERENCES lands(id) ON DELETE SET NULL,
  idempotency_key TEXT NOT NULL,
  image_path      TEXT NOT NULL,
  image_mime      TEXT NOT NULL,
  image_bytes     INTEGER NOT NULL,
  plant_age_days  INTEGER,
  affected_part   TEXT,
  symptoms        TEXT,
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  mode            TEXT CHECK (mode IN ('ai', 'demo')),
  provider        TEXT,
  model           TEXT,
  result_json     TEXT,
  error_message   TEXT,
  started_at      TEXT,
  completed_at    TEXT,
  processing_ms   INTEGER,
  chat_session_id INTEGER REFERENCES chat_sessions(id) ON DELETE SET NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, idempotency_key)
);
CREATE INDEX idx_scans_user ON pest_scans(user_id, created_at);

CREATE TABLE chat_messages (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id   INTEGER NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  role         TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content      TEXT NOT NULL,
  image_path   TEXT,
  image_mime   TEXT,
  mode         TEXT,
  provider     TEXT,
  model        TEXT,
  sources_json TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_chat_messages_session ON chat_messages(session_id, id);

CREATE TABLE article_categories (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE
);

CREATE TABLE news_sources (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT NOT NULL,
  feed_url        TEXT NOT NULL UNIQUE,
  homepage_url    TEXT,
  usage_note      TEXT,
  category_id     INTEGER REFERENCES article_categories(id) ON DELETE SET NULL,
  is_active       INTEGER NOT NULL DEFAULT 1,
  last_fetched_at TEXT,
  last_error      TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE articles (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  slug           TEXT NOT NULL UNIQUE,
  title          TEXT NOT NULL,
  summary        TEXT,
  body_md        TEXT,
  body_html      TEXT,
  image_url      TEXT,
  image_alt      TEXT,
  author_name    TEXT,
  author_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  category_id    INTEGER REFERENCES article_categories(id) ON DELETE SET NULL,
  tags           TEXT,
  status         TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  origin         TEXT NOT NULL DEFAULT 'internal' CHECK (origin IN ('internal', 'external')),
  is_demo        INTEGER NOT NULL DEFAULT 0,
  source_id      INTEGER REFERENCES news_sources(id) ON DELETE SET NULL,
  source_name    TEXT,
  source_url     TEXT,
  external_guid  TEXT UNIQUE,
  published_at   TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_articles_pub ON articles(status, published_at);

CREATE TABLE saved_articles (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, article_id)
);

CREATE TABLE pest_references (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  slug            TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  scientific_name TEXT,
  aliases         TEXT,
  symptoms        TEXT,
  visual_signs    TEXT,
  ipm_control     TEXT,
  prevention      TEXT,
  when_to_consult TEXT,
  source_name     TEXT,
  source_url      TEXT,
  is_verified     INTEGER NOT NULL DEFAULT 0,
  verified_by     TEXT,
  verified_at     TEXT,
  is_demo         INTEGER NOT NULL DEFAULT 0,
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE air_quality_cache (
  cache_key  TEXT PRIMARY KEY,
  payload    TEXT NOT NULL,
  fetched_at TEXT NOT NULL
);

CREATE TABLE sessions (
  sid     TEXT PRIMARY KEY,
  sess    TEXT NOT NULL,
  expires INTEGER NOT NULL
);

CREATE TABLE integration_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  service    TEXT NOT NULL,
  ok         INTEGER NOT NULL,
  message    TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
