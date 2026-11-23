'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { test, before, describe } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const crop = require('../src/lib/crop');

let f1, f2;
before(async () => {
  await h.setup();
  f1 = await h.agentFor(...h.FARMER1);
  f2 = await h.agentFor(...h.FARMER2);
});
const uid = async (phone) => (await h.db.get('SELECT id FROM users WHERE phone = ?', phone)).id;

describe('Tahap 1 — perhitungan terpusat', () => {
  test('total luas 0,50 + 0,35 = 0,85 ha, sama di Dashboard, Lahan Saya, dan Profil', async () => {
    assert.equal(crop.areaSummary([{ area_ha: 0.5 }, { area_ha: 0.35 }]).totalLabel, '0,85 ha');
    const s = crop.areaSummary([{ area_ha: 0.1 }, { area_ha: null }]);
    assert.deepEqual([s.total, s.missing, s.withArea], [0.1, 1, 1], 'luas kosong dibedakan dari nol');
    assert.equal(crop.fmtHa(0), '0,00 ha');
    const dash = await f1.get('/dashboard');
    assert.match(dash.text, /<span class="big-num">0,85<\/span>/);
    const lahan = await f1.get('/lahan');
    assert.match(lahan.text, /<span class="land-strip-num">0,85 ha<\/span>/);
    const prof = await f1.get('/profil');
    assert.match(prof.text, /<dt>Total luas<\/dt><dd>0,85 ha/);
  });

  test('HST: tanggal tanam = 0, zona Asia/Jakarta, tanggal mendatang = jadwal, kosong = belum diisi, fase hanya untuk padi', () => {
    assert.equal(crop.todayISO(new Date('2026-11-19T17:30:00Z')), '2026-11-20', '00.30 WIB sudah hari berikutnya');
    assert.equal(crop.cropAge({ planting_date: '2026-11-20' }, '2026-11-20').days, 0);
    assert.equal(crop.cropAge({ planting_date: '2026-12-01' }, '2026-11-20').status, 'scheduled');
    assert.equal(crop.cropAge({}, '2026-11-20').label, 'Tanggal tanam belum diisi');
    const padi = crop.cropAge({ planting_date: '2026-10-16', commodity: 'Padi' }, '2026-11-20');
    assert.deepEqual([padi.days, padi.phase, padi.phaseEstimated], [35, 'Vegetatif', true]);
    const bawang = crop.cropAge({ planting_date: '2026-10-16', commodity: 'Bawang merah' }, '2026-11-20');
    assert.equal(bawang.phase, null, 'fase padi tidak diterapkan ke tanaman lain');
    assert.equal(crop.phaseAgeLabel(crop.cropAge({ planting_date: '2026-10-16', season_status: 'Vegetatif' }, '2026-11-20')), 'Vegetatif (35 HST)');
  });

  test('HST konsisten di Lahan Saya, Dashboard, dan scanner', async () => {
    const land = await h.db.get("SELECT * FROM lands WHERE name = 'Sawah Blok A (Demo)'");
    const days = crop.cropAge(land).days;
    assert.match((await f1.get('/lahan')).text, new RegExp(`\\(${days} HST\\)`));
    assert.match((await f1.get(`/dashboard?kalender=${land.id}`)).text, new RegExp(`<span class="cal-today-hst">${days} HST`));
    assert.match((await f1.get('/scan')).text, new RegExp(`value="${land.id}" data-hst="${days}"`));
  });

  test('sesi chat kosong diarsipkan; sesi dengan konteks scan tidak; riwayat menyaring arsip', async () => {
    const id = await uid('081200000002');
    const empty = (await h.db.run("INSERT INTO chat_sessions (user_id, title) VALUES (?, 'Percakapan baru')", id)).lastInsertRowid;
    const scanOnly = (await h.db.run("INSERT INTO chat_sessions (user_id, title) VALUES (?, 'Scan tanpa pesan')", id)).lastInsertRowid;
    await h.db.run("INSERT INTO pest_scans (user_id, idempotency_key, image_path, image_mime, image_bytes, chat_session_id) VALUES (?, 'k-arsip-1', 'x/scan-a.jpg', 'image/jpeg', 1, ?)", id, scanOnly);
    // Jalankan pernyataan pengarsipan dari migrasi 007 apa adanya.
    const sql = fs.readFileSync(path.join(__dirname, '../src/db/migrations/007_revisi_navbar_kalender.sql'), 'utf8');
    const stmt = /UPDATE chat_sessions SET archived_at[\s\S]*?;/.exec(sql)[0];
    await h.db.run(stmt);
    assert.ok((await h.db.get('SELECT archived_at FROM chat_sessions WHERE id = ?', empty)).archived_at);
    assert.equal((await h.db.get('SELECT archived_at FROM chat_sessions WHERE id = ?', scanOnly)).archived_at, null, 'sesi dengan scan tidak dihapus/diarsipkan');
    const hist = await f2.get('/asisten/riwayat');
    assert.doesNotMatch(hist.text, new RegExp(`href="/asisten/${empty}"`));
    assert.match(hist.text, new RegExp(`href="/asisten/${scanOnly}"`));
    assert.ok(await h.db.get('SELECT 1 FROM chat_sessions WHERE id = ?', empty), 'tetap tersimpan untuk ditinjau (bukan dihapus)');
  });

  test('hanya berita eksternal: headline = terbaru, pagination 7 lalu 9 tanpa duplikasi; internal tidak tampil, topik sama dari sumber eksternal tetap tampil', async () => {
    const cat = await h.db.get("SELECT id, slug FROM article_categories WHERE slug = 'teknologi-pertanian'");
    const other = await h.db.get("SELECT id, slug FROM article_categories WHERE slug = 'budidaya-padi'");
    for (let i = 0; i < 30; i++) {
      await h.db.run(`INSERT INTO articles (slug, title, status, origin, category_id, published_at, external_guid, source_name, source_url) VALUES (?, ?, 'published', 'external', ?, ?, ?, 'Uji', ?)`,
        `uji-hal-${i}`, `Berita uji halaman ${i}`, cat.id, new Date(Date.UTC(2026, 9, 1 + i)).toISOString(), `url:uji-${i}`, `https://uji.test/berita-${i}`);
    }
    // Materi internal lama (pernah disematkan) dan berita eksternal dengan topik yang sama.
    await h.db.run(`INSERT INTO articles (slug, title, status, origin, category_id, published_at, is_pinned, pin_order, body_md, body_html) VALUES ('materi-pin', 'Materi Penggerek Batang internal', 'published', 'internal', ?, '2026-12-01T00:00:00Z', 1, 1, 'x', '<p>x</p>')`, other.id);
    await h.db.run(`INSERT INTO articles (slug, title, status, origin, category_id, published_at, external_guid, source_name, source_url) VALUES ('ext-penggerek', 'Petani waspadai penggerek batang dan blas', 'published', 'external', ?, '2026-10-30T00:00:00Z', 'url:ext-pb', 'Uji', 'https://uji.test/penggerek')`, other.id);
    const seen = new Set();
    const titles = (html) => [...html.matchAll(/<h3><a href="\/artikel\/([^"]+)"/g)].map((m) => m[1]);
    const r1 = await f1.get(`/artikel?kategori=${cat.slug}`);
    const p1 = titles(r1.text);
    assert.equal(p1.length, 13, '1 headline + 12 kartu');
    assert.equal(p1[0], 'uji-hal-29', 'headline = berita eksternal terbaru');
    assert.match(r1.text, /30 berita/);
    const p2 = titles((await f1.get(`/artikel?kategori=${cat.slug}&hal=2`)).text);
    assert.equal(p2.length, 12);
    const p3 = titles((await f1.get(`/artikel?kategori=${cat.slug}&hal=3`)).text);
    assert.equal(p3.length, 5);
    [...p1, ...p2, ...p3].forEach((s) => { assert.ok(!seen.has(s), 'duplikat ' + s); seen.add(s); });
    const over = await f1.get(`/artikel?kategori=${cat.slug}&hal=9`);
    assert.equal(over.status, 302, 'halaman melewati batas tidak kosong');
    assert.match(over.headers.location, /hal=3/);
    const all = await f1.get('/artikel');
    assert.ok(!titles(all.text).includes('materi-pin'), 'internal tidak tampil walau dulu disematkan');
    assert.doesNotMatch(all.text, /Disematkan|Artikel Sahabat Tani|tim Sahabat Tani/);
    const cari = await f1.get('/artikel?q=penggerek');
    assert.ok(titles(cari.text).includes('ext-penggerek'), 'berita eksternal topik penggerek batang tetap tampil');
    assert.ok(!titles(cari.text).includes('materi-pin'));
    const old = await f1.get('/artikel?jenis=artikel&kategori=' + other.slug);
    assert.equal(old.status, 301);
    assert.equal(old.headers.location, '/artikel?kategori=' + other.slug, 'filter lama diarahkan tanpa error');
  });
});

describe('Tahap 2–3 — navbar, publik, Masuk/Daftar', () => {
  test('navbar petani: empat menu, dropdown, pencocokan rute spesifik, akun dari data', async () => {
    const page = await f1.get('/lahan/peta');
    assert.match(page.text, /class="pill-nav"/);
    assert.doesNotMatch(page.text, /class="sidebar"|class="bottomnav"/);
    for (const label of ['Dashboard', 'Lahan &amp; Lingkungan', 'Asisten AI', 'Edukasi']) assert.match(page.text, new RegExp(`class="pill-link[^"]*"[^>]*>(<span class="pill-label">)?${label}`));
    assert.match(page.text, /<a class="dd-link is-active" href="\/lahan\/peta"/);
    assert.match(page.text, /<a class="dd-link" href="\/lahan"/, 'Lahan Saya tidak ikut aktif di Peta Lahan');
    assert.doesNotMatch(page.text, /href="\/scan\/riwayat"[^>]*class="pill-link/, 'Riwayat Scan bukan menu navbar');
    assert.match(page.text, /<div class="dd-head"><strong>Pak Sarno<\/strong>/);
    assert.match(page.text, /class="btn btn-scan pill-scan/);
    assert.match(page.text, /data-fab/, 'tombol chat mengambang di halaman utama');
    assert.doesNotMatch((await f1.get('/asisten')).text, /data-fab/, 'tidak di chatroom');
    assert.doesNotMatch((await f1.get('/scan')).text, /data-fab/, 'tidak di scanner');
  });

  test('navbar publik mengikuti status login; panel fitur & toggle sandi di Masuk/Daftar', async () => {
    const anon = h.request(h.getApp());
    const login = await anon.get('/masuk');
    assert.match(login.text, /class="pill-nav"/);
    assert.match(login.text, /href="\/artikel"[^>]*aria-label="Artikel"/);
    assert.match(login.text, /class="btn btn-sm pill-cta" href="\/daftar"/);
    assert.match(login.text, /Scan Hama AI[\s\S]*Asisten Penyuluhan AI[\s\S]*Peta &amp; Kalender Lahan/);
    assert.match(login.text, /data-pw-toggle aria-controls="f-password"[^>]*aria-label="Tampilkan kata sandi"/);
    const reg = await anon.get('/daftar');
    assert.equal((reg.text.match(/data-pw-toggle/g) || []).length, 2, 'sandi & konfirmasi');
    assert.match((await anon.get('/artikel')).text, /href="\/masuk"/, 'artikel publik terbaca tanpa login');
  });
});

describe('Tahap 4 — Kalender Tanam', () => {
  test('pengingat: tambah, tersimpan setelah muat ulang, ubah, tandai selesai; milik pengguna lain ditolak', async () => {
    const land = await h.db.get("SELECT * FROM lands WHERE name = 'Sawah Blok B (Demo)'");
    const due = crop.addDays(crop.todayISO(), 3);
    const add = await f1.post('/kalender').type('form').send({ _csrf: f1.csrf, land_id: land.id, title: 'Pengamatan wereng', due_date: due, category: 'pengamatan-hama' });
    assert.equal(add.status, 302);
    assert.equal(add.headers.location, `/kalender-tanam?lahan=${land.id}&tanggal=${due}#detail-hari`, 'kembali ke tanggal kegiatan');
    const r = await h.db.get("SELECT * FROM land_reminders WHERE title = 'Pengamatan wereng'");
    assert.equal(r.season_start, land.planting_date, 'tersimpan per musim tanam');
    const page = await f1.get(`/kalender-tanam?lahan=${land.id}&tanggal=${due}`);
    assert.match(page.text, /Pengamatan wereng/);
    assert.match(page.text, /Mendatang/);
    assert.equal((await f1.get('/kalender')).status, 301, 'rute lama diarahkan');
    assert.equal((await f1.get('/kalender-tanam')).status, 200, 'dibuka langsung tanpa konteks');
    await f1.post(`/kalender/${r.id}`).type('form').send({ _csrf: f1.csrf, land_id: land.id, title: 'Pengamatan wereng batang', due_date: r.due_date, category: 'pengamatan-hama' });
    await f1.post(`/kalender/${r.id}/selesai`).type('form').send({ _csrf: f1.csrf });
    const after = await h.db.get('SELECT * FROM land_reminders WHERE id = ?', r.id);
    assert.equal(after.title, 'Pengamatan wereng batang');
    assert.ok(after.done_at);
    assert.equal((await f2.post(`/kalender/${r.id}/selesai`).type('form').send({ _csrf: f2.csrf })).status, 404);
    assert.equal((await f2.post(`/kalender/${r.id}/hapus`).type('form').send({ _csrf: f2.csrf })).status, 404);
    assert.equal((await f2.get(`/kalender-tanam?lahan=${land.id}`)).text.includes('Pengamatan wereng batang'), false, 'lahan orang lain tidak bisa dibuka');
    const missing = await f1.post('/kalender').type('form').send({ _csrf: f1.csrf, land_id: land.id, title: 'Tanpa tanggal', category: 'lainnya' });
    assert.equal(missing.status, 422);
    assert.equal((await h.db.get("SELECT COUNT(*) n FROM land_reminders WHERE title = 'Tanpa tanggal'")).n, 0);
  });

  test('kalender bulanan: Senin–Minggu, hari ini terpilih, navigasi bulan, kategori baru, hapus', async () => {
    const land = await h.db.get("SELECT * FROM lands WHERE name = 'Sawah Blok A (Demo)'");
    const today = crop.todayISO();
    const page = await f1.get(`/kalender-tanam?lahan=${land.id}`);
    assert.equal(page.status, 200);
    assert.match(page.text, /<h1>Kalender Tanam<\/h1>/);
    assert.match(page.text, />Sen<[\s\S]*>Sel<[\s\S]*>Rab<[\s\S]*>Kam<[\s\S]*>Jum<[\s\S]*>Sab<[\s\S]*>Min</);
    assert.match(page.text, new RegExp(`class="cal-cell[^"]*is-today[^"]*is-selected[^"]*"[^>]*href="[^"]*tanggal=${today}`), 'hari ini terpilih otomatis');
    assert.match(page.text, />Hari Ini</);
    assert.match(page.text, /Bulan sebelumnya/);
    assert.match(page.text, new RegExp(`<option value="${land.id}" selected>`), 'lahan terkait terpilih');
    const add = await f1.post('/kalender').type('form').send({ _csrf: f1.csrf, land_id: land.id, title: 'Tanam bibit sulam', due_date: today, category: 'tanam' });
    assert.equal(add.status, 302, 'kategori Tanam diterima');
    const panen = await f1.post('/kalender').type('form').send({ _csrf: f1.csrf, land_id: land.id, title: 'Panen', due_date: crop.addDays(today, 40), category: 'panen' });
    assert.equal(panen.status, 302, 'kategori Panen diterima');
    const id = (await h.db.get("SELECT id FROM land_reminders WHERE title = 'Tanam bibit sulam'")).id;
    const day = await f1.get(`/kalender-tanam?lahan=${land.id}&tanggal=${today}`);
    assert.match(day.text, /Tanam bibit sulam/);
    assert.match(day.text, /data-confirm="Hapus kegiatan/, 'hapus dengan konfirmasi');
    const del = await f1.post(`/kalender/${id}/hapus`).type('form').send({ _csrf: f1.csrf });
    assert.equal(del.status, 302);
    assert.equal(await h.db.get('SELECT 1 FROM land_reminders WHERE id = ?', id), undefined);
    const next = await f1.get(`/kalender-tanam?lahan=${land.id}&bulan=2027-02`);
    assert.match(next.text, /Februari 2027/);
    assert.match(next.text, /is-selected[^"]*"[^>]*tanggal=2027-02-01/, 'bulan lain → tanggal 1 terpilih');
    assert.equal((await f1.get(`/kalender-tanam?lahan=${land.id}&tanggal=bukan-tanggal&bulan=13-99`)).status, 200, 'parameter tidak valid tidak error');
  });

  test('kartu Dashboard: hanya hari ini, satu tautan, sinkron dengan kalender, tanpa kalender sebulan', async () => {
    const land = await h.db.get("SELECT * FROM lands WHERE name = 'Sawah Blok A (Demo)'");
    const today = crop.todayISO();
    const dashUrl = `/dashboard?kalender=${land.id}`;
    let dash = await f1.get(dashUrl);
    assert.match(dash.text, /data-cal-today="(\d{4}-\d{2}-\d{2})"/);
    assert.equal(dash.text.match(/data-cal-today="([^"]+)"/)[1], today, 'tanggal hari ini (Asia/Jakarta), tidak dikunci');
    assert.match(dash.text, new RegExp(`<span class="cal-date-circle" aria-hidden="true">${Number(today.slice(8))}</span>`));
    assert.match(dash.text, new RegExp(`href="/kalender-tanam\\?lahan=${land.id}&amp;tanggal=${today}"`), 'kartu membuka kalender lengkap dengan lahan & tanggal');
    assert.doesNotMatch(dash.text, /class="cal-grid"/, 'Dashboard tidak memuat kalender sebulan');
    assert.match(dash.text, /Belum ada kegiatan hari ini/);
    assert.equal(dash.headers['cache-control'], 'no-store');
    // Tidak ada tautan/tombol bersarang di dalam kartu.
    const card = dash.text.match(/<a class="tile cal-today"[\s\S]*?<\/a>\s*(<form|<\/div>)/)[0];
    assert.equal((card.match(/<a /g) || []).length, 1);
    assert.doesNotMatch(card, /<button|<select/);

    // Tambah 4 kegiatan hari ini + 1 besok → kartu menampilkan 3 + "+1 kegiatan lainnya", besok tidak ikut.
    for (const [t, c] of [['Pupuk susulan pertama di petak utara yang judulnya sangat panjang sekali', 'pemupukan'], ['Cek wereng', 'pengamatan-hama'], ['Bersihkan gulma', 'perawatan'], ['Atur air', 'lainnya']]) {
      await f1.post('/kalender').type('form').send({ _csrf: f1.csrf, land_id: land.id, title: t, due_date: today, category: c });
    }
    await f1.post('/kalender').type('form').send({ _csrf: f1.csrf, land_id: land.id, title: 'Kegiatan besok', due_date: crop.addDays(today, 1), category: 'lainnya' });
    dash = await f1.get(dashUrl);
    assert.equal((dash.text.match(/class="cal-today-item"/g) || []).length, 3);
    assert.match(dash.text, /\+1 kegiatan lainnya/);
    assert.doesNotMatch(dash.text, /Kegiatan besok/, 'kegiatan besok tidak menggantikan hari ini');
    assert.match(dash.text, /badge cat-pemupukan">Pemupukan/);
    // Ubah & selesai di kalender → tampil di kartu.
    const r = await h.db.get("SELECT * FROM land_reminders WHERE title = 'Cek wereng'");
    await f1.post(`/kalender/${r.id}`).type('form').send({ _csrf: f1.csrf, land_id: land.id, title: 'Cek wereng batang cokelat', due_date: today, category: 'pengamatan-hama' });
    await f1.post(`/kalender/${r.id}/selesai`).type('form').send({ _csrf: f1.csrf });
    // Kegiatan yang belum selesai didahulukan; yang selesai turun ke urutan akhir.
    const gulma = await h.db.get("SELECT id FROM land_reminders WHERE title = 'Bersihkan gulma'");
    await f1.post(`/kalender/${gulma.id}/hapus`).type('form').send({ _csrf: f1.csrf });
    dash = await f1.get(dashUrl);
    assert.doesNotMatch(dash.text, /Bersihkan gulma/, 'hapus di kalender → hilang dari kartu');
    assert.doesNotMatch(dash.text, /kegiatan lainnya/);
    assert.match(dash.text, /Atur air[\s\S]*?<li class="is-done">[\s\S]*?Cek wereng batang cokelat/, 'selesai ditandai & diurutkan terakhir');
    // Hapus semua kegiatan hari ini → kembali ke keadaan kosong.
    for (const x of await h.db.all('SELECT id FROM land_reminders WHERE land_id = ? AND due_date = ?', land.id, today)) {
      await f1.post(`/kalender/${x.id}/hapus`).type('form').send({ _csrf: f1.csrf });
    }
    assert.match((await f1.get(dashUrl)).text, /Belum ada kegiatan hari ini/);
    // Navigasi bolak-balik tidak membuat kegiatan baru.
    const before = (await h.db.get('SELECT COUNT(*) n FROM land_reminders')).n;
    await f1.get(`/kalender-tanam?lahan=${land.id}`); await f1.get(dashUrl); await f1.get(`/kalender-tanam?lahan=${land.id}`);
    assert.equal((await h.db.get('SELECT COUNT(*) n FROM land_reminders')).n, before);
  });

  test('kartu & kalender tanpa lahan: tanggal tetap tampil, arah ke Tambahkan Lahan', async () => {
    const agent = h.request.agent(h.getApp());
    const csrf = h.csrfFrom((await agent.get('/daftar')).text);
    const reg = await agent.post('/daftar').type('form').send({ _csrf: csrf, full_name: 'Petani Tanpa Lahan', phone: '081277770001', password: 'rahasia123', password_confirm: 'rahasia123' });
    assert.equal(reg.status, 302);
    const dash = await agent.get('/dashboard');
    assert.equal(dash.status, 200);
    assert.match(dash.text, /Tambahkan lahan untuk mengatur kegiatan tanam\./);
    assert.match(dash.text, new RegExp('href="/kalender-tanam\\?tanggal=' + crop.todayISO() + '"'));
    const cal = await agent.get('/kalender-tanam');
    assert.equal(cal.status, 200);
    assert.match(cal.text, /href="\/lahan\/baru"/);
    assert.match(cal.text, /Tambahkan Lahan/);
  });
});

describe('Tahap 5–6 — scanner, udara, profil', () => {
  test('scanner: tombol analisis nonaktif, panduan, quick-tags, 3 scan terakhir; HST tersimpan sebagai snapshot', async () => {
    const page = await f1.get('/scan');
    assert.match(page.text, /data-action="analyze" disabled aria-disabled="true"/);
    assert.match(page.text, /pucuk batang yang mengering atau bercak belah ketupat/);
    assert.match(page.text, /\+ Pucuk mengering \(Sundep\)[\s\S]*\+ Malai hampa\/putih \(Beluk\)[\s\S]*\+ Bercak belah ketupat \(Blas\)/);
    assert.match(page.text, /bukan diagnosis/);
    assert.match(page.text, /Lihat Semua Riwayat/);
    const res = await f1.post('/scan').set('Accept', 'application/json').set('X-CSRF-Token', f1.csrf)
      .field('_csrf', f1.csrf).field('idempotency_key', 'snap-hst-1').field('plant_age_days', '40').field('plant_age_source', 'tanggal-tanam')
      .attach('photo', h.demoPng(640, 640), { filename: 'daun.png', contentType: 'image/png' });
    assert.equal(res.status, 200);
    const s = await h.db.get("SELECT plant_age_days, plant_age_source FROM pest_scans WHERE idempotency_key = 'snap-hst-1'");
    assert.deepEqual([s.plant_age_days, s.plant_age_source], [40, 'tanggal-tanam']);
  });

  test('kualitas udara: anjuran kegiatan berbasis US AQI (AirNow), label waktu terakhir tidak terpotong', async () => {
    const page = await f1.get('/udara');
    if (/Anjuran kegiatan di luar ruang/.test(page.text)) {
      assert.match(page.text, /airnow\.gov/);
      assert.match(page.text, /N95\/KN95/);
    }
    if (/svg class="chart"/.test(page.text)) assert.match(page.text, /text-anchor="end" class="chart-label"/);
  });

  test('profil: tanpa “(Akun Demo)” di judul, satu badge demo, ringkasan aktivitas, unggah foto kembali ke Profil', async () => {
    const page = await f1.get('/profil');
    assert.match(page.text, /<h1>Pak Sarno<\/h1>/);
    assert.equal((page.text.match(/badge badge-demo">Akun Demo/g) || []).length >= 1, true);
    assert.match(page.text, /Ringkasan Aktivitas/);
    assert.match(page.text, /Unggah Foto Profil/);
    const up = await f1.post('/profil/foto').field('_csrf', f1.csrf).field('back', '/profil').attach('photo', h.demoPng(200, 200), { filename: 'p.png', contentType: 'image/png' });
    assert.equal(up.headers.location, '/profil');
    assert.match((await f1.get('/profil')).text, /Ubah Foto Profil/);
  });
});

describe('Footer baru & halaman informasi', () => {
  const OLD = /Hasil AI adalah bantuan awal — konsultasikan dengan penyuluh pertanian setempat\. Data berlabel/;
  test('footer bersama: tiga kolom, tiga tautan informasi, WhatsApp, tahun dinamis; footer lama hilang; tidak di chatroom', async () => {
    const anon = h.request(h.getApp());
    const year = crop.todayISO().slice(0, 4);
    for (const [agent, url] of [[anon, '/masuk'], [anon, '/artikel'], [f1, '/dashboard'], [f1, '/artikel-tersimpan'], [f1, '/lahan']]) {
      const page = await agent.get(url);
      assert.doesNotMatch(page.text, OLD, 'kalimat footer lama tidak muncul di ' + url);
      assert.doesNotMatch(page.text, /class="footer"|class="footer-in"/);
      assert.match(page.text, /<footer class="site-footer/);
      const info = page.text.match(/<ul class="sf-links" role="list">([\s\S]*?)<\/ul>/)[1];
      assert.deepEqual([...info.matchAll(/href="([^"]+)"/g)].map((m) => m[1]), ['/tentang', '/kebijakan-privasi', '/syarat-ketentuan']);
      assert.match(page.text, /href="https:\/\/wa\.me\/6282122873273" target="_blank"/);
      assert.match(page.text, /<strong>082122873273<\/strong>/);
      assert.match(page.text, new RegExp(`© ${year} Sahabat Tani\. Hak cipta dilindungi\.`));
      assert.match(page.text, /Teman petani untuk mengelola lahan, mengenali gejala hama, dan mengakses informasi pertanian\./);
    }
    assert.doesNotMatch((await f1.get('/asisten')).text, /site-footer/, 'chatroom tidak memakai footer global');
  });

  test('halaman Tentang, Kebijakan Privasi, Syarat & Ketentuan dapat dibuka (publik & masuk)', async () => {
    const anon = h.request(h.getApp());
    for (const url of ['/tentang', '/kebijakan-privasi', '/syarat-ketentuan']) {
      const a = await anon.get(url);
      assert.equal(a.status, 200, url);
      assert.match(a.text, /pill-cta" href="\/daftar"/, 'navbar publik');
      const b = await f1.get(url);
      assert.equal(b.status, 200);
      assert.match(b.text, /data-nav-toggle/, 'navbar aplikasi saat masuk');
      assert.match(b.text, /wa\.me\/6282122873273/);
    }
    assert.match((await anon.get('/kebijakan-privasi')).text, /Informasi sedang disiapkan/);
  });

  test('artikel internal yang sudah tersimpan ditandai tidak tersedia dan dapat dihapus dari simpanan', async () => {
    const uid = (await h.db.get("SELECT id FROM users WHERE phone = ?", h.FARMER1[0])).id;
    const internal = await h.db.get("SELECT id, title FROM articles WHERE origin = 'internal' AND status = 'published' LIMIT 1");
    const ext = await h.db.get("SELECT id, title FROM articles WHERE origin = 'external' AND status = 'published' AND source_url IS NOT NULL LIMIT 1");
    await h.db.run('INSERT OR IGNORE INTO saved_articles (user_id, article_id) VALUES (?, ?)', uid, internal.id);
    if (ext) await h.db.run('INSERT OR IGNORE INTO saved_articles (user_id, article_id) VALUES (?, ?)', uid, ext.id);
    const page = await f1.get('/artikel-tersimpan');
    assert.match(page.text, /Tidak lagi tersedia/);
    assert.match(page.text, /Hapus dari simpanan/);
    const rm = await f1.post(`/artikel/${internal.id}/simpan`).type('form').send({ _csrf: f1.csrf, back: '/artikel-tersimpan' });
    assert.equal(rm.status, 302);
    assert.equal(await h.db.get('SELECT 1 FROM saved_articles WHERE user_id = ? AND article_id = ?', uid, internal.id), undefined);
    if (ext) assert.ok(await h.db.get('SELECT 1 FROM saved_articles WHERE user_id = ? AND article_id = ?', uid, ext.id), 'simpanan berita eksternal tetap');
    assert.ok(await h.db.get('SELECT 1 FROM articles WHERE id = ?', internal.id), 'artikel tidak dihapus');
  });
});
