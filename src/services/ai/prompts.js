'use strict';

const SAFETY_RULES = `Aturan wajib:
- Gunakan bahasa Indonesia yang sederhana, ramah, kalimat pendek, mudah dipahami petani.
- Hasil identifikasi foto adalah bantuan awal, bukan diagnosis laboratorium. Ingatkan hal ini cukup SEKALI dan singkat; jangan diulang di setiap jawaban.
- Sampaikan hasil sesuai tingkat keyakinan: bila "Hampir pasti", sebut nama hamanya dengan tegas tanpa kalimat ragu-ragu; bila "Kemungkinan besar", sebut sebagai kemungkinan besar; bila "Belum yakin" atau tidak ada hasil, jangan menebak dan minta foto atau ciri tambahan.
- Jangan pernah membuat persentase atau skor keyakinan sendiri, dan jangan mengulang tingkat keyakinan atau skor kecuali petani menanyakannya. Langsung jawab pertanyaannya.
- Utamakan Pengendalian Hama Terpadu (PHT): pengamatan rutin, sanitasi, varietas tahan, pengaturan air dan tanam serempak, musuh alami, cara fisik/mekanis.
- JANGAN menyebut dosis, takaran, campuran, merek, atau cara pakai pestisida. Bila pengendalian kimia mungkin diperlukan, katakan bahwa petani harus mengikuti label resmi produk terdaftar dan berkonsultasi dengan penyuluh pertanian (PPL) atau petugas POPT setempat.
- Jangan mengarang sumber, kutipan, atau tautan. Hanya rujuk "Referensi internal" yang diberikan di konteks; jika referensi bertanda BELUM DIVERIFIKASI, sebutkan bahwa informasinya belum diverifikasi penyuluh.
- Jika foto lebih menunjukkan penyakit (jamur/bakteri/virus) atau kekurangan hara daripada hama, katakan dengan jelas.
- Jangan menyimpulkan serangan hama dari data kualitas udara.`;

const VISION_SYSTEM = `Anda adalah asisten identifikasi awal hama padi untuk aplikasi "Sahabat Tani".
Tugas: amati SATU foto tanaman padi dari petani dan isi hasil terstruktur sesuai skema.
${SAFETY_RULES}
Petunjuk pengisian:
- photo_quality.is_clear=false bila foto buram, gelap, terlalu jauh, atau objek tertutup; isi issues dengan alasan singkat.
- subject: pilih kategori yang paling sesuai dengan isi foto.
- identified=true hanya bila ada ciri visual yang cukup untuk menduga satu hama tertentu. Bila tidak, isi suspected_pest_name dengan string kosong.
- visual_evidence: ciri yang benar-benar terlihat di foto (bukan pengetahuan umum).
- alternatives: kemungkinan lain bila foto ambigu (boleh kosong).
- non_pest_note: isi bila foto lebih mengarah ke penyakit/kekurangan hara, selain itu string kosong.
- follow_up_questions: 2–4 pertanyaan untuk membantu identifikasi.
- initial_steps: 3–6 langkah pemeriksaan dan penanganan awal berbasis PHT, tanpa dosis pestisida.
- farmer_message: pesan pembuka untuk petani (3–6 kalimat) yang menjelaskan dugaan awal, ciri yang terlihat, dan pengingat bahwa ini bantuan awal.`;

const VISION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['photo_quality', 'subject', 'identified', 'suspected_pest_name', 'suspected_pest_scientific', 'visual_evidence',
    'alternatives', 'non_pest_note', 'follow_up_questions', 'initial_steps', 'farmer_message'],
  properties: {
    photo_quality: {
      type: 'object', additionalProperties: false, required: ['is_clear', 'issues'],
      properties: { is_clear: { type: 'boolean' }, issues: { type: 'array', items: { type: 'string' } } },
    },
    subject: {
      type: 'string',
      enum: ['hama_padi', 'gejala_penyakit', 'kekurangan_hara', 'padi_tanpa_gejala_jelas', 'tidak_relevan', 'tidak_jelas'],
    },
    identified: { type: 'boolean' },
    suspected_pest_name: { type: 'string' },
    suspected_pest_scientific: { type: 'string' },
    visual_evidence: { type: 'array', items: { type: 'string' } },
    alternatives: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, required: ['name', 'reason'], properties: { name: { type: 'string' }, reason: { type: 'string' } } },
    },
    non_pest_note: { type: 'string' },
    follow_up_questions: { type: 'array', items: { type: 'string' } },
    initial_steps: { type: 'array', items: { type: 'string' } },
    farmer_message: { type: 'string' },
  },
};

const CHAT_SYSTEM = `Anda adalah "Asisten Tani", asisten AI pertanian di aplikasi "Sahabat Tani" untuk petani padi di Indonesia.
${SAFETY_RULES}
- Jawab ringkas (umumnya 3–8 kalimat atau daftar poin pendek). Akhiri dengan satu pertanyaan atau saran langkah berikut bila membantu.
- Jika petani mengirim foto tambahan, amati foto tersebut dan kaitkan dengan hasil scan sebelumnya.
- Jika ragu, sarankan pemeriksaan langsung oleh penyuluh/POPT.`;

// Tingkat keyakinan berupa kata. Batas dipilih dari data validasi model scanner lokal:
// skor >= 0,85 benar ±93%, skor >= 0,60 (ambang) benar ±85%; di bawah ambang model tidak menebak.
const CONFIDENCE_LEVELS = [
  { min: 0.85, key: 'tinggi', label: 'Hampir pasti' },
  { min: 0, key: 'sedang', label: 'Kemungkinan besar' },
];

function confidenceLevel(score, threshold = 0.6) {
  if (!Number.isFinite(score) || score < threshold) return { key: 'rendah', label: 'Belum yakin' };
  const { key, label } = CONFIDENCE_LEVELS.find((l) => score >= l.min);
  return { key, label };
}

// Hasil scan untuk model percakapan: tanpa angka skor (agar tidak diulang-ulang), cukup tingkat keyakinan berupa kata.
function chatScanView(result) {
  if (!result) return result;
  const { scores, model_info: _info, ...rest } = result;
  if (rest.confidence) rest.tingkat_keyakinan = rest.confidence.label;
  delete rest.confidence;
  return rest;
}

function notesText(notes) {
  return [
    notes.land_name && `Lahan: ${notes.land_name}`,
    notes.plant_age_days != null && `Umur tanaman: ${notes.plant_age_days} hari setelah tanam`,
    notes.affected_part && `Bagian terdampak menurut petani: ${notes.affected_part}`,
    notes.symptoms && `Gejala menurut petani: ${notes.symptoms}`,
  ].filter(Boolean).join('\n') || 'Petani tidak menambahkan keterangan.';
}

// Menyeragamkan hasil analisis dari penyedia mana pun ke bentuk VISION_SCHEMA.
function normalizeVisionResult(r) {
  if (!r || typeof r !== 'object') throw new Error('Hasil analisis kosong');
  const arr = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()) : []);
  const str = (v) => (typeof v === 'string' ? v.trim() : '');
  const subjects = VISION_SCHEMA.properties.subject.enum;
  const pq = r.photo_quality && typeof r.photo_quality === 'object' ? r.photo_quality : {};
  const out = {
    photo_quality: { is_clear: typeof pq.is_clear === 'boolean' ? pq.is_clear : null, issues: arr(pq.issues) },
    subject: subjects.includes(r.subject) ? r.subject : 'tidak_jelas',
    identified: r.identified === true,
    suspected_pest_name: str(r.suspected_pest_name),
    suspected_pest_scientific: str(r.suspected_pest_scientific),
    visual_evidence: arr(r.visual_evidence),
    alternatives: Array.isArray(r.alternatives)
      ? r.alternatives.filter((a) => a && str(a.name)).map((a) => ({ name: str(a.name), reason: str(a.reason) }))
      : [],
    non_pest_note: str(r.non_pest_note),
    follow_up_questions: arr(r.follow_up_questions),
    initial_steps: arr(r.initial_steps),
    farmer_message: str(r.farmer_message),
  };
  // Skor hanya diteruskan dari model yang benar-benar menghasilkan skor terkalibrasi (scanner lokal).
  if (Array.isArray(r.scores) && r.model_info) {
    out.scores = r.scores.filter((s) => s && str(s.name) && Number.isFinite(s.score)).slice(0, 3)
      .map((s) => ({ key: str(s.key), name: str(s.name), score: Math.max(0, Math.min(1, s.score)) }));
    out.model_info = r.model_info;
    if (r.confidence && ['tinggi', 'sedang', 'rendah'].includes(r.confidence.key)) out.confidence = { key: r.confidence.key, label: str(r.confidence.label) };
  }
  if (!out.suspected_pest_name) out.identified = false;
  if (!out.farmer_message) throw new Error('Hasil analisis tidak lengkap');
  return out;
}

module.exports = { VISION_SYSTEM, VISION_SCHEMA, CHAT_SYSTEM, SAFETY_RULES, notesText, normalizeVisionResult, confidenceLevel, chatScanView };
