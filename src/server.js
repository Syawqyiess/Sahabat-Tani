'use strict';
const config = require('./config');
const db = require('./db');
const { createApp } = require('./app');
const news = require('./services/news');
const rdkk = require('./services/rdkk');
const SqliteStore = require('./db/session-store');

async function main() {
  db.open();
  const applied = await db.migrate();
  if (applied.length) console.log(`Migrasi database diterapkan: ${applied.join(', ')}`);
  if (!(await db.get('SELECT 1 FROM users LIMIT 1'))) {
    console.log('Database kosong — jalankan "npm run seed" untuk membuat akun dan data demo.');
  }
  if (config.isProd && config.sessionSecret.startsWith('dev-only')) {
    console.error('SESSION_SECRET wajib diatur di produksi.');
    process.exit(1);
  }

  const app = createApp();
  app.listen(config.port, () => {
    console.log(`Sahabat Tani berjalan di ${config.appUrl}`);
    console.log(`Database: ${db.driverName === 'postgres' ? `Postgres (Supabase, skema ${config.db.schema})` : 'SQLite lokal'} · foto: ${config.storage.driver === 'supabase' ? `Supabase Storage (bucket ${config.storage.bucket})` : 'folder lokal'}`);
    console.log(`Mode AI — analisis gambar: ${require('./services/ai').vision().mode}, percakapan: ${require('./services/ai').chat().mode}`);
  });

  // Chatbot lokal: muat model Ollama di latar belakang agar jawaban pertama cepat.
  if (config.ai.chatProvider === 'ollama') {
    require('./services/ai/ollama').warmup().then((ok) => ok && console.log(`Model asisten lokal ${config.ai.ollamaModel} siap.`));
  }

  // Tugas berkala: ambil berita RSS & bersihkan sesi kedaluwarsa.
  const store = new SqliteStore();
  setInterval(() => store.prune().catch(() => {}), 60 * 60 * 1000).unref();
  if (config.news.autoFetch) {
    const run = () => news.fetchAll().catch((e) => console.error('Ambil berita gagal:', e.message));
    setTimeout(run, 5000).unref();
    setInterval(run, config.news.fetchIntervalHours * 3600 * 1000).unref();
  }

  // Data RDKK (Tableau Public → diagram Dashboard): diperbarui saat mulai bila sudah basi, lalu berkala.
  if (config.rdkk.autoFetch) {
    const runRdkk = () => rdkk.refresh().then((r) => { if (!r.ok) console.error('Ambil data RDKK gagal:', r.error); }).catch((e) => console.error('Ambil data RDKK gagal:', e.message));
    if (await rdkk.isStale()) setTimeout(runRdkk, 3000).unref();
    setInterval(async () => { if (await rdkk.isStale().catch(() => false)) await runRdkk(); }, 3600 * 1000).unref();
  }
}

main().catch((err) => {
  console.error('Server gagal dimulai:', err.message);
  process.exit(1);
});
