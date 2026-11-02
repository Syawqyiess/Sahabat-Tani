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
    // Model scanner buatan sendiri (ml/train.py). Aktifkan dengan AI_VISION_PROVIDER=lokal.
    localScannerDir: env.LOCAL_SCANNER_DIR || 'models/scanner-padi',
    localScannerMinScore: env.LOCAL_SCANNER_MIN_SCORE ? Number(env.LOCAL_SCANNER_MIN_SCORE) : null,
  },

  maps: {
    browserKey: env.GOOGLE_MAPS_BROWSER_KEY || '',
    mapId: env.GOOGLE_MAPS_MAP_ID || '',
    // Lokasi contoh di Indonesia (dapat dikonfigurasi): sawah di Kabupaten Karawang, Jawa Barat.
    demoCenter: {
      lat: Number(env.DEMO_MAP_LAT || -6.3227),
      lng: Number(env.DEMO_MAP_LNG || 107.3376),
      label: env.DEMO_MAP_LABEL || 'Karawang, Jawa Barat (Lokasi Demo)',
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
