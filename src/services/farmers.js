'use strict';
const crop = require('../lib/crop');
const db = require('../db');

const PROFILE_FIELDS = [
  { key: 'photo_path', label: 'Foto profil' },
  { key: 'full_name', label: 'Nama lengkap' },
  { key: 'phone', label: 'Nomor telepon' },
  { key: 'village', label: 'Desa/kelurahan' },
  { key: 'district', label: 'Kecamatan' },
  { key: 'regency', label: 'Kabupaten/kota' },
  { key: 'province', label: 'Provinsi' },
  { key: 'main_commodity', label: 'Komoditas utama' },
];

function getProfile(userId) {
  return db.get(
    `SELECT u.id AS user_id, u.phone, u.email, u.created_at AS joined_at, u.is_demo, u.is_active, u.role,
            p.full_name, p.photo_path, p.village, p.district, p.regency, p.province,
            p.farmer_group, p.experience_years, p.main_commodity, p.updated_at
       FROM users u LEFT JOIN farmer_profiles p ON p.user_id = u.id WHERE u.id = ?`, userId,
  );
}

function completeness(profile) {
  const missing = PROFILE_FIELDS.filter((f) => profile[f.key] == null || profile[f.key] === '');
  return {
    percent: Math.round(((PROFILE_FIELDS.length - missing.length) / PROFILE_FIELDS.length) * 100),
    missing: missing.map((f) => f.label),
  };
}

// Ringkasan lahan milik pengguna — satu perhitungan untuk Dashboard, Lahan Saya, dan Profil.
function landSummary(userId) {
  const lands = db.all('SELECT area_ha, data_source FROM lands WHERE user_id = ?', userId);
  const a = crop.areaSummary(lands);
  return { count: a.count, totalArea: a.total, totalLabel: a.totalLabel, noArea: a.missing, withArea: a.withArea, demoCount: lands.filter((l) => l.data_source === 'demo').length };
}

function updateProfile(userId, data) {
  db.run(
    `INSERT INTO farmer_profiles (user_id, full_name, village, district, regency, province, farmer_group, experience_years, main_commodity, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET full_name = excluded.full_name, village = excluded.village, district = excluded.district,
       regency = excluded.regency, province = excluded.province, farmer_group = excluded.farmer_group,
       experience_years = excluded.experience_years, main_commodity = excluded.main_commodity, updated_at = excluded.updated_at`,
    userId, data.full_name, data.village, data.district, data.regency, data.province, data.farmer_group, data.experience_years, data.main_commodity,
  );
}

module.exports = { getProfile, completeness, landSummary, updateProfile, PROFILE_FIELDS };
