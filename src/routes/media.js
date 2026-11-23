'use strict';
const express = require('express');
const db = require('../db');
const storage = require('../services/storage');
const { requireLogin } = require('../middleware/security');

const router = express.Router();

// Akses foto privat: hanya pemilik. Admin hanya dapat melihat foto profil (untuk membantu mengisi profil),
// tidak foto scan/percakapan pribadi petani.
router.get('/media/:uid/:file', requireLogin, async (req, res) => {
  const rel = `${req.params.uid}/${req.params.file}`;
  if (!/^\d+\/[a-z]+-[0-9a-f-]{36}\.(jpg|png|webp)$/.test(rel)) return res.status(404).end();
  const owner = Number(req.params.uid);
  const isOwner = owner === req.user.id;
  let allowed = false;
  if (isOwner) {
    // Satu query (bukan empat) — penting saat database berjarak jauh (Supabase).
    allowed = !!await db.get(
      `SELECT 1 AS ok WHERE EXISTS (SELECT 1 FROM pest_scans WHERE image_path = ? AND user_id = ?)
          OR EXISTS (SELECT 1 FROM chat_messages m JOIN chat_sessions s ON s.id = m.session_id WHERE m.image_path = ? AND s.user_id = ?)
          OR EXISTS (SELECT 1 FROM farmer_profiles WHERE photo_path = ? AND user_id = ?)
          OR EXISTS (SELECT 1 FROM lands WHERE photo_path = ? AND user_id = ?)`,
      rel, owner, rel, owner, rel, owner, rel, owner,
    );
  } else if (req.user.role === 'admin') {
    allowed = !!await db.get('SELECT 1 FROM farmer_profiles WHERE photo_path = ?', rel);
  }
  if (!allowed) return res.status(404).end();
  const buf = await storage.readFile(rel);
  if (!buf) return res.status(404).end();
  res.set({ 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff' }).type(storage.mimeOf(rel)).send(buf);
});

module.exports = router;
