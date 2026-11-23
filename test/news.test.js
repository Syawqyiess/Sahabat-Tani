'use strict';
const { test, before, afterEach, describe } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const news = require('../src/services/news');
const robots = require('../src/services/news/robots');
const fetcher = require('../src/services/news/fetcher');
const ex = require('../src/services/news/extract');
const { classify, isRelevant } = require('../src/services/news/classify');

// Situs tiruan: { url: { status, type, body } } — tidak ada permintaan ke internet.
const realFetch = global.fetch;
let sites = {};
let requested = [];
function mockSites(map) {
  sites = map;
  requested = [];
  global.fetch = async (url) => {
    const u = String(url);
    if (!/^https:\/\/(contoh-tani|media-tani|kantor-berita)\.test/.test(u)) return realFetch(url);
    requested.push(u);
    const s = sites[u];
    if (!s) return new Response('tidak ada', { status: 404, headers: { 'content-type': 'text/html' } });
    return new Response(s.body, { status: s.status || 200, headers: { 'content-type': s.type || 'text/html; charset=utf-8' } });
  };
}

const LIST = `<html><head><title>Berita</title></head><body>
  <div class="topbar">Sunday, 15 November 2026</div>
  <ul>
    <li><a href="/berita/pompa-air-untuk-sawah-kering"><img src="x.jpg"></a>
        <div class="info"><a href="/berita/pompa-air-untuk-sawah-kering">Pompa Air untuk Sawah Kering</a><span class="post-date">20 Okt 2026</span></div></li>
    <li><div class="info"><a href="/berita/serangan-wereng-di-karawang?utm_source=x">Serangan Wereng di Karawang</a><span class="post-date">18 Okt 2026</span></div></li>
    <li><div class="info"><a href="/berita/pupuk-organik-tanpa-tanggal">Pupuk Organik Tanpa Tanggal</a></div></li>
    <li><a href="/tentang">Tentang kami</a></li>
  </ul></body></html>`;

const article = (title, desc, meta = '', body = '') => `<html><head><title>${title}</title>
  <meta property="og:title" content="${title}"><meta name="description" content="${desc}">${meta}</head>
  <body><div class="topbar">Sunday, 15 November 2026</div><h1>${title}</h1>${body}<p>Isi lengkap artikel yang TIDAK boleh disalin.</p></body></html>`;

const HTML_CFG = {
  link_pattern: '^https://contoh-tani\\.test/berita/[a-z0-9-]{8,}',
  list_item: 'div.info', list_date: 'span.post-date',
  article: { title: ['meta[property="og:title"]'], summary: ['meta[name="description"]'], date: ['meta[property="article:published_time"]', 'div.date_detail'] },
};

function htmlSite(extra = {}) {
  return {
    'https://contoh-tani.test/robots.txt': { type: 'text/plain', body: 'User-agent: *\nDisallow: /admin\n' },
    'https://contoh-tani.test/berita': { body: LIST },
    'https://contoh-tani.test/berita/pompa-air-untuk-sawah-kering': { body: article('Pompa Air untuk Sawah Kering', 'Kementan menyalurkan pompa air untuk irigasi sawah saat kemarau.', '<meta property="article:published_time" content="2026-10-20T09:30:00+07:00">') },
    'https://contoh-tani.test/berita/serangan-wereng-di-karawang?utm_source=x': { body: article('Serangan Wereng di Karawang', 'Petani diminta mengamati pangkal batang padi.') },
    'https://contoh-tani.test/berita/pupuk-organik-tanpa-tanggal': { body: article('Pupuk Organik Tanpa Tanggal', 'Pemupukan berimbang dengan pupuk organik.') },
    ...extra,
  };
}

async function addSource(fields) {
  const r = await h.db.run(
    `INSERT INTO news_sources (name, feed_url, homepage_url, usage_note, kind, config_json, filter_keywords, max_items, is_active)
     VALUES (?, ?, ?, 'uji', ?, ?, ?, ?, 1)`,
    fields.name, fields.feed_url, fields.homepage_url || null, fields.kind, fields.config_json || null, fields.filter_keywords || 0, fields.max_items || 10,
  );
  return await h.db.get('SELECT * FROM news_sources WHERE id = ?', r.lastInsertRowid);
}

before(async () => { await h.setup(); });
afterEach(() => { global.fetch = realFetch; robots._reset(); fetcher._reset(); });

describe('Ekstraksi & robots.txt', () => {
  test('tanggal: format Indonesia, ISO, dan menolak tanggal yang tidak meyakinkan', () => {
    assert.equal(ex.parseDate('08 Nov 2026, 20:14 WIB').toISOString(), '2026-11-08T13:14:00.000Z');
    assert.equal(ex.parseDate('20 Okt 2026').toISOString(), '2026-10-19T17:00:00.000Z'); // 20 Okt 00:00 WIB
    assert.equal(ex.parseDate('2026-07-26T19:49:23+07:00').toISOString(), '2026-07-26T12:49:23.000Z');
    assert.equal(ex.parseDate('Sat, 14 Nov 2026 10:00:00 +0700').toISOString(), '2026-11-14T03:00:00.000Z');
    assert.equal(ex.parseDate('kemarin sore'), null);
    assert.equal(ex.parseDate('12 Jan 2031'), null, 'tanggal masa depan ditolak');
    assert.equal(ex.parseDate(''), null);
  });

  test('kunci URL menyatukan tautan yang sama (garis miring ganda, utm, fragmen)', () => {
    assert.equal(ex.urlKey('https://www.a.test/detail//indeks/x/1-a?utm_source=fb#atas'), ex.urlKey('https://a.test/detail/indeks/x/1-a/'));
  });

  test('robots.txt: grup paling cocok, aturan terpanjang, wildcard', () => {
    const g = robots.parse('User-agent: *\nDisallow: /\n\nUser-agent: SahabatTaniBot\nDisallow: /privat\nAllow: /privat/berita\nDisallow: /*.pdf$');
    assert.equal(robots.allowedBy(g, '/berita/a'), true);
    assert.equal(robots.allowedBy(g, '/privat/x'), false);
    assert.equal(robots.allowedBy(g, '/privat/berita/a'), true);
    assert.equal(robots.allowedBy(g, '/file.pdf'), false);
    assert.equal(robots.allowedBy(robots.parse('User-agent: *\nDisallow:'), '/apa-saja'), true);
  });

  test('relevansi & subkategori', () => {
    assert.equal(isRelevant('Cara mencairkan BSU lewat rekening bank', ''), false);
    assert.equal(isRelevant('Harga gabah naik di tingkat petani', ''), true);
    assert.equal(classify('Kementan siapkan pompa air atasi kekeringan', ''), 'irigasi-dan-pengelolaan-air');
    assert.equal(classify('Percepat pengembangan kedelai di Grobogan', 'Kedelai setelah padi.'), 'berita-pertanian-umum');
  });
});

describe('Pengambilan dari sumber', () => {
  test('HTML: hanya metadata, tanggal asli (bukan tanggal header), tanpa tanggal tetap kosong, tanpa duplikat', async () => {
    mockSites(htmlSite());
    const src = await addSource({ name: 'Contoh Tani', feed_url: 'https://contoh-tani.test/berita', kind: 'html', config_json: JSON.stringify(HTML_CFG) });
    const r = await news.fetchSource(src);
    assert.equal(r.error, null);
    assert.equal(r.added, 3);
    const rows = await h.db.all('SELECT * FROM articles WHERE source_id = ? ORDER BY id', src.id);
    const pompa = rows.find((a) => a.title === 'Pompa Air untuk Sawah Kering');
    assert.equal(pompa.published_at, '2026-10-20T02:30:00.000Z');
    assert.equal(pompa.date_source, 'artikel');
    assert.equal(pompa.body_md, null, 'isi artikel tidak disalin');
    assert.equal(pompa.origin, 'external');
    assert.equal(pompa.source_url, 'https://contoh-tani.test/berita/pompa-air-untuk-sawah-kering');
    const wereng = rows.find((a) => a.title === 'Serangan Wereng di Karawang');
    assert.equal(wereng.published_at, '2026-10-17T17:00:00.000Z', 'tanggal dari daftar berita, bukan "15 November" di header');
    assert.equal(wereng.date_source, 'daftar berita');
    const tanpa = rows.find((a) => a.title === 'Pupuk Organik Tanpa Tanggal');
    assert.equal(tanpa.published_at, null, 'tanggal tidak dikarang');
    const slug = async (id) => (await h.db.get('SELECT c.slug FROM articles a JOIN article_categories c ON c.id = a.category_id WHERE a.id = ?', id)).slug;
    assert.equal(await slug(pompa.id), 'irigasi-dan-pengelolaan-air');
    assert.equal(await slug(wereng.id), 'hama-dan-penyakit-tanaman');
    assert.ok(!requested.some((u) => u.includes('/tentang')), 'tautan non-berita tidak dibuka');

    // Pengambilan kedua: tidak ada duplikat, dan artikel yang sudah ada tidak dibuka lagi.
    mockSites(htmlSite());
    const r2 = await news.fetchSource(await h.db.get('SELECT * FROM news_sources WHERE id = ?', src.id));
    assert.equal(r2.added, 0);
    assert.equal(requested.filter((u) => u.includes('/berita/')).length, 0);
    const s = await h.db.get('SELECT * FROM news_sources WHERE id = ?', src.id);
    assert.ok(s.last_ok_at && s.robots_status);
  });

  test('robots.txt melarang: tidak ada yang diambil', async () => {
    mockSites(htmlSite({ 'https://contoh-tani.test/robots.txt': { type: 'text/plain', body: 'User-agent: *\nDisallow: /berita' } }));
    const src = await addSource({ name: 'Dilarang', feed_url: 'https://contoh-tani.test/berita?sumber=2', kind: 'html', config_json: JSON.stringify(HTML_CFG) });
    const r = await news.fetchSource(src);
    assert.match(r.error, /diblokir robots\.txt/);
    assert.equal(r.added, 0);
    assert.deepEqual(requested, ['https://contoh-tani.test/robots.txt'], 'halaman berita tidak dibuka sama sekali');
  });

  test('akses dibatasi (403) atau halaman CAPTCHA: berhenti, tidak diakali', async () => {
    mockSites(htmlSite({ 'https://contoh-tani.test/berita?sumber=3': { status: 403, body: 'Forbidden' } }));
    let src = await addSource({ name: 'Terkunci', feed_url: 'https://contoh-tani.test/berita?sumber=3', kind: 'html', config_json: JSON.stringify(HTML_CFG) });
    let r = await news.fetchSource(src);
    assert.match(r.error, /akses dibatasi/);
    robots._reset();
    mockSites(htmlSite({ 'https://contoh-tani.test/berita?sumber=4': { body: '<html><head><title>Just a moment...</title></head><body>cek</body></html>' } }));
    src = await addSource({ name: 'Captcha', feed_url: 'https://contoh-tani.test/berita?sumber=4', kind: 'html', config_json: JSON.stringify(HTML_CFG) });
    r = await news.fetchSource(src);
    assert.match(r.error, /halaman verifikasi/);
    assert.equal(r.added, 0);
  });

  test('RSS kanal umum: disaring kata kunci, duplikat lintas sumber dibuang, mode uji tidak menyimpan', async () => {
    const rss = `<?xml version="1.0"?><rss version="2.0"><channel><title>Ekonomi</title>
      <item><title>Harga gabah di tingkat petani naik</title><link>https://kantor-berita.test/a/1</link><pubDate>Fri, 13 Nov 2026 08:00:00 +0700</pubDate><description>Panen raya di Jawa.</description></item>
      <item><title>Cara mencairkan BSU lewat bank</title><link>https://kantor-berita.test/a/2</link><pubDate>Fri, 13 Nov 2026 09:00:00 +0700</pubDate></item>
      <item><title>Serangan Wereng di Karawang</title><link>https://kantor-berita.test/a/3</link><pubDate>Fri, 13 Nov 2026 10:00:00 +0700</pubDate></item>
    </channel></rss>`;
    mockSites({
      'https://kantor-berita.test/robots.txt': { type: 'text/plain', body: 'User-agent: *\nAllow: /' },
      'https://kantor-berita.test/rss.xml': { type: 'application/rss+xml', body: rss },
    });
    const src = await addSource({ name: 'Kantor Berita', feed_url: 'https://kantor-berita.test/rss.xml', kind: 'rss', filter_keywords: 1 });
    const before = (await h.db.get('SELECT COUNT(*) n FROM articles')).n;
    const dry = await news.fetchSource(src, { dryRun: true });
    assert.equal((await h.db.get('SELECT COUNT(*) n FROM articles')).n, before, 'mode uji tidak menyimpan');
    assert.deepEqual(dry.items.map((i) => i.title), ['Harga gabah di tingkat petani naik']);
    const reasons = dry.skipped.map((s) => s.reason).sort();
    assert.deepEqual(reasons, ['bukan topik pertanian', 'duplikat (judul sama dari sumber lain)']);
    mockSites(sites);
    const r = await news.fetchSource(src);
    assert.equal(r.added, 1);
    const a = await h.db.get("SELECT * FROM articles WHERE title = 'Harga gabah di tingkat petani naik'");
    assert.equal(a.published_at, '2026-11-13T01:00:00.000Z');
    assert.equal(a.date_source, 'rss');
  });
});

describe('Kanal Berita & Artikel Pertanian', () => {
  test('berita nyata tampil urut tanggal sumber, tanpa tanggal di akhir, konten demo tidak mengisi daftar', async () => {
    const f1 = await h.agentFor(...h.FARMER1);
    const page = await f1.get('/artikel');
    assert.equal(page.status, 200);
    const order = ['Harga gabah di tingkat petani naik', 'Pompa Air untuk Sawah Kering', 'Serangan Wereng di Karawang', 'Pupuk Organik Tanpa Tanggal']
      .map((t) => page.text.indexOf(t));
    assert.ok(order.every((i) => i > 0), 'semua berita tampil');
    assert.deepEqual([...order].sort((a, b) => a - b), order, 'urut tanggal terbit sumber, tanpa tanggal paling akhir');
    assert.match(page.text, /Tanggal tidak tersedia/);
    assert.doesNotMatch(page.text, /badge-demo">Konten Demo/);
    assert.doesNotMatch(page.text, /Artikel Sahabat Tani/, 'tab artikel internal sudah dihapus');
    assert.match(page.text, /Berita dan artikel pertanian dari berbagai sumber tepercaya\./);
    const demo = await h.db.get("SELECT slug FROM articles WHERE origin = 'internal' AND status = 'published' LIMIT 1");
    assert.doesNotMatch(page.text, new RegExp('/artikel/' + demo.slug + '"'), 'artikel internal tidak tampil');
    assert.ok(await h.db.get("SELECT 1 FROM articles WHERE slug = ?", demo.slug), 'artikel internal tidak dihapus dari database');
    const irigasi = await f1.get('/artikel?kategori=irigasi-dan-pengelolaan-air');
    assert.match(irigasi.text, /Pompa Air untuk Sawah Kering/);
    assert.doesNotMatch(irigasi.text, /Serangan Wereng di Karawang/);
  });

  test('admin: uji sumber, aktif/nonaktif, dan validasi konfigurasi', async () => {
    const admin = await h.agentFor(...h.ADMIN);
    mockSites(htmlSite());
    const src = await h.db.get("SELECT * FROM news_sources WHERE name = 'Contoh Tani'");
    const uji = await admin.post(`/admin/sumber-berita/${src.id}/uji`).type('form').send({ _csrf: admin.csrf });
    assert.equal(uji.status, 200);
    assert.match(uji.text, /duplikat/, 'pratinjau menjelaskan alasan dilewati');
    await admin.post(`/admin/sumber-berita/${src.id}/status`).type('form').send({ _csrf: admin.csrf });
    assert.equal((await h.db.get('SELECT is_active FROM news_sources WHERE id = ?', src.id)).is_active, 0);
    const bad = await admin.post('/admin/sumber-berita').type('form').send({ _csrf: admin.csrf, name: 'X', kind: 'html', feed_url: 'https://contoh-tani.test/x', usage_note: 'uji', config_json: '{"link_pattern": "(" }' });
    assert.equal(bad.status, 422);
    assert.match(bad.text, /Konfigurasi HTML tidak valid/);
    const page = await admin.get('/admin/sumber-berita');
    assert.match(page.text, /Ditjen Prasarana dan Sarana Pertanian/, 'sumber nyata yang terverifikasi tersedia');
  });
});
