'use strict';
const { test, before, afterEach, describe } = require('node:test');
const assert = require('node:assert/strict');
process.env.RDKK_GAP_MS = '0';
const h = require('./helpers');
const rdkk = require('../src/services/rdkk');

// Ekspor CSV Tableau Public tiruan — tidak ada permintaan ke internet.
const realFetch = global.fetch;
const CSV = {
  KebutuhanPupukperJenis: 'jenis_pupuk,kelompok_tani,jumlah_kebutuhan_sesuai_sumber\nUREA,KALIBANJAR,42.328\nUREA,KALITEBON,8.343\nNPK,KALIBANJAR,38.319\nNPK,KALITEBON,7.694\n',
  PupukperMusim: 'jenis_pupuk,musim_tanam,jumlah_kebutuhan_sesuai_sumber\nNPK,MT1,4.665\nNPK,MT2,21.285\nNPK,MT3,20.063\nUREA,MT1,5.043\nUREA,MT2,23.599\nUREA,MT3,22.029\n',
  petaniterdaftar: 'KPI Petani Terdaftar\n88\n',
  kelompoktani: 'KPI Kelompok Tani\n2\n',
  totalkebutuhan: 'KPI Total Kebutuhan\n96.684 kg\n',
  ratarataPerpetani: 'KPI rata-rata petani\n1.099 kg\n',
};
let requested = [];
function mockTableau(overrides = {}) {
  requested = [];
  global.fetch = async (url) => {
    const u = String(url);
    if (!u.startsWith('https://public.tableau.com/views/SITANI/')) return realFetch(url);
    requested.push(u);
    const sheet = /SITANI\/([^.]+)\.csv/.exec(u)[1];
    const o = overrides[sheet];
    if (o && o.status) return new Response('x', { status: o.status, headers: { 'content-type': 'text/html' } });
    return new Response(o !== undefined ? o : CSV[sheet], { status: 200, headers: { 'content-type': 'text/csv; charset=utf-8' } });
  };
}

before(async () => { await h.setup(); });
afterEach(() => { global.fetch = realFetch; });

describe('Pengambilan data RDKK', () => {
  test('angka format Indonesia & CSV ber-kutip', () => {
    assert.equal(rdkk.parseIdNumber('42.328'), 42328);
    assert.equal(rdkk.parseIdNumber('96.684 kg'), 96684);
    assert.equal(rdkk.parseIdNumber('1.234.567'), 1234567);
    assert.equal(rdkk.parseIdNumber('4,5'), 4.5);
    assert.equal(rdkk.parseIdNumber('12abc'), null);
    assert.deepEqual(rdkk.parseCsv('a,b\n"x, y","say ""hi"""\r\n'), [['a', 'b'], ['x, y', 'say "hi"']]);
  });

  test('ambil, validasi silang, simpan; data tampil di Dashboard sebagai diagram sendiri + tabel', async () => {
    mockTableau();
    const r = await rdkk.refresh();
    assert.deepEqual(r, { ok: true, warnings: [] });
    assert.equal(requested.length, 6, 'lembar duplikat tidak diunduh ulang');
    const l = await rdkk.latest();
    assert.equal(l.data.kpi.total, 96684);
    assert.deepEqual(l.data.kelompok, ['KALIBANJAR', 'KALITEBON']);
    const page = await (await h.agentFor(...h.FARMER1)).get('/dashboard');
    assert.match(page.text, /Total kebutuhan pupuk<\/span><span class="rdkk-kpi-num"><span data-count="96684">96\.684<\/span><small> kg/, 'angka akhir sudah ada di HTML (tanpa JS tetap terbaca)');
    assert.match(page.text, /data-chart="kelompok"/);
    assert.match(page.text, /data-chart="heatmap"/);
    assert.match(page.text, /<td>Kalibanjar<\/td><td>Urea<\/td><td class="num">42\.328 kg<\/td>/, 'tabel data tersedia tanpa JavaScript');
    assert.match(page.text, /Data: Tableau Public \(Angely Marcella\)/);
  });

  test('angka antarlembar tidak cocok atau kolom berubah → gagal, data lama tetap dipakai', async () => {
    const before = await rdkk.latest();
    mockTableau({ totalkebutuhan: 'KPI Total Kebutuhan\n96,684 kg\n' }); // salah format → total 96,684
    let r = await rdkk.refresh();
    assert.equal(r.ok, false);
    assert.match(r.error, /tidak konsisten/);
    mockTableau({ PupukperMusim: 'jenis,musim,nilai\nNPK,MT1,1\n' });
    r = await rdkk.refresh();
    assert.match(r.error, /kolom berubah/);
    mockTableau({ petaniterdaftar: { status: 403 } });
    r = await rdkk.refresh();
    assert.match(r.error, /menolak akses/);
    const after = await rdkk.latest();
    assert.equal(after.fetchedAt, before.fetchedAt, 'snapshot valid terakhir tetap dipakai');
    assert.match(after.lastError.message, /menolak akses/);
    const page = await (await h.agentFor(...h.FARMER1)).get('/dashboard');
    assert.match(page.text, /Pembaruan terakhir gagal/);
    assert.match(page.text, /96\.684/);
  });

  test('admin dapat memperbarui manual dari halaman Integrasi', async () => {
    const admin = await h.agentFor(...h.ADMIN);
    const page = await admin.get('/admin/integrasi');
    assert.match(page.text, /Data RDKK untuk Dashboard/);
    mockTableau();
    const res = await admin.post('/admin/integrasi/rdkk').type('form').send({ _csrf: admin.csrf });
    assert.equal(res.status, 302);
    assert.equal((await rdkk.latest()).lastError, null);
    const f1 = await h.agentFor(...h.FARMER1);
    assert.equal((await f1.post('/admin/integrasi/rdkk').type('form').send({ _csrf: f1.csrf })).status, 403, 'petani tidak bisa memicu pengambilan');
  });
});

describe('Animasi masuk', () => {
  test('layar pembuka login hanya sekali per sesi browser; JS penanda dimuat lebih dulu', async () => {
    const agent = h.request.agent(h.getApp());
    const first = await agent.get('/masuk');
    assert.match(first.text, /class="intro"/);
    assert.match(first.headers['set-cookie'].join(';'), /st_intro=1/);
    assert.match(first.text, /<script src="\/static\/js\/early\.js\?v=[0-9a-f]{10}"><\/script>/);
    const second = await agent.get('/masuk');
    assert.doesNotMatch(second.text, /class="intro"/);
    assert.match(second.text, /auth-wrap auth-enter"/);
  });
});
