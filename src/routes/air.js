'use strict';
const express = require('express');
const db = require('../db');
const config = require('../config');
const air = require('../services/airQuality');
const { requireRole } = require('../middleware/security');

const router = express.Router();
const farmerOnly = requireRole('farmer');

// Menentukan lokasi: lahan terpilih → lokasi perangkat (dengan izin) → lahan pertama berkoordinat → lokasi demo.
function resolveLocation(req) {
  const lands = db.all('SELECT id, name, lat, lng, data_source FROM lands WHERE user_id = ? AND lat IS NOT NULL AND lng IS NOT NULL ORDER BY created_at', req.user.id);
  const landId = Number(req.query.lahan);
  if (landId) {
    const l = lands.find((x) => x.id === landId);
    if (l) return { lands, loc: { lat: l.lat, lng: l.lng, label: l.name, kind: l.data_source === 'demo' ? 'land-demo' : 'land', landId: l.id } };
  }
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  if (req.query.src === 'perangkat' && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
    return { lands, loc: { lat, lng, label: 'Lokasi perangkat Anda', kind: 'device' } };
  }
  if (lands.length && req.query.src !== 'demo') {
    const l = lands[0];
    return { lands, loc: { lat: l.lat, lng: l.lng, label: l.name, kind: l.data_source === 'demo' ? 'land-demo' : 'land', landId: l.id } };
  }
  const c = config.maps.demoCenter;
  return { lands, loc: { lat: c.lat, lng: c.lng, label: c.label, kind: 'demo' } };
}

router.get('/udara', farmerOnly, async (req, res) => {
  const { lands, loc } = resolveLocation(req);
  const out = await air.getAirQuality(loc.lat, loc.lng, { force: req.query.segarkan === '1' });
  const layer = WINDY_LAYERS.find((l) => l.id === req.query.lapisan) || WINDY_LAYERS[0];
  res.render('farmer/air', {
    title: 'Informasi Kualitas Udara', lands, loc, ...out, categories: air.US_AQI_CATEGORIES,
    windy: { layers: WINDY_LAYERS, active: layer, url: windyUrl(loc, layer.id), center: windyCenter(loc) },
  });
});

// Peta sebaran polusi dari widget embed resmi Windy (lapisan data CAMS/Copernicus).
const WINDY_LAYERS = [
  { id: 'pm2p5', label: 'PM2.5' },
  { id: 'no2', label: 'NO₂' },
  { id: 'cosc', label: 'CO' },
  { id: 'go3', label: 'Ozon permukaan' },
  { id: 'dustsm', label: 'Debu' },
];

// Pusat peta: Desa Mojopuro Wetan (titik Balai Desa dari OpenStreetMap, config.maps.demoCenter) bila lokasi yang
// dipilih berada ≤ 15 km darinya; selain itu pusat = lokasi itu sendiri. Penanda (detailLat/Lon) selalu di titik
// lokasi yang dipilih — pusat desa tidak disajikan sebagai titik lahan.
function distanceKm(a, b) {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function windyCenter(loc) {
  const v = config.maps.demoCenter;
  return distanceKm(loc, v) <= 15 ? { lat: v.lat, lng: v.lng, label: v.label, village: true } : { lat: loc.lat, lng: loc.lng, label: loc.label, village: false };
}
function windyUrl(loc, overlay) {
  const c = windyCenter(loc);
  const p = new URLSearchParams({
    type: 'map', location: 'coordinates', metricRain: 'default', metricTemp: 'default', metricWind: 'default',
    zoom: c.village ? '10' : '8', overlay, product: 'cams', level: 'surface',
    lat: c.lat.toFixed(4), lon: c.lng.toFixed(4), detailLat: loc.lat.toFixed(4), detailLon: loc.lng.toFixed(4),
    marker: 'true', message: 'true', lang: 'id',
  });
  return `https://embed.windy.com/embed.html?${p}`;
}

router.windyUrl = windyUrl;

// Potongan HTML untuk dashboard (dimuat setelah halaman tampil agar dashboard tetap cepat).
router.get('/udara/ringkas', farmerOnly, async (req, res) => {
  const { loc } = resolveLocation(req);
  const out = await air.getAirQuality(loc.lat, loc.lng);
  res.render('partials/air-summary', { loc, ...out });
});

module.exports = router;
