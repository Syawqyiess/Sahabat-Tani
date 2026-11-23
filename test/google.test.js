'use strict';
// Uji Masuk/Daftar dengan Google. Server Google digantikan klien uji: penukaran kode (getToken) dan
// kunci publik Google (getFederatedSignonCertsAsync) diganti, tetapi VERIFIKASI ID token tetap memakai
// kode asli google-auth-library (signature RS256, issuer, audience, masa berlaku) + pemeriksaan nonce aplikasi.
// Ini bukan uji dengan akun Google nyata.
const crypto = require('node:crypto');
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { OAuth2Client } = require('google-auth-library');
const h = require('./helpers');
const config = require('../src/config');
const google = require('../src/services/google-auth');

const CLIENT_ID = 'uji-123.apps.googleusercontent.com';
const KID = 'kunci-uji-1';
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const PUB_PEM = publicKey.export({ type: 'spki', format: 'pem' });

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function makeIdToken(claims, { key = privateKey, kid = KID } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const payload = { iss: 'https://accounts.google.com', aud: CLIENT_ID, iat: now, exp: now + 3600, email_verified: true, ...claims };
  const head = b64({ alg: 'RS256', typ: 'JWT', kid });
  const body = b64(payload);
  const sig = crypto.sign('RSA-SHA256', Buffer.from(`${head}.${body}`), key).toString('base64url');
  return `${head}.${body}.${sig}`;
}

let nextToken = null;
let nextError = null;
let lastVerifier = null;
class TestClient extends OAuth2Client {
  async getFederatedSignonCertsAsync() { return { certs: { [KID]: PUB_PEM }, format: 'PEM' }; }
  async getToken(opts) {
    lastVerifier = opts.codeVerifier;
    if (nextError) throw nextError;
    return { tokens: { id_token: nextToken } };
  }
}

before(async () => {
  await h.setup();
  config.google.clientId = CLIENT_ID;
  config.google.clientSecret = 'rahasia-uji';
  google._setClient(new TestClient({ clientId: CLIENT_ID, clientSecret: 'rahasia-uji', redirectUri: config.google.redirectUri }));
});
after(() => {
  config.google.clientId = '';
  config.google.clientSecret = '';
  google._reset();
});

// Jalankan alur: halaman Masuk → POST /auth/google → (Google) → callback.
async function startFlow(agent, body = {}) {
  const page = await agent.get(body.intent === 'link' ? '/profil/google' : '/masuk');
  const csrf = h.csrfFrom(page.text);
  const res = await agent.post('/auth/google').type('form').send({ _csrf: csrf, intent: 'login', ...body });
  return { res, csrf };
}
function paramsOf(location) {
  return new URL(location).searchParams;
}
async function googleLogin(agent, claims, { tokenOpts, mutate } = {}) {
  const { res } = await startFlow(agent);
  assert.equal(res.status, 302);
  const p = paramsOf(res.headers.location);
  const claimsWithNonce = { nonce: p.get('nonce'), ...claims };
  nextToken = makeIdToken(mutate ? mutate(claimsWithNonce) : claimsWithNonce, tokenOpts);
  nextError = null;
  return agent.get(`/auth/google/callback?code=kode-uji&state=${encodeURIComponent(p.get('state'))}`);
}
const users = async () => (await h.db.get('SELECT COUNT(*) n FROM users')).n;
const flashOf = async (agent, url = '/masuk') => (await agent.get(url)).text;

describe('Masuk/Daftar dengan Google', () => {
  test('tombol tampil di Masuk & Daftar saat dikonfigurasi, tersembunyi bila belum', async () => {
    const anon = h.request.agent(h.getApp());
    const login = await anon.get('/masuk');
    assert.match(login.text, /class="auth-or"[\s\S]*atau[\s\S]*Lanjutkan dengan Google/);
    assert.match(login.text, /action="\/auth\/google"/);
    assert.match((await anon.get('/daftar')).text, /Lanjutkan dengan Google/);
    assert.doesNotMatch(login.text, /type="password"[^>]*name="google/i, 'tidak ada kolom kata sandi Google');
    config.google.clientSecret = '';
    assert.doesNotMatch((await anon.get('/masuk')).text, /Lanjutkan dengan Google/, 'tanpa konfigurasi, tidak ada tombol palsu');
    const csrf = h.csrfFrom((await anon.get('/masuk')).text);
    const r = await anon.post('/auth/google').type('form').send({ _csrf: csrf });
    assert.equal(r.status, 302);
    assert.equal(r.headers.location, '/masuk');
    assert.match(await flashOf(anon), /Masuk dengan Google belum tersedia/);
    config.google.clientSecret = 'rahasia-uji';
  });

  test('mulai alur: hanya scope openid email profile, state, nonce, PKCE S256; tanpa CSRF ditolak', async () => {
    const anon = h.request.agent(h.getApp());
    const { res } = await startFlow(anon);
    const url = new URL(res.headers.location);
    assert.equal(url.origin + url.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
    const p = url.searchParams;
    assert.equal(p.get('scope'), 'openid email profile');
    assert.equal(p.get('response_type'), 'code');
    assert.equal(p.get('client_id'), CLIENT_ID);
    assert.equal(p.get('code_challenge_method'), 'S256');
    assert.ok(p.get('code_challenge') && p.get('state') && p.get('nonce'));
    assert.equal(p.get('redirect_uri'), config.google.redirectUri);
    assert.doesNotMatch(res.headers.location, /client_secret|rahasia-uji/, 'secret tidak pernah ke browser');
    const noCsrf = await h.request.agent(h.getApp()).post('/auth/google').type('form').send({});
    assert.equal(noCsrf.status, 403);
  });

  test('pengguna baru: akun petani + profil dibuat dari token terverifikasi, tanpa kata sandi; login ulang ke akun yang sama', async () => {
    const before = await users();
    const agent = h.request.agent(h.getApp());
    const cb = await googleLogin(agent, { sub: 'google-sub-100', email: 'Siti.Petani@Gmail.com', name: 'Siti Aminah' });
    assert.equal(cb.status, 302);
    assert.equal(cb.headers.location, '/profil/lengkapi');
    assert.ok(lastVerifier && lastVerifier.length >= 43, 'PKCE verifier dikirim saat menukar kode');
    assert.equal(await users(), before + 1);
    const u = await h.db.get("SELECT * FROM users WHERE email = 'siti.petani@gmail.com'");
    assert.equal(u.role, 'farmer', 'bukan admin');
    assert.equal(u.password_hash, null, 'tanpa kata sandi tiruan');
    assert.equal(u.phone, null, 'nomor HP tidak dikarang');
    assert.equal((await h.db.get('SELECT full_name FROM farmer_profiles WHERE user_id = ?', u.id)).full_name, 'Siti Aminah');
    assert.equal((await h.db.get("SELECT subject FROM user_identities WHERE user_id = ? AND provider = 'google'", u.id)).subject, 'google-sub-100');
    // Profil singkat (opsional) lalu Dashboard.
    const quick = await agent.get('/profil/lengkapi');
    assert.match(quick.text, /Nomor HP[\s\S]*Desa\/kelurahan[\s\S]*Kelompok tani/);
    const csrf = h.csrfFrom(quick.text);
    const save = await agent.post('/profil/lengkapi').type('form').send({ _csrf: csrf, phone: '081377770055', village: 'Mojopuro Wetan', farmer_group: '' });
    assert.equal(save.status, 302);
    assert.equal((await h.db.get('SELECT phone FROM users WHERE id = ?', u.id)).phone, '081377770055');
    // Data antarpengguna terpisah: akun baru tidak melihat lahan petani lain.
    assert.doesNotMatch((await agent.get('/lahan')).text, /Sawah Blok A \(Demo\)/);
    // Nama diubah di Sahabat Tani tidak ditimpa saat login Google berikutnya.
    await h.db.run("UPDATE farmer_profiles SET full_name = 'Bu Siti' WHERE user_id = ?", u.id);
    const out = h.csrfFrom((await agent.get('/dashboard')).text);
    await agent.post('/keluar').type('form').send({ _csrf: out });
    assert.equal((await agent.get('/dashboard')).status, 302, 'logout mengakhiri sesi');
    const again = await googleLogin(agent, { sub: 'google-sub-100', email: 'siti.petani@gmail.com', name: 'Siti Aminah (Google)' });
    assert.equal(again.headers.location, '/dashboard');
    assert.equal(await users(), before + 1, 'login ulang tidak membuat akun baru');
    assert.equal((await h.db.get('SELECT full_name FROM farmer_profiles WHERE user_id = ?', u.id)).full_name, 'Bu Siti');
    assert.equal((await h.db.get('SELECT COUNT(*) n FROM farmer_profiles WHERE user_id = ?', u.id)).n, 1, 'tanpa profil ganda');
    const dash = await agent.get('/dashboard');
    assert.equal(dash.status, 200);
    // Login lokal untuk akun tanpa kata sandi gagal dengan aman (bukan galat server).
    const anon = h.request.agent(h.getApp());
    const c2 = h.csrfFrom((await anon.get('/masuk')).text);
    const local = await anon.post('/masuk').type('form').send({ _csrf: c2, identifier: 'siti.petani@gmail.com', password: 'apa-saja-123' });
    assert.equal(local.status, 401);
  });

  test('login lokal tetap berjalan', async () => {
    const agent = await h.agentFor(...h.FARMER1);
    assert.equal((await agent.get('/dashboard')).status, 200);
  });

  test('email sama dengan akun lokal: tidak digabung otomatis, harus membuktikan kata sandi', async () => {
    const reg = h.request.agent(h.getApp());
    const c = h.csrfFrom((await reg.get('/daftar')).text);
    await reg.post('/daftar').type('form').send({ _csrf: c, full_name: 'Pak Budi', phone: '081366660001', email: 'budi@contoh.id', password: 'sandibudi123', password_confirm: 'sandibudi123' });
    const budi = await h.db.get("SELECT id FROM users WHERE email = 'budi@contoh.id'");
    const before = await users();
    const agent = h.request.agent(h.getApp());
    const cb = await googleLogin(agent, { sub: 'google-sub-budi', email: 'budi@contoh.id', name: 'Budi G' });
    assert.equal(cb.headers.location, '/auth/google/tautkan');
    assert.equal(await users(), before, 'tidak membuat akun duplikat');
    assert.equal((await agent.get('/dashboard')).status, 302, 'belum masuk sebelum terbukti');
    assert.equal((await h.db.get("SELECT COUNT(*) n FROM user_identities WHERE subject = 'google-sub-budi'")).n, 0);
    const page = await agent.get('/auth/google/tautkan');
    assert.match(page.text, /budi@contoh\.id/);
    const csrf = h.csrfFrom(page.text);
    const wrong = await agent.post('/auth/google/tautkan').type('form').send({ _csrf: csrf, password: 'salah-sekali' });
    assert.equal(wrong.status, 401);
    assert.equal((await h.db.get("SELECT COUNT(*) n FROM user_identities WHERE subject = 'google-sub-budi'")).n, 0);
    const ok = await agent.post('/auth/google/tautkan').type('form').send({ _csrf: csrf, password: 'sandibudi123' });
    assert.equal(ok.status, 302);
    assert.equal((await h.db.get("SELECT user_id FROM user_identities WHERE subject = 'google-sub-budi'")).user_id, budi.id);
    // Berikutnya langsung masuk dengan Google ke akun yang sama.
    const next = h.request.agent(h.getApp());
    const cb2 = await googleLogin(next, { sub: 'google-sub-budi', email: 'budi@contoh.id' });
    assert.equal(cb2.headers.location, '/dashboard');
    assert.equal(await users(), before);
  });

  test('token tidak valid ditolak: signature palsu, audience lain, kedaluwarsa, issuer lain, nonce salah, state salah', async () => {
    const before = await users();
    const cases = [
      ['signature', { tokenOpts: { key: other.privateKey } }],
      ['audience', { mutate: (c) => ({ ...c, aud: 'klien-lain.apps.googleusercontent.com' }) }],
      ['kedaluwarsa', { mutate: (c) => ({ ...c, iat: Math.floor(Date.now() / 1000) - 7200, exp: Math.floor(Date.now() / 1000) - 3600 }) }],
      ['issuer', { mutate: (c) => ({ ...c, iss: 'https://penipu.example' }) }],
      ['nonce', { mutate: (c) => ({ ...c, nonce: 'nonce-lain' }) }],
    ];
    for (const [name, opts] of cases) {
      const agent = h.request.agent(h.getApp());
      const cb = await googleLogin(agent, { sub: `palsu-${name}`, email: `palsu-${name}@gmail.com` }, opts);
      assert.equal(cb.headers.location, '/masuk', name);
      const text = await flashOf(agent);
      assert.match(text, /Verifikasi akun Google gagal/, name);
      assert.doesNotMatch(text, /eyJ|Invalid token|rahasia-uji/, `tanpa detail internal (${name})`);
    }
    // State tidak cocok / callback tanpa memulai alur.
    const agent = h.request.agent(h.getApp());
    await startFlow(agent);
    nextToken = makeIdToken({ sub: 'palsu-state', email: 'palsu-state@gmail.com' });
    const bad = await agent.get('/auth/google/callback?code=x&state=state-palsu');
    assert.equal(bad.headers.location, '/masuk');
    assert.match(await flashOf(agent), /kedaluwarsa atau tidak valid/);
    const direct = await h.request.agent(h.getApp()).get('/auth/google/callback?code=x&state=y');
    assert.equal(direct.headers.location, '/masuk');
    assert.equal(await users(), before, 'tidak ada akun dibuat dari token tidak valid');
  });

  test('dibatalkan, koneksi gagal, email belum terverifikasi, akun dinonaktifkan', async () => {
    let agent = h.request.agent(h.getApp());
    let { res } = await startFlow(agent);
    let st = paramsOf(res.headers.location).get('state');
    await agent.get(`/auth/google/callback?error=access_denied&state=${encodeURIComponent(st)}`);
    assert.match(await flashOf(agent), /Masuk dengan Google dibatalkan/);

    agent = h.request.agent(h.getApp());
    ({ res } = await startFlow(agent));
    st = paramsOf(res.headers.location).get('state');
    nextError = Object.assign(new Error('getaddrinfo ENOTFOUND oauth2.googleapis.com'), { code: 'ENOTFOUND' });
    await agent.get(`/auth/google/callback?code=x&state=${encodeURIComponent(st)}`);
    nextError = null;
    assert.match(await flashOf(agent), /Tidak dapat terhubung ke Google/);

    agent = h.request.agent(h.getApp());
    ({ res } = await startFlow(agent));
    st = paramsOf(res.headers.location).get('state');
    nextError = Object.assign(new Error('invalid_grant'), { response: { status: 400 } });
    await agent.get(`/auth/google/callback?code=x&state=${encodeURIComponent(st)}`);
    nextError = null;
    assert.match(await flashOf(agent), /konfigurasi alamat callback/);

    agent = h.request.agent(h.getApp());
    await googleLogin(agent, { sub: 'sub-unverified', email: 'belum@gmail.com', email_verified: false });
    assert.match(await flashOf(agent), /belum terverifikasi/);
    assert.equal((await h.db.get("SELECT COUNT(*) n FROM users WHERE email = 'belum@gmail.com'")).n, 0);

    const siti = await h.db.get("SELECT id FROM users WHERE email = 'siti.petani@gmail.com'");
    await h.db.run('UPDATE users SET is_active = 0 WHERE id = ?', siti.id);
    agent = h.request.agent(h.getApp());
    const cb = await googleLogin(agent, { sub: 'google-sub-100', email: 'siti.petani@gmail.com' });
    assert.equal(cb.headers.location, '/masuk');
    assert.match(await flashOf(agent), /dinonaktifkan/);
    await h.db.run('UPDATE users SET is_active = 1 WHERE id = ?', siti.id);
  });

  test('profil: status Google, tautkan butuh kata sandi, akun Google lain ditolak, putus hanya bila ada cara masuk lain', async () => {
    const f1 = await h.agentFor(...h.FARMER1);
    const me = (await h.db.get('SELECT id FROM users WHERE phone = ?', h.FARMER1[0])).id;
    assert.match((await f1.get('/profil')).text, /Belum terhubung/);
    // Kata sandi salah → tidak diarahkan ke Google.
    let { res } = await startFlow(f1, { intent: 'link', password: 'salah' });
    assert.equal(res.headers.location, '/profil/google');
    // Akun Google yang sudah milik pengguna lain ditolak.
    ({ res } = await startFlow(f1, { intent: 'link', password: h.FARMER1[1] }));
    let p = paramsOf(res.headers.location);
    nextToken = makeIdToken({ sub: 'google-sub-100', email: 'siti.petani@gmail.com', nonce: p.get('nonce') });
    await f1.get(`/auth/google/callback?code=x&state=${encodeURIComponent(p.get('state'))}`);
    assert.match(await flashOf(f1, '/profil/google'), /sudah terhubung ke akun Sahabat Tani lain/);
    // Tautkan akun Google baru.
    ({ res } = await startFlow(f1, { intent: 'link', password: h.FARMER1[1] }));
    p = paramsOf(res.headers.location);
    nextToken = makeIdToken({ sub: 'google-sub-sarno', email: 'sarno@gmail.com', nonce: p.get('nonce') });
    const linked = await f1.get(`/auth/google/callback?code=x&state=${encodeURIComponent(p.get('state'))}`);
    assert.equal(linked.headers.location, '/profil/google');
    assert.equal((await h.db.get("SELECT user_id FROM user_identities WHERE subject = 'google-sub-sarno'")).user_id, me);
    assert.match((await f1.get('/profil')).text, /Google terhubung/);
    // Punya kata sandi → boleh putus.
    const csrf = h.csrfFrom((await f1.get('/profil/google')).text);
    await f1.post('/profil/google/putus').type('form').send({ _csrf: csrf });
    assert.equal((await h.db.get('SELECT COUNT(*) n FROM user_identities WHERE user_id = ?', me)).n, 0);
    // Akun khusus Google (tanpa kata sandi) tidak bisa memutus satu-satunya cara masuk.
    const g = h.request.agent(h.getApp());
    await googleLogin(g, { sub: 'google-sub-100', email: 'siti.petani@gmail.com' });
    const gc = h.csrfFrom((await g.get('/profil/google')).text);
    await g.post('/profil/google/putus').type('form').send({ _csrf: gc });
    assert.equal((await h.db.get("SELECT COUNT(*) n FROM user_identities WHERE subject = 'google-sub-100'")).n, 1);
    assert.match(await flashOf(g, '/profil/google'), /Buat kata sandi terlebih dahulu/);
  });
});
