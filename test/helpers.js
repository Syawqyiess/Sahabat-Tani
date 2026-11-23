'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Lingkungan uji terisolasi: database & folder unggahan sementara, AI tanpa kunci (mode demo).
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sahabat-tani-test-'));
process.env.NODE_ENV = 'test';
process.env.DB_PATH = path.join(tmp, 'test.db');
process.env.UPLOAD_DIR = path.join(tmp, 'uploads');
process.env.ANTHROPIC_API_KEY = '';
process.env.GEMINI_API_KEY = '';
// Login Google mati secara default di uji; test/google.test.js mengaktifkannya dengan klien uji.
process.env.GOOGLE_CLIENT_ID = '';
process.env.GOOGLE_CLIENT_SECRET = '';
// Dikosongkan (bukan dihapus) agar dotenv tidak mengisinya lagi dari .env pengembang.
process.env.AI_VISION_PROVIDER = '';
process.env.AI_CHAT_PROVIDER = '';
process.env.NEWS_AUTO_FETCH = '0';
process.env.RDKK_AUTO_FETCH = '0';
process.env.NEWS_MIN_DELAY_MS = '0'; // tes memakai situs tiruan: tanpa jeda antar permintaan

const request = require('supertest');
const db = require('../src/db');
const { seed, demoPng } = require('../src/db/seed');
const { createApp } = require('../src/app');

let app;
async function setup() {
  if (app) return app;
  db.open();
  await seed({ quiet: true });
  app = createApp();
  return app;
}

function csrfFrom(html) {
  const m = /name="csrf-token" content="([^"]+)"/.exec(html);
  if (!m) throw new Error('Token CSRF tidak ditemukan');
  return m[1];
}

async function agentFor(identifier, password) {
  const agent = request.agent(app);
  const page = await agent.get('/masuk');
  const csrf = csrfFrom(page.text);
  const res = await agent.post('/masuk').type('form').send({ _csrf: csrf, identifier, password });
  if (res.status !== 302) throw new Error(`Login gagal untuk ${identifier}: ${res.status}`);
  agent.csrf = csrfFrom((await agent.get('/artikel')).text);
  return agent;
}

const FARMER1 = ['081200000001', 'tani12345'];
const FARMER2 = ['081200000002', 'tani12345'];
const ADMIN = ['admin@sahabattani.test', 'admin12345'];

module.exports = { setup, agentFor, csrfFrom, demoPng, db, request, FARMER1, FARMER2, ADMIN, tmp, getApp: () => app };
