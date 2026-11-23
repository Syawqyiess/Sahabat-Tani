-- Gambar ilustrasi lahan demo dan metadata gambar berita/artikel.

-- Lahan: ilustrasi terpisah dari foto asli (photo_path). Foto asli unggahan petani selalu diutamakan,
-- dan ilustrasi hanya ditampilkan selama lahan masih berlabel demo.
ALTER TABLE lands ADD COLUMN illustration_path TEXT;        -- path statis di /static/...
ALTER TABLE lands ADD COLUMN illustration_kind TEXT;        -- 'stok' (foto stok berlisensi) | 'ai' (ilustrasi AI)
ALTER TABLE lands ADD COLUMN illustration_credit TEXT;      -- atribusi sesuai lisensi
ALTER TABLE lands ADD COLUMN illustration_source_url TEXT;  -- halaman sumber/lisensi

UPDATE lands SET illustration_path = '/static/img/lahan-demo/blok-a.webp', illustration_kind = 'stok',
  illustration_credit = 'Foto: Firman Rusda, “Sawah Hijau dan Jalan Setapak”, Wikimedia Commons, CC BY-SA 4.0 (dipotong & diperkecil)',
  illustration_source_url = 'https://commons.wikimedia.org/wiki/File:Sawah_Hijau_dan_Jalan_Setapak.jpg'
 WHERE data_source = 'demo' AND name = 'Sawah Blok A (Demo)' AND illustration_path IS NULL;
UPDATE lands SET illustration_path = '/static/img/lahan-demo/blok-b.webp', illustration_kind = 'stok',
  illustration_credit = 'Foto: Yumenosora, “Tanam Padi” (Grogol, Kediri), Wikimedia Commons, CC BY-SA 4.0 (dipotong & diperkecil)',
  illustration_source_url = 'https://commons.wikimedia.org/wiki/File:Tanam_Padi.jpg'
 WHERE data_source = 'demo' AND name = 'Sawah Blok B (Demo)' AND illustration_path IS NULL;

-- Artikel/berita: image_url = URL yang ditampilkan; sisanya metadata asal-usul gambar.
ALTER TABLE articles ADD COLUMN image_source_url TEXT;   -- URL gambar asli di situs penerbit
ALTER TABLE articles ADD COLUMN image_credit TEXT;       -- kredit fotografer/penerbit
ALTER TABLE articles ADD COLUMN image_caption TEXT;      -- caption asli bila ada
ALTER TABLE articles ADD COLUMN image_kind TEXT;         -- 'sumber' | 'admin' | 'ilustrasi-ai' | 'ilustrasi-stok' | 'fallback'
ALTER TABLE articles ADD COLUMN image_status TEXT;       -- 'ok' | 'tidak-ada' | 'ditolak' | 'gagal' | 'diblokir' | 'tidak-diizinkan'
ALTER TABLE articles ADD COLUMN image_note TEXT;         -- alasan singkat (untuk laporan admin)
ALTER TABLE articles ADD COLUMN image_checked_at TEXT;
CREATE INDEX IF NOT EXISTS idx_articles_image_status ON articles(image_status);

-- Cover artikel internal yang diisi admin ditandai sebagai pilihan admin (tidak ditimpa backfill).
UPDATE articles SET image_kind = 'admin', image_status = 'ok' WHERE origin = 'internal' AND image_url IS NOT NULL;

-- Kebijakan gambar per sumber: 'tautan' = tampilkan URL gambar asli penerbit (tanpa menyalin berkas),
-- 'salin' = simpan salinan yang diperkecil (hanya bila penerbit mengizinkan), 'tidak' = tanpa gambar.
ALTER TABLE news_sources ADD COLUMN image_policy TEXT NOT NULL DEFAULT 'tautan';
ALTER TABLE news_sources ADD COLUMN image_hosts TEXT;  -- host CDN gambar tambahan yang diverifikasi (dipisah koma)
UPDATE news_sources SET image_hosts = 'img.antaranews.com' WHERE feed_url = 'https://www.antaranews.com/rss/ekonomi-bisnis.xml';
