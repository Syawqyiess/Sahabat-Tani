'use strict';
const Anthropic = require('@anthropic-ai/sdk');
const config = require('../../config');
const storage = require('../storage');
const { VISION_SYSTEM, VISION_SCHEMA, CHAT_SYSTEM, notesText, normalizeVisionResult, chatScanView } = require('./prompts');
const { referenceText } = require('./references');

let client;
function getClient() {
  if (!client) client = new (Anthropic.default || Anthropic)({ apiKey: config.ai.anthropicKey, maxRetries: 2, timeout: 90_000 });
  return client;
}

const { AIServiceError } = require('./errors');

// Panggilan Messages API dengan fallback sisi server (bila model menolak permintaan).
async function callClaude(params) {
  const c = getClient();
  try {
    if (config.ai.useFallbacks) {
      return await c.beta.messages.create({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' });
    }
    return await c.messages.create(params);
  } catch (err) {
    const A = Anthropic.default || Anthropic;
    if (err instanceof A.AuthenticationError) throw new AIServiceError('Kunci API AI tidak valid. Hubungi admin.', { retryable: false, cause: err });
    if (err instanceof A.RateLimitError) throw new AIServiceError('Layanan AI sedang sibuk. Coba lagi beberapa saat lagi.', { cause: err });
    if (err instanceof A.BadRequestError) throw new AIServiceError('Permintaan ke layanan AI ditolak. Coba foto lain.', { retryable: false, cause: err });
    if (err instanceof A.APIConnectionError) throw new AIServiceError('Koneksi ke layanan AI terputus. Periksa internet lalu coba lagi.', { cause: err });
    if (err instanceof A.APIError) throw new AIServiceError('Layanan AI sedang bermasalah. Coba lagi nanti.', { cause: err });
    throw err;
  }
}

function textOf(resp) {
  if (resp.stop_reason === 'refusal') throw new AIServiceError('Layanan AI tidak dapat memproses foto ini. Coba foto lain yang menampilkan tanaman padi.', { retryable: false });
  return resp.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
}

async function imageBlock(relPath, mime) {
  return { type: 'image', source: { type: 'base64', media_type: mime, data: await storage.readBase64(relPath) } };
}

const vision = {
  name: 'anthropic',
  mode: 'ai',
  get model() { return config.ai.visionModel; },
  supportsImages: true,

  async analyze({ imagePath, mime, notes, references }) {
    const resp = await callClaude({
      model: config.ai.visionModel,
      max_tokens: 16000,
      system: VISION_SYSTEM + (references.length ? `\n\nReferensi internal:\n${referenceText(references)}` : ''),
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: VISION_SCHEMA } },
      messages: [{
        role: 'user',
        content: [await imageBlock(imagePath, mime), { type: 'text', text: `Keterangan dari petani:\n${notesText(notes)}\n\nAnalisis foto ini.` }],
      }],
    });
    const text = textOf(resp);
    let result;
    try { result = normalizeVisionResult(JSON.parse(text)); } catch {
      throw new AIServiceError('Hasil analisis AI tidak dapat dibaca. Coba lagi.');
    }
    return { result, model: resp.model || config.ai.visionModel };
  },
};

const chat = {
  name: 'anthropic',
  mode: 'ai',
  get model() { return config.ai.chatModel; },
  supportsImages: true,

  // history: [{role, content, image_path, image_mime}] — sudah urut, termasuk pesan pembuka.
  async reply({ scan, history, references }) {
    const ctx = [];
    if (scan) {
      ctx.push({ type: 'text', text: `Konteks hasil scan (otomatis dari aplikasi, status: ${scan.status}):\n${JSON.stringify(chatScanView(scan.result) || { error: scan.error_message }, null, 1)}\n\nKeterangan petani:\n${notesText(scan.notes)}` });
      if (scan.image_path) ctx.unshift(await imageBlock(scan.image_path, scan.image_mime));
    }
    const messages = [];
    const push = (role, blocks) => {
      const last = messages[messages.length - 1];
      if (last && last.role === role) last.content.push(...blocks);
      else messages.push({ role, content: blocks });
    };
    if (ctx.length) push('user', ctx);
    for (const m of history) {
      if (m.role === 'system') continue;
      const blocks = [];
      if (m.image_path && m.role === 'user') blocks.push(await imageBlock(m.image_path, m.image_mime));
      blocks.push({ type: 'text', text: m.content || '(foto tambahan)' });
      if (!messages.length && m.role === 'assistant') push('user', [{ type: 'text', text: 'Halo.' }]);
      push(m.role, blocks);
    }
    const resp = await callClaude({
      model: config.ai.chatModel,
      max_tokens: 4000,
      system: CHAT_SYSTEM + (references.length ? `\n\nReferensi internal:\n${referenceText(references)}` : ''),
      output_config: { effort: 'low' },
      messages,
    });
    return { text: textOf(resp), model: resp.model || config.ai.chatModel };
  },
};

module.exports = { vision, chat, AIServiceError };
