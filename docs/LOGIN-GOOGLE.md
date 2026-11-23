# Masuk/Daftar dengan Google — konfigurasi

Fitur ini memakai **OAuth 2.0 / OpenID Connect, alur authorization code dengan PKCE (S256), `state`, dan `nonce`**,
lewat library resmi Google [`google-auth-library`](https://github.com/googleapis/google-auth-library-nodejs).
Sesi tetap memakai `express-session` milik aplikasi (tidak ada sistem sesi kedua).

Tombol **"Lanjutkan dengan Google"** baru tampil setelah `GOOGLE_CLIENT_ID` dan `GOOGLE_CLIENT_SECRET` diisi di `.env`.
Selama belum diisi, login nomor HP/email + kata sandi tetap berjalan seperti biasa.

## Alamat yang dipakai aplikasi

| Lingkungan | Authorized JavaScript origin | Authorized redirect URI |
|---|---|---|
| Pengembangan (laptop) | `http://localhost:3000` | `http://localhost:3000/auth/google/callback` |
| Produksi (domain desa) | `https://<domain-anda>` | `https://<domain-anda>/auth/google/callback` |

- Redirect URI dibentuk dari `APP_URL` + `/auth/google/callback`, atau diatur langsung lewat `GOOGLE_REDIRECT_URI`.
  Nilainya harus **sama persis** (http/https, port, tanpa garis miring di akhir) dengan yang didaftarkan di Google Cloud.
- Bila server pengembangan berjalan di port lain (mis. 3001), tambahkan juga `http://localhost:3001` dan
  `http://localhost:3001/auth/google/callback`, lalu set `APP_URL=http://localhost:3001`.
- Produksi wajib HTTPS (Google tidak menerima redirect `http://` selain `localhost`).

## Langkah di Google Cloud (dilakukan pengelola, bukan oleh kode)

1. Buka <https://console.cloud.google.com/> → buat project, mis. **Sahabat Tani**.
2. **Google Auth Platform → Branding** (dulu "OAuth consent screen"):
   - Nama aplikasi: **Sahabat Tani**
   - Email dukungan pengguna & email kontak pengembang: email pengelola
   - Homepage: `https://<domain-anda>/`
   - Kebijakan Privasi: `https://<domain-anda>/kebijakan-privasi`
   - Syarat & Ketentuan: `https://<domain-anda>/syarat-ketentuan`
   - Authorized domain: `<domain-anda>`
3. **Audience**: pilih *External*. Selama status **Testing**, hanya akun yang ditambahkan di *Test users* yang bisa masuk
   (akun lain melihat "akses diblokir" dari Google). Untuk dipakai warga desa, ajukan **Publish app**.
4. **Data access (scopes)**: cukup `openid`, `.../auth/userinfo.email`, `.../auth/userinfo.profile`.
   Aplikasi **tidak** meminta Gmail, Drive, kontak, atau layanan lain.
5. **Clients → Create client → Web application**: isi origins & redirect URI sesuai tabel di atas.
   Disarankan membuat **dua client terpisah**: satu untuk pengembangan, satu untuk produksi.
6. Salin Client ID & Client secret ke `.env` server:

   ```
   GOOGLE_CLIENT_ID=xxxxxxxx.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=...      # hanya di server; jangan di-commit
   APP_URL=https://<domain-anda>  # di produksi
   ```

7. Jalankan ulang aplikasi (`npm start`).

## Kebijakan Privasi

Halaman `/kebijakan-privasi` saat ini masih berisi keterangan "sedang disiapkan". Sebelum aplikasi dipublikasikan
untuk umum, pengelola perlu mengisi naskah resmi (data apa yang diambil dari Google: nama, email, foto profil;
untuk apa dipakai; cara menghapus akun). Aplikasi tidak mengarang isi kebijakan ini.

## Perilaku yang diterapkan

- **Pengguna baru**: akun petani (peran `farmer`) + profil dibuat dari ID token yang sudah diverifikasi (nama, email,
  foto). Tanpa kata sandi lokal (kolom `password_hash` kosong, bukan kata sandi tiruan). Lalu diarahkan ke
  `/profil/lengkapi` (nomor HP, desa, kelompok tani — semuanya opsional).
- **Pengguna lama**: identitas = `sub` Google di tabel `user_identities` (bukan email). Login ulang masuk ke akun yang sama.
- **Email sama dengan akun lokal**: tidak digabung otomatis. Pengguna diminta kata sandi akun lama di
  `/auth/google/tautkan`; setelah benar, Google ditautkan.
- **Profil → Atur metode masuk** (`/profil/google`): status "Google terhubung", hubungkan Google (wajib kata sandi
  dulu), putuskan Google (hanya bila akun punya kata sandi), atau buat kata sandi untuk akun yang dibuat lewat Google.
- **Nama/foto** yang diubah di Sahabat Tani tidak ditimpa saat login Google berikutnya.
- **Keluar** hanya mengakhiri sesi Sahabat Tani, tidak mengeluarkan akun Google di browser.
- Token dan secret tidak pernah dicatat ke log; pesan galat ke pengguna tidak memuat detail internal.

## Pengujian

- Otomatis (`npm test`, berkas `test/google.test.js`): server Google diganti klien uji, tetapi verifikasi ID token
  memakai kode asli library (signature RS256, issuer, audience, masa berlaku) + pemeriksaan nonce/state aplikasi.
  Mencakup daftar pertama, login ulang, penautan email sama, token palsu/kedaluwarsa, pembatalan, koneksi gagal,
  akun nonaktif, dan putus tautan.
- **Belum diuji dengan akun Google nyata.** Setelah client dibuat, uji manual: daftar pertama kali, login ulang,
  pembatalan di layar Google, desktop & ponsel, lalu ulangi di domain produksi sebelum diserahkan ke pihak desa.
