# Panduan Menghubungkan Layanan Eksternal

Semua kunci disimpan di file `.env` di server (lihat `.env.example`). Kunci rahasia tidak pernah dikirim ke browser. Setelah mengubah `.env`, mulai ulang aplikasi. Status setiap integrasi bisa dilihat di **Admin → Integrasi** (nilai kunci tidak ditampilkan).

---

## 1. Chatbot lokal: Ollama (tanpa layanan luar)

Percakapan bisa dijalankan sepenuhnya di komputer/server sendiri dengan model bahasa terbuka.
Foto dan pesan petani tidak dikirim ke layanan luar.

1. Pasang Ollama: `winget install Ollama.Ollama` (atau unduh dari <https://ollama.com>). Ollama berjalan di `http://127.0.0.1:11434`.
2. Unduh model (±3,3 GB): `ollama pull gemma3:4b`. Gemma 3 4B dipilih karena dukungan banyak bahasa dan bisa membaca gambar.
3. Di `.env`: `AI_CHAT_PROVIDER=ollama` (opsional `OLLAMA_MODEL`, `OLLAMA_VISION`, `OLLAMA_NUM_CTX`).
4. `npm run cek-ai` untuk memastikan Ollama berjalan dan model siap, lalu mulai ulang aplikasi.

Implementasi: `src/services/ai/ollama.js`. Untuk model kecil, konteks dijaga pendek (ringkasan hasil scan + 12 pesan terakhir)
dan hanya foto scan serta foto tambahan terakhir yang dikirim. Bila Ollama mati, chat menampilkan status gagal dengan tombol coba lagi.

Kebutuhan perangkat (perkiraan): RAM 16 GB; dengan GPU NVIDIA 4 GB model berjalan sebagian di GPU. Tanpa GPU tetap bisa, tetapi
jawaban bisa makan waktu puluhan detik. Mutu model 4B di bawah Gemini/Claude — tetap ingatkan petani bahwa jawabannya bantuan awal.

## 1a. AI gratis untuk demo: Google Gemini

1. Buka <https://aistudio.google.com>, masuk dengan akun Google, klik **Get API key** → **Create API key** (tanpa kartu kredit).
2. Isi `GEMINI_API_KEY=...` di `.env`. Bila `ANTHROPIC_API_KEY` kosong, aplikasi otomatis memakai Gemini untuk analisis foto dan chat.
3. Jalankan `npm run cek-ai`. Bila model ditolak, skrip menampilkan daftar model yang tersedia untuk kunci Anda.

Model diatur sebagai **daftar cadangan** (dipisah koma) yang dicoba berurutan bila model sebelumnya lambat (> `GEMINI_TIMEOUT_MS`, default 50 dtk), kuota habis, server sibuk, atau model sudah dihapus:
- Analisis foto: `GEMINI_VISION_MODEL=gemini-3.5-flash,gemini-flash-lite-latest`
- Chat: `GEMINI_CHAT_MODEL=gemini-flash-lite-latest,gemini-3.5-flash`

Pengukuran 1 Nov 2026 (free tier): `gemini-3.5-flash` ±7–20 dtk dengan foto, `gemini-flash-lite-latest` ±1–4 dtk, sedangkan alias `gemini-flash-latest` (saat itu 3.8-flash) > 90 dtk sehingga tidak dipakai. `gemini-2.5-flash` sudah tidak tersedia untuk pengguna baru.
4. Mulai ulang aplikasi (`npm start`).

Catatan:
- Batas free tier ditentukan per proyek dan dapat berubah; lihat di halaman rate-limit AI Studio. Bila kuota habis, aplikasi menampilkan “Kuota gratis layanan AI sedang habis” dengan tombol coba lagi.
- **Privasi:** pada free tier, Google dapat memakai foto dan pesan yang dikirim untuk meningkatkan produknya. Cocok untuk demo; sebelum dipakai dengan data petani asli, pindah ke tier berbayar atau beri tahu petani. Peringatan ini juga tampil di Admin → Integrasi.
- Implementasi: `src/services/ai/gemini.js` (REST `generateContent`, tanpa paket tambahan). Keluaran analisis diminta berformat JSON lalu dinormalisasi ke skema yang sama dengan Claude.
- Bisa dicampur, misalnya `AI_VISION_PROVIDER=gemini` dan `AI_CHAT_PROVIDER=anthropic`.

## 1b. AI analisis foto & Asisten AI (Anthropic Claude, berbayar)

**Tanpa kunci** aplikasi berjalan dalam **mode demo**: foto disimpan dan dibuka di chat, tetapi diberi label “Simulasi respons AI” dan **tidak dianalisis oleh model**.

Langkah mengaktifkan:
1. Buat akun di <https://console.anthropic.com>, aktifkan billing, lalu buat API key.
2. Isi `ANTHROPIC_API_KEY=...` di `.env` dan mulai ulang aplikasi.
3. Buka Admin → Integrasi: “Analisis gambar” dan “Asisten percakapan” harus berstatus **aktif**.

Arsitektur (mudah diganti):
- `src/services/ai/index.js` — registry penyedia. Analisis gambar (`vision`) dan percakapan (`chat`) dipilih terpisah lewat `AI_VISION_PROVIDER` / `AI_CHAT_PROVIDER`.
- `src/services/ai/anthropic.js` — implementasi Claude. Analisis foto memakai *structured output* (JSON schema di `prompts.js`) agar hasil tersimpan terstruktur di `pest_scans.result_json`.
- `src/services/ai/demo.js` — mode demo yang jujur.
- Setiap penyedia mendeklarasikan `supportsImages`. Bila suatu saat percakapan memakai model teks saja, foto tambahan di chat otomatis diproses lewat modul analisis gambar — chatbot teks tidak dianggap bisa membaca foto.
- Untuk memakai model identifikasi hama khusus (mis. model klasifikasi yang dilatih sendiri), buat objek `{ name, mode: 'ai', model, supportsImages: true, analyze() }` yang mengembalikan bentuk hasil yang sama, lalu daftarkan di `index.js`.

Model bawaan: `claude-opus-5-5` (bisa diganti lewat `AI_VISION_MODEL` / `AI_CHAT_MODEL`). Fallback sisi server diaktifkan (`AI_USE_FALLBACKS=true`); bila akun Anda belum mendukungnya dan permintaan ditolak, set `AI_USE_FALLBACKS=false`.

**Perkiraan biaya** (harga daftar Anthropic per Oktober 2026, dapat berubah — cek <https://www.anthropic.com/pricing>): Claude Opus 5.5 $4 per juta token input dan $20 per juta token output. Satu scan (1 foto ≈ 1.000–1.600 token + instruksi, keluaran termasuk proses berpikir model ±1.000–2.000 token) kira-kira **US$0,02–0,05**; satu balasan chat yang menyertakan foto konteks kira-kira **US$0,01–0,03**. Untuk menekan biaya, Anda bisa memakai `claude-sonnet-5-5` ($2/$10) — uji dulu mutunya pada foto lapangan. Batas penggunaan per petani: 20 scan & 60 pesan per jam (`src/middleware/security.js`).

> Integrasi Claude belum diuji terhadap API langsung dalam pengembangan ini karena belum ada API key; alurnya diuji dengan penyedia tiruan (lihat `test/flows.test.js`). Lakukan uji coba dengan beberapa foto asli setelah kunci dipasang.

---

## 2. Peta lahan (Leaflet) dan peta kualitas udara (Windy)

Tidak memerlukan API key maupun billing.

**Peta lahan — Leaflet**
- Pustaka [Leaflet](https://leafletjs.com) (open source) dipasang lewat npm dan disajikan dari server sendiri (`/static/vendor/leaflet`), jadi CSP tetap ketat (`script-src 'self'`).
- Lapisan dasar: **Satelit** (Esri World Imagery) dan **Peta jalan** (OpenStreetMap), dapat diganti dari tombol di pojok kanan atas. Atribusi keduanya wajib dan sudah tampil di pojok peta.
- Ketentuan ubin: server ubin OpenStreetMap dan Esri wajar dipakai untuk demo/penggunaan ringan. Untuk banyak pengguna, gunakan penyedia ubin berbayar atau server ubin sendiri, dan periksa ketentuan terbaru penyedianya.
- Peta hanya menerima data lahan milik petani yang masuk. Lahan demo: warna oranye, **garis putus-putus**, penanda **D**; lahan asli: hijau, garis penuh, penanda **L**.
- Leaflet tidak mengetahui kepemilikan/batas lahan. Batas asli diisi sebagai poligon `[[lat,lng],...]` di form lahan (petani atau admin), misalnya dari pengukuran GPS lapangan. Lahan tetap bisa disimpan tanpa koordinat.
- Bila ubin gagal dimuat (mis. koneksi putus), peta menampilkan pesan, bukan peta kosong diam-diam.

**Peta sebaran polusi — Windy**
- Widget embed resmi `https://embed.windy.com/embed.html` disematkan sebagai iframe di halaman Kualitas Udara, dipusatkan ke lokasi yang dipilih dengan penanda.
- Lapisan (produk `cams`, data Copernicus CAMS): PM2.5 (`pm2p5`), NO₂ (`no2`), CO (`cosc`), ozon permukaan (`go3`), debu (`dustsm`). Hanya nilai dari daftar ini yang diterima server.
- CSP mengizinkan `frame-src https://embed.windy.com`. Peta membutuhkan internet; angka Open-Meteo di atasnya tetap menjadi acuan utama.

## 2a. Visualisasi data RDKK di Dashboard (data dari Tableau Public)

Dashboard petani menampilkan kebutuhan pupuk bersubsidi **Dashboard RDKK Mojopuro Wetan** (workbook Tableau Public `SITANI`, Angely Marcella), tetapi diagramnya digambar sendiri oleh website (SVG di `public/js/rdkk.js`) agar seirama dengan tampilan Sahabat Tani. Tidak ada embed atau skrip Tableau di halaman.
- Server (`src/services/rdkk.js`) mengunduh ekspor CSV lembar: Kebutuhan Pupuk per Jenis, Pupuk per Musim, dan empat KPI (petani terdaftar, kelompok tani, total kebutuhan, rata-rata per petani). Lembar Perbandingan Kelompok Tani & Heatmap berisi data yang sama sehingga tidak diunduh ulang; lembar Status Data RDKK tidak menyediakan data lewat CSV.
- Angka format Indonesia (`42.328` = 42.328 kg) dibaca dengan benar dan **divalidasi silang**: jumlah per kelompok dan per musim harus sama dengan KPI total. Bila kolom berubah, angka tidak cocok, atau Tableau menolak akses, data **tidak** disimpan dan Dashboard tetap memakai snapshot terakhir beserta keterangan waktunya.
- Pembaruan otomatis saat server mulai (bila data lebih tua dari `RDKK_REFRESH_HOURS`, bawaan 24 jam) dan dicek tiap jam; `RDKK_AUTO_FETCH=0` untuk mematikan. Admin dapat memperbarui manual di Admin → Integrasi.
- Diagram: kartu KPI, batang bertumpuk per kelompok tani, batang berkelompok per musim tanam, peta panas jenis × musim, filter jenis pupuk, tooltip (kursor & keyboard), serta tabel data tanpa JavaScript. Palet Urea (#2e7d32) & NPK (#c98a1b) lolos pemeriksaan buta warna; karena emas < 3:1 terhadap putih, setiap batang diberi label angka.
- Data sama untuk semua pengguna; tidak disaring per akun atau per lahan. Bergantung pada pemilik workbook tetap mengizinkan unduhan data dan tidak mengganti nama lembar/kolom.

## 3. Open-Meteo Air Quality API

Tidak memerlukan API key untuk penggunaan **non-komersial**. Ketentuan yang berlaku saat pengembangan (periksa ulang di <https://open-meteo.com/en/terms> sebelum rilis):
- Gratis untuk non-komersial dengan batas sekitar **10.000 permintaan/hari** (juga ada batas per menit/jam).
- Data berlisensi **CC BY 4.0** — wajib atribusi; halaman kualitas udara menampilkan “Weather data by Open-Meteo.com” dan sumber data CAMS (Copernicus Atmosphere Monitoring Service).
- Penggunaan komersial memerlukan langganan berbayar (API key + endpoint `customer-...`). Ganti `OPEN_METEO_AQ_URL` bila berlangganan.

Perilaku aplikasi:
- Hasil di-*cache* per grid ±1 km selama `AIR_CACHE_MINUTES` (30 menit) di tabel `air_quality_cache`.
- Bila API gagal/kuota habis (HTTP 429) dan ada cache, data lama ditampilkan dengan label “Data lama” + waktu pengambilan. Tanpa cache, tampil pesan kesalahan + tombol “Coba lagi”. Tidak pernah diganti angka simulasi.
- Indeks yang dipakai **US AQI** (kategori US EPA) dan **tidak** dikonversi ke ISPU.

---

## 4. Berita pertanian (RSS & web scraping)

Kanal **Berita & Artikel Pertanian** diisi dari situs nyata. Subkategori: Budidaya Padi, Hama dan Penyakit Tanaman, Pupuk dan Kesehatan Tanah, Teknologi Pertanian, Irigasi dan Pengelolaan Air, Cuaca dan Iklim Pertanian, Berita Pertanian Umum.

Sumber bawaan (sudah dicek aksesnya, robots.txt, dan tanggalnya — bisa dinonaktifkan di Admin → Sumber Berita):

| Sumber | Cara | Catatan |
|---|---|---|
| Ditjen PSP Kementan (psp.pertanian.go.id/berita) | HTML | tanggal dari meta artikel |
| BRMP Kementan (brmp.pertanian.go.id/berita) | HTML | tanggal dari daftar berita; bila tidak ada → kosong |
| Tabloid Sinar Tani — Pangan | HTML | tanggal dari bagian detail artikel (bukan tanggal di header situs) |
| Trubus (RSS) | RSS | disaring kata kunci pertanian |
| ANTARA Ekonomi & Bisnis (RSS) | RSS | kanal umum, disaring kata kunci pertanian |

Aturan yang dijalankan kode (`src/services/news/`):
- RSS dipakai bila tersedia; HTML hanya dari halaman daftar berita yang diizinkan robots.txt (dibaca untuk setiap host, termasuk Crawl-delay).
- Identitas bot jujur, jeda ≥ 2 detik per host, batas jumlah item per sumber. Respons 401/403/429 atau halaman verifikasi/CAPTCHA → sumber **berhenti**, tidak diakali. Tidak ada login atau paywall yang dilewati.
- robots.txt bukan izin menyalin: yang disimpan hanya judul, ringkasan singkat dari penerbit (≤ 280 karakter), tanggal terbit asli, nama sumber, dan tautan. Isi lengkap tidak disalin; pembaca diarahkan ke situs penerbit.
- Tanggal tidak pernah dikarang: bila sumber tidak mencantumkannya, tampil “Tanggal tidak tersedia” dan berita diletakkan di akhir urutan.
- Duplikat dicegah lewat URL ternormalisasi dan judul (juga antar sumber). Berita non-pertanian dari kanal umum dibuang.
- Subkategori ditentukan kata kunci; admin bisa memindahkannya manual.

**Gambar berita.** Saat berita diambil (dan lewat backfill), gambar utama dicari berurutan: RSS (`media:content`/`media:thumbnail`/`enclosure`) → JSON-LD `NewsArticle`/`Article` (termasuk `@graph` dan rujukan `@id`) → `og:image` → `twitter:image` → selector `article.image` di konfigurasi sumber. Setiap kandidat divalidasi di backend (`src/services/news/images.js`):
- host harus domain penerbit itu sendiri (atau subdomainnya) atau CDN yang diisi admin; IP tujuan harus publik (localhost/jaringan privat ditolak), dicek ulang di setiap redirect (maks. 3);
- batas waktu 15 detik, retry 1× untuk galat jaringan/5xx, ukuran maks. 8 MB, jeda per host dan robots.txt tetap berlaku;
- berkas harus benar-benar didekode sebagai JPEG/PNG/WEBP/GIF/AVIF, minimal 400×200 px, proporsi wajar; HTML/SVG yang menyamar, logo, ikon, avatar, banner iklan, piksel pelacak, dan gambar umum situs (dipakai berita lain) ditolak;
- 401/403/429 (termasuk proteksi hotlink) = “diblokir”, tidak dicoba akali.

Kebijakan per sumber (Admin → Sumber Berita): **tautan** (bawaan) menampilkan URL gambar asli penerbit dengan kredit “Foto: <penerbit>”, tanpa menyalin berkas; **salinan** menyimpan versi WEBP 1280 px di `storage/uploads/berita` — pakai hanya bila penerbit mengizinkan; **tanpa gambar**. Bila tidak ada gambar yang lolos, kartu menampilkan ilustrasi kategori berlabel “Ilustrasi”.

Backfill artikel lama: tombol **Perbarui gambar berita lama** di Admin → Sumber Berita, atau `npm run backfill-gambar` (`-- --ulang` untuk memeriksa ulang yang memakai ilustrasi). Aman diulang: yang sudah bergambar dilewati, cover pilihan admin tidak disentuh, galat jaringan dicoba lagi setelah 6 jam. Setiap sinkronisasi berita juga melanjutkan backfill (40 artikel per putaran).

Menambah sumber: Admin → Sumber Berita → isi nama, URL (feed RSS atau halaman daftar berita), **dasar izin** (wajib — cek juga syarat penggunaan situs, bukan hanya robots.txt), dan untuk HTML konfigurasi JSON (`link_pattern` wajib). Tekan **Uji** untuk pratinjau tanpa menyimpan (terlihat item, tanggal, subkategori, dan alasan item dilewati), lalu **Ambil**. Server juga mengambil otomatis saat mulai dan setiap `NEWS_FETCH_INTERVAL_HOURS` jam (`NEWS_AUTO_FETCH=0` untuk mematikan). Bila struktur situs berubah, laporan sumber menampilkan galat “tidak menemukan tautan berita”.

---

## 5. Email/SMS untuk reset kata sandi

Belum terhubung. Saat ini tautan reset (berlaku 30 menit, sekali pakai) dicatat di log server, dan bila `DEMO_SHOW_RESET_LINK=true` juga ditampilkan di layar (default: aktif di luar produksi). Untuk produksi, sambungkan penyedia email/SMS/WhatsApp di `src/routes/auth.js` (blok `/lupa-sandi`) dan set `DEMO_SHOW_RESET_LINK=false`.
