# Database & foto di Supabase

Sahabat Tani dapat berjalan dengan dua jenis penyimpanan, dipilih lewat `.env`:

| Pengaturan | Supabase (dipakai aplikasi) | Lokal (uji otomatis / offline) |
|---|---|---|
| `DB_DRIVER` | `postgres` | `sqlite` |
| `STORAGE_DRIVER` | `supabase` | `local` |
| Data | Postgres Supabase, skema `public` | `storage/sahabat-tani.db` |
| Foto | Supabase Storage, bucket privat `uploads` | `storage/uploads/` |

## Variabel `.env`

```
DB_DRIVER=postgres
STORAGE_DRIVER=supabase
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SECRET_KEY=sb_secret_...            # Project Settings > API Keys > Secret keys
SUPABASE_DB_URL=postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres
SUPABASE_DB_POOLER_URL=postgresql://postgres.<project-ref>:<password>@aws-1-<region>.pooler.supabase.com:5432/postgres
```

- **SUPABASE_DB_URL** (utama) — *Connect > Direct connection > URI*. Butuh jaringan yang mendukung IPv6.
- **SUPABASE_DB_POOLER_URL** (cadangan) — *Connect > Session pooler > URI*. IPv4. Dipakai otomatis bila
  koneksi langsung tidak bisa dibuka (aplikasi menulis "memakai koneksi cadangan" di log).
- Password database: *Project Settings > Database > Reset database password*. Gunakan huruf & angka saja
  (karakter `@ # / ? : %` merusak format URL).
- Aplikasi mengutamakan IPv4 untuk layanan lain (`dns.setDefaultResultOrder('ipv4first')`), karena pada
  sebagian jaringan rute IPv6 ke Supabase API diputus.
- *Publishable key* tidak dipakai server. Semua akses dari server lewat koneksi Postgres & secret key.

## Keamanan

- **RLS aktif di semua tabel tanpa policy**: Data API Supabase dengan publishable/anon key tidak dapat
  membaca/mengubah tabel. Server memakai koneksi Postgres langsung (pemilik tabel).
- **Bucket `uploads` privat**: browser tidak mengakses bucket; foto dilayani lewat `/media/...` yang memeriksa
  pemilik foto. Hanya JPG/PNG/WEBP, maks. 8 MB.
- `SUPABASE_SECRET_KEY` dan password database hanya di `.env` server — jangan di-commit / dikirim ke chat.
  Bila sempat bocor: buat secret key baru / reset password, perbarui `.env`, hapus yang lama.

## Perintah

| Perintah | Fungsi |
|---|---|
| `npm run pindah-supabase` | Salin semua data SQLite + foto lokal ke Supabase, lalu cocokkan jumlah. Menolak bila Supabase sudah berisi pengguna. |
| `npm run pindah-supabase -- --timpa` | Kosongkan tabel Supabase lalu salin ulang. |
| `npm test` | 106 uji otomatis di SQLite sementara (cepat, tanpa internet). |
| `npm run test:supabase` | Uji yang sama di Postgres Supabase, skema terpisah `uji_otomatis` (data asli tidak disentuh). |

## Migrasi skema berikutnya

Struktur tabel ada di dua tempat:
- `src/db/migrations/*.sql` — SQLite (riwayat 001…).
- `src/db/migrations-pg/*.sql` — Postgres (`000_skema.sql` = setara 001–009).

Perubahan tabel baru (010…) ditulis di **kedua** folder. Kode aplikasi tetap satu: query bergaya SQLite
(`?`, `datetime('now')`, `LIKE`) diterjemahkan otomatis untuk Postgres oleh `src/db/pg-driver.js`.

## Kecepatan

Project Supabase berada di Sydney (ap-southeast-2): satu query dari Indonesia ±280 ms. Bila halaman terasa
lambat, buat project baru di **Singapore (ap-southeast-1)** — biasanya jauh lebih dekat — lalu jalankan
`npm run pindah-supabase` ke project baru tersebut.
