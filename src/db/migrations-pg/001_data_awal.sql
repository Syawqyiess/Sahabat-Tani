-- Data awal setara migrasi SQLite 002 & 004: kategori tambahan dan sumber berita terverifikasi.
-- Aman dijalankan ulang (ON CONFLICT DO NOTHING).
INSERT INTO article_categories (name, slug)
  SELECT 'Irigasi dan Pengelolaan Air', 'irigasi-dan-pengelolaan-air'
  WHERE EXISTS (SELECT 1 FROM article_categories) AND NOT EXISTS (SELECT 1 FROM article_categories WHERE slug = 'irigasi-dan-pengelolaan-air');

-- Sumber awal yang sudah diverifikasi (15 Nov 2026): dapat diakses, robots.txt mengizinkan, punya tanggal terbit
-- yang dapat dibaca mesin. Hanya judul, ringkasan singkat penerbit, tanggal asli, sumber & tautan yang disimpan.
INSERT INTO news_sources (name, feed_url, homepage_url, usage_note, kind, config_json, filter_keywords, max_items, is_active) VALUES
('Ditjen Prasarana dan Sarana Pertanian (Kementan)', 'https://psp.pertanian.go.id/berita', 'https://psp.pertanian.go.id',
 'Situs pemerintah (go.id); robots.txt: semua diizinkan. Disimpan hanya judul, ringkasan meta, tanggal (article:published_time) & tautan.',
 'html', '{"link_pattern":"^https://psp\\.pertanian\\.go\\.id/berita/[a-z0-9-]{8,}$","article":{"title":["meta[property=\"og:title\"]","h1"],"summary":["meta[property=\"og:description\"]","meta[name=\"description\"]"],"date":["meta[property=\"article:published_time\"]"]}}',
 0, 10, 1),
('BRMP — Badan Perakitan dan Modernisasi Pertanian (Kementan)', 'https://brmp.pertanian.go.id/berita', 'https://brmp.pertanian.go.id',
 'Situs pemerintah (go.id); robots.txt: semua diizinkan. Tanggal diambil dari daftar berita resmi (span.post-date).',
 'html', '{"link_pattern":"^https://brmp\\.pertanian\\.go\\.id/berita/[a-z0-9-]{8,}$","list_item":"div.info","list_date":"span.post-date","article":{"title":["meta[property=\"og:title\"]","h1"],"summary":["meta[property=\"og:description\"]","meta[name=\"description\"]"],"date":[]}}',
 0, 10, 1),
('Tabloid Sinar Tani — Pangan', 'https://tabloidsinartani.com/indeks/pangan', 'https://tabloidsinartani.com',
 'Media pertanian; tanpa robots.txt (tidak ada larangan); "Copyright Tabloid Sinar Tani". Hanya judul, ringkasan meta, tanggal (div.date_detail, bukan tanggal header) & tautan.',
 'html', '{"link_pattern":"^https://tabloidsinartani\\.com/detail/.+/\\d+-[A-Za-z0-9-]+$","article":{"title":["meta[property=\"og:title\"]"],"summary":["meta[name=\"description\"]","meta[property=\"og:description\"]"],"date":["div.jdl_detail div.date_detail"]}}',
 0, 10, 1),
('Trubus', 'https://trubus.id/feed', 'https://trubus.id',
 'Media pertanian; RSS resmi; robots.txt: semua diizinkan; "All rights reserved" — hanya judul, ringkasan singkat & tautan.',
 'rss', NULL, 1, 10, 1),
('ANTARA — Ekonomi & Bisnis', 'https://www.antaranews.com/rss/ekonomi-bisnis.xml', 'https://www.antaranews.com',
 'Kantor berita; RSS resmi; robots.txt mengizinkan /rss. Kanal umum: hanya berita yang memuat kata kunci pertanian yang disimpan. Hanya judul, ringkasan singkat & tautan.',
 'rss', NULL, 1, 20, 1)
ON CONFLICT (feed_url) DO NOTHING;

UPDATE news_sources SET image_hosts = 'img.antaranews.com' WHERE feed_url = 'https://www.antaranews.com/rss/ekonomi-bisnis.xml';
