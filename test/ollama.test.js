'use strict';
const { test, before, after, afterEach, describe } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const h = require('./helpers');
const config = require('../src/config');
const ai = require('../src/services/ai');
const ollama = require('../src/services/ai/ollama');
const storage = require('../src/services/storage');
const { AIServiceError } = require('../src/services/ai/errors');

// Semua panggilan ke Ollama ditiru — tes tidak butuh Ollama yang berjalan.
const realFetch = global.fetch;
let calls = [];
function mockOllama(responder) {
  calls = [];
  global.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (!u.startsWith(config.ai.ollamaUrl)) return realFetch(url, opts);
    const body = opts.body ? JSON.parse(opts.body) : null;
    calls.push({ url: u, body });
    const r = responder(u, body);
    if (r instanceof Error) throw r;
    return new Response(JSON.stringify(r.json), { status: r.status || 200, headers: { 'content-type': 'application/json' } });
  };
}
const answer = (content) => ({ json: { model: 'gemma3:4b', message: { role: 'assistant', content }, done: true } });

let imgRel;
before(async () => {
  await h.setup();
  imgRel = storage.saveImage({ buffer: h.demoPng(64, 64), size: 100 }, 888, 'scan').relPath;
});
afterEach(() => { global.fetch = realFetch; });
after(() => { config.ai.chatProvider = 'demo'; });

const scan = () => ({
  status: 'completed', image_path: imgRel, image_mime: 'image/png', notes: { symptoms: 'daun menguning' },
  result: { identified: true, suspected_pest_name: 'Wereng batang cokelat', suspected_pest_scientific: 'Nilaparvata lugens', scores: [{ name: 'Wereng batang cokelat', score: 0.82 }], confidence: { key: 'sedang', label: 'Kemungkinan besar' }, alternatives: [] },
});

describe('Penyedia chat Ollama (lokal)', () => {
  test('mengirim aturan, ringkasan scan + foto, dan riwayat; menghapus tag <think>', async () => {
    mockOllama(() => answer('<think>rencana</think>Amati pangkal batang di beberapa titik.'));
    const out = await ollama.chat.reply({
      scan: scan(),
      history: [
        { id: 1, role: 'user', content: 'Foto dari scan', image_path: imgRel, image_mime: 'image/png' },
        { id: 2, role: 'assistant', content: 'Dugaan awal: wereng' },
        { id: 3, role: 'system', content: 'diabaikan' },
        { id: 4, role: 'user', content: 'Bagaimana penanganannya?' },
      ],
      references: [],
    });
    assert.equal(out.text, 'Amati pangkal batang di beberapa titik.');
    const body = calls[0].body;
    assert.match(calls[0].url, /\/api\/chat$/);
    assert.equal(body.model, 'gemma3:4b');
    assert.equal(body.stream, false);
    assert.equal(body.messages[0].role, 'system');
    assert.match(body.messages[0].content, /JANGAN menyebut dosis/);
    assert.match(body.messages[0].content, /bahasa Indonesia/);
    assert.match(body.messages[1].content, /Hasil scan: Wereng batang cokelat/);
    assert.match(body.messages[1].content, /Tingkat keyakinan scanner: Kemungkinan besar/);
    assert.doesNotMatch(body.messages[1].content, /82|%/, 'angka skor tidak dikirim ke chatbot');
    assert.match(body.messages[0].content, /jangan mengulang tingkat keyakinan/i);
    assert.equal(body.messages[1].images.length, 1, 'foto scan dikirim sekali');
    const imgCount = body.messages.reduce((n, m) => n + (m.images ? m.images.length : 0), 0);
    assert.equal(imgCount, 1, 'foto yang sama tidak dikirim berulang');
    assert.equal(body.messages.at(-1).content, 'Bagaimana penanganannya?');
    for (let i = 2; i < body.messages.length; i++) assert.notEqual(body.messages[i].role, body.messages[i - 1].role, 'peran bergantian');
  });

  test('baris sumber karangan dari model dibuang', () => {
    const t = 'Amati pangkal batang.\nHubungi penyuluh bila meluas.\n\nReferensi internal: Pengendalian Hama Terpadu Padi.';
    assert.equal(ollama.stripInventedSources(t), 'Amati pangkal batang.\nHubungi penyuluh bila meluas.');
    assert.equal(ollama.stripInventedSources('Langkah awal ... sebaran. Referensi internal: Pengendalian Hama Terpadu Padi.'), 'Langkah awal ... sebaran.');
    assert.equal(ollama.stripInventedSources('**Sumber:** Buku Hama Padi\nIsi.'), 'Isi.');
    assert.equal(ollama.stripInventedSources('Gunakan sumber air yang bersih.'), 'Gunakan sumber air yang bersih.', 'kata "sumber" biasa tidak terhapus');
  });

  test('riwayat panjang dipangkas agar model kecil tetap cepat', async () => {
    mockOllama(() => answer('ok'));
    const history = Array.from({ length: 30 }, (_, i) => ({ id: i, role: i % 2 ? 'assistant' : 'user', content: `pesan ${i}` }));
    await ollama.chat.reply({ scan: null, history, references: [] });
    assert.ok(calls[0].body.messages.length <= 13);
    assert.equal(calls[0].body.messages.at(-1).content, 'pesan 29');
  });

  test('galat dijelaskan dengan jelas', async () => {
    mockOllama(() => Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }));
    await assert.rejects(ollama.chat.reply({ scan: null, history: [{ id: 1, role: 'user', content: 'halo' }], references: [] }),
      (e) => e instanceof AIServiceError && /belum berjalan/.test(e.message) && e.retryable);
    mockOllama(() => ({ status: 404, json: { error: 'model "gemma3:4b" not found, try pulling it first' } }));
    await assert.rejects(ollama.chat.reply({ scan: null, history: [{ id: 1, role: 'user', content: 'halo' }], references: [] }),
      (e) => /ollama pull gemma3:4b/.test(e.message) && e.retryable === false);
  });

  test('status: mendeteksi Ollama berjalan dan model siap', async () => {
    mockOllama((u) => (u.endsWith('/api/version') ? { json: { version: '0.9.9' } } : { json: { models: [{ name: 'gemma3:4b' }] } }));
    const st = await ollama.status();
    assert.deepEqual({ running: st.running, modelReady: st.modelReady, version: st.version }, { running: true, modelReady: true, version: '0.9.9' });
  });

  test('alur aplikasi: pertanyaan di chat dijawab asisten lokal dan tercatat sebagai penyedia ollama', async () => {
    config.ai.chatProvider = 'ollama';
    assert.equal(ai.chat().name, 'ollama');
    mockOllama(() => answer('Tanam serempak dan gunakan varietas tahan.'));
    const f1 = await h.agentFor(...h.FARMER1);
    const s = await f1.post('/scan').set('Accept', 'application/json').set('X-CSRF-Token', f1.csrf)
      .field('_csrf', f1.csrf).field('idempotency_key', crypto.randomUUID())
      .attach('photo', h.demoPng(300, 300), { filename: 'a.png', contentType: 'image/png' });
    const sid = s.body.redirect.split('/').pop();
    const r = await f1.post(`/asisten/${sid}/pesan`).set('Accept', 'application/json').set('X-CSRF-Token', f1.csrf)
      .field('_csrf', f1.csrf).field('message', 'Bagaimana mencegahnya?');
    assert.equal(r.body.ok, true, JSON.stringify(r.body));
    const msg = h.db.get("SELECT provider, model, content FROM chat_messages WHERE session_id = ? AND role = 'assistant' ORDER BY id DESC LIMIT 1", sid);
    assert.deepEqual({ ...msg }, { provider: 'ollama', model: 'gemma3:4b', content: 'Tanam serempak dan gunakan varietas tahan.' });
    config.ai.chatProvider = 'demo';
  });
});
