'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const multer = require('multer');
const config = require('../config');

// Foto disimpan di luar folder publik; akses lewat rute /media yang memeriksa pemilik.
// Untuk produksi, modul ini bisa diganti dengan object storage (S3/GCS) privat.

const ALLOWED = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

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

function saveImage(file, userId, kind) {
  if (!file) throw new UploadError('Belum ada foto yang dipilih.');
  const real = sniffMime(file.buffer);
  if (!real || !ALLOWED[real]) throw new UploadError('Berkas bukan gambar yang valid. Gunakan foto JPG, PNG, atau WEBP.');
  const rel = path.posix.join(String(userId), `${kind}-${crypto.randomUUID()}.${ALLOWED[real]}`);
  const abs = path.join(config.uploadDir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, file.buffer, { mode: 0o600 });
  return { relPath: rel, mime: real, bytes: file.size };
}

function absPath(rel) {
  const abs = path.resolve(config.uploadDir, rel);
  if (!abs.startsWith(path.resolve(config.uploadDir) + path.sep)) throw new Error('Path tidak valid');
  return abs;
}

function readBase64(rel) {
  return fs.readFileSync(absPath(rel)).toString('base64');
}

module.exports = { single, saveImage, absPath, readBase64, UploadError, sniffMime, ALLOWED };
