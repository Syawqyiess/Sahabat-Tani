'use strict';
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const sharp = require('sharp');
const h = require('./helpers');
const config = require('../src/config');
const ai = require('../src/services/ai');
const storage = require('../src/services/storage');
const local = require('../src/services/ai/local-scanner');

// Model mini (test/fixtures/scanner-mini) memilih kelas dari warna rata-rata gambar:
// merah → kelas 0, hijau → "wereng batang cokelat", biru → "bukan hama padi".
async function colorImage(r, g, b, size = 400) {
  const buffer = await sharp({ create: { width: size, height: size, channels: 3, background: { r, g, b } } }).jpeg().toBuffer();
  return (await storage.saveImage({ buffer, size: buffer.length }, 777, 'scan')).relPath;
}

before(async () => {
  await h.setup();
  config.ai.localScannerDir = 'test/fixtures/scanner-mini';
  local._reset();
});
after(() => {
  config.ai.visionProvider = 'demo';
  config.ai.localScannerMinScore = null;
  config.ai.localScannerDir = 'models/scanner-padi';
  local._reset();
});

describe('Penyedia scanner lokal (ONNX)', () => {
  test('aktif hanya bila berkas model tersedia', () => {
    config.ai.visionProvider = 'lokal';
    assert.equal(ai.vision().name, 'lokal');
    config.ai.localScannerDir = 'tidak/ada';
    assert.equal(ai.vision().name, 'demo');
    config.ai.localScannerDir = 'test/fixtures/scanner-mini';
  });

  test('yakin: nama hama, skor 3 teratas, langkah dari referensi hama di database', async () => {
    const { result, model } = await local.vision.analyze({ imagePath: await colorImage(20, 230, 40), notes: {}, references: [] });
    assert.match(model, /scanner-padi fixture/);
    assert.equal(result.identified, true);
    assert.equal(result.suspected_pest_name, 'Wereng batang cokelat');
    assert.equal(result.suspected_pest_scientific, 'Nilaparvata lugens');
    assert.equal(result.scores.length, 3);
    assert.ok(result.scores[0].score > 0.6 && result.scores[0].score <= 1);
    assert.ok(result.initial_steps.some((s) => /pangkal batang/i.test(s)), 'langkah diambil dari referensi wereng');
    assert.deepEqual(result.visual_evidence, [], 'model klasifikasi tidak mengarang ciri visual');
    assert.match(result.model_info.note, /bukan jaminan/);
    assert.deepEqual(result.confidence, { key: 'tinggi', label: 'Hampir pasti' });
    assert.ok(result.farmer_message.startsWith('Ini **Wereng batang cokelat**'), 'tegas bila hampir pasti');
    assert.doesNotMatch(result.farmer_message, /%|skor/i, 'tanpa angka/skor di pesan');
    assert.deepEqual(result.alternatives, [], 'tidak menumpuk kemungkinan lain bila hampir pasti');
  });

  test('serangga lain: tidak dipaksakan menjadi hama padi', async () => {
    const { result } = await local.vision.analyze({ imagePath: await colorImage(20, 40, 230), notes: {}, references: [] });
    assert.equal(result.identified, false);
    assert.equal(result.subject, 'tidak_relevan');
    assert.equal(result.suspected_pest_name, '');
  });

  test('di bawah ambang: belum teridentifikasi, hanya kemungkinan', async () => {
    config.ai.localScannerMinScore = 0.9;
    const { result } = await local.vision.analyze({ imagePath: await colorImage(100, 140, 120), notes: {}, references: [] });
    config.ai.localScannerMinScore = null;
    assert.equal(result.identified, false);
    assert.equal(result.subject, 'tidak_jelas');
    assert.match(result.farmer_message, /belum yakin.*tidak akan menebak/);
    assert.equal(result.confidence.key, 'rendah');
    assert.ok(result.alternatives.length >= 1);
  });

  test('alur aplikasi: scan dengan model lokal → chat menampilkan skor beserta penjelasan batasannya', async () => {
    config.ai.visionProvider = 'lokal';
    const f1 = await h.agentFor(...h.FARMER1);
    const buffer = await sharp({ create: { width: 500, height: 500, channels: 3, background: { r: 20, g: 230, b: 40 } } }).png().toBuffer();
    const res = await f1.post('/scan').set('Accept', 'application/json').set('X-CSRF-Token', f1.csrf)
      .field('_csrf', f1.csrf).field('idempotency_key', crypto.randomUUID())
      .attach('photo', buffer, { filename: 'hijau.png', contentType: 'image/png' });
    assert.equal(res.body.ok, true, JSON.stringify(res.body));
    const scan = await h.db.get('SELECT provider, mode, model FROM pest_scans WHERE id = ?', res.body.scanId);
    assert.equal(scan.provider, 'lokal');
    assert.equal(scan.mode, 'ai');
    const page = await f1.get(res.body.redirect);
    assert.match(page.text, /Hasil:<\/strong> Wereng batang cokelat \(<em>Nilaparvata lugens<\/em>\) — <strong>Hampir pasti<\/strong>/);
    assert.match(page.text, /class="conf conf-tinggi"/);
    assert.match(page.text, /Lihat skor model/, 'angka skor tetap bisa dilihat bila ingin tahu');
    const firstAi = page.text.split('class="msg msg-assistant"')[1].split('</li>')[0];
    assert.doesNotMatch(firstAi, /\d+\s?%/, 'pesan pembuka tanpa persen');
    assert.match(firstAi, /Yang bisa dilakukan sekarang/);
    config.ai.visionProvider = 'demo';
  });
});
