'use strict';
const express = require('express');
const db = require('../db');
const chat = require('../services/chat');
const scans = require('../services/scans');
const storage = require('../services/storage');
const { requireRole, verifyCsrf, limits, wantsJson } = require('../middleware/security');
const { safeJson } = require('../lib/util');

const router = express.Router();
const farmerOnly = requireRole('farmer');

const QUICK_QUESTIONS = [
  'Apa ciri-ciri hama ini?',
  'Bagaimana langkah penanganan awal?',
  'Bagaimana mencegahnya muncul lagi?',
  'Apakah perlu diperiksa penyuluh?',
];

function notFound(res) {
  return res.status(404).render('errors/error', { title: 'Percakapan tidak ditemukan', status: 404, message: 'Percakapan tidak ditemukan atau bukan milik Anda.' });
}

// Contoh pertanyaan di Percakapan Baru (mengisi kolom pesan, tidak langsung terkirim).
const STARTER_QUESTIONS = [
  'Apa perbedaan gejala beluk dan blas leher pada padi?',
  'Bagaimana langkah pencegahan sundep?',
  'Bagian tanaman mana yang perlu saya foto agar gejalanya lebih jelas?',
  'Kapan waktu yang tepat memupuk padi umur 30 hari?',
];

function renderNewChat(req, res, { status = 200, error = null, message = '' } = {}) {
  const recent = db.all('SELECT id, title, scan_id, updated_at FROM chat_sessions WHERE user_id = ? AND archived_at IS NULL ORDER BY updated_at DESC, id DESC LIMIT 5', req.user.id);
  const total = db.get('SELECT COUNT(*) AS n FROM chat_sessions WHERE user_id = ? AND archived_at IS NULL', req.user.id).n;
  res.status(status).render('chat/new', {
    title: 'Percakapan Baru — Asisten AI', layout: 'chat', recent, total, starters: STARTER_QUESTIONS, error, message,
    idempotencyKey: Date.now().toString(36) + Math.random().toString(36).slice(2),
  });
}

// Menu "Asisten AI" selalu membuka Percakapan Baru (draf). Belum ada sesi yang dibuat di database
// sampai pesan pertama dikirim — membuka menu berulang kali tidak menambah sesi kosong.
router.get('/asisten', farmerOnly, (req, res) => renderNewChat(req, res));

router.get('/asisten/riwayat', farmerOnly, (req, res) => {
  const sessions = db.all(
    `SELECT s.*, p.status AS scan_status,
            (SELECT content FROM chat_messages m WHERE m.session_id = s.id AND m.role != 'system' ORDER BY m.id DESC LIMIT 1) AS last_message,
            (SELECT COUNT(*) FROM chat_messages m WHERE m.session_id = s.id) AS message_count
       FROM chat_sessions s LEFT JOIN pest_scans p ON p.id = s.scan_id
      WHERE s.user_id = ? AND s.archived_at IS NULL ORDER BY s.updated_at DESC, s.id DESC`, req.user.id,
  );
  res.render('chat/index', { title: 'Riwayat Percakapan', sessions });
});

// Pesan pertama dari Percakapan Baru: sesi baru dibuat di sini, lalu pesan dikirim ke asisten.
router.post('/asisten/mulai', farmerOnly, limits.chat, storage.single('photo'), verifyCsrf, async (req, res) => {
  const text = String(req.body.message || '').trim();
  const fail = (message) => renderNewChat(req, res, { status: 422, error: message, message: text });
  // Kiriman ganda (tombol ditekan dua kali / muat ulang) membuka sesi yang sama, bukan sesi baru.
  const key = String(req.body.idempotency_key || '');
  const recent = req.session.newChat;
  if (key && recent && recent.key === key && chat.getOwnedSession(req.user.id, recent.id)) return res.redirect(`/asisten/${recent.id}#akhir`);
  if (req.uploadError) return fail(req.uploadError);
  if (!text && !req.file) return fail('Tulis pertanyaan atau lampirkan foto terlebih dahulu.');
  if (text.length > 2000) return fail('Pesan terlalu panjang (maksimal 2000 karakter).');
  if (req.file && !storage.sniffMime(req.file.buffer)) return fail('Berkas bukan gambar yang valid. Gunakan foto JPG, PNG, atau WEBP.');
  const r = db.run('INSERT INTO chat_sessions (user_id, title) VALUES (?, ?)', req.user.id, text ? text.slice(0, 60) : 'Pertanyaan dengan foto');
  const session = chat.getOwnedSession(req.user.id, r.lastInsertRowid);
  req.session.newChat = { key, id: session.id };
  try {
    await chat.sendMessage(req.user, session, { text, file: req.file });
  } catch (err) {
    if (!(err instanceof storage.UploadError)) throw err;
    db.run('DELETE FROM chat_sessions WHERE id = ? AND user_id = ?', session.id, req.user.id);
    return fail(err.message);
  }
  res.redirect(`/asisten/${session.id}#akhir`);
});

// Tautan lama "Percakapan Baru" (form POST) diarahkan ke draf baru tanpa membuat sesi kosong.
router.post('/asisten/baru', farmerOnly, (req, res) => res.redirect('/asisten'));

router.get('/asisten/:id', farmerOnly, (req, res) => {
  const session = chat.getOwnedSession(req.user.id, req.params.id);
  if (!session) return notFound(res);
  const messages = chat.messagesOf(session.id).map((m) => ({ ...m, sources: safeJson(m.sources_json, []) }));
  const scan = chat.scanContext(req.user.id, session);
  const last = messages[messages.length - 1];
  const sessions = db.all('SELECT id, title, scan_id, updated_at FROM chat_sessions WHERE user_id = ? AND archived_at IS NULL ORDER BY updated_at DESC, id DESC LIMIT 30', req.user.id);
  res.render('chat/room', {
    title: session.title,
    layout: 'chat',
    session,
    sessions,
    messages,
    scan,
    SUBJECT_LABEL: scans.SUBJECT_LABEL,
    quick: QUICK_QUESTIONS,
    scanFailed: !!(scan && scan.status === 'failed'),
    replyFailed: !!(last && last.role === 'system' && !(scan && scan.status === 'failed')),
  });
});

router.post('/asisten/:id/pesan', farmerOnly, limits.chat, storage.single('photo'), verifyCsrf, async (req, res) => {
  const session = chat.getOwnedSession(req.user.id, req.params.id);
  if (!session) return wantsJson(req) ? res.status(404).json({ error: 'Percakapan tidak ditemukan.' }) : notFound(res);
  const back = `/asisten/${session.id}#akhir`;
  const failWith = (status, message) => {
    if (wantsJson(req)) return res.status(status).json({ error: message });
    req.session.flash = { type: 'error', text: message };
    return res.redirect(back);
  };
  if (req.uploadError) return failWith(422, req.uploadError);
  const text = String(req.body.message || '').trim();
  if (!text && !req.file) return failWith(422, 'Tulis pesan atau lampirkan foto terlebih dahulu.');
  if (text.length > 2000) return failWith(422, 'Pesan terlalu panjang (maksimal 2000 karakter).');
  if (session.title === 'Percakapan baru' && text) {
    db.run('UPDATE chat_sessions SET title = ? WHERE id = ?', text.slice(0, 60), session.id);
  }
  let out;
  try {
    out = await chat.sendMessage(req.user, session, { text, file: req.file });
  } catch (err) {
    if (err instanceof storage.UploadError) return failWith(422, err.message);
    throw err;
  }
  if (wantsJson(req)) return res.json({ ok: out.ok, error: out.error || null, redirect: back });
  res.redirect(back);
});

router.post('/asisten/:id/ulang', farmerOnly, limits.chat, async (req, res) => {
  const session = chat.getOwnedSession(req.user.id, req.params.id);
  if (!session) return notFound(res);
  const scan = session.scan_id && scans.getOwnedScan(req.user.id, session.scan_id);
  if (scan && scan.status === 'failed') await scans.retryScan(req.user, scan.id);
  else await chat.retryReply(req.user, session);
  res.redirect(`/asisten/${session.id}#akhir`);
});

module.exports = router;
