'use strict';
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const h = require('./helpers');
const ai = require('../src/services/ai');
const { AIServiceError } = require('../src/services/ai/anthropic');
const config = require('../src/config');

let f1; let f2; let admin;

before(async () => {
  await h.setup();
  f1 = await h.agentFor(...h.FARMER1);
  f2 = await h.agentFor(...h.FARMER2);
  admin = await h.agentFor(...h.ADMIN);
});
after(() => { ai._clearOverrides(); });

function scanPost(agent, { key = crypto.randomUUID(), file = h.demoPng(640, 640), name = 'daun.png', type = 'image/png', fields = {} } = {}) {
  let req = agent.post('/scan').set('Accept', 'application/json').set('X-CSRF-Token', agent.csrf)
    .field('_csrf', agent.csrf).field('idempotency_key', key);
  for (const [k, v] of Object.entries(fields)) req = req.field(k, v);
  return req.attach('photo', file, { filename: name, contentType: type });
}

describe('Halaman publik & akses', () => {
  test('halaman publik dapat dibuka', async () => {
    const r = h.request(h.getApp());
    for (const p of ['/', '/artikel', '/masuk', '/daftar', '/lupa-sandi']) {
      const res = await r.get(p);
      assert.equal(res.status, 200, p);
    }
  });

  test('halaman petani mengalihkan ke login bila belum masuk', async () => {
    const res = await h.request(h.getApp()).get('/dashboard');
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, '/masuk');
  });

  test('semua halaman petani & admin dapat dirender', async () => {
    for (const p of ['/dashboard', '/profil', '/profil/ubah', '/lahan', '/lahan/baru', '/lahan/peta', '/scan', '/scan/riwayat', '/asisten', '/artikel-tersimpan']) {
      const res = await f1.get(p);
      assert.equal(res.status, 200, `${p}: ${res.text.slice(0, 300)}`);
    }
    for (const p of ['/admin', '/admin/pengguna', '/admin/pengguna/baru', '/admin/lahan', '/admin/lahan/baru', '/admin/artikel', '/admin/artikel/baru',
      '/admin/kategori', '/admin/sumber-berita', '/admin/referensi-hama', '/admin/referensi-hama/baru', '/admin/integrasi']) {
      const res = await admin.get(p);
      assert.equal(res.status, 200, `${p}: ${res.text.slice(0, 300)}`);
    }
  });

  test('petani tidak bisa membuka panel admin; admin tidak bisa membuka chat petani', async () => {
    assert.equal((await f1.get('/admin')).status, 403);
    const s = h.db.get('SELECT id FROM chat_sessions WHERE user_id = (SELECT id FROM users WHERE phone = ?)', h.FARMER1[0]);
    assert.equal((await admin.get(`/asisten/${s.id}`)).status, 403);
  });

  test('POST tanpa token CSRF ditolak', async () => {
    const res = await f1.post('/lahan').type('form').send({ name: 'Tanpa token' });
    assert.equal(res.status, 403);
  });
});

describe('Autentikasi & profil', () => {
  test('daftar dengan data minimal, profil menampilkan "Belum diisi"', async () => {
    const agent = h.request.agent(h.getApp());
    const csrf = h.csrfFrom((await agent.get('/daftar')).text);
    const res = await agent.post('/daftar').type('form').send({ _csrf: csrf, full_name: 'Petani Uji', phone: '+62 812-9999-0000', password: 'rahasia123', password_confirm: 'rahasia123' });
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, '/dashboard');
    const dash = await agent.get('/dashboard');
    assert.match(dash.text, /Lengkapi Profil/);
    const prof = await agent.get('/profil');
    assert.match(prof.text, /Belum diisi/);
    assert.match(prof.text, /081299990000/);
  });

  test('pendaftaran menolak nomor HP ganda dan kata sandi pendek', async () => {
    const agent = h.request.agent(h.getApp());
    const csrf = h.csrfFrom((await agent.get('/daftar')).text);
    const res = await agent.post('/daftar').type('form').send({ _csrf: csrf, full_name: 'X', phone: h.FARMER1[0], password: '123', password_confirm: '123' });
    assert.equal(res.status, 422);
    assert.match(res.text, /sudah terdaftar/);
    assert.match(res.text, /minimal 8 karakter/);
  });

  test('login salah memberi pesan jelas', async () => {
    const agent = h.request.agent(h.getApp());
    const csrf = h.csrfFrom((await agent.get('/masuk')).text);
    const res = await agent.post('/masuk').type('form').send({ _csrf: csrf, identifier: h.FARMER1[0], password: 'salah' });
    assert.equal(res.status, 401);
    assert.match(res.text, /kata sandi salah/);
  });

  test('profil dapat dilengkapi belakangan', async () => {
    const res = await f2.post('/profil/ubah').type('form').send({
      _csrf: f2.csrf, full_name: 'Bu Wati (Akun Demo)', phone: h.FARMER2[0], village: 'Desa Uji', district: 'Kec. Uji', regency: 'Klaten', province: 'Jawa Tengah', main_commodity: 'Padi',
    });
    assert.equal(res.status, 302);
    const prof = await f2.get('/profil');
    assert.match(prof.text, /Desa Uji/);
  });

  test('reset kata sandi (mode demo menampilkan tautan) lalu login dengan sandi baru', async () => {
    const agent = h.request.agent(h.getApp());
    let csrf = h.csrfFrom((await agent.get('/lupa-sandi')).text);
    const res = await agent.post('/lupa-sandi').type('form').send({ _csrf: csrf, identifier: '081299990000' });
    const link = /href="(http[^"]+\/reset-sandi\/[^"]+)"/.exec(res.text)[1];
    const p = new URL(link).pathname;
    csrf = h.csrfFrom((await agent.get(p)).text);
    const done = await agent.post(p).type('form').send({ _csrf: csrf, password: 'sandibaru1', password_confirm: 'sandibaru1' });
    assert.equal(done.headers.location, '/masuk?reset=1');
    // Tautan hanya sekali pakai
    assert.match((await agent.get(p)).text, /tidak berlaku/);
    await h.agentFor('081299990000', 'sandibaru1');
  });
});

describe('Lahan & isolasi data antarpetani', () => {
  test('lahan bisa disimpan tanpa koordinat dan luas', async () => {
    const res = await f2.post('/lahan').type('form').send({ _csrf: f2.csrf, name: 'Petak baru tanpa koordinat' });
    assert.equal(res.status, 302);
    const page = await f2.get(res.headers.location);
    assert.match(page.text, /Petak baru tanpa koordinat/);
    assert.match(page.text, /Belum diisi/);
  });

  test('poligon tidak valid ditolak dengan pesan', async () => {
    const res = await f2.post('/lahan').type('form').send({ _csrf: f2.csrf, name: 'X', polygon_json: '[[1,2]]' });
    assert.equal(res.status, 422);
    assert.match(res.text, /minimal 3 titik/);
  });

  test('petani tidak dapat membuka atau mengubah lahan petani lain lewat ID', async () => {
    const wLand = h.db.get('SELECT id FROM lands WHERE user_id = (SELECT id FROM users WHERE phone = ?)', h.FARMER2[0]);
    assert.equal((await f1.get(`/lahan/${wLand.id}`)).status, 404);
    assert.equal((await f1.get(`/lahan/${wLand.id}/ubah`)).status, 404);
    assert.equal((await f1.post(`/lahan/${wLand.id}`).type('form').send({ _csrf: f1.csrf, name: 'Diretas' })).status, 404);
    await f1.post(`/lahan/${wLand.id}/hapus`).type('form').send({ _csrf: f1.csrf });
    assert.ok(h.db.get('SELECT 1 FROM lands WHERE id = ?', wLand.id), 'lahan petani lain tidak boleh terhapus');
    const list = await f1.get('/lahan');
    assert.doesNotMatch(list.text, /Sawah dekat rumah/);
  });

  test('peta hanya memuat lahan milik petani yang masuk dan membedakan lahan demo', async () => {
    const page = await f1.get('/lahan/peta');
    assert.match(page.text, /Lahan Demo — Bukan Batas Lahan Asli/);
    assert.doesNotMatch(page.text, /Sawah dekat rumah/);
    // Tanpa API key: placeholder informatif, bukan peta palsu
    assert.match(page.text, /Peta belum aktif/);
  });
});

describe('Scan → analisis → chatroom', () => {
  test('mode demo: scan otomatis membuka chat berisi foto dan label simulasi', async () => {
    const res = await scanPost(f1, { fields: { plant_age_days: '30', affected_part: 'Daun', symptoms: 'daun menguning' } });
    assert.equal(res.status, 200, res.text);
    assert.equal(res.body.ok, true);
    assert.match(res.body.redirect, /^\/asisten\/\d+$/);
    const chat = await f1.get(res.body.redirect);
    assert.equal(chat.status, 200);
    assert.match(chat.text, /<img class="msg-img" src="\/media\/\d+\/scan-/);
    assert.match(chat.text, /Simulasi respons AI/);
    assert.match(chat.text, /BELUM dianalisis oleh model AI/);
    assert.match(chat.text, /umur 30 hari/);
    const scan = h.db.get('SELECT * FROM pest_scans WHERE id = ?', res.body.scanId);
    assert.equal(scan.status, 'completed');
    assert.equal(scan.mode, 'demo');
    assert.ok(scan.processing_ms != null);
  });

  test('tombol ditekan berulang (kunci idempoten sama) tidak membuat scan ganda', async () => {
    const key = crypto.randomUUID();
    const before = h.db.get('SELECT COUNT(*) n FROM pest_scans').n;
    const a = await scanPost(f1, { key });
    const b = await scanPost(f1, { key });
    assert.equal(a.body.redirect, b.body.redirect);
    assert.equal(b.body.duplicate, true);
    assert.equal(h.db.get('SELECT COUNT(*) n FROM pest_scans').n, before + 1);
  });

  test('berkas bukan gambar ditolak (termasuk yang menyamar sebagai PNG)', async () => {
    const r1 = await scanPost(f1, { file: Buffer.from('halo'), name: 'a.txt', type: 'text/plain' });
    assert.equal(r1.status, 422);
    assert.match(r1.body.error, /Format berkas tidak didukung/);
    const r2 = await scanPost(f1, { file: Buffer.from('bukan gambar sungguhan ...'), name: 'palsu.png', type: 'image/png' });
    assert.equal(r2.status, 422);
    assert.match(r2.body.error, /bukan gambar yang valid/);
  });

  test('foto pribadi hanya dapat diakses pemiliknya', async () => {
    const res = await scanPost(f1);
    const scan = h.db.get('SELECT image_path FROM pest_scans WHERE id = ?', res.body.scanId);
    assert.equal((await f1.get(`/media/${scan.image_path}`)).status, 200);
    assert.equal((await f2.get(`/media/${scan.image_path}`)).status, 404);
    assert.equal((await admin.get(`/media/${scan.image_path}`)).status, 404);
    assert.equal((await f2.get(res.body.redirect)).status, 404);
    assert.equal((await f2.get(`/scan/${res.body.scanId}`)).status, 404);
  });

  test('AI gagal: status "Foto belum berhasil dianalisis", lalu coba lagi tanpa unggah ulang', async () => {
    ai._setOverride('vision', { name: 'uji', mode: 'ai', model: 'model-uji', supportsImages: true, analyze: async () => { throw new AIServiceError('Koneksi ke layanan AI terputus.'); } });
    const res = await scanPost(f1);
    assert.equal(res.body.ok, false);
    assert.match(res.body.error, /terputus/);
    let chat = await f1.get(res.body.redirect);
    assert.match(chat.text, /Foto belum berhasil dianalisis/);
    assert.doesNotMatch(chat.text, /Dugaan awal/);
    assert.equal(h.db.get('SELECT status FROM pest_scans WHERE id = ?', res.body.scanId).status, 'failed');

    ai._setOverride('vision', { name: 'uji', mode: 'ai', model: 'model-uji', supportsImages: true, analyze: async () => ({ model: 'model-uji', result: identifiedResult() }) });
    const retry = await f1.post(`/scan/${res.body.scanId}/ulang`).set('Accept', 'application/json').type('form').send({ _csrf: f1.csrf });
    assert.equal(retry.body.ok, true);
    chat = await f1.get(res.body.redirect);
    assert.match(chat.text, /Dugaan awal:<\/strong> Wereng batang cokelat/);
    ai._clearOverrides();
  });

  test('mode AI: pesan pertama berisi dugaan, ciri, langkah awal, dan sumber yang benar-benar dipakai', async () => {
    let seenNotes;
    ai._setOverride('vision', {
      name: 'uji', mode: 'ai', model: 'model-uji', supportsImages: true,
      analyze: async ({ notes, imagePath }) => { seenNotes = { notes, imagePath }; return { model: 'model-uji', result: identifiedResult() }; },
    });
    const res = await scanPost(f1, { fields: { symptoms: 'pangkal batang ada serangga cokelat' } });
    ai._clearOverrides();
    assert.equal(seenNotes.notes.symptoms, 'pangkal batang ada serangga cokelat');
    assert.ok(seenNotes.imagePath);
    const chat = await f1.get(res.body.redirect);
    assert.match(chat.text, /Ciri yang terlihat di foto/);
    assert.match(chat.text, /Langkah pemeriksaan dan penanganan awal/);
    assert.match(chat.text, /Referensi hama: Wereng batang cokelat/);
    assert.match(chat.text, /Belum diverifikasi penyuluh/);
    assert.match(chat.text, /bantuan awal/);
    assert.doesNotMatch(chat.text, /\d+\s?%/, 'tidak boleh ada persentase keyakinan');
  });

  test('chat lanjutan menerima konteks scan dan riwayat tetap ada setelah keluar-masuk', async () => {
    let ctx;
    ai._setOverride('chat', { name: 'uji', mode: 'ai', model: 'chat-uji', supportsImages: true, reply: async (c) => { ctx = c; return { text: 'Jawaban uji tentang wereng.', model: 'chat-uji' }; } });
    const res = await scanPost(f1);
    const sid = res.body.redirect.split('/').pop();
    const send = await f1.post(`/asisten/${sid}/pesan`).set('Accept', 'application/json').set('X-CSRF-Token', f1.csrf)
      .field('_csrf', f1.csrf).field('message', 'Apa ciri-ciri hama ini?');
    assert.equal(send.body.ok, true);
    ai._clearOverrides();
    assert.ok(ctx.scan && ctx.scan.image_path, 'konteks scan & foto otomatis tersedia untuk chatbot');
    assert.equal(ctx.history.at(-1).content, 'Apa ciri-ciri hama ini?');

    const again = await h.agentFor(...h.FARMER1);
    const page = await again.get(`/asisten/${sid}`);
    assert.match(page.text, /Jawaban uji tentang wereng/);
    assert.match(page.text, /Apa ciri-ciri hama ini\?/);
  });

  test('mode demo: tombol pertanyaan cepat mendapat jawaban yang sesuai', async () => {
    const res = await scanPost(f2);
    const sid = res.body.redirect.split('/').pop();
    for (const [q, expect] of [
      ['Bagaimana langkah penanganan awal?', /Pengendalian Hama Terpadu/],
      ['Bagaimana mencegahnya muncul lagi?', /tanam serempak/],
      ['Apakah perlu diperiksa penyuluh?', /POPT/],
    ]) {
      await f2.post(`/asisten/${sid}/pesan`).set('Accept', 'application/json').set('X-CSRF-Token', f2.csrf).field('_csrf', f2.csrf).field('message', q);
      const last = h.db.get("SELECT content FROM chat_messages WHERE session_id = ? AND role = 'assistant' ORDER BY id DESC LIMIT 1", sid);
      assert.match(last.content, expect, q);
      assert.match(last.content, /^\[Simulasi respons AI\]/);
    }
  });

  test('chat gagal menampilkan status dan bisa dicoba lagi', async () => {
    ai._setOverride('chat', { name: 'uji', mode: 'ai', model: 'x', supportsImages: true, reply: async () => { throw new AIServiceError('Layanan AI sedang sibuk.'); } });
    const res = await scanPost(f2);
    const sid = res.body.redirect.split('/').pop();
    await f2.post(`/asisten/${sid}/pesan`).set('Accept', 'application/json').set('X-CSRF-Token', f2.csrf).field('_csrf', f2.csrf).field('message', 'halo');
    let page = await f2.get(`/asisten/${sid}`);
    assert.match(page.text, /Asisten belum berhasil menjawab/);
    ai._setOverride('chat', { name: 'uji', mode: 'ai', model: 'x', supportsImages: true, reply: async () => ({ text: 'Sudah pulih.', model: 'x' }) });
    await f2.post(`/asisten/${sid}/ulang`).type('form').send({ _csrf: f2.csrf });
    ai._clearOverrides();
    page = await f2.get(`/asisten/${sid}`);
    assert.match(page.text, /Sudah pulih/);
    assert.doesNotMatch(page.text, /Asisten belum berhasil menjawab/);
  });

  test('dua petani memiliki riwayat scan dan percakapan yang terpisah', async () => {
    const u1 = h.db.get('SELECT id FROM users WHERE phone = ?', h.FARMER1[0]).id;
    const u2 = h.db.get('SELECT id FROM users WHERE phone = ?', h.FARMER2[0]).id;
    const s2 = h.db.all('SELECT id FROM pest_scans WHERE user_id = ?', u2).map((r) => r.id);
    const hist1 = await f1.get('/scan/riwayat');
    for (const id of s2) assert.doesNotMatch(hist1.text, new RegExp(`Scan #${id} `));
    const c1 = h.db.all('SELECT id FROM chat_sessions WHERE user_id = ?', u1);
    for (const c of c1) assert.equal((await f2.get(`/asisten/${c.id}`)).status, 404);
  });
});

describe('Kualitas udara', () => {
  const realFetch = global.fetch;
  after(() => { global.fetch = realFetch; });

  function sample() {
    return {
      latitude: -6.3, longitude: 107.3, timezone: 'Asia/Jakarta', timezone_abbreviation: 'WIB',
      current_units: { us_aqi: 'USAQI', pm2_5: 'μg/m³', pm10: 'μg/m³', nitrogen_dioxide: 'μg/m³', ozone: 'μg/m³', carbon_monoxide: 'μg/m³' },
      current: { time: '2026-11-01T10:00', us_aqi: 87, pm2_5: 29.1, pm10: 41.3, nitrogen_dioxide: 12.2, ozone: 60.1, carbon_monoxide: 300 },
      hourly: { time: ['2026-11-01T08:00', '2026-11-01T09:00', '2026-11-01T10:00'], us_aqi: [70, 80, 87], pm2_5: [20, 25, 29.1], pm10: [30, 35, 41.3] },
    };
  }

  test('menampilkan indeks, kategori, satuan, lokasi, waktu data, dan atribusi', async () => {
    global.fetch = async () => new Response(JSON.stringify(sample()), { status: 200, headers: { 'content-type': 'application/json' } });
    const page = await f1.get('/udara?segarkan=1');
    assert.equal(page.status, 200);
    assert.match(page.text, /US AQI \(standar US EPA\)/);
    assert.match(page.text, />87</);
    assert.match(page.text, /Sedang/);
    assert.match(page.text, /μg\/m³/);
    assert.match(page.text, /Sawah Blok A \(Demo\)/);
    assert.match(page.text, /2026-11-01 10:00 WIB/);
    assert.match(page.text, /Open-Meteo/);
    assert.match(page.text, /bukan pengukuran langsung sensor/);
    assert.match(page.text, /<svg class="chart"/);
  });

  test('API gagal: data lama ditampilkan dengan penanda waktu, bukan angka simulasi', async () => {
    global.fetch = async () => new Response('err', { status: 500 });
    const page = await f1.get('/udara?segarkan=1');
    assert.match(page.text, /Menampilkan data terakhir yang tersimpan/);
    assert.match(page.text, /Data lama/);
  });

  test('API gagal tanpa cache dan kuota habis: pesan jelas dengan tombol coba lagi', async () => {
    global.fetch = async () => new Response('limit', { status: 429 });
    const page = await f1.get('/udara?src=perangkat&lat=-7.7&lng=110.6');
    assert.match(page.text, /Kuota permintaan Open-Meteo habis/);
    assert.match(page.text, /Coba lagi/i);
    assert.doesNotMatch(page.text, /class="aq-num"/);
  });
});

describe('Artikel & admin', () => {
  test('admin menerbitkan artikel; petani dapat membaca dan menyimpannya; draft tidak terlihat', async () => {
    const draft = await admin.post('/admin/artikel').type('form').send({ _csrf: admin.csrf, title: 'Artikel Uji Draft', body_md: 'Isi', action: 'draft' });
    assert.equal(draft.status, 302);
    const draftRow = h.db.get("SELECT * FROM articles WHERE title = 'Artikel Uji Draft'");
    assert.equal((await f1.get(`/artikel/${draftRow.slug}`)).status, 404);

    const pub = await admin.post('/admin/artikel').type('form').send({
      _csrf: admin.csrf, title: 'Panduan Pengamatan Mingguan', summary: 'Ringkasan', body_md: '## Langkah\n\nAmati lahan.<script>alert(1)</script>', action: 'publish', tags: 'pht',
    });
    assert.equal(pub.status, 302);
    const row = h.db.get("SELECT * FROM articles WHERE title = 'Panduan Pengamatan Mingguan'");
    assert.equal(row.status, 'published');
    const read = await f1.get(`/artikel/${row.slug}`);
    assert.equal(read.status, 200);
    assert.match(read.text, /<h2>Langkah<\/h2>/);
    assert.doesNotMatch(read.text, /<script>alert/);
    await f1.post(`/artikel/${row.id}/simpan`).type('form').send({ _csrf: f1.csrf });
    assert.match((await f1.get('/artikel-tersimpan')).text, /Panduan Pengamatan Mingguan/);

    const list = await f1.get('/artikel?q=Pengamatan');
    assert.match(list.text, /Panduan Pengamatan Mingguan/);

    await admin.post(`/admin/artikel/${row.id}/status`).type('form').send({ _csrf: admin.csrf, action: 'archive' });
    assert.equal((await f1.get(`/artikel/${row.slug}`)).status, 404);
  });

  test('admin menonaktifkan akun: sesi petani langsung berakhir', async () => {
    const agent = await h.agentFor('081299990000', 'sandibaru1');
    const uid = h.db.get("SELECT id FROM users WHERE phone = '081299990000'").id;
    await admin.post(`/admin/pengguna/${uid}/status`).type('form').send({ _csrf: admin.csrf });
    const res = await agent.get('/dashboard');
    assert.equal(res.status, 302);
    await admin.post(`/admin/pengguna/${uid}/status`).type('form').send({ _csrf: admin.csrf });
  });

  test('admin membantu mengisi data lahan petani', async () => {
    const uid = h.db.get('SELECT id FROM users WHERE phone = ?', h.FARMER2[0]).id;
    const res = await admin.post('/admin/lahan').type('form').send({
      _csrf: admin.csrf, user_id: uid, name: 'Lahan diisi admin', lat: '-7.70', lng: '110.60', polygon_json: '[[-7.70,110.60],[-7.70,110.61],[-7.71,110.61]]', data_source: 'real',
    });
    assert.equal(res.status, 302);
    assert.match((await f2.get('/lahan')).text, /Lahan diisi admin/);
    assert.doesNotMatch((await f1.get('/lahan')).text, /Lahan diisi admin/);
  });

  test('status integrasi tidak menampilkan nilai API key', async () => {
    const prev = config.ai.anthropicKey;
    config.ai.anthropicKey = 'sk-ant-RAHASIA-UJI';
    const page = await admin.get('/admin/integrasi');
    config.ai.anthropicKey = prev;
    assert.doesNotMatch(page.text, /RAHASIA/);
    assert.match(page.text, /Terkonfigurasi \(nilai disembunyikan\)/);
  });

  test('dashboard admin tidak memuat isi percakapan petani', async () => {
    const page = await admin.get('/admin');
    assert.doesNotMatch(page.text, /Jawaban uji tentang wereng/);
  });

  test('referensi hama hanya bisa diverifikasi setelah sumber diisi', async () => {
    const p = h.db.get('SELECT id FROM pest_references LIMIT 1');
    await admin.post(`/admin/referensi-hama/${p.id}/verifikasi`).type('form').send({ _csrf: admin.csrf, verified_by: 'PPL Uji' });
    assert.equal(h.db.get('SELECT is_verified FROM pest_references WHERE id = ?', p.id).is_verified, 0);
  });
});

function identifiedResult() {
  return {
    photo_quality: { is_clear: true, issues: [] },
    subject: 'hama_padi',
    identified: true,
    suspected_pest_name: 'Wereng batang cokelat',
    suspected_pest_scientific: 'Nilaparvata lugens',
    visual_evidence: ['Serangga kecil cokelat di pangkal batang'],
    alternatives: [{ name: 'Wereng punggung putih', reason: 'warna mirip pada foto kecil' }],
    non_pest_note: '',
    follow_up_questions: ['Apakah ada bercak kering melingkar?'],
    initial_steps: ['Amati pangkal batang di beberapa titik.'],
    farmer_message: 'Dari foto, terlihat serangga kecil berwarna cokelat di pangkal batang.',
  };
}
