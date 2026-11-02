'use strict';
// Cek koneksi AI: menjalankan modul analisis gambar dan percakapan yang sama dengan aplikasi.
// Gemini free tier: gratis (memakai 2 permintaan kuota). Claude: kira-kira US$0,02–0,05 sekali jalan.
const fs = require('node:fs');
const path = require('node:path');
const config = require('./config');
const ai = require('./services/ai');
const { demoPng } = require('./db/seed');

async function main() {
  const usesLocal = config.ai.chatProvider === 'ollama' || config.ai.visionProvider === 'lokal';
  if (!config.ai.anthropicKey && !config.ai.geminiKey && !usesLocal) {
    console.log('Belum ada kunci AI di file .env — aplikasi masih mode demo.');
    console.log('Isi GEMINI_API_KEY=... (gratis, dari aistudio.google.com) atau ANTHROPIC_API_KEY=..., simpan, lalu jalankan lagi: npm run cek-ai');
    process.exit(1);
  }
  const vision = ai.vision();
  const chat = ai.chat();
  console.log(`Analisis gambar : ${vision.mode} (${vision.name}${vision.model ? ', ' + vision.model : ''})`);
  console.log(`Percakapan      : ${chat.mode} (${chat.name}${chat.model ? ', ' + chat.model : ''})`);
  if (chat.name === 'ollama') {
    const st = await require('./services/ai/ollama').status();
    console.log(st.running
      ? `Ollama          : berjalan (versi ${st.version}); model ${config.ai.ollamaModel} ${st.modelReady ? 'siap' : 'BELUM diunduh → jalankan: ollama pull ' + config.ai.ollamaModel}`
      : `Ollama          : TIDAK berjalan (${st.error}). Buka aplikasi Ollama, lalu ulangi.`);
  }
  if (vision.mode !== 'ai' || chat.mode !== 'ai') {
    console.log('Salah satu modul masih demo. Periksa AI_VISION_PROVIDER / AI_CHAT_PROVIDER di .env ("gemini" atau "anthropic", sesuai kunci yang diisi).');
    process.exit(1);
  }

  // Gambar uji: kotak hijau buatan (bukan foto padi) — model seharusnya menyebut foto tidak relevan/tidak jelas.
  const rel = path.posix.join('cek-ai', 'scan-00000000-0000-4000-8000-000000000000.png');
  const abs = path.join(config.uploadDir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, demoPng(256, 256));

  let ok = true;
  try {
    console.log('\n1) Menguji analisis gambar…');
    const t = Date.now();
    const { result, model } = await vision.analyze({ imagePath: rel, mime: 'image/png', notes: { symptoms: 'uji koneksi' }, references: [] });
    console.log(`   Berhasil dalam ${((Date.now() - t) / 1000).toFixed(1)} dtk, model: ${model}`);
    console.log(`   Kategori foto: ${result.subject} · teridentifikasi: ${result.identified}`);
    console.log(`   Pesan: ${String(result.farmer_message).slice(0, 200)}`);
  } catch (err) {
    ok = false;
    console.log(`   GAGAL: ${err.message}`);
    if (err.cause) console.log(`   Detail: ${err.cause.status || ''} ${err.cause.message || err.cause}`);
  } finally {
    fs.rmSync(path.dirname(abs), { recursive: true, force: true });
  }

  try {
    console.log('\n2) Menguji percakapan…');
    const t = Date.now();
    const { text, model } = await chat.reply({ scan: null, history: [{ role: 'user', content: 'Apa itu pengendalian hama terpadu? Jawab dalam 2 kalimat.' }], references: [] });
    console.log(`   Berhasil dalam ${((Date.now() - t) / 1000).toFixed(1)} dtk, model: ${model}`);
    console.log(`   Jawaban: ${text.slice(0, 300)}`);
  } catch (err) {
    ok = false;
    console.log(`   GAGAL: ${err.message}`);
    if (err.cause) console.log(`   Detail: ${err.cause.status || ''} ${err.cause.message || err.cause}`);
  }

  if (!ok && [vision.name, chat.name].includes('gemini') && config.ai.geminiKey) {
    try {
      const models = (await require('./services/ai/gemini').listModels()).filter((m) => /flash|pro/.test(m) && !/tts|image|embed|live|audio/.test(m));
      console.log('\nModel Gemini yang tersedia untuk kunci ini (pilih yang mengandung "flash"):');
      console.log('  ' + models.slice(0, 15).join('\n  '));
      console.log('Atur di .env, contoh: GEMINI_MODEL=' + (models.find((m) => /flash/.test(m)) || models[0] || 'gemini-flash-latest'));
    } catch (err) {
      console.log(`\nTidak bisa mengambil daftar model: ${err.message}`);
    }
  }

  console.log(ok
    ? '\nAI siap. Jalankan ulang aplikasi (npm start); label "Mode demo" akan hilang dari halaman Scan.'
    : '\nAda yang gagal. Baca pesan di atas. (Untuk Claude: bila detail menyebut "fallbacks", tambahkan AI_USE_FALLBACKS=false di .env.)');
  process.exit(ok ? 0 : 1);
}

main();
