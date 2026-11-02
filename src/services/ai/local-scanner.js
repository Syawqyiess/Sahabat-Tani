'use strict';
// Penyedia analisis gambar "lokal": model klasifikasi hama padi buatan sendiri (ONNX),
// dijalankan langsung di server tanpa internet. Dilatih dengan ml/train.py.
const fs = require('node:fs');
const path = require('node:path');
const config = require('../../config');
const storage = require('../storage');
const { findReferences } = require('./references');
const { AIServiceError } = require('./errors');

let state; // { session, labels, card }

function files() {
  const dir = path.resolve(config.root, config.ai.localScannerDir);
  return { dir, model: path.join(dir, 'model.onnx'), labels: path.join(dir, 'labels.json'), card: path.join(dir, 'model-card.json') };
}

function isAvailable() {
  const f = files();
  return fs.existsSync(f.model) && fs.existsSync(f.labels);
}

function modelInfo() {
  if (!isAvailable()) return null;
  const f = files();
  const labels = JSON.parse(fs.readFileSync(f.labels, 'utf8'));
  const card = fs.existsSync(f.card) ? JSON.parse(fs.readFileSync(f.card, 'utf8')) : {};
  return { version: labels.version, classes: labels.classes.length, metrics: card.metrics || null, limitations: card.limitations || [] };
}

async function load() {
  if (state) return state;
  const f = files();
  if (!isAvailable()) throw new AIServiceError('Model scanner lokal belum tersedia. Hubungi admin.', { retryable: false });
  const ort = require('onnxruntime-node');
  const session = await ort.InferenceSession.create(f.model, { executionProviders: ['cpu'] });
  const labels = JSON.parse(fs.readFileSync(f.labels, 'utf8'));
  const card = fs.existsSync(f.card) ? JSON.parse(fs.readFileSync(f.card, 'utf8')) : {};
  state = { session, labels, card, ort };
  return state;
}

// Prapemrosesan sama dengan evaluasi saat latih: sisi pendek 256 → potong tengah 224 → normalisasi ImageNet.
async function toTensor(absPath, input, ort) {
  const sharp = require('sharp');
  const img = sharp(absPath).rotate(); // ikuti orientasi EXIF dari kamera ponsel
  const meta = await img.metadata();
  const w = meta.autoOrient ? meta.autoOrient.width : meta.width;
  const h = meta.autoOrient ? meta.autoOrient.height : meta.height;
  const s = input.resize_short / Math.min(w, h);
  const rw = Math.max(input.size, Math.round(w * s));
  const rh = Math.max(input.size, Math.round(h * s));
  const { data } = await img
    .resize(rw, rh, { fit: 'fill', kernel: 'cubic' })
    .extract({ left: Math.floor((rw - input.size) / 2), top: Math.floor((rh - input.size) / 2), width: input.size, height: input.size })
    .removeAlpha().toColourspace('srgb').raw()
    .toBuffer({ resolveWithObject: true });
  const n = input.size * input.size;
  const arr = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 3; c++) arr[c * n + i] = (data[i * 3 + c] / 255 - input.mean[c]) / input.std[c];
  }
  return { tensor: new ort.Tensor('float32', arr, [1, 3, input.size, input.size]), width: w, height: h };
}

function softmax(logits, T) {
  const z = Array.from(logits, (v) => v / T);
  const m = Math.max(...z);
  const e = z.map((v) => Math.exp(v - m));
  const s = e.reduce((a, b) => a + b, 0);
  return e.map((v) => v / s);
}

const pct = (p) => `${Math.round(p * 100)}%`;

const GENERIC_STEPS = [
  'Amati beberapa rumpun di beberapa titik lahan, termasuk pangkal batang dan bawah daun.',
  'Perkirakan seberapa luas gejala atau serangga ditemukan di lahan.',
  'Lindungi musuh alami (laba-laba, kepik, capung) dan hindari penyemprotan tanpa pengamatan.',
  'Hubungi penyuluh (PPL) atau petugas POPT bila populasi tinggi atau gejala meluas cepat.',
];

function stepsFrom(ref) {
  if (!ref) return GENERIC_STEPS;
  const split = (t) => String(t || '').split(/;\s*|\.\s+/).map((s) => s.trim().replace(/\.$/, '')).filter((s) => s.length > 3);
  const steps = [...split(ref.ipm_control), ...split(ref.prevention)].slice(0, 5).map((s) => s + '.');
  if (ref.when_to_consult) steps.push(`Hubungi penyuluh/POPT ${ref.when_to_consult.charAt(0).toLowerCase()}${ref.when_to_consult.slice(1)}`);
  return steps.length ? steps : GENERIC_STEPS;
}

const vision = {
  name: 'lokal',
  mode: 'ai',
  get model() { const i = modelInfo(); return i ? `scanner-padi ${i.version}` : 'scanner-padi (belum dilatih)'; },
  supportsImages: true,

  async analyze({ imagePath }) {
    const { session, labels, card, ort } = await load();
    let prep;
    try {
      prep = await toTensor(storage.absPath(imagePath), labels.input, ort);
    } catch {
      throw new AIServiceError('Foto tidak dapat dibaca oleh model. Coba foto lain.', { retryable: false });
    }
    const out = await session.run({ [labels.input.name]: prep.tensor });
    const probs = softmax(out[Object.keys(out)[0]].data, labels.temperature || 1);
    const ranked = probs.map((p, i) => ({ i, p, cls: labels.classes[i] })).sort((a, b) => b.p - a.p);
    const best = ranked[0];
    const minScore = config.ai.localScannerMinScore ?? labels.min_score ?? 0.6;
    const isRice = best.cls.is_rice_pest;
    const identified = isRice && best.p >= minScore;
    const m = card.metrics || {};

    const issues = [];
    if (Math.min(prep.width, prep.height) < 300) issues.push('resolusi foto rendah');
    const riceRanked = ranked.filter((r) => r.cls.is_rice_pest);
    const ref = identified ? findReferences(best.cls.name_id, best.cls.scientific)[0] : null;

    const name = best.cls.name_id;
    let message;
    if (identified) {
      message = `Model scanner Sahabat Tani menduga foto ini menunjukkan **${name}** dengan skor keyakinan ${pct(best.p)}. ` +
        'Skor ini adalah perkiraan model, bukan kepastian — cocokkan dengan kondisi di lahan.';
    } else if (!isRice) {
      message = 'Model menilai foto ini lebih mirip serangga lain, bukan salah satu hama padi yang dikenalinya. ' +
        'Model ini juga belum dilatih untuk penyakit tanaman, kekurangan hara, walang sangit, keong mas, atau tikus.';
    } else {
      message = `Model belum cukup yakin (skor tertinggi ${pct(best.p)}, di bawah ambang ${pct(minScore)}), jadi hama belum dapat diidentifikasi. ` +
        'Coba foto lebih dekat dan terang, atau lihat kemungkinan di bawah sebagai bahan pemeriksaan.';
    }

    return {
      model: `scanner-padi ${labels.version}`,
      result: {
        photo_quality: { is_clear: issues.length ? false : null, issues },
        subject: identified ? 'hama_padi' : (isRice ? 'tidak_jelas' : 'tidak_relevan'),
        identified,
        suspected_pest_name: identified ? name : '',
        suspected_pest_scientific: identified ? (best.cls.scientific || '') : '',
        visual_evidence: [],
        alternatives: (identified ? riceRanked.slice(1, 3) : riceRanked.slice(0, 3))
          .filter((r) => r.p >= 0.05)
          .map((r) => ({ name: r.cls.name_id, reason: `skor model ${pct(r.p)}` })),
        non_pest_note: isRice ? '' : 'Foto lebih mirip serangga lain atau objek yang belum dikenali model.',
        follow_up_questions: [
          'Di bagian mana serangga atau gejala paling banyak terlihat: daun, batang, pangkal batang, atau malai?',
          'Berapa umur tanaman saat ini, dan seberapa luas gejala di lahan?',
          identified ? `Apakah ciri di lapangan cocok dengan ${name}?` : 'Bisakah Anda mengirim foto lebih dekat (20–30 cm) dengan cahaya terang?',
        ],
        initial_steps: stepsFrom(ref),
        farmer_message: message,
        scores: ranked.slice(0, 3).map((r) => ({ key: r.cls.key, name: r.cls.name_id, score: Math.round(r.p * 1000) / 1000 })),
        model_info: {
          kind: 'Klasifikasi gambar buatan sendiri (EfficientNet-B0, dilatih dengan IP102)',
          version: labels.version,
          threshold: minScore,
          test_accuracy: m.test_accuracy ?? null,
          test_top3_accuracy: m.test_top3_accuracy ?? null,
          test_images: m.test_images ?? null,
          note: 'Skor sudah dikalibrasi pada data validasi, tetapi bukan peluang pasti benar. Model tidak menjelaskan ciri visual; ia hanya mengenali pola gambar.',
        },
      },
    };
  },
};

module.exports = { vision, isAvailable, modelInfo, _reset() { state = undefined; } };
