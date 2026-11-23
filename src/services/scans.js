'use strict';
const db = require('../db');
const ai = require('./ai');
const storage = require('./storage');
const { findReferences, toSources } = require('./ai/references');
const { safeJson } = require('../lib/util');
const { DEMO_LABEL } = require('./ai/demo');

const ANALYSIS_TIMEOUT_MS = 120_000;

const SUBJECT_LABEL = {
  hama_padi: 'Terlihat seperti serangan hama',
  gejala_penyakit: 'Lebih mirip gejala penyakit tanaman',
  kekurangan_hara: 'Lebih mirip kekurangan unsur hara',
  padi_tanpa_gejala_jelas: 'Tanaman padi tanpa gejala yang jelas',
  tidak_relevan: 'Foto tidak menunjukkan tanaman padi',
  tidak_jelas: 'Isi foto belum jelas',
  tidak_dianalisis: 'Belum dianalisis (mode demo)',
};

function withTimeout(promise, ms) {
  let t;
  return Promise.race([
    promise,
    new Promise((_, rej) => { t = setTimeout(() => rej(Object.assign(new Error('Analisis terlalu lama. Coba lagi.'), { retryable: true })), ms); }),
  ]).finally(() => clearTimeout(t));
}

async function getOwnedScan(userId, scanId) {
  return await db.get(
    `SELECT s.*, l.name AS land_name FROM pest_scans s LEFT JOIN lands l ON l.id = s.land_id
      WHERE s.id = ? AND s.user_id = ?`, Number(scanId), userId,
  );
}

function notesOf(scan) {
  return { land_name: scan.land_name, plant_age_days: scan.plant_age_days, affected_part: scan.affected_part, symptoms: scan.symptoms };
}

function composeInitialMessage(result, mode) {
  const L = [];
  if (mode === 'demo') {
    L.push(result.farmer_message, '');
  } else {
    L.push(result.farmer_message, '');
    if (result.photo_quality && result.photo_quality.is_clear === false) {
      L.push(`**Foto kurang jelas:** ${(result.photo_quality.issues || []).join('; ') || 'detail sulit dilihat'}. Hasil di bawah perlu dikonfirmasi dengan foto yang lebih jelas.`, '');
    }
    const sci = result.suspected_pest_scientific ? ` (*${result.suspected_pest_scientific}*)` : '';
    if (result.confidence) {
      // Model dengan tingkat keyakinan terukur: satu baris hasil yang tegas, tanpa daftar persen.
      if (result.identified && result.suspected_pest_name) L.push(`**Hasil:** ${result.suspected_pest_name}${sci} — **${result.confidence.label}**`);
    } else {
      L.push(`**Dugaan awal:** ${result.identified && result.suspected_pest_name ? `${result.suspected_pest_name}${sci}` : 'Hama belum dapat diidentifikasi dari foto ini.'}`);
      if (SUBJECT_LABEL[result.subject]) L.push(`**Kategori foto:** ${SUBJECT_LABEL[result.subject]}`);
    }
    if (result.visual_evidence && result.visual_evidence.length) {
      L.push('', '**Ciri yang terlihat di foto:**', ...result.visual_evidence.map((x) => `- ${x}`));
    }
    if (result.alternatives && result.alternatives.length) {
      L.push('', '**Kemungkinan lain:**', ...result.alternatives.map((a) => `- ${a.name} — ${a.reason}`));
    }
    if (result.non_pest_note) L.push('', `**Catatan:** ${result.non_pest_note}`);
  }
  const firm = result.confidence && result.confidence.key !== 'rendah';
  if (result.initial_steps && result.initial_steps.length) {
    L.push('', firm ? '**Yang bisa dilakukan sekarang:**' : '**Langkah pemeriksaan dan penanganan awal:**', ...result.initial_steps.map((x, i) => `${i + 1}. ${x}`));
  }
  if (result.follow_up_questions && result.follow_up_questions.length) {
    L.push('', firm ? '**Supaya sarannya lebih pas:**' : '**Agar dugaan lebih tepat, mohon jawab:**', ...result.follow_up_questions.map((x) => `- ${x}`));
  }
  L.push('', '_Hasil foto adalah bantuan awal — bila ragu atau serangan meluas, minta penyuluh (PPL/POPT) memeriksa langsung. Untuk pestisida, ikuti label resmi._');
  return L.join('\n');
}

async function analyzeAndPost(scanId) {
  const scan = await db.get('SELECT s.*, l.name AS land_name FROM pest_scans s LEFT JOIN lands l ON l.id = s.land_id WHERE s.id = ?', scanId);
  const svc = ai.vision();
  const started = Date.now();
  await db.run("UPDATE pest_scans SET status = 'processing', started_at = datetime('now'), error_message = NULL WHERE id = ?", scanId);
  const refsBefore = await findReferences(scan.symptoms, scan.affected_part);
  try {
    const { result, model } = await withTimeout(
      svc.analyze({ imagePath: scan.image_path, mime: scan.image_mime, notes: notesOf(scan), references: refsBefore }),
      ANALYSIS_TIMEOUT_MS,
    );
    const refs = await findReferences(result.suspected_pest_name, result.suspected_pest_scientific);
    await db.tx(async () => {
      await db.run(
        `UPDATE pest_scans SET status = 'completed', mode = ?, provider = ?, model = ?, result_json = ?,
                completed_at = datetime('now'), processing_ms = ? WHERE id = ?`,
        svc.mode, svc.name, model, JSON.stringify(result), Date.now() - started, scanId,
      );
      await db.run(
        'INSERT INTO chat_messages (session_id, role, content, mode, provider, model, sources_json) VALUES (?, ?, ?, ?, ?, ?, ?)',
        scan.chat_session_id, 'assistant', composeInitialMessage(result, svc.mode), svc.mode, svc.name, model,
        refs.length ? JSON.stringify(toSources(refs)) : null,
      );
      if (result.identified && result.suspected_pest_name) {
        await db.run("UPDATE chat_sessions SET title = ?, updated_at = datetime('now') WHERE id = ?", `Scan: ${result.confidence && result.confidence.key === 'tinggi' ? '' : 'dugaan '}${result.suspected_pest_name}`, scan.chat_session_id);
      }
    });
    return { ok: true };
  } catch (err) {
    console.error(`[scan ${scanId}] analisis gagal:`, err.message);
    const msg = err.message && /[a-z]/.test(err.message) && err.retryable !== undefined
      ? err.message : 'Layanan analisis sedang bermasalah. Coba lagi nanti.';
    await db.tx(async () => {
      await db.run(
        `UPDATE pest_scans SET status = 'failed', mode = ?, provider = ?, error_message = ?, completed_at = datetime('now'),
                processing_ms = ? WHERE id = ?`, svc.mode, svc.name, msg, Date.now() - started, scanId,
      );
      await db.run(
        'INSERT INTO chat_messages (session_id, role, content) VALUES (?, ?, ?)',
        scan.chat_session_id, 'system', `Foto belum berhasil dianalisis. ${msg}`,
      );
    });
    return { ok: false, error: msg };
  }
}

// Membuat scan + sesi chat sekaligus. Kunci idempoten mencegah scan ganda saat tombol ditekan berulang.
async function createScan(user, { file, idempotencyKey, landId, plantAge, plantAgeSource = null, affectedPart, symptoms }) {
  const existing = await db.get('SELECT id, chat_session_id FROM pest_scans WHERE user_id = ? AND idempotency_key = ?', user.id, idempotencyKey);
  if (existing) return { scanId: existing.id, sessionId: existing.chat_session_id, duplicate: true };

  const saved = await storage.saveImage(file, user.id, 'scan');
  let ids;
  try {
    ids = await db.tx(async () => {
      const r = await db.run(
        `INSERT INTO pest_scans (user_id, land_id, idempotency_key, image_path, image_mime, image_bytes, plant_age_days, plant_age_source, affected_part, symptoms, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
        user.id, landId, idempotencyKey, saved.relPath, saved.mime, saved.bytes, plantAge, plantAgeSource, affectedPart, symptoms,
      );
      const scanId = Number(r.lastInsertRowid);
      const s = await db.run('INSERT INTO chat_sessions (user_id, scan_id, title) VALUES (?, ?, ?)', user.id, scanId, `Scan hama #${scanId}`);
      const sessionId = Number(s.lastInsertRowid);
      await db.run('UPDATE pest_scans SET chat_session_id = ? WHERE id = ?', sessionId, scanId);
      const notes = [
        'Foto dari Scan Hama Padi.',
        landId && `Lahan: ${(await db.get('SELECT name FROM lands WHERE id = ?', landId)).name}`,
        plantAge != null && `Umur tanaman: ${plantAge} hari${plantAgeSource === 'tanggal-tanam' ? ' (dari tanggal tanam)' : ''}`,
        affectedPart && `Bagian terdampak: ${affectedPart}`,
        symptoms && `Gejala: ${symptoms}`,
      ].filter(Boolean).join('\n');
      await db.run('INSERT INTO chat_messages (session_id, role, content, image_path, image_mime) VALUES (?, ?, ?, ?, ?)',
        sessionId, 'user', notes, saved.relPath, saved.mime);
      return { scanId, sessionId };
    });
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      const again = await db.get('SELECT id, chat_session_id FROM pest_scans WHERE user_id = ? AND idempotency_key = ?', user.id, idempotencyKey);
      if (again) return { scanId: again.id, sessionId: again.chat_session_id, duplicate: true };
    }
    throw err;
  }
  const outcome = await analyzeAndPost(ids.scanId);
  return { ...ids, ...outcome };
}

async function retryScan(user, scanId) {
  const scan = await getOwnedScan(user.id, scanId);
  if (!scan) return null;
  if (scan.status !== 'failed') return { scanId: scan.id, sessionId: scan.chat_session_id, ok: scan.status === 'completed' };
  // Klaim atomik agar dua klik "Coba lagi" tidak memproses dua kali.
  const claim = await db.run("UPDATE pest_scans SET status = 'processing' WHERE id = ? AND status = 'failed'", scan.id);
  if (!claim.changes) return { scanId: scan.id, sessionId: scan.chat_session_id, ok: false };
  const outcome = await analyzeAndPost(scan.id);
  return { scanId: scan.id, sessionId: scan.chat_session_id, ...outcome };
}

function scanView(scan) {
  return { ...scan, result: safeJson(scan.result_json), notes: notesOf(scan) };
}

module.exports = { createScan, retryScan, getOwnedScan, scanView, composeInitialMessage, SUBJECT_LABEL, DEMO_LABEL };
