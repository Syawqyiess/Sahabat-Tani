'use strict';
const db = require('../../db');

// Mencari referensi hama yang relevan dengan teks (nama hasil scan, gejala, pertanyaan).
async function findReferences(...texts) {
  const hay = texts.filter(Boolean).join(' ').toLowerCase();
  if (!hay.trim()) return [];
  const refs = await db.all('SELECT * FROM pest_references ORDER BY is_verified DESC, name');
  return refs.filter((r) => {
    const keys = [r.name, r.scientific_name, ...(r.aliases || '').split(',')]
      .map((k) => (k || '').trim().toLowerCase())
      .filter((k) => k.length >= 4);
    return keys.some((k) => hay.includes(k));
  }).slice(0, 3);
}

// Bentuk sumber untuk ditampilkan: hanya yang benar-benar dipakai sebagai konteks.
function toSources(refs) {
  return refs.map((r) => ({
    id: r.id,
    title: `Referensi hama: ${r.name}`,
    source_name: r.source_name || null,
    source_url: r.source_url || null,
    verified: !!r.is_verified,
    is_demo: !!r.is_demo,
  }));
}

function referenceText(refs) {
  return refs.map((r) => [
    `### ${r.name}${r.scientific_name ? ` (${r.scientific_name})` : ''} — ${r.is_verified ? 'TERVERIFIKASI' : 'BELUM DIVERIFIKASI'}`,
    r.symptoms && `Gejala: ${r.symptoms}`,
    r.visual_signs && `Ciri visual: ${r.visual_signs}`,
    r.ipm_control && `Pengendalian terpadu: ${r.ipm_control}`,
    r.prevention && `Pencegahan: ${r.prevention}`,
    r.when_to_consult && `Kapan ke penyuluh: ${r.when_to_consult}`,
  ].filter(Boolean).join('\n')).join('\n\n');
}

module.exports = { findReferences, toSources, referenceText };
