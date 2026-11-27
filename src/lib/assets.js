'use strict';
// Alamat berkas statis dengan versi dari isi berkas: /static/css/app.css?v=<hash>.
// Berkas statis disimpan browser & CDN selama 7 hari; tanpa versi, perubahan CSS/JS tidak terlihat
// sampai cache kedaluwarsa (halaman baru tampil dengan gaya lama = berantakan). Hash berubah bila isi berubah.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const config = require('../config');

const cache = new Map();

function asset(rel) {
  const clean = String(rel).replace(/^\/+/, '');
  if (!cache.has(clean) || !config.isProd) {
    let v = '';
    try {
      v = crypto.createHash('sha1').update(fs.readFileSync(path.join(config.root, 'public', clean))).digest('hex').slice(0, 10);
    } catch { /* berkas tidak ada: alamat tanpa versi */ }
    cache.set(clean, v ? `/static/${clean}?v=${v}` : `/static/${clean}`);
  }
  return cache.get(clean);
}

module.exports = { asset };
