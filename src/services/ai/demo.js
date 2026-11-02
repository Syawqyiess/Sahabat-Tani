'use strict';
// MODE DEMO — dipakai ketika API AI belum dikonfigurasi.
// Modul ini TIDAK menganalisis gambar. Semua keluaran ditandai sebagai simulasi.

const DEMO_LABEL = 'Simulasi respons AI';

const vision = {
  name: 'demo',
  mode: 'demo',
  model: null,
  supportsImages: false,

  async analyze({ notes }) {
    const questions = [
      'Di bagian mana gejala paling banyak terlihat: daun, batang, pangkal batang, atau malai?',
      'Apakah Anda melihat serangga, telur, atau kotoran di sekitar tanaman? Jika ya, seperti apa warnanya?',
      'Seberapa luas gejala ini menyebar di lahan: beberapa rumpun saja atau banyak petak?',
    ];
    if (notes.plant_age_days == null) questions.push('Berapa umur tanaman padi saat ini (hari setelah tanam)?');
    return {
      model: null,
      result: {
        simulated: true,
        photo_quality: { is_clear: null, issues: [] },
        subject: 'tidak_dianalisis',
        identified: false,
        suspected_pest_name: '',
        suspected_pest_scientific: '',
        visual_evidence: [],
        alternatives: [],
        non_pest_note: '',
        follow_up_questions: questions,
        initial_steps: [
          'Amati beberapa rumpun di beberapa titik lahan, termasuk pangkal batang dan permukaan bawah daun.',
          'Catat gejala yang terlihat dan perkirakan berapa bagian lahan yang terdampak.',
          'Foto dari jarak dekat (sekitar 20–30 cm) dengan cahaya terang untuk pemeriksaan berikutnya.',
          'Hubungi penyuluh pertanian (PPL) atau petugas POPT setempat bila gejala meluas dengan cepat.',
        ],
        farmer_message:
          `[${DEMO_LABEL}] Foto Anda sudah tersimpan, tetapi BELUM dianalisis oleh model AI karena layanan AI belum diaktifkan oleh admin. ` +
          'Karena itu saya tidak bisa menyebutkan dugaan nama hama dari foto ini. ' +
          'Sementara itu, jawab pertanyaan di bawah dan ikuti langkah pemeriksaan awal agar penyuluh lebih mudah membantu.',
      },
    };
  },
};

const QUICK = [
  { match: /ciri|tanda|gejala/i, text: 'Ciri-ciri hama hanya bisa saya jelaskan jika nama hamanya diketahui. Sebutkan dugaan nama hama (misalnya wereng batang cokelat atau penggerek batang), lalu saya tampilkan ciri dari referensi internal.' },
  { match: /penanganan|tangani|atasi|kendali|obat|semprot|langkah/i, text: 'Langkah awal berbasis Pengendalian Hama Terpadu: (1) amati lahan secara rutin, (2) bersihkan gulma dan sisa tanaman yang menjadi tempat hama, (3) atur air dan jarak tanam, (4) lindungi musuh alami. Untuk penggunaan pestisida, ikuti label resmi produk terdaftar dan konsultasikan dengan penyuluh — saya tidak memberikan dosis.' },
  { match: /cegah|lagi|muncul/i, text: 'Pencegahan umum: tanam serempak dengan petani sekitar, gunakan varietas tahan bila tersedia, jaga kebersihan pematang, pupuk berimbang (tidak berlebihan nitrogen), dan amati lahan setiap minggu.' },
  { match: /penyuluh|ppl|popt|periksa/i, text: 'Sebaiknya hubungi penyuluh (PPL) atau petugas POPT bila: gejala menyebar cepat, lebih dari beberapa rumpun terdampak, Anda ragu jenis hamanya, atau Anda mempertimbangkan penggunaan pestisida.' },
];

const chat = {
  name: 'demo',
  mode: 'demo',
  model: null,
  supportsImages: false,

  async reply({ history, references }) {
    const last = [...history].reverse().find((m) => m.role === 'user');
    const q = (last && last.content) || '';
    let text;
    if (references.length) {
      const r = references[0];
      text = `Berikut ringkasan dari referensi internal "${r.name}"${r.is_verified ? '' : ' (belum diverifikasi penyuluh)'}:\n` +
        [r.symptoms && `• Gejala: ${r.symptoms}`, r.ipm_control && `• Pengendalian terpadu: ${r.ipm_control}`, r.prevention && `• Pencegahan: ${r.prevention}`]
          .filter(Boolean).join('\n');
    } else {
      const hit = QUICK.find((x) => x.match.test(q));
      text = hit ? hit.text : 'Terima kasih atas pesannya. Dalam mode demo, saya hanya bisa memberi jawaban umum yang sudah disiapkan. Coba tombol pertanyaan cepat atau sebutkan nama hama yang Anda duga.';
    }
    if (last && last.image_path) text = 'Foto tambahan Anda tersimpan, tetapi tidak dianalisis karena layanan AI belum aktif. ' + text;
    return { text: `[${DEMO_LABEL}] ${text}`, model: null };
  },
};

module.exports = { vision, chat, DEMO_LABEL };
