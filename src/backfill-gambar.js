'use strict';
// Backfill gambar berita: `npm run backfill-gambar` (tambahkan `-- --ulang` untuk memeriksa ulang yang memakai ilustrasi).
// Aman diulang: artikel yang sudah bergambar valid dilewati, gambar pilihan admin tidak disentuh,
// permintaan ke tiap situs tetap berjeda, dan satu kegagalan tidak menghentikan proses.
require('dotenv').config({ quiet: true });
const db = require('./db');
const images = require('./services/news/images');

(async () => {
  db.open();
  const force = process.argv.includes('--ulang');
  const limit = Number((process.argv.find((a) => a.startsWith('--batas=')) || '').split('=')[1]) || 500;
  console.log(`Memeriksa gambar berita${force ? ' (termasuk yang sebelumnya memakai ilustrasi)' : ''}…`);
  const r = await images.processPending({
    limit, force,
    onItem: (it) => console.log(`  [${it.status}] ${it.source} — ${it.title.slice(0, 70)}${it.note ? ` (${it.note})` : ''}`),
  });
  console.log(`\nSelesai: ${r.checked} diperiksa, ${r.updated} diperbarui, ${r.fallback} memakai ilustrasi, ${r.failed} gagal sementara.`);
  db.close();
})().catch((err) => { console.error(err); process.exit(1); });
