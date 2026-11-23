'use strict';
const db = require('../db');
const ai = require('./ai');
const storage = require('./storage');
const scans = require('./scans');
const crop = require('../lib/crop');
const { findReferences, toSources } = require('./ai/references');

async function getOwnedSession(userId, sessionId) {
  return await db.get('SELECT * FROM chat_sessions WHERE id = ? AND user_id = ?', Number(sessionId), userId);
}

async function messagesOf(sessionId) {
  return await db.all('SELECT * FROM chat_messages WHERE session_id = ? ORDER BY id', sessionId);
}

async function scanContext(userId, session) {
  if (!session.scan_id) return null;
  const s = await scans.getOwnedScan(userId, session.scan_id);
  return s ? scans.scanView(s) : null;
}

async function generateReply(user, session) {
  const history = await messagesOf(session.id);
  const scan = await scanContext(user.id, session);
  const lastUser = [...history].reverse().find((m) => m.role === 'user');

  // Ambil konteks lahan aktif/pertama milik petani (HST & varietas)
  let landContextStr = '';
  try {
    const lands = await db.all('SELECT * FROM lands WHERE user_id = ? ORDER BY created_at', user.id);
    const primaryLand = lands.find((l) => l.planting_date) || lands[0] || null;
    if (primaryLand) {
      const age = crop.cropAge(primaryLand);
      const parts = [
        primaryLand.variety && `varietas ${primaryLand.variety}`,
        age.status === 'growing' && `${age.days} HST`,
        age.phase && `fase ${age.phase}`,
      ].filter(Boolean);
      landContextStr = parts.join(' ');
    }
  } catch (err) {
    console.warn('[chat] Gagal membaca konteks lahan:', err.message);
  }

  const refs = await findReferences(
    scan && scan.result && scan.result.suspected_pest_name,
    scan && scan.notes && scan.notes.plant_age_days != null ? `${scan.notes.plant_age_days} HST` : '',
    lastUser && lastUser.content,
    landContextStr,
  );
  const chatSvc = ai.chat();
  const visionSvc = ai.vision();
  try {
    // Chatbot teks-saja tidak dianggap mampu membaca foto: foto tambahan diproses modul analisis gambar.
    let extraNote = '';
    if (lastUser && lastUser.image_path && !chatSvc.supportsImages && visionSvc.supportsImages) {
      const { result } = await visionSvc.analyze({ imagePath: lastUser.image_path, mime: lastUser.image_mime, notes: { symptoms: lastUser.content }, references: refs });
      extraNote = `\n\n(Hasil analisis foto tambahan: ${JSON.stringify(result)})`;
    }
    const h = extraNote ? history.map((m) => (m.id === lastUser.id ? { ...m, content: m.content + extraNote } : m)) : history;
    const { text, model } = await chatSvc.reply({ scan, history: h, references: refs });
    await db.tx(async () => {
      await db.run(
        'INSERT INTO chat_messages (session_id, role, content, mode, provider, model, sources_json) VALUES (?, ?, ?, ?, ?, ?, ?)',
        session.id, 'assistant', text, chatSvc.mode, chatSvc.name, model, refs.length ? JSON.stringify(toSources(refs)) : null,
      );
      await db.run("UPDATE chat_sessions SET updated_at = datetime('now') WHERE id = ?", session.id);
    });
    return { ok: true };
  } catch (err) {
    console.error(`[chat ${session.id}] gagal:`, err.message);
    const msg = err.retryable !== undefined ? err.message : 'Asisten AI sedang bermasalah.';
    await db.run('INSERT INTO chat_messages (session_id, role, content) VALUES (?, ?, ?)', session.id, 'system', `Asisten belum berhasil menjawab. ${msg}`);
    return { ok: false, error: msg };
  }
}

async function sendMessage(user, session, { text, file }) {
  let img = null;
  if (file) img = await storage.saveImage(file, user.id, 'chat');
  await db.run('INSERT INTO chat_messages (session_id, role, content, image_path, image_mime) VALUES (?, ?, ?, ?, ?)',
    session.id, 'user', text || (img ? 'Foto tambahan' : ''), img && img.relPath, img && img.mime);
  return await generateReply(user, session);
}

// Ulangi jawaban terakhir bila sebelumnya gagal.
async function retryReply(user, session) {
  const last = await db.get('SELECT * FROM chat_messages WHERE session_id = ? ORDER BY id DESC LIMIT 1', session.id);
  if (!last || last.role !== 'system') return { ok: true };
  await db.run('DELETE FROM chat_messages WHERE id = ?', last.id);
  const prev = await db.get('SELECT role FROM chat_messages WHERE session_id = ? ORDER BY id DESC LIMIT 1', session.id);
  if (!prev || prev.role !== 'user') return { ok: true };
  return await generateReply(user, session);
}

module.exports = { getOwnedSession, messagesOf, sendMessage, retryReply, scanContext };
