'use strict';
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const config = require('../config');
const db = require('./index');
const demo = require('./demo-data');
const { slugify, renderMarkdown } = require('../lib/util');

// Gambar contoh sederhana (PNG hijau bergradasi) — hanya untuk mengisi riwayat demo, bukan foto hama.
function demoPng(w = 96, h = 96) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const i = y * (w * 3 + 1) + 1 + x * 3;
      raw[i] = 40 + (x % 16 < 2 ? 60 : 0); raw[i + 1] = 110 + Math.round((y / h) * 90); raw[i + 2] = 50;
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

async function seed({ withScans = true, quiet = false } = {}) {
  const log = quiet ? () => {} : console.log;
  db.migrate();
  if (db.get('SELECT 1 FROM users LIMIT 1')) {
    log('Data sudah ada — seed dilewati. Hapus file database untuk mengulang dari awal.');
    return;
  }
  if (config.isProd && !process.env.ALLOW_DEMO_SEED) {
    console.error('Menolak membuat akun demo di produksi. Set ALLOW_DEMO_SEED=1 bila memang diperlukan.');
    process.exit(1);
  }
  const rounds = config.isTest ? 4 : 10;
  const ids = {};
  db.tx(() => {
    for (const name of demo.categories) db.run('INSERT INTO article_categories (name, slug) VALUES (?, ?)', name, slugify(name));
    for (const u of demo.users) {
      const r = db.run('INSERT INTO users (phone, email, password_hash, role, is_demo) VALUES (?, ?, ?, ?, 1)', u.phone, u.email, bcrypt.hashSync(u.password, rounds), u.role);
      const id = Number(r.lastInsertRowid);
      ids[u.key] = id;
      const p = u.profile;
      db.run(
        `INSERT INTO farmer_profiles (user_id, full_name, village, district, regency, province, farmer_group, experience_years, main_commodity)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id, p.full_name, p.village || null, p.district || null, p.regency || null, p.province || null, p.farmer_group || null, p.experience_years ?? null, p.main_commodity || null,
      );
      for (const l of u.lands || []) {
        db.run(
          `INSERT INTO lands (user_id, name, address_desc, area_ha, commodity, variety, planting_date, season_status, lat, lng, polygon_json, data_source,
                              illustration_path, illustration_kind, illustration_credit, illustration_source_url)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'demo', ?, ?, ?, ?)`,
          id, l.name, l.address_desc, l.area_ha, l.commodity, l.variety, l.planting_date, l.season_status, l.lat, l.lng, l.polygon ? JSON.stringify(l.polygon) : null,
          l.illustration ? l.illustration.path : null, l.illustration ? l.illustration.kind : null, l.illustration ? l.illustration.credit : null, l.illustration ? l.illustration.source_url : null,
        );
      }
    }
    for (const p of demo.pests) {
      db.run(
        `INSERT INTO pest_references (slug, name, scientific_name, aliases, symptoms, visual_signs, ipm_control, prevention, when_to_consult, is_verified, is_demo)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1)`,
        slugify(p.name), p.name, p.scientific_name, p.aliases, p.symptoms, p.visual_signs, p.ipm_control, p.prevention, p.when_to_consult,
      );
    }
    demo.articles.forEach((a, i) => {
      const cat = db.get('SELECT id FROM article_categories WHERE name = ?', a.cat);
      const when = new Date(Date.now() - (i + 1) * 86400000 * 2).toISOString();
      db.run(
        `INSERT INTO articles (slug, title, summary, body_md, body_html, author_name, author_id, category_id, tags, status, is_demo, published_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'published', 1, ?)`,
        slugify(a.title), a.title, a.summary, a.body, renderMarkdown(a.body), 'Tim Sahabat Tani (Konten Demo)', ids.admin, cat.id, a.tags, when,
      );
    });
    db.run(
      `INSERT INTO articles (slug, title, summary, body_md, body_html, author_name, author_id, category_id, status, is_demo)
       VALUES ('draft-contoh', 'Draft: Jadwal Pengamatan Mingguan', 'Contoh draft yang belum diterbitkan.', 'Isi draft.', '<p>Isi draft.</p>', 'Admin Demo', ?, NULL, 'draft', 1)`,
      ids.admin,
    );
  });

  if (withScans) {
    // Satu scan demo per petani agar riwayat dan percakapan terlihat terpisah per akun.
    const scans = require('../services/scans');
    const ai = require('../services/ai');
    // Gambar contoh bukan foto hama: selalu pakai mode demo walaupun API AI terpasang.
    ai._setOverride('vision', require('../services/ai/demo').vision);
    const file = { buffer: demoPng(), size: 0 };
    file.size = file.buffer.length;
    for (const key of ['sarno', 'wati']) {
      const land = db.get('SELECT id FROM lands WHERE user_id = ? LIMIT 1', ids[key]);
      await scans.createScan({ id: ids[key] }, {
        file, idempotencyKey: `seed-${crypto.randomUUID()}`, landId: land && land.id, plantAge: key === 'sarno' ? 35 : null,
        affectedPart: 'Daun', symptoms: key === 'sarno' ? 'Daun menguning di beberapa rumpun (contoh data demo)' : null,
      });
    }
    ai._clearOverrides();
  }

  log('Data demo dibuat:');
  log(`  Admin  : admin@sahabattani.test / ${demo.DEMO_PASSWORD_ADMIN}`);
  log(`  Petani : 081200000001 (Pak Sarno) / ${demo.DEMO_PASSWORD_FARMER}`);
  log(`  Petani : 081200000002 (Bu Wati)   / ${demo.DEMO_PASSWORD_FARMER}`);
}

module.exports = { seed, demoPng };

if (require.main === module) {
  seed().then(() => db.close()).catch((e) => { console.error(e); process.exit(1); });
}
