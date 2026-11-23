'use strict';
const path = require('node:path');
require('dotenv').config({ quiet: true });

const root = path.resolve(__dirname, '..');
const env = process.env;

function bool(v, def = false) {
  if (v === undefined || v === '') return def;
  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
}

function list(v) {
  return String(v).split(',').map((s) => s.trim()).filter(Boolean);
}

function defaultProvider() {
  if (env.ANTHROPIC_API_KEY) return 'anthropic';
  if (env.GEMINI_API_KEY) return 'gemini';
  return 'demo';
}

const config = {
  root,
  env: env.NODE_ENV || 'development',
  isProd: env.NODE_ENV === 'production',
  isTest: env.NODE_ENV === 'test',
  port: Number(env.PORT || 3000),
  appUrl: env.APP_URL || `http://localhost:${env.PORT || 3000}`,
  sessionSecret: env.SESSION_SECRET || 'dev-only-secret-ganti-di-produksi',
  dbPath: env.DB_PATH || path.join(root, 'storage', 'sahabat-tani.db'),
  uploadDir: env.UPLOAD_DIR || path.join(root, 'storage', 'uploads'),
  maxUploadBytes: Number(env.MAX_UPLOAD_MB || 8) * 1024 * 1024,
  // Masuk dengan Google (OAuth 2.0 / OpenID Connect, alur kode + PKCE). Aktif hanya bila client ID & secret diisi.
  // Client secret hanya dipakai di server; tidak pernah dikirim ke browser.
  google: {
    clientId: env.GOOGLE_CLIENT_ID || '',
    clientSecret: env.GOOGLE_CLIENT_SECRET || '',
    redirectUri: env.GOOGLE_REDIRECT_URI || `${env.APP_URL || `http://localhost:${env.PORT || 3000}`}/auth/google/callback`,
    get enabled() { return !!(this.clientId && this.clientSecret); },
  },

  ai: {
    anthropicKey: env.ANTHROPIC_API_KEY || '',
    geminiKey: env.GEMINI_API_KEY || '',
    // Layanan analisis gambar dan percakapan dipisah agar bisa diganti sendiri-sendiri.
    // Bila tidak diatur: pakai penyedia yang kuncinya tersedia (Anthropic, lalu Gemini), selain itu demo.
    visionProvider: env.AI_VISION_PROVIDER || defaultProvider(),
    chatProvider: env.AI_CHAT_PROVIDER || defaultProvider(),
    visionModel: env.AI_VISION_MODEL || 'claude-opus-5-5',
    chatModel: env.AI_CHAT_MODEL || 'claude-opus-5-5',
    useFallbacks: bool(env.AI_USE_FALLBACKS, true),
    // Daftar model dipisah koma, dicoba berurutan bila model sebelumnya lambat/habis kuota/tidak tersedia.
    // Diukur 1 Nov 2026 (free tier): gemini-3.5-flash ±20 dtk, gemini-flash-lite-latest ±4 dtk,
    // sedangkan gemini-flash-latest (3.8-flash) >90 dtk. Nama model Google sering berubah — cek dengan npm run cek-ai.
    geminiVisionModels: list(env.GEMINI_VISION_MODEL || env.GEMINI_MODEL || 'gemini-3.5-flash,gemini-flash-lite-latest'),
    geminiChatModels: list(env.GEMINI_CHAT_MODEL || env.GEMINI_MODEL || 'gemini-flash-lite-latest,gemini-3.5-flash'),
    geminiTimeoutMs: Number(env.GEMINI_TIMEOUT_MS || 50000),
    // Chatbot lokal lewat Ollama. Aktifkan dengan AI_CHAT_PROVIDER=ollama.
    ollamaUrl: env.OLLAMA_URL || 'http://127.0.0.1:11434',
    ollamaModel: env.OLLAMA_MODEL || 'gemma3:4b',
    ollamaVision: bool(env.OLLAMA_VISION, true),
    ollamaNumCtx: Number(env.OLLAMA_NUM_CTX || 4096),
    ollamaTimeoutMs: Number(env.OLLAMA_TIMEOUT_MS || 180000),
    // Model scanner buatan sendiri (ml/train.py). Aktifkan dengan AI_VISION_PROVIDER=lokal.
    localScannerDir: env.LOCAL_SCANNER_DIR || 'models/scanner-padi',
    localScannerMinScore: env.LOCAL_SCANNER_MIN_SCORE ? Number(env.LOCAL_SCANNER_MIN_SCORE) : null,
  },

  // Data RDKK untuk visualisasi di Dashboard: diambil dari ekspor CSV workbook Tableau Public "SITANI"
  // (Dashboard RDKK Mojopuro Wetan, oleh Angely Marcella), lalu digambar dengan diagram milik website.
  rdkk: {
    title: 'Dashboard RDKK Mojopuro Wetan',
    author: 'Angely Marcella',
    workbook: env.RDKK_TABLEAU_WORKBOOK || 'SITANI',
    baseUrl: 'https://public.tableau.com/views/',
    publicUrl: 'https://public.tableau.com/views/SITANI/DashboardRDKKMojopuroWetan?:showVizHome=no',
    refreshHours: Number(env.RDKK_REFRESH_HOURS || 24),
    autoFetch: bool(env.RDKK_AUTO_FETCH, true),
  },
  maps: {
    // Peta memakai Leaflet + ubin OpenStreetMap / Esri (tanpa API key).
    // Lokasi contoh (dapat dikonfigurasi): Desa Mojopuro Wetan, Kec. Bungah, Kab. Gresik, Jawa Timur.
    demoCenter: {
      lat: Number(env.DEMO_MAP_LAT || -7.0347),
      lng: Number(env.DEMO_MAP_LNG || 112.5279),
      label: env.DEMO_MAP_LABEL || 'Desa Mojopuro Wetan, Bungah, Gresik (Lokasi Demo)',
    },
  },

  air: {
    baseUrl: env.OPEN_METEO_AQ_URL || 'https://air-quality-api.open-meteo.com/v1/air-quality',
    cacheMinutes: Number(env.AIR_CACHE_MINUTES || 30),
    timeoutMs: Number(env.AIR_TIMEOUT_MS || 8000),
  },

  news: {
    fetchIntervalHours: Number(env.NEWS_FETCH_INTERVAL_HOURS || 6),
    autoFetch: bool(env.NEWS_AUTO_FETCH, true),
  },

  mail: {
    // Belum ada layanan email: tautan reset ditampilkan di layar hanya bila mode demo aktif.
    showResetLinkOnScreen: bool(env.DEMO_SHOW_RESET_LINK, env.NODE_ENV !== 'production'),
  },
};

module.exports = config;
