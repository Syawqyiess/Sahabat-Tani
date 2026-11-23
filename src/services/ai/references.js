'use strict';
const db = require('../../db');

// Ekstraksi angka HST dari teks (misal "30 hst", "umur 25 hari setelah tanam", "20 HST")
function extractHst(text) {
  const m = String(text || '').match(/\b(\d+)\s*(?:hst|hari\s*setelah\s*tanam)\b/i)
    || String(text || '').match(/\b(?:umur|usia)\s*(?:tanaman\s*)?(\d+)\b/i);
  return m ? Number(m[1]) : null;
}

// Mencari referensi (hama, fase pertumbuhan/masa tanam, dan varietas) yang relevan.
async function findReferences(...texts) {
  const hay = texts.filter(Boolean).join(' ').toLowerCase();
  if (!hay.trim()) return [];

  const results = [];

  // 1. Cek Hama & Penyakit (tabel pest_references)
  try {
    const pestRows = await db.all('SELECT * FROM pest_references ORDER BY is_verified DESC, name');
    const matchedPests = pestRows.filter((r) => {
      const keys = [r.name, r.scientific_name, ...(r.aliases || '').split(',')]
        .map((k) => (k || '').trim().toLowerCase())
        .filter((k) => k.length >= 4);
      return keys.some((k) => hay.includes(k));
    }).slice(0, 3);
    for (const p of matchedPests) {
      results.push({ ...p, ref_type: 'pest' });
    }
  } catch (err) {
    console.warn('[references] Gagal mengambil pest_references:', err.message);
  }

  // 2. Cek Fase Pertumbuhan / Masa Tanam (tabel crop_stages)
  try {
    const hst = extractHst(hay);
    let stageRows = [];
    if (hst != null) {
      stageRows = await db.all('SELECT * FROM crop_stages WHERE min_hst <= ? AND max_hst >= ?', hst, hst);
    }

    // Jika tidak ada angka HST persis, cari berdasarkan kata kunci fase/agronomi
    if (!stageRows.length) {
      const stageKeywords = [
        ['vegetatif awal', 'GS-001'],
        ['bibit', 'GS-001'],
        ['anakan', 'GS-003'],
        ['bwd', 'GS-004'],
        ['anakan maksimal', 'GS-005'],
        ['primordia', 'GS-006'],
        ['bunting', 'GS-006'],
        ['malai', 'GS-007'],
        ['bunga', 'GS-008'],
        ['berbunga', 'GS-008'],
        ['pembungaan', 'GS-008'],
        ['masak susu', 'GS-009'],
        ['pengisian bulir', 'GS-009'],
        ['masak kunyit', 'GS-010'],
        ['panen', 'GS-011'],
        ['pematangan', 'GS-011'],
      ];
      for (const [kw, sid] of stageKeywords) {
        if (hay.includes(kw)) {
          const row = await db.get('SELECT * FROM crop_stages WHERE stage_id = ?', sid);
          if (row && !stageRows.some((s) => s.id === row.id)) {
            stageRows.push(row);
            if (stageRows.length >= 2) break;
          }
        }
      }
    }

    for (const s of stageRows) {
      results.push({
        ...s,
        ref_type: 'stage',
        name: s.nama_fase,
        is_verified: 1,
        source_name: 'Petunjuk Lapang PTT Padi Sawah / Jarwo Super, Balitbangtan Kementan',
      });
    }
  } catch (err) {
    console.warn('[references] Gagal mengambil crop_stages:', err.message);
  }

  // 3. Cek Varietas Padi (tabel crop_varieties)
  try {
    const varieties = await db.all('SELECT * FROM crop_varieties ORDER BY is_priority_gresik DESC, nama');
    const matchedVars = varieties.filter((v) => {
      const name = (v.nama || '').toLowerCase();
      const simple = name.replace(/[^a-z0-9]/g, '');
      const haySimple = hay.replace(/[^a-z0-9]/g, '');

      // Cocokkan nama langsung
      if (hay.includes(name) || haySimple.includes(simple)) return true;

      // Cocokkan kata kunci khusus varietas (rendaman, salin, gsr, ciherang, mekongga, ir 64, inpari 32)
      if (hay.includes('rendaman') && name.includes('rendaman')) return true;
      if (hay.includes('sub-1') && name.includes('sub-1')) return true;
      if (hay.includes('salin') && name.includes('salin')) return true;
      if (hay.includes('gsr') && name.includes('gsr')) return true;
      if (hay.includes('ciherang') && name.includes('ciherang')) return true;
      if (hay.includes('mekongga') && name.includes('mekongga')) return true;
      if (hay.includes('ir 64') && name.includes('ir 64')) return true;
      if ((hay.includes('inpari 32') || hay.includes('inpari-32')) && name.includes('inpari 32')) return true;
      if ((hay.includes('inpari 42') || hay.includes('inpari-42')) && name.includes('inpari 42')) return true;

      // Cocokkan kondisi lahan (misal petani tanya varietas untuk lahan banjir / salin)
      if (hay.includes('banjir') && (v.kesesuaian_lahan || '').toLowerCase().includes('banjir')) return true;
      if (hay.includes('salin') && (v.kesesuaian_lahan || '').toLowerCase().includes('salin')) return true;

      return false;
    }).slice(0, 2);

    for (const v of matchedVars) {
      results.push({
        ...v,
        ref_type: 'variety',
        name: v.nama,
        is_verified: 1,
        source_name: 'Balitbangtan Kementan / Repository Pertanian',
      });
    }
  } catch (err) {
    console.warn('[references] Gagal mengambil crop_varieties:', err.message);
  }

  return results;
}

// Format sumber rujukan untuk ditampilkan di antarmuka chat
function toSources(refs) {
  return refs.map((r) => {
    let title = `Referensi hama: ${r.name}`;
    if (r.ref_type === 'stage') {
      title = `Fase pertumbuhan: ${r.nama_fase} (${r.min_hst}–${r.max_hst} HST)`;
    } else if (r.ref_type === 'variety') {
      title = `Varietas: ${r.nama}`;
    }
    return {
      id: r.id,
      title,
      source_name: r.source_name || null,
      source_url: r.source_url || null,
      verified: !!r.is_verified,
      is_demo: !!r.is_demo,
    };
  });
}

function parseJsonSafe(str, fallback = []) {
  if (!str) return fallback;
  try { return JSON.parse(str); } catch { return fallback; }
}

// Format teks referensi yang disuntikkan ke System Prompt AI
function referenceText(refs) {
  return refs.map((r) => {
    if (r.ref_type === 'stage') {
      const tasks = parseJsonSafe(r.kegiatan_json, []);
      const pests = parseJsonSafe(r.ancaman_opt_json, []);
      const tips = parseJsonSafe(r.tips_pht_json, []);

      return [
        `### PANDUAN MASA TANAM: ${r.nama_fase} (${r.min_hst}–${r.max_hst} HST) — Kategori: ${r.kategori_fase} (TERVERIFIKASI BALITBANGTAN)`,
        r.ciri_fisik && `Ciri fisik tanaman: ${r.ciri_fisik}`,
        r.manajemen_air && `Pengaturan/Manajemen Air: ${r.manajemen_air}`,
        tasks.length && `Rekomendasi Kegiatan & Pemupukan:\n${tasks.map((t) => `  - [${t.kategori || 'kegiatan'}] ${t.judul}: ${t.catatan_teknis || ''}`).join('\n')}`,
        pests.length && `Ancaman OPT Utama Fase Ini: ${pests.join(', ')}`,
        tips.length && `Tips PHT & Pengamatan:\n${tips.map((tip) => `  - ${tip}`).join('\n')}`,
      ].filter(Boolean).join('\n');
    }

    if (r.ref_type === 'variety') {
      return [
        `### PANDUAN VARIETAS PADI: ${r.nama} (${r.tipe || 'Inbrida'}) — Rekomendasi Jatim/Gresik (TERVERIFIKASI)`,
        r.min_hst != null && `Umur panen: ${r.min_hst}–${r.max_hst} HST (sekitar ${r.umur_hss || ''})`,
        r.potensi_hasil && `Potensi hasil: ${r.potensi_hasil} (Rata-rata: ${r.rata_rata_hasil || '-'})`,
        r.ketahanan_opt && `Ketahanan Hama & Penyakit: ${r.ketahanan_opt}`,
        r.manajemen_air && `Manajemen air: ${r.manajemen_air}`,
        r.pemupukan && `Panduan pemupukan: ${r.pemupukan}`,
        r.kesesuaian_lahan && `Kesesuaian lahan: ${r.kesesuaian_lahan}`,
      ].filter(Boolean).join('\n');
    }

    // Default: hama & penyakit
    return [
      `### ${r.name}${r.scientific_name ? ` (${r.scientific_name})` : ''} — ${r.is_verified ? 'TERVERIFIKASI' : 'BELUM DIVERIFIKASI'}`,
      r.symptoms && `Gejala: ${r.symptoms}`,
      r.visual_signs && `Ciri visual: ${r.visual_signs}`,
      r.ipm_control && `Pengendalian terpadu: ${r.ipm_control}`,
      r.prevention && `Pencegahan: ${r.prevention}`,
      r.when_to_consult && `Kapan ke penyuluh: ${r.when_to_consult}`,
    ].filter(Boolean).join('\n');
  }).join('\n\n');
}

module.exports = { findReferences, toSources, referenceText, extractHst };
