'use strict';
// Validasi input sederhana di backend; pesan kesalahan berbahasa Indonesia sederhana.

class ValidationError extends Error {
  constructor(errors) {
    super('Data belum benar');
    this.errors = errors;
  }
}

function str(v, { max = 200, required = false, label = 'Kolom ini' } = {}, errors, key) {
  const s = v === undefined || v === null ? '' : String(v).trim();
  if (!s) {
    if (required) errors[key] = `${label} wajib diisi.`;
    return null;
  }
  if (s.length > max) errors[key] = `${label} terlalu panjang (maksimal ${max} karakter).`;
  return s;
}

function num(v, { min = -Infinity, max = Infinity, int = false, label = 'Angka' } = {}, errors, key) {
  if (v === undefined || v === null || String(v).trim() === '') return null;
  const n = Number(String(v).replace(',', '.'));
  if (!Number.isFinite(n) || (int && !Number.isInteger(n))) {
    errors[key] = `${label} harus berupa angka${int ? ' bulat' : ''}.`;
    return null;
  }
  if (n < min || n > max) {
    errors[key] = `${label} harus antara ${min} dan ${max}.`;
    return null;
  }
  return n;
}

function date(v, { label = 'Tanggal' } = {}, errors, key) {
  if (!v || !String(v).trim()) return null;
  const s = String(v).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(new Date(s).getTime())) {
    errors[key] = `${label} tidak valid.`;
    return null;
  }
  return s;
}

function oneOf(v, list, { label = 'Pilihan' } = {}, errors, key) {
  if (v === undefined || v === null || v === '') return null;
  if (!list.includes(v)) {
    errors[key] = `${label} tidak valid.`;
    return null;
  }
  return v;
}

// Poligon: JSON [[lat,lng],...] minimal 3 titik, atau kosong.
function polygon(v, errors, key) {
  if (!v || !String(v).trim()) return null;
  let arr;
  try { arr = JSON.parse(v); } catch { errors[key] = 'Format batas lahan harus JSON, contoh: [[-7.025,112.528],[-7.025,112.529],[-7.026,112.529]]'; return null; }
  const ok = Array.isArray(arr) && arr.length >= 3 && arr.length <= 500 && arr.every(
    (p) => Array.isArray(p) && p.length === 2 && Math.abs(p[0]) <= 90 && Math.abs(p[1]) <= 180 && p.every(Number.isFinite),
  );
  if (!ok) { errors[key] = 'Batas lahan membutuhkan minimal 3 titik koordinat [lat, lng] yang valid.'; return null; }
  return JSON.stringify(arr);
}

module.exports = { ValidationError, str, num, date, oneOf, polygon };
