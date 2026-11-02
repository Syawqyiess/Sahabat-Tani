# Panduan Menghubungkan Layanan Eksternal

Semua kunci disimpan di file `.env` di server (lihat `.env.example`). Kunci rahasia tidak pernah dikirim ke browser, kecuali Google Maps *browser key* yang memang dirancang publik dan **wajib dibatasi**. Setelah mengubah `.env`, mulai ulang aplikasi. Status setiap integrasi bisa dilihat di **Admin → Integrasi** (nilai kunci tidak ditampilkan).

---

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

## 2. Google Maps JavaScript API

**Tanpa kunci** halaman peta menampilkan *placeholder* informatif dan daftar koordinat (tidak ada peta palsu).

1. Buka <https://console.cloud.google.com>, buat proyek, **aktifkan billing** (wajib walau ada kuota gratis bulanan).
2. APIs & Services → Library → aktifkan **Maps JavaScript API** saja.
3. Credentials → Create credentials → API key. Lalu **batasi**:
   - *Application restrictions*: **Websites (HTTP referrers)** → tambahkan domain Anda, mis. `https://sahabattani.example.id/*` dan untuk pengembangan `http://localhost:3000/*`.
   - *API restrictions*: **Restrict key** → pilih hanya **Maps JavaScript API**.
4. Atur kuota/anggaran: Billing → Budgets & alerts (mis. peringatan di US$10), dan APIs & Services → Maps JavaScript API → Quotas untuk membatasi *map loads* per hari.
5. Isi `GOOGLE_MAPS_BROWSER_KEY=...` di `.env`.

Catatan:
- Peta hanya menerima data lahan milik petani yang masuk (disiapkan di server).
- Lahan demo diberi label “Lahan Demo — Bukan Batas Lahan Asli” dan warna oranye; lahan asli hijau.
- Google Maps tidak mengetahui kepemilikan/batas lahan. Batas asli diisi sebagai poligon `[[lat,lng],...]` di form lahan (petani atau admin), misalnya dari pengukuran GPS lapangan. Lahan tetap bisa disimpan tanpa koordinat.
- `map.js` memakai `google.maps.Marker` (masih berfungsi). Untuk proyek baru Google menyarankan `AdvancedMarkerElement` yang memerlukan `GOOGLE_MAPS_MAP_ID`.
- CSP di `src/app.js` sudah mengizinkan domain `maps.googleapis.com` dan `maps.gstatic.com`.

---

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

## 4. Berita pertanian (RSS)

1. Pilih penerbit tepercaya yang **mengizinkan** penggunaan RSS-nya (baca syarat di situs penerbit; bila ragu, minta izin tertulis).
2. Admin → Sumber Berita → isi nama, URL feed, dan **dasar izin** (wajib), pilih kategori.
3. Tekan “Ambil sekarang”. Selanjutnya server mengambil otomatis setiap `NEWS_FETCH_INTERVAL_HOURS` jam.

Yang disimpan: judul, ringkasan ≤ 280 karakter, tanggal terbit asli, nama sumber, dan tautan ke penerbit. Isi artikel lengkap tidak disalin. Duplikat dicegah dengan GUID dan URL asli; berita diurutkan berdasarkan tanggal terbit sumber. Tidak ada sumber berita bawaan — sebelum admin menambahkannya, hanya artikel “Konten Demo” yang tampil.

---

## 5. Email/SMS untuk reset kata sandi

Belum terhubung. Saat ini tautan reset (berlaku 30 menit, sekali pakai) dicatat di log server, dan bila `DEMO_SHOW_RESET_LINK=true` juga ditampilkan di layar (default: aktif di luar produksi). Untuk produksi, sambungkan penyedia email/SMS/WhatsApp di `src/routes/auth.js` (blok `/lupa-sandi`) dan set `DEMO_SHOW_RESET_LINK=false`.
