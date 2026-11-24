'use strict';
// Titik masuk Vercel (serverless function). Seluruh permintaan diarahkan ke sini oleh vercel.json.
// Aplikasi Express yang sama dengan `npm start`, tetapi tanpa app.listen() dan tanpa timer latar belakang:
// tugas berkala dijalankan Vercel Cron lewat /cron/harian (lihat src/routes/cron.js).
//
// Bila konfigurasi (Environment Variables) belum lengkap, fungsi TIDAK dibiarkan gagal diam-diam
// (FUNCTION_INVOCATION_FAILED): halaman menampilkan NAMA variabel yang bermasalah — tidak pernah nilainya.

function configProblems() {
  const env = process.env;
  const p = [];
  const need = (name, why) => { if (!String(env[name] || '').trim()) p.push(`${name} belum diisi — ${why}`); };
  need('SESSION_SECRET', 'isi dengan kode acak panjang (wajib di produksi).');
  if ((env.DB_DRIVER || '').toLowerCase() !== 'postgres') p.push('DB_DRIVER harus "postgres" — Vercel tidak bisa menyimpan database SQLite.');
  if ((env.STORAGE_DRIVER || '').toLowerCase() !== 'supabase') p.push('STORAGE_DRIVER harus "supabase" — Vercel tidak bisa menyimpan foto di disk.');
  need('SUPABASE_URL', 'alamat project Supabase (https://<ref>.supabase.co).');
  need('SUPABASE_SECRET_KEY', 'secret key Supabase (sb_secret_...).');
  const url = String(env.SUPABASE_DB_URL || '');
  if (!url) p.push('SUPABASE_DB_URL belum diisi — pakai URL Session pooler Supabase.');
  else if (/\[YOUR-.*PASSWORD\]/i.test(url)) p.push('SUPABASE_DB_URL masih berisi [YOUR-DATABASE-PASSWORD] — ganti dengan password database.');
  else if (/@db\.[a-z0-9]+\.supabase\.co/i.test(url)) p.push('SUPABASE_DB_URL memakai koneksi langsung (db.<ref>.supabase.co, hanya IPv6) — di Vercel wajib URL pooler (...pooler.supabase.com).');
  else if (!/^postgres(ql)?:\/\//i.test(url)) p.push('SUPABASE_DB_URL formatnya tidak dikenali — harus diawali postgresql://');
  return p;
}

function setupPage(problems, detail) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  return `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Konfigurasi belum lengkap · Sahabat Tani</title>
<style>body{font-family:system-ui,sans-serif;background:#f6f8f1;color:#17251b;margin:0;padding:24px}main{max-width:720px;margin:40px auto;background:#fff;border-radius:16px;padding:28px;box-shadow:0 4px 20px rgba(0,0,0,.08)}h1{font-size:1.4rem;margin-top:0}li{margin:8px 0}code{background:#eef2e7;padding:2px 6px;border-radius:6px}.muted{color:#58665d;font-size:.9rem}</style></head>
<body><main><h1>Sahabat Tani belum bisa dijalankan</h1>
<p>Periksa <strong>Vercel → Settings → Environment Variables</strong>, perbaiki hal berikut, lalu <strong>Redeploy</strong>:</p>
<ul>${problems.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
${detail ? `<p class="muted">Galat saat memulai: <code>${esc(detail)}</code></p>` : ''}
<p class="muted">Halaman ini hanya menampilkan nama pengaturan, tidak pernah nilainya. Panduan: docs/VERCEL.md.</p></main></body></html>`;
}

// Paket yang hanya berbentuk ES Module dan di-require() dari CommonJS. Vercel menolak require(esm)
// (flag --no-experimental-require-module), jadi keduanya dimuat lebih dulu dengan import().
// Daftar diperoleh dengan menjalankan aplikasi memakai flag yang sama (lihat docs/VERCEL.md).
const ESM_PACKAGES = [
  { request: 'htmlparser2', from: 'sanitize-html' },
  { request: 'marked' },
];

const sendPage = (res, problems, detail) => {
  res.statusCode = 503;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(setupPage(problems, detail));
};
// Jangan tampilkan nilai rahasia: buang URL/kunci dari pesan galat.
const safeMessage = (err) => String(err && err.message || err).replace(/postgres(ql)?:\/\/\S+/gi, '[url]').replace(/sb_secret_\S+/g, '[secret]').slice(0, 300);

const problems = configProblems();
const ready = problems.length ? null : (async () => {
  await require('../src/esm-preload').preloadEsm(ESM_PACKAGES);
  const { createApp } = require('../src/app');
  return createApp();
})();
if (ready) ready.catch((err) => console.error('[vercel] aplikasi gagal dimulai:', safeMessage(err)));

module.exports = async function handler(req, res) {
  if (!ready) return sendPage(res, problems);
  let app;
  try {
    app = await ready;
  } catch (err) {
    return sendPage(res, ['Aplikasi gagal dimulai — lihat pesan galat di bawah dan tab Logs di Vercel.'], safeMessage(err));
  }
  return app(req, res);
};
