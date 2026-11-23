'use strict';
const path = require('node:path');
const fs = require('node:fs');
const db = require('./index');

async function syncKnowledgeBase() {
  console.log('Menjalankan migrasi database...');
  await db.migrate();

  const stagesFile = path.join(__dirname, '../data/growth-stages.json');
  const varietiesFile = path.join(__dirname, '../data/crop-varieties.json');

  if (fs.existsSync(stagesFile)) {
    const raw = JSON.parse(fs.readFileSync(stagesFile, 'utf8'));
    const stages = raw.stages || [];
    console.log(`Menyinkronkan ${stages.length} fase pertumbuhan padi...`);

    for (const s of stages) {
      const existing = await db.get('SELECT id FROM crop_stages WHERE stage_id = ?', s.stage_id);
      if (existing) {
        await db.run(
          `UPDATE crop_stages SET min_hst = ?, max_hst = ?, nama_fase = ?, kategori_fase = ?, ciri_fisik = ?,
           manajemen_air = ?, kegiatan_json = ?, ancaman_opt_json = ?, tips_pht_json = ?
           WHERE stage_id = ?`,
          s.rentang_hst[0],
          s.rentang_hst[1],
          s.nama_fase,
          s.kategori_fase,
          s.ciri_fisik_tanaman || null,
          s.manajemen_air || null,
          JSON.stringify(s.rekomendasi_kegiatan_kalender || []),
          JSON.stringify(s.ancaman_opt_utama || []),
          JSON.stringify(s.tips_pengamatan_dan_pht || []),
          s.stage_id,
        );
      } else {
        await db.run(
          `INSERT INTO crop_stages (stage_id, min_hst, max_hst, nama_fase, kategori_fase, ciri_fisik,
           manajemen_air, kegiatan_json, ancaman_opt_json, tips_pht_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          s.stage_id,
          s.rentang_hst[0],
          s.rentang_hst[1],
          s.nama_fase,
          s.kategori_fase,
          s.ciri_fisik_tanaman || null,
          s.manajemen_air || null,
          JSON.stringify(s.rekomendasi_kegiatan_kalender || []),
          JSON.stringify(s.ancaman_opt_utama || []),
          JSON.stringify(s.tips_pengamatan_dan_pht || []),
        );
      }
    }
  }

  if (fs.existsSync(varietiesFile)) {
    const raw = JSON.parse(fs.readFileSync(varietiesFile, 'utf8'));
    const varieties = raw.varieties || [];
    console.log(`Menyinkronkan ${varieties.length} varietas padi unggul...`);

    for (const v of varieties) {
      const existing = await db.get('SELECT id FROM crop_varieties WHERE variety_id = ?', v.variety_id);
      if (existing) {
        await db.run(
          `UPDATE crop_varieties SET nama = ?, tipe = ?, umur_hss = ?, min_hst = ?, max_hst = ?,
           rata_rata_hasil = ?, potensi_hasil = ?, ketahanan_opt = ?, manajemen_air = ?, pemupukan = ?,
           kesesuaian_lahan = ?, is_priority_gresik = ?
           WHERE variety_id = ?`,
          v.nama,
          v.tipe || null,
          v.umur_hss || null,
          Array.isArray(v.umur_hst) ? v.umur_hst[0] : null,
          Array.isArray(v.umur_hst) ? v.umur_hst[1] : null,
          v.rata_rata_hasil || null,
          v.potensi_hasil || null,
          v.ketahanan_opt || null,
          v.manajemen_air || null,
          v.pemupukan || null,
          v.kesesuaian_lahan || null,
          v.is_priority_gresik ? 1 : 0,
          v.variety_id,
        );
      } else {
        await db.run(
          `INSERT INTO crop_varieties (variety_id, nama, tipe, umur_hss, min_hst, max_hst,
           rata_rata_hasil, potensi_hasil, ketahanan_opt, manajemen_air, pemupukan, kesesuaian_lahan, is_priority_gresik)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          v.variety_id,
          v.nama,
          v.tipe || null,
          v.umur_hss || null,
          Array.isArray(v.umur_hst) ? v.umur_hst[0] : null,
          Array.isArray(v.umur_hst) ? v.umur_hst[1] : null,
          v.rata_rata_hasil || null,
          v.potensi_hasil || null,
          v.ketahanan_opt || null,
          v.manajemen_air || null,
          v.pemupukan || null,
          v.kesesuaian_lahan || null,
          v.is_priority_gresik ? 1 : 0,
        );
      }
    }
  }

  console.log('✅ Sinkronisasi knowledge base masa tanam dan varietas selesai!');
}

if (require.main === module) {
  syncKnowledgeBase()
    .then(async () => {
      await db.close();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('Galat sinkronisasi KB:', err);
      await db.close();
      process.exit(1);
    });
}

module.exports = { syncKnowledgeBase };
