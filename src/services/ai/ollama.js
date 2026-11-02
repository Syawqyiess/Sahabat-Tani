'use strict';
// Penyedia percakapan "ollama": model bahasa terbuka yang berjalan di komputer sendiri (tanpa layanan luar).
// Dipasang dengan Ollama (https://ollama.com); model bawaan gemma3:4b (bisa membaca gambar).
const config = require('../../config');
const storage = require('../storage');
const { CHAT_SYSTEM, notesText } = require('./prompts');
const { referenceText } = require('./references');
const { AIServiceError } = require('./errors');

const MAX_HISTORY = 12; // model kecil: konteks dijaga pendek agar cepat dan tetap fokus

// Pengingat tambahan untuk model kecil yang cenderung panjang lebar atau berganti bahasa.
const SMALL_MODEL_RULES = `
Selalu jawab dalam bahasa Indonesia, maksimal sekitar 150 kata, dengan kalimat pendek. Jawab pertanyaan yang ditanyakan secara langsung.
Untuk ciri, gejala, dan cara makan hama, gunakan HANYA informasi dari "Referensi internal" atau konteks scan. Jika informasinya tidak ada, katakan Anda tidak tahu pasti.
Jika petani menanyakan dosis, takaran, campuran, atau merek pestisida: katakan dengan jelas bahwa Anda tidak memberikan dosis, minta petani mengikuti label resmi pada kemasan produk terdaftar dan bertanya ke penyuluh (PPL/POPT), lalu sebutkan langkah pengendalian terpadu.
Jika tidak yakin, katakan tidak yakin dan sarankan pemeriksaan penyuluh. Jangan mengarang nama produk, dosis, atau sumber.
Jangan menulis daftar "Referensi" atau "Sumber" di akhir jawaban — aplikasi menampilkan sumber yang benar-benar dipakai secara terpisah.`;

// Model kecil kadang tetap menulis baris sumber karangan; buang baris seperti itu agar tidak menyesatkan.
function stripInventedSources(text) {
  return text
    .split('\n')
    .filter((line) => !/^\s*[*_>-]*\s*(\*\*)?\s*(referensi|sumber|rujukan|daftar pustaka)(\s+internal)?\s*(\*\*)?\s*:/i.test(line))
    .join('\n')
    .replace(/\s*(referensi|sumber|rujukan)(\s+internal)?\s*:\s*[^.\n]*\.?\s*$/i, '')
    .trim();
}

function base() {
  return config.ai.ollamaUrl.replace(/\/+$/, '');
}

async function call(path, body, timeoutMs) {
  let res;
  try {
    res = await fetch(base() + path, {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      throw new AIServiceError('Asisten lokal terlalu lama menjawab. Coba lagi, atau ajukan pertanyaan yang lebih singkat.', { cause: err });
    }
    throw new AIServiceError('Asisten lokal (Ollama) belum berjalan di server. Hubungi admin untuk menyalakan Ollama.', { cause: err });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.error || `HTTP ${res.status}`;
    const cause = Object.assign(new Error(msg), { status: res.status });
    if (res.status === 404 || /not found|pull/i.test(msg)) {
      throw new AIServiceError(`Model asisten lokal "${config.ai.ollamaModel}" belum diunduh. Admin perlu menjalankan: ollama pull ${config.ai.ollamaModel}`, { retryable: false, cause });
    }
    throw new AIServiceError('Asisten lokal sedang bermasalah. Coba lagi nanti.', { cause });
  }
  return data;
}

// Ringkasan hasil scan yang padat untuk model kecil.
function scanSummary(scan) {
  const r = scan.result || {};
  const L = [`Status scan: ${scan.status}${scan.error_message ? ` (${scan.error_message})` : ''}`];
  if (scan.status === 'completed') {
    if (r.simulated) L.push('Foto TIDAK dianalisis (mode demo).');
    L.push(`Dugaan: ${r.identified && r.suspected_pest_name ? `${r.suspected_pest_name}${r.suspected_pest_scientific ? ` (${r.suspected_pest_scientific})` : ''}` : 'belum teridentifikasi'}`);
    if (r.scores && r.scores.length) L.push(`Skor model scanner: ${r.scores.map((s) => `${s.name} ${Math.round(s.score * 100)}%`).join('; ')} (skor model, bukan kepastian)`);
    if (r.alternatives && r.alternatives.length) L.push(`Kemungkinan lain: ${r.alternatives.map((a) => a.name).join(', ')}`);
    if (r.visual_evidence && r.visual_evidence.length) L.push(`Ciri terlihat: ${r.visual_evidence.join('; ')}`);
    if (r.non_pest_note) L.push(`Catatan: ${r.non_pest_note}`);
  }
  L.push(`Keterangan petani: ${notesText(scan.notes)}`);
  return L.join('\n');
}

function img(relPath) {
  try { return storage.readBase64(relPath); } catch { return null; }
}

const chat = {
  name: 'ollama',
  mode: 'ai',
  get model() { return config.ai.ollamaModel; },
  get supportsImages() { return config.ai.ollamaVision; },

  async reply({ scan, history, references }) {
    const system = CHAT_SYSTEM + SMALL_MODEL_RULES + (references.length ? `\n\nReferensi internal:\n${referenceText(references)}` : '');
    const messages = [{ role: 'system', content: system }];
    if (scan) {
      const first = { role: 'user', content: `Konteks hasil scan (otomatis dari aplikasi):\n${scanSummary(scan)}` };
      const b64 = config.ai.ollamaVision && scan.image_path ? img(scan.image_path) : null;
      if (b64) first.images = [b64];
      messages.push(first, { role: 'assistant', content: 'Baik, saya sudah melihat konteks scan tersebut.' });
    }
    const recent = history.filter((m) => m.role !== 'system').slice(-MAX_HISTORY);
    const lastImageId = [...recent].reverse().find((m) => m.role === 'user' && m.image_path)?.id;
    for (const m of recent) {
      const msg = { role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content || '(foto tambahan)' };
      // Hanya foto tambahan terakhir yang dikirim agar ringan di GPU kecil.
      if (config.ai.ollamaVision && m.id === lastImageId && m.image_path && m.image_path !== (scan && scan.image_path)) {
        const b64 = img(m.image_path);
        if (b64) msg.images = [b64];
      }
      const prev = messages[messages.length - 1];
      if (prev.role === msg.role && prev.role !== 'system') {
        prev.content += '\n\n' + msg.content;
        if (msg.images) prev.images = [...(prev.images || []), ...msg.images];
      } else messages.push(msg);
    }
    const data = await call('/api/chat', {
      model: config.ai.ollamaModel,
      messages,
      stream: false,
      keep_alive: '30m',
      options: { temperature: 0.4, num_ctx: config.ai.ollamaNumCtx, num_predict: 700 },
    }, config.ai.ollamaTimeoutMs);
    const text = stripInventedSources(String((data.message && data.message.content) || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim());
    if (!text) throw new AIServiceError('Asisten lokal tidak memberikan jawaban. Coba lagi.');
    return { text, model: data.model || config.ai.ollamaModel };
  },
};

// Pemeriksaan untuk npm run cek-ai dan halaman admin.
async function status() {
  try {
    const v = await call('/api/version', null, 3000);
    const tags = await call('/api/tags', null, 3000);
    const names = (tags.models || []).map((m) => m.name);
    const want = config.ai.ollamaModel.includes(':') ? config.ai.ollamaModel : `${config.ai.ollamaModel}:latest`;
    return { running: true, version: v.version, models: names, modelReady: names.includes(want) };
  } catch (err) {
    return { running: false, error: err.message, models: [], modelReady: false };
  }
}

// Muat model ke memori saat server menyala agar jawaban pertama petani tidak menunggu lama.
async function warmup() {
  try {
    await call('/api/generate', { model: config.ai.ollamaModel, keep_alive: '30m' }, 180000);
    return true;
  } catch (err) {
    console.warn(`[ollama] Gagal memuat model saat start: ${err.message}`);
    return false;
  }
}

module.exports = { chat, status, scanSummary, warmup, stripInventedSources };
