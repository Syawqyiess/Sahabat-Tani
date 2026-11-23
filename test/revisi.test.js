'use strict';
const { test, before, describe } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

let f1, f2;
before(async () => {
  await h.setup();
  f1 = await h.agentFor(...h.FARMER1);
  f2 = await h.agentFor(...h.FARMER2);
});

const uid = async (phone) => (await h.db.get('SELECT id FROM users WHERE phone = ?', phone)).id;
const countSessions = async (userId) => (await h.db.get('SELECT COUNT(*) n FROM chat_sessions WHERE user_id = ?', userId)).n;

describe('Dashboard: visualisasi data RDKK', () => {
  test('tanpa data tersimpan: pesan jujur, tanpa embed Tableau; CSP tidak lagi membuka Tableau', async () => {
    const res = await f1.get('/dashboard');
    assert.equal(res.status, 200);
    assert.match(res.text, /Visualisasi Data Pertanian/);
    assert.doesNotMatch(res.text, /tableau-viz|tableau.js|viz_v1/);
    const csp = res.headers['content-security-policy'];
    assert.doesNotMatch(csp, /tableau/);
  });
});

describe('Lahan Saya: jenis tanaman & foto', () => {
  test('kartu menampilkan Jenis Tanaman dari field lahan, bukan varietas', async () => {
    const page = await f1.get('/lahan');
    assert.match(page.text, /<dt>Jenis Tanaman<\/dt><dd>Padi<\/dd>/);
    assert.doesNotMatch(page.text, /<dt>Varietas<\/dt>/);
    assert.doesNotMatch(page.text, /Inpari 32/, 'nama varietas tidak tampil di kartu');
    // Lahan demo memakai foto stok berlisensi yang diberi label "Foto ilustrasi" (bukan foto lahan itu).
    assert.ok(page.text.includes('/static/img/lahan-demo/blok-a.webp'));
    assert.ok(page.text.includes('/static/img/lahan-demo/blok-b.webp'));
    assert.match(page.text, /Foto ilustrasi<span class="visually-hidden"> — bukan foto lahan ini/);
    const wati = await f2.get('/lahan');
    assert.match(wati.text, /Foto lahan belum ditambahkan/, 'lahan tanpa foto & tanpa ilustrasi: placeholder jujur');
  });

  test('jenis tanaman kosong tampil "Belum diisi"; foto diunggah, diperkecil, hanya pemilik yang bisa melihat', async () => {
    const add = await f2.post('/lahan').field('_csrf', f2.csrf).field('name', 'Petak bawang').field('commodity', 'Bawang merah')
      .attach('photo', h.demoPng(2400, 1200), { filename: 'lahan.png', contentType: 'image/png' });
    assert.equal(add.status, 302);
    const land = await h.db.get("SELECT * FROM lands WHERE name = 'Petak bawang'");
    assert.match(land.photo_path, /^\d+\/land-[0-9a-f-]{36}\.webp$/);
    const sharp = require('sharp');
    const meta = await sharp(require('node:fs').readFileSync(require('../src/services/storage').absPath(land.photo_path))).metadata();
    assert.equal(meta.width, 1600, 'foto diperkecil');
    const list = await f2.get('/lahan');
    assert.match(list.text, /<dt>Jenis Tanaman<\/dt><dd>Bawang merah<\/dd>/);
    assert.match(list.text, new RegExp(`/media/${land.photo_path.replace(/[.]/g, '\\.')}`));
    assert.equal((await f2.get(`/media/${land.photo_path}`)).status, 200);
    assert.equal((await f1.get(`/media/${land.photo_path}`)).status, 404, 'petani lain tidak bisa melihat');

    await f2.post('/lahan').type('form').send({ _csrf: f2.csrf, name: 'Petak kosong' });
    const again = await f2.get('/lahan');
    const card = again.text.slice(again.text.indexOf('Petak kosong'));
    assert.match(card, /<dt>Jenis Tanaman<\/dt><dd><span class="empty-val">Belum diisi<\/span>/);

    // Ganti lalu hapus foto: berkas lama dibersihkan.
    const old = land.photo_path;
    const upd = await f2.post(`/lahan/${land.id}`).field('_csrf', f2.csrf).field('name', 'Petak bawang').field('commodity', 'Bawang merah')
      .attach('photo', h.demoPng(300, 200), { filename: 'baru.png', contentType: 'image/png' });
    assert.equal(upd.status, 302);
    const after = (await h.db.get('SELECT photo_path FROM lands WHERE id = ?', land.id)).photo_path;
    assert.notEqual(after, old);
    assert.equal(require('node:fs').existsSync(require('../src/services/storage').absPath(old)), false);
    await f2.post(`/lahan/${land.id}`).field('_csrf', f2.csrf).field('name', 'Petak bawang').field('remove_photo', '1');
    assert.equal((await h.db.get('SELECT photo_path FROM lands WHERE id = ?', land.id)).photo_path, null);
  });

  test('berkas bukan gambar ditolak; petani lain tidak bisa mengganti foto', async () => {
    const bad = await f2.post('/lahan').field('_csrf', f2.csrf).field('name', 'Petak palsu')
      .attach('photo', Buffer.from('bukan gambar sama sekali'), { filename: 'x.png', contentType: 'image/png' });
    assert.equal(bad.status, 422);
    assert.match(bad.text, /bukan gambar yang valid/);
    assert.equal((await h.db.get("SELECT COUNT(*) n FROM lands WHERE name = 'Petak palsu'")).n, 0);
    const own = await h.db.get('SELECT id FROM lands WHERE user_id = ? LIMIT 1', await uid('081200000001'));
    const res = await f2.post(`/lahan/${own.id}`).field('_csrf', f2.csrf).field('name', 'Diretas')
      .attach('photo', h.demoPng(), { filename: 'x.png', contentType: 'image/png' });
    assert.equal(res.status, 404);
    assert.equal((await h.db.get('SELECT photo_path FROM lands WHERE id = ?', own.id)).photo_path, null);
  });
});

describe('Asisten AI: Percakapan Baru', () => {
  test('menu membuka Percakapan Baru tanpa membuat sesi kosong', async () => {
    const id = await uid('081200000001');
    const before = await countSessions(id);
    for (let i = 0; i < 3; i++) {
      const res = await f1.get('/asisten');
      assert.equal(res.status, 200);
      assert.match(res.text, /Ada yang ingin ditanyakan tentang tanamanmu\?/);
      assert.match(res.text, /action="\/asisten\/mulai"/);
      assert.match(res.text, /data-starter=/);
      assert.match(res.text, /href="\/asisten\/riwayat"/);
    }
    assert.equal(await countSessions(id), before);
    // Tautan lama POST /asisten/baru juga tidak membuat sesi.
    const old = await f1.post('/asisten/baru').type('form').send({ _csrf: f1.csrf });
    assert.equal(old.headers.location, '/asisten');
    assert.equal(await countSessions(id), before);
  });

  test('pesan pertama membuat satu sesi; kirim ulang dengan kunci sama tidak menggandakan', async () => {
    const id = await uid('081200000001');
    const before = await countSessions(id);
    const empty = await f1.post('/asisten/mulai').field('_csrf', f1.csrf).field('message', '  ');
    assert.equal(empty.status, 422);
    assert.equal(await countSessions(id), before);
    const send = () => f1.post('/asisten/mulai').field('_csrf', f1.csrf).field('idempotency_key', 'kunci-1').field('message', 'Bagaimana cara memupuk padi?');
    const r1 = await send();
    assert.match(r1.headers.location, /^\/asisten\/\d+#akhir$/);
    const r2 = await send();
    assert.equal(r2.headers.location, r1.headers.location);
    assert.equal(await countSessions(id), before + 1);
    const sid = Number(/\/asisten\/(\d+)/.exec(r1.headers.location)[1]);
    const room = await f1.get(`/asisten/${sid}`);
    assert.equal(room.status, 200, 'URL sesi langsung tetap membuka sesi itu');
    assert.match(room.text, /Bagaimana cara memupuk padi\?/);
    const msgs = (await h.db.all('SELECT role FROM chat_messages WHERE session_id = ? ORDER BY id', sid)).map((m) => m.role);
    assert.deepEqual(msgs.slice(0, 2), ['user', 'assistant']);
    const hist = await f1.get('/asisten/riwayat');
    assert.equal(hist.status, 200);
    assert.match(hist.text, new RegExp(`href="/asisten/${sid}"`));
  });

  test('alur scan tetap langsung ke percakapan berisi konteks scan', async () => {
    const res = await f2.post('/scan').set('Accept', 'application/json').set('X-CSRF-Token', f2.csrf)
      .field('_csrf', f2.csrf).field('idempotency_key', 'scan-revisi').attach('photo', h.demoPng(640, 640), { filename: 'daun.png', contentType: 'image/png' });
    assert.match(res.body.redirect, /^\/asisten\/\d+$/);
    const room = await f2.get(res.body.redirect);
    assert.equal(room.status, 200);
    assert.match(room.text, /hasil scan #\d+/);
    assert.doesNotMatch(room.text, /Ada yang ingin ditanyakan tentang tanamanmu/);
  });
});
