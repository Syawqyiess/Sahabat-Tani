# Sahabat Tani

Sistem informasi pertanian berbahasa Indonesia untuk petani padi: akun pribadi, data lahan & peta, **Scan Hama Padi → Asisten AI otomatis**, informasi kualitas udara, artikel/berita, dan panel admin. Ini **demo fungsional**: integrasi eksternal yang belum dikonfigurasi berjalan dalam mode demo yang diberi label jelas.

## Stack

| Bagian | Pilihan | Alasan singkat |
|---|---|---|
| Server | Node.js 22 + Express 5 | Umum, mudah dipelihara, satu proses |
| Tampilan | EJS (server-rendered) + JS kecil tanpa framework | Ringan untuk koneksi terbatas, tetap berfungsi tanpa JS untuk alur inti |
| Database | SQLite (`node:sqlite` bawaan Node) + migrasi SQL | Tanpa kompilasi native; bisa dipindah ke PostgreSQL dengan skema yang sama |
| Autentikasi | Sesi server (express-session, disimpan di SQLite) + bcrypt | Cookie httpOnly/SameSite, regenerasi sesi saat login |
| AI | Analisis foto: **model scanner buatan sendiri** (EfficientNet-B0 → ONNX, `onnxruntime-node`), atau Gemini/Claude. Percakapan: Gemini (free tier) atau Claude | Modul analisis gambar & percakapan terpisah; penyedia dipilih lewat `.env` |
| Kualitas udara | Open-Meteo Air Quality API | Gratis untuk non-komersial, tanpa kunci |
| Peta | Leaflet + ubin OpenStreetMap/Esri; Windy (embed) untuk sebaran polusi | Tanpa API key, kode peta disajikan sendiri |
| Berita | RSS (rss-parser) | Hanya judul/ringkasan/tautan |

## Menjalankan

Prasyarat: **Node.js ≥ 22.13**.

```bash
npm install
```

```bash
npm run setup
```

```bash
npm start
```

Buka <http://localhost:3000>. `npm run setup` menjalankan migrasi dan membuat data demo (hanya bila database masih kosong). Opsional: salin `.env.example` menjadi `.env` untuk mengaktifkan integrasi. Untuk mengulang dari awal, hapus folder `storage/` lalu jalankan `npm run setup` lagi.

Menjalankan pengujian (memakai database sementara, tidak menyentuh data Anda):

```bash
npm test
```

### Akun demo (Data Demo — hapus sebelum dipakai dengan data asli)

| Peran | Login | Kata sandi | Catatan |
|---|---|---|---|
| Petani 1 | `081200000001` | `tani12345` | Profil hampir lengkap, 2 lahan demo berkoordinat + poligon |
| Petani 2 | `081200000002` | `tani12345` | Profil sengaja belum lengkap, 1 lahan tanpa koordinat/luas |
| Admin | `admin@sahabattani.test` | `admin12345` | Panel admin |

Seed menolak berjalan saat `NODE_ENV=production` (kecuali `ALLOW_DEMO_SEED=1`).

## Struktur

```
src/
  app.js, server.js, config.js
  db/            index.js (koneksi+migrasi), migrations/001_init.sql, seed.js, demo-data.js, session-store.js
  middleware/    security.js (login, peran, CSRF, rate limit)
  services/      scans.js, chat.js, airQuality.js, news.js, farmers.js, storage.js
  services/ai/   index.js (registry), anthropic.js, demo.js, prompts.js, references.js
  routes/        public, auth, farmer, lands, scans, chat, air, articles, media, admin
views/           template EJS (publik, petani, admin, partials)
public/          css/app.css, js/app.js, js/scan.js, js/chat.js, js/map.js
test/            flows.test.js (uji alur utama)
docs/INTEGRASI.md  panduan API key, billing, kuota, biaya
storage/         database & foto (privat, tidak di-commit)
```

## Skema database

Migrasi: `src/db/migrations/001_init.sql`. Tabel utama:

- `users` (login: HP/email, hash kata sandi, peran, status aktif, penanda demo) — **dipisah** dari `farmer_profiles` (1:1; semua kolom profil boleh kosong).
- `lands` (N per petani): nama, alamat, luas (boleh kosong), komoditas, varietas, tanggal tanam, status musim, `lat`/`lng` opsional, `polygon_json` opsional, `data_source` = `demo|real`.
- `pest_scans` (N per petani, `land_id` opsional): lokasi gambar, status `pending|processing|completed|failed`, `mode` `ai|demo`, `provider`, `model`, `result_json` terstruktur, `error_message`, waktu mulai/selesai, `processing_ms`, `idempotency_key` unik per petani, `chat_session_id`.
- `chat_sessions` (N per petani, `scan_id` unik opsional) → `chat_messages` (N per sesi; foto, mode, penyedia, model, `sources_json`).
- `articles`, `article_categories`, `saved_articles`, `news_sources`.
- `pest_references` (dengan status verifikasi, pemverifikasi, sumber).
- Pendukung: `password_resets` (token di-hash), `sessions`, `air_quality_cache`, `integration_events`, `schema_migrations`.

Foto disimpan di `storage/uploads/<user_id>/` (di luar folder publik) dan hanya dilayani lewat `/media/...` setelah pemeriksaan pemilik.

## Status fitur

### Berfungsi penuh (tanpa kredensial eksternal)
- Daftar, masuk, keluar, reset kata sandi (token 30 menit, sekali pakai; semua sesi lama diputus).
- Profil terpisah dari akun, indikator kelengkapan, “Belum diisi”, ajakan **Lengkapi Profil**, foto profil.
- Lahan: CRUD, tanpa koordinat/luas tetap bisa disimpan, poligon tervalidasi, tanda demo/asli.
- Dashboard: sapaan, ringkasan profil & lahan, tombol **Scan Hama Padi** utama, kualitas udara, peta ringkas, scan & chat terbaru, artikel.
- Alur scan: kamera langsung (getUserMedia) atau galeri → panduan foto → pratinjau + cek terang/buram/resolusi di perangkat → ganti/ambil ulang → keterangan opsional → **Analisis Foto** → otomatis ke chatroom berisi foto & hasil. Kompresi ke maks. 1600 px sebelum unggah.
- Kondisi khusus: izin kamera ditolak, tidak ada kamera (fallback kamera bawaan/galeri), format/ukuran salah (dicek di perangkat dan server, termasuk *magic bytes*), koneksi putus (coba lagi dengan kunci idempoten yang sama), AI gagal (pilihan **Coba lagi** tanpa unggah ulang atau buka chat dengan status “Foto belum berhasil dianalisis”).
- Anti-ganda: kunci idempoten per scan, klaim atomik saat coba ulang, tombol dinonaktifkan saat dikirim.
- Chat: riwayat per akun, foto tambahan, pertanyaan cepat, sumber referensi yang benar-benar dipakai (dengan status verifikasi), status gagal + coba lagi.
- **Informasi Kualitas Udara** (Open-Meteo, data nyata): US AQI + kategori US EPA, PM2.5, PM10, NO₂, O₃, CO dengan satuan, lokasi (lahan / perangkat dengan izin / lokasi demo berlabel), waktu data & waktu pembaruan, grafik 24 jam, atribusi, cache 30 menit, data lama bertanda waktu saat gagal.
- Artikel: daftar, detail, pencarian, filter kategori, pagination, artikel terkait, simpan artikel; Markdown disanitasi.
- Admin: statistik agregat (tanpa isi chat), kelola akun & status aktif (sesi langsung diputus), bantu isi profil & lahan, artikel (draft/terbit/arsip), kategori, sumber RSS, referensi hama + verifikasi, status integrasi tanpa nilai kunci.
- Keamanan: bcrypt, sesi aman, CSRF, Helmet + CSP, validasi input server, batas unggahan, rate limit (login, reset, scan, chat), pemeriksaan kepemilikan di setiap query, pemisahan data demo.

### Model scanner hama padi buatan sendiri (`AI_VISION_PROVIDER=lokal`)
- Dilatih dengan `ml/` pada 14 hama padi IP102 + kelas “bukan hama padi”; berjalan di server tanpa internet (±15 ms/foto).
- Hasil data uji (3.131 foto IP102 yang tidak dipakai melatih): **ketepatan 67,1%**, macro-F1 64,4%, **benar di 3 teratas 86,5%**.
  Pada ambang yakin 0,60, model menjawab untuk 67% foto dengan ketepatan 81%; sisanya dinyatakan “belum teridentifikasi”.
- Skor dikalibrasi (temperature scaling), lalu disampaikan sebagai kata: **“Hampir pasti”** (skor ≥ 85%, benar ±93% pada validasi),
  **“Kemungkinan besar”** (60–85%, ±85%), atau **“Belum yakin”** (< 60%, tidak menebak). AI menjawab tegas sesuai tingkat ini;
  angka persen hanya ada di “Lihat skor model” dan tidak diulang oleh chatbot.
- Paling sering tertukar: tiga jenis wereng (F1 ±0,5) dan hama kulit gabah. Belum mencakup walang sangit, keong mas, tikus,
  penyakit, atau kekurangan hara. Wajib diuji ulang dengan foto lapangan Indonesia. Panduan: [ml/README.md](ml/README.md).

### Chatbot lokal (`AI_CHAT_PROVIDER=ollama`)
- Model terbuka **Gemma 3 4B** lewat Ollama di komputer sendiri; foto & pesan petani tidak dikirim ke layanan luar.
- Menerima ringkasan hasil scan (termasuk skor model scanner lokal), referensi hama dari database, dan aturan keamanan yang sama.
- Uji `npm run uji-chatbot` (6 pertanyaan petani, termasuk pancingan dosis pestisida): lolos 6/6 pemeriksaan otomatis,
  rata-rata ±11 dtk per jawaban di laptop RTX 2050 setelah model dimuat (model dimuat otomatis saat server start).
- Keterbatasan: model 4B kadang keliru fakta (mis. menyebut wereng “memakan” jaringan, padahal menghisap cairan) bila
  referensi di database tidak lengkap — lengkapi Referensi Hama di panel admin. Baris “Referensi/Sumber” karangan model disaring otomatis.

### Mode demo / simulasi (berlabel di UI)
- **Analisis foto & Asisten AI** tanpa `ANTHROPIC_API_KEY`: “Simulasi respons AI”, foto tidak dianalisis, tidak ada dugaan hama.
- Data seed: akun, profil, lahan (“Lahan Demo — Bukan Batas Lahan Asli”), artikel (“Konten Demo”), referensi hama (“Belum diverifikasi”, tanpa sumber — perlu diisi & diverifikasi penyuluh), 1 scan demo per petani dengan gambar contoh.
- Reset kata sandi: tautan ditampilkan di layar karena email/SMS belum terhubung.

### Memerlukan kredensial/konfigurasi eksternal
| Fitur | Yang dibutuhkan |
|---|---|
| Analisis foto & chat AI nyata | `GEMINI_API_KEY` (free tier, untuk demo) atau `ANTHROPIC_API_KEY` (berbayar); uji dengan `npm run cek-ai` |
| Berita eksternal | URL RSS dari penerbit yang mengizinkan (diisi admin) |
| Pengiriman tautan reset | Penyedia email/SMS (belum diimplementasikan) |
| Kualitas udara komersial | Langganan Open-Meteo (gratis hanya non-komersial) |

Panduan lengkap: [docs/INTEGRASI.md](docs/INTEGRASI.md).

## Hasil pengujian alur utama

`npm test` — **33 dari 33 lulus** (Node 22.15, Windows 11). Cakupan:

- Halaman publik, perlindungan rute per peran, CSRF ditolak, semua halaman petani & admin ter-render.
- Daftar dengan data minimal → profil “Belum diisi” → dilengkapi belakangan; validasi pendaftaran; login salah; reset kata sandi sekali pakai.
- Lahan tanpa koordinat/luas; poligon tidak valid ditolak; petani tidak bisa membuka/mengubah/menghapus lahan petani lain lewat ID; peta hanya berisi lahan sendiri dan memberi label demo; placeholder bila tanpa API key.
- Scan demo → chat otomatis dengan foto, keterangan, label simulasi; idempoten; berkas palsu ditolak; foto privat (petani lain & admin 404); AI gagal → status gagal → coba lagi berhasil tanpa unggah ulang; mode AI (penyedia tiruan) → dugaan, ciri, langkah, sumber, tanpa persentase; chat menerima konteks scan & foto; riwayat ada setelah keluar-masuk; pertanyaan cepat demo; chat gagal → coba lagi; dua petani terpisah.
- Kualitas udara (respons tiruan): indeks, kategori, satuan, lokasi, waktu, atribusi, grafik; gagal → data lama bertanda; kuota habis tanpa cache → pesan + coba lagi.
- Admin terbitkan artikel → petani baca & simpan; draft/arsip tak terlihat; nonaktifkan akun memutus sesi; admin isi lahan petani; kunci API tidak bocor; dashboard admin tanpa isi chat; verifikasi referensi butuh sumber.

Pemeriksaan manual tambahan:
- Panggilan **nyata** ke Open-Meteo berhasil (contoh titik demo Karawang: US AQI 177 “Tidak sehat”, 24 titik grafik).
- Di browser ukuran ponsel (375×812): login → dashboard → scan (berkas uji disuntikkan ke input galeri) → otomatis masuk chatroom → pertanyaan cepat → halaman kualitas udara → menu “Lainnya”.

Belum diuji: panggilan langsung ke API Claude (belum ada API key), kamera fisik pada ponsel sungguhan, dan feed RSS nyata.

## Catatan pengembangan lanjut
- Ganti data demo dengan data asli lewat panel admin (profil & lahan) atau impor ke tabel `farmer_profiles`/`lands`; struktur koordinat & poligon sudah siap.
- Untuk produksi: set `NODE_ENV=production`, `SESSION_SECRET`, jalankan di belakang HTTPS (cookie `secure` aktif otomatis), cadangkan `storage/`, pertimbangkan PostgreSQL & object storage privat bila pengguna bertambah.
- Analisis foto saat ini sinkron (≤ 2 menit, dengan layar tunggu). Bila volume naik, pindahkan ke antrean pekerja; status `pending/processing` sudah ada di skema.
