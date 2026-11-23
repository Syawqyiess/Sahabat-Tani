'use strict';
const config = require('./config');
const db = require('./db');
const { createApp } = require('./app');
const news = require('./services/news');
const rdkk = require('./services/rdkk');
const SqliteStore = require('./db/session-store');

db.open();
db.migrate();
if (!db.get('SELECT 1 FROM users LIMIT 1')) {
  console.log('Database kosong — jalankan "npm run seed" untuk membuat akun dan data demo.');
}
if (config.isProd && config.sessionSecret.startsWith('dev-only')) {
  console.error('SESSION_SECRET wajib diatur di produksi.');
  process.exit(1);
}

const app = createApp();
app.listen(config.port, () => {
  console.log(`Sahabat Tani berjalan di ${config.appUrl}`);
  console.log(`Mode AI — analisis gambar: ${require('./services/ai').vision().mode}, percakapan: ${require('./services/ai').chat().mode}`);
});

// Chatbot lokal: muat model Ollama di latar belakang agar jawaban pertama cepat.
if (config.ai.chatProvider === 'ollama') {
  require('./services/ai/ollama').warmup().then((ok) => ok && console.log(`Model asisten lokal ${config.ai.ollamaModel} siap.`));
}

// Tugas berkala: ambil berita RSS & bersihkan sesi kedaluwarsa.
const store = new SqliteStore();
setInterval(() => store.prune(), 60 * 60 * 1000).unref();
if (config.news.autoFetch) {
  const run = () => news.fetchAll().catch((e) => console.error('Ambil berita gagal:', e.message));
  setTimeout(run, 5000).unref();
  setInterval(run, config.news.fetchIntervalHours * 3600 * 1000).unref();
}

// Data RDKK (Tableau Public → diagram Dashboard): diperbarui saat mulai bila sudah basi, lalu berkala.
if (config.rdkk.autoFetch) {
  const runRdkk = () => rdkk.refresh().then((r) => { if (!r.ok) console.error('Ambil data RDKK gagal:', r.error); });
  if (rdkk.isStale()) setTimeout(runRdkk, 3000).unref();
  setInterval(() => { if (rdkk.isStale()) runRdkk(); }, 3600 * 1000).unref();
}
