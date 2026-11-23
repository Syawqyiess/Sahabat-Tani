'use strict';
const { test, before, afterEach, describe } = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const h = require('./helpers');
const news = require('../src/services/news');
const images = require('../src/services/news/images');
const robots = require('../src/services/news/robots');
const fetcher = require('../src/services/news/fetcher');

// Situs & CDN tiruan — tidak ada permintaan ke internet.
const realFetch = global.fetch;
let sites = {};
let requested = [];
function mockSites(map) {
  sites = map;
  requested = [];
  global.fetch = async (url) => {
    const u = String(url);
    if (!/^https?:\/\/[a-z0-9.-]+\.test\//.test(u)) return realFetch(url);
    requested.push(u);
    const s = sites[u];
    if (!s) return new Response('tidak ada', { status: 404, headers: { 'content-type': 'text/html' } });
    if (s.redirect) return new Response(null, { status: 302, headers: { location: s.redirect } });
    return new Response(s.body, { status: s.status || 200, headers: { 'content-type': s.type || 'text/html; charset=utf-8' } });
  };
}

let PHOTO; let SMALL; let BANNER;
before(async () => {
  await h.setup();
  PHOTO = await sharp({ create: { width: 1200, height: 675, channels: 3, background: '#4a7a3a' } }).jpeg().toBuffer();
  SMALL = await sharp({ create: { width: 160, height: 60, channels: 3, background: '#fff' } }).png().toBuffer();
  BANNER = await sharp({ create: { width: 1400, height: 300, channels: 3, background: '#e33' } }).jpeg().toBuffer();
  fetcher._setResolver(async (host) => [{ address: host.startsWith('privat.') ? '10.0.0.5' : '93.184.216.34' }]);
});
afterEach(() => { global.fetch = realFetch; robots._reset(); fetcher._reset(); });

const jpg = (b) => ({ type: 'image/jpeg', body: b });

describe('Kandidat gambar', () => {
  test('JSON-LD @graph dengan rujukan @id, URL relatif/protokol-relatif, entity, og & twitter', () => {
    const html = `<html><head>
      <meta property="og:image" content="//media-tani.test/foto/og.jpg?w=1200&amp;h=630">
      <meta name="twitter:image" content="/foto/tw.jpg">
      <script type="application/ld+json">{"@context":"https://schema.org","@graph":[
        {"@type":"ImageObject","@id":"https://media-tani.test/a#primaryimage","url":"https:\/\/media-tani.test\/foto\/utama.jpg","caption":"Petani memanen padi","creditText":"Budi"},
        {"@type":"NewsArticle","image":{"@id":"https://media-tani.test/a#primaryimage"}}]}</script>
    </head><body><img src="/logo.png"></body></html>`;
    const c = images.pageCandidates(html, 'https://media-tani.test/berita/a');
    assert.deepEqual(c.map((x) => [x.from, x.url]), [
      ['json-ld', 'https://media-tani.test/foto/utama.jpg'],
      ['og:image', 'https://media-tani.test/foto/og.jpg?w=1200&h=630'],
      ['twitter:image', 'https://media-tani.test/foto/tw.jpg'],
    ]);
    assert.equal(c[0].caption, 'Petani memanen padi');
    assert.equal(c[0].credit, 'Budi');
  });

  test('selector khusus sumber: lazy data-srcset, picture/source, figcaption; bukan gambar pertama sembarang', () => {
    const html = `<body><img src="/avatar.jpg"><figure class="utama"><picture>
      <source data-srcset="/f/a-480.webp 480w, /f/a-1280.webp 1280w, /f/a-2400.webp 2400w">
      <img src="data:image/gif;base64,R0lG" data-src="/f/a-800.jpg" alt="Sawah di Klaten"></picture>
      <figcaption>Hamparan sawah</figcaption></figure></body>`;
    const c = images.pageCandidates(html, 'https://media-tani.test/x', { article: { image: ['figure.utama'] } });
    assert.equal(c.length, 1);
    assert.equal(c[0].url, 'https://media-tani.test/f/a-1280.webp');
    assert.equal(c[0].alt, 'Sawah di Klaten');
    assert.equal(c[0].caption, 'Hamparan sawah');
  });

  test('RSS: media:content & enclosure gambar; media non-gambar diabaikan', () => {
    const c = images.rssCandidates({
      mediaContent: [{ $: { url: 'https://kb.test/v.mp4', medium: 'video' } }, { $: { url: 'https://img.kb.test/a.jpg', medium: 'image' } }],
      enclosure: { url: 'https://img.kb.test/a.jpg', type: 'image/jpeg' },
    }, 'https://kb.test/berita/1');
    assert.deepEqual(c.map((x) => x.url), ['https://img.kb.test/a.jpg', 'https://img.kb.test/a.jpg']);
  });
});

describe('Validasi gambar di backend', () => {
  const src = { id: 0, name: 'Media Tani', image_policy: 'tautan', image_hosts: 'cdn-tani.test' };
  const art = (url) => ({ id: 0, title: 'Panen raya padi', source_url: url });

  test('foto valid dipakai; logo kecil, banner, HTML menyamar, host asing, IP privat ditolak; 403 = diblokir', async () => {
    mockSites({
      'https://media-tani.test/foto/ok.jpg': jpg(PHOTO),
      'https://media-tani.test/foto/kecil.png': { type: 'image/png', body: SMALL },
      'https://media-tani.test/foto/lebar.jpg': jpg(BANNER),
      'https://media-tani.test/foto/palsu.jpg': { type: 'image/jpeg', body: '<!doctype html><html><body>bukan gambar</body></html>' },
      'https://media-tani.test/foto/hotlink.jpg': { status: 403, body: 'Forbidden' },
      'https://media-tani.test/foto/pindah.jpg': { redirect: 'https://asing.test/x.jpg' },
      'https://cdn-tani.test/f/cdn.jpg': jpg(PHOTO),
    });
    const allowHost = (host) => ['media-tani.test', 'cdn-tani.test'].includes(host);
    const v = (u) => images.validate({ url: u }, { allowHost, policy: 'tautan' });
    assert.equal((await v('https://media-tani.test/foto/ok.jpg')).status, 'ok');
    assert.equal((await v('https://cdn-tani.test/f/cdn.jpg')).status, 'ok', 'CDN terverifikasi diizinkan');
    assert.match((await v('https://media-tani.test/foto/kecil.png')).note, /terlalu kecil/);
    assert.match((await v('https://media-tani.test/foto/lebar.jpg')).note, /proporsi/);
    assert.match((await v('https://media-tani.test/foto/palsu.jpg')).note, /HTML/);
    assert.equal((await v('https://media-tani.test/foto/hotlink.jpg')).status, 'diblokir');
    assert.match((await v('https://media-tani.test/foto/pindah.jpg')).note, /belum diverifikasi/, 'redirect ke host lain dicek ulang');
    assert.match((await images.validate({ url: 'https://privat.test/a.jpg' }, { allowHost: () => true })).note, /jaringan privat/);
    assert.match((await images.validate({ url: 'http://localhost/a.jpg' }, { allowHost: () => true })).note, /jaringan lokal/);
    assert.match((await v('https://media-tani.test/assets/logo-media.jpg')).note, /logo/, 'pola logo ditolak tanpa diunduh');
    assert.ok(!requested.some((u) => u.includes('logo-media')));
    // resolve: kandidat pertama (logo) dilewati, og:image dipakai, kredit & alt diisi tanpa mengarang.
    mockSites({
      'https://media-tani.test/berita/a': { body: '<meta property="og:image" content="/assets/logo-media.jpg"><meta name="twitter:image" content="/foto/ok.jpg">' },
      'https://media-tani.test/foto/ok.jpg': jpg(PHOTO),
    });
    const r = await images.resolve(art('https://media-tani.test/berita/a'), src);
    assert.equal(r.status, 'ok');
    assert.equal(r.sourceUrl, 'https://media-tani.test/foto/ok.jpg');
    assert.equal(r.display, 'https://media-tani.test/foto/ok.jpg', "kebijakan 'tautan' menampilkan URL asli penerbit");
    assert.equal(r.credit, 'Foto: Media Tani');
    assert.match(r.alt, /^Foto dari berita “Panen raya padi” — Media Tani$/);
  });
});

describe('Pengambilan & backfill', () => {
  test('berita baru dari HTML langsung mendapat gambar dari halaman yang sama; tanpa gambar → ilustrasi', async () => {
    const list = `<a href="/berita/pompa-air-sawah-kering">Pompa air sawah kering</a><a href="/berita/pupuk-tanpa-foto">Pupuk tanpa foto</a>`;
    mockSites({
      'https://media-tani.test/robots.txt': { type: 'text/plain', body: 'User-agent: *\nAllow: /' },
      'https://media-tani.test/berita': { body: list },
      'https://media-tani.test/berita/pompa-air-sawah-kering': { body: '<title>Pompa air sawah kering</title><meta property="og:title" content="Pompa air sawah kering"><meta property="og:image" content="https://media-tani.test/foto/pompa.jpg"><meta property="og:image:alt" content="Pompa air di tepi sawah">' },
      'https://media-tani.test/berita/pupuk-tanpa-foto': { body: '<title>Pupuk tanpa foto</title><meta property="og:title" content="Pupuk organik untuk petani">' },
      'https://media-tani.test/foto/pompa.jpg': jpg(PHOTO),
    });
    const r = h.db.run(`INSERT INTO news_sources (name, feed_url, usage_note, kind, config_json, is_active) VALUES ('Media Tani', 'https://media-tani.test/berita', 'uji', 'html', ?, 1)`,
      JSON.stringify({ link_pattern: '^https://media-tani\\.test/berita/[a-z-]+$' }));
    const source = h.db.get('SELECT * FROM news_sources WHERE id = ?', r.lastInsertRowid);
    const rep = await news.fetchSource(source);
    assert.equal(rep.added, 2);
    assert.deepEqual(rep.images, { ok: 1, fallback: 1 });
    const pompa = h.db.get("SELECT * FROM articles WHERE title = 'Pompa air sawah kering'");
    assert.equal(pompa.image_status, 'ok');
    assert.equal(pompa.image_kind, 'sumber');
    assert.equal(pompa.image_alt, 'Pompa air di tepi sawah');
    assert.equal(requested.filter((u) => u.endsWith('/berita/pompa-air-sawah-kering')).length, 1, 'halaman artikel tidak dibuka dua kali');
    const tanpa = h.db.get("SELECT * FROM articles WHERE title = 'Pupuk organik untuk petani'");
    assert.equal(tanpa.image_url, null);
    assert.equal(tanpa.image_status, 'tidak-ada');

    const page = await (await h.agentFor(...h.FARMER1)).get('/artikel');
    assert.match(page.text, /<img src="https:\/\/media-tani\.test\/foto\/pompa\.jpg" alt="Pompa air di tepi sawah"[^>]*referrerpolicy="strict-origin-when-cross-origin"/);
    assert.match(page.text, /<span class="media-credit">Foto: Media Tani<\/span>/);
    assert.match(page.text, /<span class="media-tag">Ilustrasi<\/span>/, 'tanpa gambar: ilustrasi kategori berlabel');
  });

  test('backfill: memperbarui artikel lama, idempoten, tidak menimpa pilihan admin, gagal satu tidak menghentikan', async () => {
    const src = h.db.get("SELECT * FROM news_sources WHERE name = 'Media Tani'");
    const ins = (title, url, extra = '') => h.db.run(
      `INSERT INTO articles (slug, title, status, origin, source_id, source_name, source_url, external_guid${extra ? ', image_url, image_kind, image_status' : ''})
       VALUES (?, ?, 'published', 'external', ?, 'Media Tani', ?, ?${extra ? ', ?, ?, ?' : ''})`,
      title.toLowerCase().replace(/\W+/g, '-'), title, src.id, url, 'url:' + url, ...(extra ? [extra, 'admin', 'ok'] : [])).lastInsertRowid;
    const lama = ins('Berita lama bergambar', 'https://media-tani.test/berita/lama');
    const putus = ins('Berita lama putus', 'https://media-tani.test/berita/hilang');
    const admin = ins('Berita dengan cover admin', 'https://media-tani.test/berita/admin', 'https://cdn-tani.test/pilihan-admin.jpg');
    mockSites({
      'https://media-tani.test/berita/lama': { body: '<meta property="og:image" content="/foto/lama.jpg">' },
      'https://media-tani.test/foto/lama.jpg': jpg(PHOTO),
    });
    const r1 = await images.processPending({ sourceId: src.id });
    assert.equal(r1.updated, 1);
    assert.ok(r1.checked >= 2);
    assert.equal(h.db.get('SELECT image_status FROM articles WHERE id = ?', lama).image_status, 'ok');
    assert.equal(h.db.get('SELECT image_status FROM articles WHERE id = ?', putus).image_status, 'gagal', '404 halaman = gagal sementara, dicoba lagi nanti');
    assert.equal(h.db.get('SELECT image_url FROM articles WHERE id = ?', admin).image_url, 'https://cdn-tani.test/pilihan-admin.jpg');
    mockSites({});
    const r2 = await images.processPending({ sourceId: src.id });
    assert.equal(r2.checked, 0, 'aman diulang: tidak ada yang diproses ulang');
    assert.equal(h.db.get("SELECT COUNT(*) n FROM articles WHERE title = 'Berita lama bergambar'").n, 1, 'tidak menggandakan artikel');
  });

  test('gambar tampil sama di daftar, detail, dan Artikel Tersimpan; gambar umum situs ditolak', async () => {
    const f1 = await h.agentFor(...h.FARMER1);
    const a = h.db.get("SELECT * FROM articles WHERE title = 'Berita lama bergambar'");
    await f1.post(`/artikel/${a.id}/simpan`).type('form').send({ _csrf: f1.csrf });
    const saved = await f1.get('/artikel-tersimpan');
    assert.match(saved.text, /https:\/\/media-tani\.test\/foto\/lama\.jpg/);
    const detail = await f1.get(`/artikel/${a.slug}`);
    assert.match(detail.text, /https:\/\/media-tani\.test\/foto\/lama\.jpg/);
    assert.match(detail.text, /fetchpriority="high"/, 'gambar utama detail tidak di-lazy-load');
    // Artikel lain dengan og:image yang sama → gambar umum situs, bukan foto berita itu.
    const src = h.db.get("SELECT * FROM news_sources WHERE name = 'Media Tani'");
    mockSites({ 'https://media-tani.test/berita/lain': { body: '<meta property="og:image" content="/foto/lama.jpg">' }, 'https://media-tani.test/foto/lama.jpg': jpg(PHOTO) });
    const r = await images.resolve({ id: 99999, title: 'Lain', source_url: 'https://media-tani.test/berita/lain' }, src);
    assert.equal(r.status, 'ditolak');
    assert.match(r.note, /gambar umum situs/);
  });
});

describe('Foto lahan', () => {
  test('foto asli unggahan petani diutamakan di atas ilustrasi demo dan tidak ditimpa', async () => {
    const f1 = await h.agentFor(...h.FARMER1);
    const blokA = h.db.get("SELECT * FROM lands WHERE name = 'Sawah Blok A (Demo)'");
    assert.equal(blokA.illustration_path, '/static/img/lahan-demo/blok-a.webp');
    await f1.post(`/lahan/${blokA.id}`).field('_csrf', f1.csrf).field('name', blokA.name).field('commodity', 'Padi')
      .attach('photo', h.demoPng(1200, 700), { filename: 'asli.png', contentType: 'image/png' });
    const after = h.db.get('SELECT * FROM lands WHERE id = ?', blokA.id);
    assert.ok(after.photo_path);
    assert.equal(after.illustration_path, '/static/img/lahan-demo/blok-a.webp', 'ilustrasi tetap tersimpan, hanya tidak ditampilkan');
    const page = await f1.get('/lahan');
    const card = page.text.slice(page.text.indexOf(`/lahan/${blokA.id}"`) - 400, page.text.indexOf('Sawah Blok A (Demo)</a>'));
    assert.match(card, new RegExp(`/media/${after.photo_path.replace('.', '\\.')}`));
    assert.doesNotMatch(card, /blok-a\.webp/);
    assert.doesNotMatch(card, /Foto ilustrasi/);
  });
});
