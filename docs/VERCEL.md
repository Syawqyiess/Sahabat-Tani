# Deploy ke Vercel

Sahabat Tani berjalan di Vercel sebagai satu *serverless function* (`api/index.js`) yang memuat aplikasi Express
yang sama dengan `npm start`. Data di **Supabase Postgres**, foto di **Supabase Storage** (Vercel tidak bisa
menyimpan berkas secara permanen).

## Berkas yang sudah disiapkan

| Berkas | Fungsi |
|---|---|
| `api/index.js` | Titik masuk Vercel: mengekspor aplikasi Express (tanpa `app.listen`, tanpa timer). |
| `vercel.json` | Semua permintaan → `api/index.js`; region `syd1` (dekat Supabase Sydney); durasi maks. 300 dtk; memori 1 GB; menyertakan `views/`, `public/`, Leaflet; mengecualikan model ONNX, ML, dan data lokal; cron harian. |
| `.vercelignore` | `.env`, `storage/`, `ml/`, `assets/`, `models/` tidak diunggah. |
| `src/routes/cron.js` | `GET /cron/harian`: ambil berita, perbarui RDKK bila basi, bersihkan sesi kedaluwarsa. Hanya bisa dipanggil dengan `CRON_SECRET`. |

Jadwal cron `0 22 * * *` = **05.00 WIB setiap hari** (paket Hobby: maksimal sekali sehari).

## 1. Siapkan database (sekali, dari laptop)

Skema Supabase sudah dibuat saat migrasi. Bila nanti ada migrasi baru (`src/db/migrations-pg/010_...`),
jalankan dari laptop sebelum deploy:

```powershell
npm run migrate
```

(`.env` laptop berisi `DB_DRIVER=postgres` dan `SUPABASE_DB_URL`.)

## 2. Buat project di Vercel

1. Buka **vercel.com** → *Add New… → Project* → impor repo GitHub **Sahabat-Tani**.
2. **Framework Preset: Other**. Build Command & Output Directory dibiarkan kosong.
3. Isi **Environment Variables** (langkah 3), lalu **Deploy**.

## 3. Environment Variables (Vercel → Project → Settings → Environment Variables)

| Nama | Nilai |
|---|---|
| `NODE_ENV` | `production` |
| `APP_URL` | `https://<nama-project>.vercel.app` (atau domain sendiri) — tanpa `/` di akhir |
| `SESSION_SECRET` | acak & panjang — buat dengan perintah di bawah |
| `CRON_SECRET` | acak & panjang — buat dengan perintah di bawah |
| `DB_DRIVER` | `postgres` |
| `STORAGE_DRIVER` | `supabase` |
| `SUPABASE_URL` | `https://<project-ref>.supabase.co` |
| `SUPABASE_SECRET_KEY` | `sb_secret_...` |
| `SUPABASE_DB_URL` | **Session pooler** (IPv4): `postgresql://postgres.<project-ref>:<password>@aws-1-ap-southeast-2.pooler.supabase.com:5432/postgres` |
| `PG_POOL_MAX` | `2` |
| `MAX_UPLOAD_MB` | `4` |
| `GEMINI_API_KEY` | kunci Gemini |
| `AI_VISION_PROVIDER` | `gemini` |
| `AI_CHAT_PROVIDER` | `gemini` |
| `GOOGLE_CLIENT_ID` | client OAuth **produksi** (langkah 4) |
| `GOOGLE_CLIENT_SECRET` | secret client produksi |

Membuat nilai acak untuk `SESSION_SECRET` dan `CRON_SECRET` (jalankan dua kali, satu untuk masing-masing):

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Catatan penting:
- **`SUPABASE_DB_URL` di Vercel harus pooler**, bukan koneksi langsung `db.<ref>.supabase.co` — server Vercel
  tidak mendukung IPv6, sedangkan koneksi langsung Supabase hanya IPv6. `SUPABASE_DB_POOLER_URL` tidak perlu diisi.
- Jangan isi `AI_VISION_PROVIDER=lokal` / `AI_CHAT_PROVIDER=ollama` di Vercel: model ONNX tidak ikut diunggah dan
  Ollama tidak tersedia.
- Setelah mengubah variabel, lakukan **Redeploy** agar nilainya terbaca.

## 4. Login Google untuk domain Vercel

Di Google Cloud → Google Auth Platform → **Clients → Create client** (Web application), nama
`Sahabat Tani (produksi)`:
- Authorized JavaScript origins: `https://<nama-project>.vercel.app`
- Authorized redirect URIs: `https://<nama-project>.vercel.app/auth/google/callback`

Isi `GOOGLE_CLIENT_ID` & `GOOGLE_CLIENT_SECRET` di Vercel dengan client ini. Di **Branding**, isi homepage &
kebijakan privasi dengan alamat Vercel, lalu **Audience → Publish app**. Lihat juga `docs/LOGIN-GOOGLE.md`.

## 5. Setelah deploy — periksa

1. Buka `https://<nama-project>.vercel.app/masuk` → masuk dengan akun yang ada di Supabase.
2. Dashboard, Lahan, Kalender, Berita tampil; foto lahan/scan muncul (dari Supabase Storage).
3. Coba Scan Hama (Gemini) dan Asisten AI.
4. Login dengan Google.
5. Vercel → Project → **Settings → Cron Jobs**: `/cron/harian` terdaftar. Tombol *Run* untuk mencoba; hasilnya
   terlihat di **Logs** (`[cron/harian] {...}`).

## Batasan yang perlu diketahui

- **Unggahan maks. ±4,5 MB per permintaan** (batas Vercel). Browser otomatis memperkecil foto > 3,5 MB
  (Scan Hama, foto lahan, foto profil, lampiran chat) sebelum diunggah.
- **Permintaan pertama setelah lama sepi lebih lambat** (fungsi "bangun" dan membuka koneksi database).
- Pembatas jumlah percobaan login/scan/chat dihitung per instance fungsi (tidak dibagi antar-instance).
- Fitur model lokal (ONNX) dan Ollama hanya untuk menjalankan di laptop/server sendiri.
- Menjalankan aplikasi di laptop tetap dengan `npm start` (tidak terpengaruh berkas Vercel).
