'use strict';
const db = require('../db');
const config = require('../config');

// Open-Meteo Air Quality API — gratis untuk penggunaan non-komersial (lihat docs/INTEGRASI.md).
// Data berupa estimasi model (CAMS/Copernicus), BUKAN pengukuran sensor di lahan.

// Kategori US AQI (US EPA). Kita memakai US AQI apa adanya dan TIDAK mengonversinya ke ISPU Indonesia.
const US_AQI_CATEGORIES = [
  { max: 50, label: 'Baik', tone: 'good', advice: 'Kualitas udara memuaskan.' },
  { max: 100, label: 'Sedang', tone: 'moderate', advice: 'Dapat diterima; orang yang sangat sensitif sebaiknya mengurangi aktivitas berat di luar ruangan.' },
  { max: 150, label: 'Tidak sehat bagi kelompok sensitif', tone: 'usg', advice: 'Anak-anak, lansia, dan penderita gangguan pernapasan sebaiknya membatasi aktivitas berat di luar.' },
  { max: 200, label: 'Tidak sehat', tone: 'unhealthy', advice: 'Kurangi aktivitas berat di luar ruangan; pertimbangkan masker saat bekerja di lahan.' },
  { max: 300, label: 'Sangat tidak sehat', tone: 'very', advice: 'Hindari aktivitas berat di luar ruangan.' },
  { max: Infinity, label: 'Berbahaya', tone: 'hazard', advice: 'Hindari aktivitas di luar ruangan.' },
];

function categorize(aqi) {
  if (aqi == null || !Number.isFinite(aqi)) return null;
  return US_AQI_CATEGORIES.find((c) => aqi <= c.max);
}

const CURRENT_VARS = ['us_aqi', 'pm2_5', 'pm10', 'nitrogen_dioxide', 'ozone', 'carbon_monoxide'];
const HOURLY_VARS = ['us_aqi', 'pm2_5', 'pm10'];

function cacheKey(lat, lng) {
  return `${lat.toFixed(2)},${lng.toFixed(2)}`; // ~1 km grid, hemat permintaan
}

function logEvent(ok, message) {
  try { db.run('INSERT INTO integration_events (service, ok, message) VALUES (?, ?, ?)', 'open-meteo', ok ? 1 : 0, message); } catch { /* abaikan */ }
}

async function fetchRemote(lat, lng) {
  const u = new URL(config.air.baseUrl);
  u.searchParams.set('latitude', lat.toFixed(4));
  u.searchParams.set('longitude', lng.toFixed(4));
  u.searchParams.set('current', CURRENT_VARS.join(','));
  u.searchParams.set('hourly', HOURLY_VARS.join(','));
  u.searchParams.set('past_days', '1');
  u.searchParams.set('forecast_days', '1');
  u.searchParams.set('timezone', 'auto');
  const res = await fetch(u, { signal: AbortSignal.timeout(config.air.timeoutMs), headers: { 'user-agent': 'SahabatTani/0.1 (demo non-komersial)' } });
  if (res.status === 429) throw Object.assign(new Error('Kuota permintaan Open-Meteo habis untuk sementara.'), { code: 'QUOTA' });
  if (!res.ok) throw Object.assign(new Error(`Open-Meteo merespons ${res.status}.`), { code: 'HTTP' });
  const data = await res.json();
  if (data.error) throw Object.assign(new Error(data.reason || 'Open-Meteo mengembalikan galat.'), { code: 'API' });
  return data;
}

function shape(data, fetchedAt, stale) {
  const cur = data.current || {};
  const units = data.current_units || {};
  const hourly = data.hourly || {};
  const nowIso = cur.time;
  const series = (hourly.time || []).map((t, i) => ({ time: t, us_aqi: hourly.us_aqi?.[i] ?? null, pm2_5: hourly.pm2_5?.[i] ?? null }))
    .filter((p) => !nowIso || p.time <= nowIso).slice(-24);
  const params = [
    { key: 'pm2_5', label: 'PM2.5' }, { key: 'pm10', label: 'PM10' },
    { key: 'nitrogen_dioxide', label: 'NO₂' }, { key: 'ozone', label: 'O₃' }, { key: 'carbon_monoxide', label: 'CO' },
  ].map((p) => ({ ...p, value: cur[p.key] ?? null, unit: units[p.key] || '' }));
  const empty = cur.us_aqi == null && params.every((p) => p.value == null);
  return {
    empty,
    stale,
    fetchedAt,
    dataTime: cur.time || null,
    timezone: data.timezone || null,
    tzAbbr: data.timezone_abbreviation || null,
    gridLat: data.latitude, gridLng: data.longitude,
    aqi: cur.us_aqi ?? null,
    indexName: 'US AQI (standar US EPA)',
    category: categorize(cur.us_aqi),
    params,
    series,
  };
}

// Mengambil data dengan cache. Bila gagal, tampilkan data lama dengan penanda waktunya — tidak pernah angka simulasi.
async function getAirQuality(lat, lng, { force = false } = {}) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { error: 'Koordinat lokasi tidak valid.' };
  const key = cacheKey(lat, lng);
  const cached = db.get('SELECT payload, fetched_at FROM air_quality_cache WHERE cache_key = ?', key);
  const ageMin = cached ? (Date.now() - Date.parse(cached.fetched_at)) / 60000 : Infinity;
  if (cached && !force && ageMin < config.air.cacheMinutes) {
    return { data: shape(JSON.parse(cached.payload), cached.fetched_at, false), fromCache: true };
  }
  try {
    const raw = await fetchRemote(lat, lng);
    const fetchedAt = new Date().toISOString();
    db.run(
      `INSERT INTO air_quality_cache (cache_key, payload, fetched_at) VALUES (?, ?, ?)
       ON CONFLICT(cache_key) DO UPDATE SET payload = excluded.payload, fetched_at = excluded.fetched_at`,
      key, JSON.stringify(raw), fetchedAt,
    );
    logEvent(true, `OK ${key}`);
    return { data: shape(raw, fetchedAt, false), fromCache: false };
  } catch (err) {
    const reason = err.name === 'TimeoutError' || err.name === 'AbortError'
      ? 'Layanan kualitas udara tidak merespons (waktu habis).'
      : err.code ? err.message : 'Tidak dapat terhubung ke layanan kualitas udara.';
    logEvent(false, reason);
    if (cached) return { data: shape(JSON.parse(cached.payload), cached.fetched_at, true), warning: `${reason} Menampilkan data terakhir yang tersimpan.` };
    return { error: reason };
  }
}

module.exports = { getAirQuality, categorize, US_AQI_CATEGORIES };
