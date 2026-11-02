'use strict';
const { test, before, after, afterEach, describe } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const h = require('./helpers');
const config = require('../src/config');
const ai = require('../src/services/ai');
const gemini = require('../src/services/ai/gemini');
const storage = require('../src/services/storage');
const { AIServiceError } = require('../src/services/ai/errors');

// Semua panggilan ke Google ditiru (fetch palsu) — tes tidak memakai kuota.
const realFetch = global.fetch;
let calls = [];
function mockGemini(responder) {
  calls = [];
  global.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (!u.includes('generativelanguage.googleapis.com')) return realFetch(url, opts);
    const body = opts.body ? JSON.parse(opts.body) : null;
    calls.push({ url: u, headers: opts.headers, body });
    const { status = 200, json } = responder(body, u);
    return new Response(JSON.stringify(json), { status, headers: { 'content-type': 'application/json' } });
  };
}
const textReply = (text) => ({ json: { modelVersion: 'gemini-uji-001', candidates: [{ finishReason: 'STOP', content: { role: 'model', parts: [{ text: 'memikirkan…', thought: true }, { text }] } }] } });

let imgRel;
before(async () => {
  await h.setup();
  config.ai.geminiKey = 'kunci-gemini-uji';
  imgRel = storage.saveImage({ buffer: h.demoPng(64, 64), size: 100 }, 999, 'scan').relPath;
});
afterEach(() => { global.fetch = realFetch; });
after(() => {
  config.ai.geminiKey = '';
  config.ai.visionProvider = 'demo';
  config.ai.chatProvider = 'demo';
});

describe('Penyedia Gemini', () => {
  test('analisis gambar: kirim foto + instruksi JSON, hasil dinormalisasi', async () => {
    mockGemini(() => textReply(JSON.stringify({
      subject: 'hama_padi', identified: true, suspected_pest_name: 'Walang sangit', visual_evidence: ['Serangga ramping hijau kecokelatan'],
      initial_steps: ['Bersihkan gulma di pematang.'], farmer_message: 'Terlihat serangga ramping pada malai.',
    })));
    const { result, model } = await gemini.vision.analyze({ imagePath: imgRel, mime: 'image/png', notes: { symptoms: 'bulir hampa' }, references: [] });
    const req = calls[0];
    assert.match(req.url, /models\/gemini-3\.5-flash:generateContent$/);
    assert.equal(req.headers['x-goog-api-key'], 'kunci-gemini-uji');
    assert.equal(req.body.generationConfig.responseMimeType, 'application/json');
    assert.equal(req.body.contents[0].parts[0].inline_data.mime_type, 'image/png');
    assert.match(req.body.contents[0].parts[1].text, /bulir hampa/);
    assert.match(req.body.systemInstruction.parts[0].text, /JANGAN menyebut dosis/);
    assert.equal(model, 'gemini-uji-001');
    assert.equal(result.suspected_pest_name, 'Walang sangit');
    assert.deepEqual(result.alternatives, []); // kolom yang hilang diisi bawaan
    assert.equal(result.photo_quality.is_clear, null);
    assert.ok(!JSON.stringify(result).includes('memikirkan'), 'bagian "thought" tidak ikut');
  });

  test('chat: riwayat dipetakan ke peran user/model, foto konteks scan disertakan', async () => {
    mockGemini(() => textReply('Jawaban Gemini.'));
    const out = await gemini.chat.reply({
      scan: { status: 'completed', result: { suspected_pest_name: 'Walang sangit' }, notes: {}, image_path: imgRel, image_mime: 'image/png' },
      history: [
        { role: 'user', content: 'Foto dari scan', image_path: imgRel, image_mime: 'image/png' },
        { role: 'assistant', content: 'Dugaan awal: walang sangit' },
        { role: 'system', content: 'diabaikan' },
        { role: 'user', content: 'Bagaimana mencegahnya?' },
      ],
      references: [],
    });
    assert.equal(out.text, 'Jawaban Gemini.');
    const roles = calls[0].body.contents.map((c) => c.role);
    assert.deepEqual(roles, ['user', 'model', 'user']);
    assert.ok(calls[0].body.contents[0].parts.some((p) => p.inline_data), 'foto ikut dikirim');
  });

  test('galat dipetakan ke pesan ramah', async () => {
    const cases = [
      [{ status: 429, json: { error: { message: 'Resource exhausted' } } }, /Kuota gratis/, true],
      [{ status: 400, json: { error: { message: 'API key not valid. Please pass a valid API key.' } } }, /Kunci API AI tidak valid/, false],
      [{ status: 404, json: { error: { message: 'models/x is not found' } } }, /tidak tersedia/, false],
      [{ json: { promptFeedback: { blockReason: 'SAFETY' } } }, /tidak dapat memproses foto/, false],
      [{ json: { candidates: [{ finishReason: 'SAFETY', content: { parts: [] } }] } }, /tidak dapat memproses foto/, false],
    ];
    for (const [resp, msg, retryable] of cases) {
      mockGemini(() => resp);
      await assert.rejects(
        gemini.vision.analyze({ imagePath: imgRel, mime: 'image/png', notes: {}, references: [] }),
        (err) => err instanceof AIServiceError && msg.test(err.message) && err.retryable === retryable,
      );
    }
    mockGemini(() => textReply('ini bukan json'));
    await assert.rejects(gemini.vision.analyze({ imagePath: imgRel, mime: 'image/png', notes: {}, references: [] }), /tidak dapat dibaca/);
  });

  test('model lambat/habis kuota/dihapus: otomatis pindah ke model berikutnya', async () => {
    const prevTimeout = config.ai.geminiTimeoutMs;
    config.ai.geminiTimeoutMs = 200;
    const ok = JSON.stringify({ subject: 'tidak_jelas', identified: false, farmer_message: 'Foto kurang jelas.' });
    for (const failFirst of ['timeout', 429, 404, 503]) {
      calls = [];
      global.fetch = async (url, opts) => {
        calls.push(String(url));
        if (String(url).includes('gemini-3.5-flash:')) {
          if (failFirst === 'timeout') {
            // Tunggu sampai sinyal batas waktu memutus permintaan.
            // Timer AbortSignal.timeout tidak menahan event loop, jadi tambahkan penahan sementara.
            const keep = setTimeout(() => {}, 5000);
            return new Promise((_, rej) => opts.signal.addEventListener('abort', () => { clearTimeout(keep); rej(opts.signal.reason); }));
          }
          return new Response(JSON.stringify({ error: { message: 'gagal' } }), { status: failFirst });
        }
        return new Response(JSON.stringify(textReply(ok).json), { status: 200 });
      };
      const { result } = await gemini.vision.analyze({ imagePath: imgRel, mime: 'image/png', notes: {}, references: [] });
      assert.equal(result.farmer_message, 'Foto kurang jelas.', String(failFirst));
      assert.match(calls[1], /gemini-flash-lite-latest:/, String(failFirst));
    }
    // Kunci salah tidak dicoba ulang ke model lain.
    calls = [];
    global.fetch = async (url) => { calls.push(String(url)); return new Response(JSON.stringify({ error: { message: 'API key not valid.' } }), { status: 400 }); };
    await assert.rejects(gemini.vision.analyze({ imagePath: imgRel, mime: 'image/png', notes: {}, references: [] }), /Kunci API AI tidak valid/);
    assert.equal(calls.length, 1);
    config.ai.geminiTimeoutMs = prevTimeout;
  });

  test('registry: Gemini aktif hanya bila kuncinya ada', () => {
    config.ai.visionProvider = 'gemini';
    assert.equal(ai.vision().name, 'gemini');
    config.ai.geminiKey = '';
    assert.equal(ai.vision().name, 'demo');
    config.ai.geminiKey = 'kunci-gemini-uji';
  });

  test('alur lengkap: scan dengan Gemini → chat berisi dugaan awal → tanya lanjut', async () => {
    config.ai.visionProvider = 'gemini';
    config.ai.chatProvider = 'gemini';
    mockGemini((body) => (body.generationConfig.responseMimeType === 'application/json'
      ? textReply(JSON.stringify({
        photo_quality: { is_clear: true, issues: [] }, subject: 'hama_padi', identified: true, suspected_pest_name: 'Wereng batang cokelat',
        suspected_pest_scientific: 'Nilaparvata lugens', visual_evidence: ['Serangga cokelat di pangkal batang'], alternatives: [], non_pest_note: '',
        follow_up_questions: ['Apakah ada bercak kering melingkar?'], initial_steps: ['Amati pangkal batang.'], farmer_message: 'Terlihat serangga cokelat.',
      }))
      : textReply('Cegah dengan tanam serempak dan varietas tahan.')));
    const f1 = await h.agentFor(...h.FARMER1);
    const res = await f1.post('/scan').set('Accept', 'application/json').set('X-CSRF-Token', f1.csrf)
      .field('_csrf', f1.csrf).field('idempotency_key', crypto.randomUUID())
      .attach('photo', h.demoPng(320, 320), { filename: 'a.png', contentType: 'image/png' });
    assert.equal(res.body.ok, true, JSON.stringify(res.body));
    const scan = h.db.get('SELECT provider, model, mode FROM pest_scans WHERE id = ?', res.body.scanId);
    assert.deepEqual({ ...scan }, { provider: 'gemini', model: 'gemini-uji-001', mode: 'ai' });
    let page = await f1.get(res.body.redirect);
    assert.match(page.text, /Dugaan awal:<\/strong> Wereng batang cokelat/);
    assert.doesNotMatch(page.text, /Simulasi respons AI/);

    const sid = res.body.redirect.split('/').pop();
    await f1.post(`/asisten/${sid}/pesan`).set('Accept', 'application/json').set('X-CSRF-Token', f1.csrf).field('_csrf', f1.csrf).field('message', 'Bagaimana mencegahnya?');
    page = await f1.get(`/asisten/${sid}`);
    assert.match(page.text, /tanam serempak dan varietas tahan/);
  });
});
