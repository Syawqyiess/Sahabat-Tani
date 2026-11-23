'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const multer = require('multer');
const config = require('../config');

// Penyimpanan foto. Dua backend dengan antarmuka yang sama (semua asinkron):
// - 'supabase': Supabase Storage, bucket PRIVAT (dipakai aplikasi). Diakses hanya dari server dengan secret key.
// - 'local'   : folder storage/uploads (uji otomatis & mode offline).
// Browser tidak pernah mengakses bucket langsung: foto dilayani lewat rute /media yang memeriksa pemiliknya.

const ALLOWED = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};
const MIME_OF = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

function sniffMime(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return null;
}

class UploadError extends Error {}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadBytes, files: 1, fields: 20 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED[file.mimetype]) return cb(new UploadError('Format berkas tidak didukung. Gunakan foto JPG, PNG, atau WEBP.'));
    cb(null, true);
  },
});

// Bungkus multer supaya galat unggahan menjadi pesan ramah, bukan 500.
function single(field) {
  const mw = upload.single(field);
  return (req, res, next) => mw(req, res, (err) => {
    if (!err) return next();
    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
      req.uploadError = `Ukuran foto terlalu besar. Maksimal ${Math.round(config.maxUploadBytes / 1024 / 1024)} MB.`;
    } else if (err instanceof UploadError) {
      req.uploadError = err.message;
    } else if (err instanceof multer.MulterError) {
      req.uploadError = 'Unggahan tidak valid. Pilih satu foto saja.';
    } else return next(err);
    next();
  });
}

// Nama objek yang sah: "<id>/<jenis>-<uuid>.<ext>" atau "berita/<hash>.webp" (tanpa "..", tanpa garis miring awal).
function checkRel(rel) {
  const r = String(rel || '');
  if (!/^[a-z0-9-]+\/[a-z0-9._-]+$/i.test(r) || r.includes('..')) throw new Error('Path tidak valid');
  return r;
}

// ---------- Backend: folder lokal ----------
function absPath(rel) {
  const abs = path.resolve(config.uploadDir, checkRel(rel));
  if (!abs.startsWith(path.resolve(config.uploadDir) + path.sep)) throw new Error('Path tidak valid');
  return abs;
}
const local = {
  async put(rel, buffer) {
    const abs = absPath(rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, buffer, { mode: 0o600 });
  },
  async read(rel) {
    try { return fs.readFileSync(absPath(rel)); } catch { return null; }
  },
  async remove(rel) {
    try { fs.unlinkSync(absPath(rel)); } catch { /* berkas sudah tidak ada */ }
  },
};

// ---------- Backend: Supabase Storage ----------
let sb = null;
let bucketReady = null;
function client() {
  if (!sb) {
    if (!config.storage.supabaseUrl || !config.storage.secretKey) throw new Error('SUPABASE_URL / SUPABASE_SECRET_KEY belum diisi.');
    const { createClient } = require('@supabase/supabase-js');
    sb = createClient(config.storage.supabaseUrl, config.storage.secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
  }
  return sb;
}
// Bucket dibuat sekali bila belum ada: privat, hanya gambar, ukuran dibatasi.
function ensureBucket() {
  if (!bucketReady) {
    bucketReady = (async () => {
      const s = client().storage;
      const { data } = await s.getBucket(config.storage.bucket);
      if (data) return;
      const { error } = await s.createBucket(config.storage.bucket, { public: false, fileSizeLimit: config.maxUploadBytes, allowedMimeTypes: Object.keys(ALLOWED) });
      if (error && !/already exists/i.test(error.message)) throw new Error(`Bucket Supabase gagal dibuat: ${error.message}`);
    })().catch((err) => { bucketReady = null; throw err; });
  }
  return bucketReady;
}
// Cache memori untuk foto yang sudah diunduh dari Supabase (nama berkas selalu unik & isinya tidak pernah
// berubah), agar halaman dengan banyak foto tidak mengunduh ulang dari server Storage yang jauh.
const MEM_LIMIT = 64 * 1024 * 1024;
const mem = new Map();
let memBytes = 0;
function memPut(rel, buf) {
  if (!buf || buf.length > 8 * 1024 * 1024) return;
  if (mem.has(rel)) memBytes -= mem.get(rel).length;
  mem.delete(rel);
  mem.set(rel, buf);
  memBytes += buf.length;
  while (memBytes > MEM_LIMIT && mem.size) { const [k, v] = mem.entries().next().value; mem.delete(k); memBytes -= v.length; }
}
function memDrop(rel) { if (mem.has(rel)) { memBytes -= mem.get(rel).length; mem.delete(rel); } }

const supabase = {
  async put(rel, buffer, mime) {
    await ensureBucket();
    const { error } = await client().storage.from(config.storage.bucket).upload(checkRel(rel), buffer, { contentType: mime, upsert: true, cacheControl: '86400' });
    if (error) throw new Error(`Gagal menyimpan foto ke Supabase Storage: ${error.message}`);
    memPut(rel, buffer);
  },
  async read(rel) {
    const hit = mem.get(checkRel(rel));
    if (hit) { mem.delete(rel); mem.set(rel, hit); return hit; } // tandai baru dipakai
    const { data, error } = await client().storage.from(config.storage.bucket).download(rel);
    if (error || !data) return null;
    const buf = Buffer.from(await data.arrayBuffer());
    memPut(rel, buf);
    return buf;
  },
  async remove(rel) {
    memDrop(rel);
    await client().storage.from(config.storage.bucket).remove([checkRel(rel)]).catch(() => {});
  },
};

function backend() {
  return config.storage.driver === 'supabase' ? supabase : local;
}

// ---------- API untuk aplikasi ----------
async function saveImage(file, userId, kind) {
  if (!file) throw new UploadError('Belum ada foto yang dipilih.');
  const real = sniffMime(file.buffer);
  if (!real || !ALLOWED[real]) throw new UploadError('Berkas bukan gambar yang valid. Gunakan foto JPG, PNG, atau WEBP.');
  const rel = path.posix.join(String(userId), `${kind}-${crypto.randomUUID()}.${ALLOWED[real]}`);
  await backend().put(rel, file.buffer, real);
  return { relPath: rel, mime: real, bytes: file.size };
}

// Foto lahan/profil: diperkecil (sisi terpanjang ≤ 1600 px), orientasi EXIF diterapkan, metadata (termasuk GPS)
// dibuang, lalu disimpan sebagai WEBP agar ringan dimuat.
async function saveOptimizedImage(file, userId, kind) {
  if (!file) throw new UploadError('Belum ada foto yang dipilih.');
  const real = sniffMime(file.buffer);
  if (!real || !ALLOWED[real]) throw new UploadError('Berkas bukan gambar yang valid. Gunakan foto JPG, PNG, atau WEBP.');
  const sharp = require('sharp');
  let buffer;
  try {
    buffer = await sharp(file.buffer).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
  } catch {
    throw new UploadError('Foto tidak dapat dibaca. Coba foto lain.');
  }
  return saveImage({ buffer, size: buffer.length }, userId, kind);
}

// Simpan berkas dengan nama tertentu (mis. salinan gambar berita "berita/<hash>.webp").
async function putFile(rel, buffer, mime) {
  await backend().put(rel, buffer, mime);
  return rel;
}

async function readFile(rel) {
  try { return await backend().read(rel); } catch { return null; }
}

async function readBase64(rel) {
  const buf = await readFile(rel);
  if (!buf) throw new Error('Foto tidak ditemukan di penyimpanan.');
  return buf.toString('base64');
}

async function removeFile(rel) {
  if (!rel) return;
  try { await backend().remove(rel); } catch { /* berkas sudah tidak ada */ }
}

function mimeOf(rel) {
  return MIME_OF[String(rel).split('.').pop().toLowerCase()] || 'application/octet-stream';
}

module.exports = {
  single, saveImage, saveOptimizedImage, putFile, readFile, readBase64, removeFile, mimeOf, absPath,
  UploadError, sniffMime, ALLOWED,
  get driver() { return config.storage.driver; },
  _backends: { local, supabase },
};
