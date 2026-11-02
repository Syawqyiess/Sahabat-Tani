'use strict';
const express = require('express');
const db = require('../db');

const router = express.Router();

router.get('/', (req, res) => {
  if (req.user) return res.redirect(req.user.role === 'admin' ? '/admin' : '/dashboard');
  const latest = db.all(
    `SELECT a.*, c.name AS category_name FROM articles a LEFT JOIN article_categories c ON c.id = a.category_id
      WHERE a.status = 'published' ORDER BY a.published_at DESC LIMIT 3`,
  );
  res.render('home', { title: 'Sahabat Tani — Teman Petani Padi', latest });
});

router.get('/healthz', (req, res) => res.json({ ok: true }));

module.exports = router;
