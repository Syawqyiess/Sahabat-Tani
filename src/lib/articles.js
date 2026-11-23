'use strict';
// Kebijakan tampilan bacaan: daftar publik (Berita & Artikel, Dashboard, beranda, terkait) hanya memuat
// berita dari sumber eksternal nyata (hasil scraping/RSS/API) yang memiliki tautan asli.
// Pembeda berdasarkan ASAL konten (origin), bukan judul atau kategori. Artikel internal tidak dihapus dari
// database; hanya dikeluarkan dari tampilan publik.
// Pakai dengan alias tabel `a`.
const PUBLIC_WHERE = "a.status = 'published' AND a.origin = 'external' AND a.source_url IS NOT NULL";

function isPublic(a) {
  return !!a && a.status === 'published' && a.origin === 'external' && !!a.source_url;
}

module.exports = { PUBLIC_WHERE, isPublic };
