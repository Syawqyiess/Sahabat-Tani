'use strict';
// Penyedia Google Gemini (REST generateContent). Free tier tersedia lewat Google AI Studio.
// Catatan privasi: pada free tier, Google dapat memakai data yang dikirim untuk meningkatkan produknya.
const config = require('../../config');
const storage = require('../storage');
const { VISION_SYSTEM, VISION_SCHEMA, CHAT_SYSTEM, notesText, normalizeVisionResult, chatScanView } = require('./prompts');
const { referenceText } = require('./references');
const { AIServiceError } = require('./errors');

const BASE = 'https://generativelanguage.googleapis.com/v1beta';

// Galat yang membuat model berikutnya di daftar layak dicoba (lambat, kuota habis, model dihapus, server sibuk).
function nextable(message, opts) {
  return Object.assign(new AIServiceError(message, opts), { tryNext: true });
}

async function generateOne(model, body) {
  let res;
  try {
    res = await fetch(`${BASE}/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': config.ai.geminiKey },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(config.ai.geminiTimeoutMs),
    });
  } catch (err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') throw nextable('Layanan AI terlalu lama merespons. Coba lagi.', { cause: err });
    throw new AIServiceError('Koneksi ke layanan AI terputus. Periksa internet lalu coba lagi.', { cause: err });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data.error && data.error.message) || `HTTP ${res.status}`;
    const cause = Object.assign(new Error(`${model}: ${msg}`), { status: res.status });
    if (res.status === 429) throw nextable('Kuota gratis layanan AI sedang habis. Tunggu sebentar (atau besok) lalu coba lagi.', { cause });
    if (res.status === 404) throw nextable(`Model AI "${model}" tidak tersedia. Hubungi admin.`, { retryable: false, cause });
    if (res.status === 400 && /api key/i.test(msg)) throw new AIServiceError('Kunci API AI tidak valid. Hubungi admin.', { retryable: false, cause });
    if (res.status === 401 || res.status === 403) throw new AIServiceError('Kunci API AI tidak valid atau tidak punya izin. Hubungi admin.', { retryable: false, cause });
    if (res.status === 400) throw nextable('Permintaan ke layanan AI ditolak. Coba foto lain.', { retryable: false, cause });
    throw nextable('Layanan AI sedang bermasalah. Coba lagi nanti.', { cause });
  }
  if (data.promptFeedback && data.promptFeedback.blockReason) {
    throw new AIServiceError('Layanan AI tidak dapat memproses foto ini. Coba foto lain yang menampilkan tanaman padi.', { retryable: false });
  }
  const cand = (data.candidates || [])[0];
  const text = cand && cand.content && (cand.content.parts || []).filter((p) => p.text && !p.thought).map((p) => p.text).join('').trim();
  if (!text) {
    if (cand && ['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'IMAGE_SAFETY'].includes(cand.finishReason)) {
      throw new AIServiceError('Layanan AI tidak dapat memproses foto ini. Coba foto lain.', { retryable: false });
    }
    throw new AIServiceError('Layanan AI tidak memberikan jawaban. Coba lagi.');
  }
  return { text, model: data.modelVersion || model };
}

// Coba model satu per satu; galat terakhir yang dilaporkan bila semuanya gagal.
async function generate(models, body) {
  let lastErr;
  for (const model of models) {
    try {
      return await generateOne(model, body);
    } catch (err) {
      lastErr = err;
      if (!err.tryNext) throw err;
      console.warn(`[gemini] ${model} gagal (${err.cause ? err.cause.message : err.message}); mencoba model berikutnya bila ada.`);
    }
  }
  throw lastErr;
}

function imagePart(relPath, mime) {
  return { inline_data: { mime_type: mime, data: storage.readBase64(relPath) } };
}

function systemOf(base, references) {
  return { parts: [{ text: base + (references.length ? `\n\nReferensi internal:\n${referenceText(references)}` : '') }] };
}

const vision = {
  name: 'gemini',
  mode: 'ai',
  get model() { return config.ai.geminiVisionModels.join(' → '); },
  supportsImages: true,

  async analyze({ imagePath, mime, notes, references }) {
    // Skema dijelaskan di instruksi dan keluaran dipaksa JSON; hasil lalu dinormalisasi
    // supaya tetap aman walau model sesekali menghilangkan kolom.
    const schemaHint = `\n\nBalas HANYA dengan satu objek JSON yang mengikuti skema berikut (semua kolom wajib ada):\n${JSON.stringify(VISION_SCHEMA)}`;
    const { text, model } = await generate(config.ai.geminiVisionModels, {
      systemInstruction: systemOf(VISION_SYSTEM + schemaHint, references),
      contents: [{ role: 'user', parts: [imagePart(imagePath, mime), { text: `Keterangan dari petani:\n${notesText(notes)}\n\nAnalisis foto ini.` }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0.2, maxOutputTokens: 8192 },
    });
    let result;
    try {
      result = normalizeVisionResult(JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, '')));
    } catch {
      throw new AIServiceError('Hasil analisis AI tidak dapat dibaca. Coba lagi.');
    }
    return { result, model };
  },
};

const chat = {
  name: 'gemini',
  mode: 'ai',
  get model() { return config.ai.geminiChatModels.join(' → '); },
  supportsImages: true,

  async reply({ scan, history, references }) {
    const contents = [];
    const push = (role, parts) => {
      const last = contents[contents.length - 1];
      if (last && last.role === role) last.parts.push(...parts);
      else contents.push({ role, parts });
    };
    if (scan) {
      const ctx = [{ text: `Konteks hasil scan (otomatis dari aplikasi, status: ${scan.status}):\n${JSON.stringify(chatScanView(scan.result) || { error: scan.error_message }, null, 1)}\n\nKeterangan petani:\n${notesText(scan.notes)}` }];
      if (scan.image_path) ctx.unshift(imagePart(scan.image_path, scan.image_mime));
      push('user', ctx);
    }
    for (const m of history) {
      if (m.role === 'system') continue;
      const role = m.role === 'assistant' ? 'model' : 'user';
      const parts = [];
      if (m.image_path && role === 'user') parts.push(imagePart(m.image_path, m.image_mime));
      parts.push({ text: m.content || '(foto tambahan)' });
      if (!contents.length && role === 'model') push('user', [{ text: 'Halo.' }]);
      push(role, parts);
    }
    const { text, model } = await generate(config.ai.geminiChatModels, {
      systemInstruction: systemOf(CHAT_SYSTEM, references),
      contents,
      generationConfig: { temperature: 0.4, maxOutputTokens: 4096 },
    });
    return { text, model };
  },
};

// Daftar model yang bisa dipakai kunci ini (untuk npm run cek-ai).
async function listModels() {
  const res = await fetch(`${BASE}/models?pageSize=200`, { headers: { 'x-goog-api-key': config.ai.geminiKey }, signal: AbortSignal.timeout(15_000) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data.error && data.error.message) || `HTTP ${res.status}`);
  return (data.models || [])
    .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map((m) => m.name.replace(/^models\//, ''));
}

module.exports = { vision, chat, listModels };
