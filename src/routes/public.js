'use strict';
const express = require('express');
const db = require('../db');

const router = express.Router();

router.get('/', (req, res) => {
  if (req.user) return res.redirect(req.user.role === 'admin' ? '/admin' : '/dashboard');
  const latest = db.all(
    `SELECT a.*, c.name AS category_name FROM articles a LEFT JOIN article_categories c ON c.id = a.category_id
      WHERE ${require('../lib/articles').PUBLIC_WHERE} ORDER BY a.published_at IS NULL, a.published_at DESC LIMIT 3`,
  );
  res.render('home', { title: 'Sahabat Tani — Teman Petani Padi', latest });
});

// Halaman informasi dari footer (navbar mengikuti status login lewat layout bersama).
router.get('/tentang', (req, res) => res.render('info/about', { title: 'Tentang Sahabat Tani' }));
router.get('/kebijakan-privasi', (req, res) => res.render('info/privacy', { title: 'Kebijakan Privasi' }));
router.get('/syarat-ketentuan', (req, res) => res.render('info/terms', { title: 'Syarat & Ketentuan' }));

router.get('/healthz', (req, res) => res.json({ ok: true }));

module.exports = router;
