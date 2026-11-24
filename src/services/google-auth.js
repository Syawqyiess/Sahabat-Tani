'use strict';
// Masuk dengan Google memakai library resmi Google (google-auth-library), alur OAuth 2.0 authorization code
// dengan PKCE (S256), state, dan nonce. Identitas diambil HANYA dari ID token yang sudah diverifikasi
// (signature terhadap kunci publik Google, issuer, audience = client ID, masa berlaku) — tidak pernah dari
// data yang dikirim browser. Token dan secret tidak pernah dicatat ke log.
const crypto = require('node:crypto');
const { OAuth2Client } = require('google-auth-library');
const config = require('../config');

// Hanya identitas dasar. Tidak meminta Gmail, Drive, kontak, atau layanan lain.
const SCOPES = ['openid', 'email', 'profile'];
const FLOW_TTL_MS = 10 * 60 * 1000;

class GoogleAuthError extends Error {
  constructor(code, cause) {
    super(code);
    this.code = code; // kode internal singkat; pesan untuk pengguna dipetakan di rute
    if (cause) this.cause = cause;
  }
}

let client = null;
function getClient() {
  if (!client) {
    client = new OAuth2Client({ clientId: config.google.clientId, clientSecret: config.google.clientSecret, redirectUri: config.google.redirectUri });
  }
  return client;
}

// Alamat callback mengikuti domain yang sedang dibuka pengguna (mis. sahabat-tani.my.id atau *.vercel.app),
// karena sesi login (state/nonce/PKCE) tersimpan per domain: kembali ke domain lain = sesi tidak ditemukan.
// - Di Vercel, permintaan hanya sampai bila domainnya terdaftar di project, jadi host permintaan dapat dipercaya.
// - Di server lain, hanya host dari APP_URL / GOOGLE_REDIRECT_URI yang dipakai (cegah pemalsuan header Host).
// Setiap alamat callback harus didaftarkan di Google Cloud (Authorized redirect URIs).
function redirectUriFor(req) {
  const fallback = config.google.redirectUri;
  if (!req) return fallback;
  const host = String(req.get('x-forwarded-host') || req.get('host') || '').split(',')[0].trim().toLowerCase();
  if (!/^[a-z0-9.-]+(:\d+)?$/.test(host)) return fallback;
  const trusted = new Set([new URL(fallback).host, new URL(config.appUrl).host].map((h) => h.toLowerCase()));
  if (!process.env.VERCEL && !trusted.has(host)) return fallback;
  const proto = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host) ? (req.protocol || 'http') : 'https';
  return `${proto}://${host}/auth/google/callback`;
}

// Memulai alur: membuat state, nonce, dan PKCE verifier yang disimpan di sesi server (bukan di browser).
async function begin({ intent, userId = null, returnTo = null, redirectUri = config.google.redirectUri }) {
  const c = getClient();
  const { codeVerifier, codeChallenge } = await c.generateCodeVerifierAsync();
  const flow = {
    state: crypto.randomBytes(24).toString('base64url'),
    nonce: crypto.randomBytes(24).toString('base64url'),
    verifier: codeVerifier,
    intent, userId, returnTo, redirectUri,
    startedAt: Date.now(),
  };
  const url = c.generateAuthUrl({
    scope: SCOPES,
    state: flow.state,
    nonce: flow.nonce,
    code_challenge_method: 'S256',
    code_challenge: codeChallenge,
    prompt: 'select_account',
    access_type: 'online',
    include_granted_scopes: false,
    redirect_uri: redirectUri,
  });
  return { flow, url };
}

// Memeriksa state, menukar kode (dengan PKCE verifier), lalu memverifikasi ID token.
async function complete(flow, { code, state }) {
  if (!flow || !state || typeof state !== 'string') throw new GoogleAuthError('state');
  const a = Buffer.from(String(flow.state));
  const b = Buffer.from(state);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new GoogleAuthError('state');
  if (Date.now() - flow.startedAt > FLOW_TTL_MS) throw new GoogleAuthError('expired');
  if (!code || typeof code !== 'string') throw new GoogleAuthError('no_code');

  const c = getClient();
  let tokens;
  try {
    ({ tokens } = await c.getToken({ code, codeVerifier: flow.verifier, redirect_uri: flow.redirectUri || config.google.redirectUri }));
  } catch (err) {
    const status = err && err.response && err.response.status;
    // 400/401 dari Google = kode/redirect/klien tidak cocok; selain itu dianggap gangguan koneksi.
    throw new GoogleAuthError(status === 400 || status === 401 ? 'exchange' : 'network', err);
  }
  if (!tokens || !tokens.id_token) throw new GoogleAuthError('no_id_token');
  return await verifyIdToken(tokens.id_token, flow.nonce);
}

async function verifyIdToken(idToken, expectedNonce) {
  let payload;
  try {
    const ticket = await getClient().verifyIdToken({ idToken, audience: config.google.clientId });
    payload = ticket.getPayload();
  } catch (err) {
    const msg = String(err && err.message || '');
    throw new GoogleAuthError(/fetch|network|ENOTFOUND|ECONN|ETIMEDOUT|socket/i.test(msg) ? 'network' : 'invalid_token', err);
  }
  if (!payload || !payload.sub) throw new GoogleAuthError('invalid_token');
  if (expectedNonce && payload.nonce !== expectedNonce) throw new GoogleAuthError('nonce');
  return {
    sub: String(payload.sub),
    email: payload.email ? String(payload.email).toLowerCase() : null,
    emailVerified: payload.email_verified === true || payload.email_verified === 'true',
    name: payload.name ? String(payload.name).slice(0, 100) : null,
    picture: payload.picture ? String(payload.picture) : null,
  };
}

module.exports = {
  SCOPES, FLOW_TTL_MS, GoogleAuthError, begin, complete, verifyIdToken, redirectUriFor,
  get enabled() { return config.google.enabled; },
  // Untuk pengujian: pakai klien tiruan / kunci publik uji.
  _setClient(c) { client = c; },
  _reset() { client = null; },
};
