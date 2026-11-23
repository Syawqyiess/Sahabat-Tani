'use strict';
// Gambar utama berita dari sumber aslinya.
// Kandidat diambil berurutan: RSS (media:content/thumbnail/enclosure) → JSON-LD NewsArticle/Article →
// og:image → twitter:image → selector gambar utama khusus sumber. Setiap kandidat divalidasi di backend
// (host terverifikasi, IP publik, tipe & dekode gambar, ukuran wajar) sebelum dipakai.
// Kebijakan per sumber: 'tautan' = tampilkan URL asli penerbit (tanpa menyalin berkas),
// 'salin' = simpan salinan diperkecil (hanya bila penerbit mengizinkan), 'tidak' = tanpa gambar.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const cheerio = require('cheerio');
const db = require('../../db');
const config = require('../../config');
const { politeFetch, fetchImage, checkTarget, FetchError } = require('./fetcher');
const robots = require('./robots');

const MIN_W = 400;
const MIN_H = 200;
// Pola URL yang hampir pasti bukan foto berita: logo, avatar, ikon, iklan, piksel pelacak, placeholder.
const JUNK = /(logo|favicon|sprite|icon|avatar|gravatar|banner|advert|iklan|pixel|spacer|placeholder|no[-_]?image|noimage|blank\.|default[-_](image|img|thumb)|1x1|loading\.gif|(^|[/_.-])ads?[/_.-])/i;

function decodeUrl(raw) {
  if (!raw) return '';
  return String(raw).trim()
    .replace(/\\\//g, '/')
    .replace(/&amp;/gi, '&').replace(/&#0*38;/g, '&').replace(/&#x26;/gi, '&')
    .replace(/&quot;/gi, '"').replace(/&#0*39;/g, "'")
    .replace(/\s/g, '%20');
}

// URL relatif / //protokol-relatif → absolut terhadap halaman artikel.
function absolute(raw, base) {
  const v = decodeUrl(raw);
  if (!v || v.startsWith('data:') || v.startsWith('blob:')) return null;
  try {
    const u = new URL(v, base);
    if (!/^https?:$/.test(u.protocol)) return null;
    u.pathname = u.pathname.replace(/\/{2,}/g, '/');
    return u.href;
  } catch { return null; }
}

// srcset: pilih kandidat terlebar yang masih ≤ 1600 px (atau yang terlebar bila semuanya lebih besar).
function pickSrcset(srcset, base) {
  const items = String(srcset || '').split(/,\s+(?=\S)/).map((part) => {
    const [u, d] = part.trim().split(/\s+/);
    const w = /(\d+)w/.exec(d || '') ? Number(/(\d+)w/.exec(d)[1]) : (/([\d.]+)x/.exec(d || '') ? Number(/([\d.]+)x/.exec(d)[1]) * 800 : 0);
    return { url: absolute(u, base), w };
  }).filter((i) => i.url);
  if (!items.length) return null;
  const fit = items.filter((i) => i.w && i.w <= 1600).sort((a, b) => b.w - a.w)[0];
  return (fit || items.sort((a, b) => b.w - a.w)[0]).url;
}

function imgElementUrl($, el, base) {
  const $el = $(el);
  const set = $el.attr('data-srcset') || $el.attr('data-lazy-srcset') || $el.attr('srcset')
    || $el.closest('picture').find('source[srcset], source[data-srcset]').first().attr('srcset')
    || $el.closest('picture').find('source[data-srcset]').first().attr('data-srcset');
  return pickSrcset(set, base)
    || absolute($el.attr('data-src') || $el.attr('data-lazy-src') || $el.attr('data-original') || $el.attr('src'), base);
}

// JSON-LD: objek, array, atau @graph; image bisa string, array, ImageObject, atau rujukan @id.
function jsonLdImages($, base) {
  const out = [];
  $('script[type="application/ld+json"]').each((_, s) => {
    let data;
    try { data = JSON.parse($(s).contents().text().trim()); } catch { return; }
    const nodes = [];
    const walk = (n) => {
      if (!n || typeof n !== 'object') return;
      if (Array.isArray(n)) return n.forEach(walk);
      nodes.push(n);
      if (n['@graph']) walk(n['@graph']);
    };
    walk(data);
    const byId = new Map(nodes.filter((n) => n['@id']).map((n) => [n['@id'], n]));
    const types = (n) => [].concat(n['@type'] || []).map(String);
    for (const n of nodes) {
      if (!types(n).some((t) => /^(NewsArticle|Article|ReportageNewsArticle|BlogPosting|WebPage)$/.test(t))) continue;
      const isArticle = types(n).some((t) => t !== 'WebPage');
      for (let img of [].concat(n.image || n.primaryImageOfPage || n.thumbnailUrl || [])) {
        if (img && typeof img === 'object' && img['@id'] && byId.has(img['@id'])) img = byId.get(img['@id']);
        const url = typeof img === 'string' ? img : (img && (img.url || img.contentUrl));
        const abs = absolute(url, base);
        if (!abs) continue;
        const credit = img && typeof img === 'object' ? [].concat(img.creditText || img.copyrightHolder?.name || img.author?.name || []).join(', ') : '';
        out.push({ url: abs, from: 'json-ld', priority: isArticle ? 0 : 1, caption: img && typeof img === 'object' ? (img.caption || '') : '', credit,
          width: img && img.width ? Number(img.width.value || img.width) : null });
      }
    }
  });
  return out.sort((a, b) => a.priority - b.priority);
}

function pageCandidates(html, pageUrl, cfg = {}) {
  const $ = cheerio.load(html);
  const meta = (sel) => $(sel).map((_, e) => $(e).attr('content')).get();
  const alt = $('meta[property="og:image:alt"]').attr('content') || $('meta[name="twitter:image:alt"]').attr('content') || '';
  const out = [];
  out.push(...jsonLdImages($, pageUrl));
  meta('meta[property="og:image:secure_url"], meta[property="og:image"], meta[property="og:image:url"]').forEach((u) => out.push({ url: absolute(u, pageUrl), from: 'og:image', alt }));
  meta('meta[name="twitter:image"], meta[name="twitter:image:src"], meta[property="twitter:image"]').forEach((u) => out.push({ url: absolute(u, pageUrl), from: 'twitter:image', alt }));
  // Elemen gambar utama: hanya selector khusus sumber (bukan "gambar pertama di halaman").
  for (const sel of [].concat((cfg.article && cfg.article.image) || [])) {
    const el = $(sel).first();
    if (!el.length) continue;
    const img = el.is('img') ? el : el.find('img').first();
    if (!img.length) continue;
    const fig = img.closest('figure');
    out.push({ url: imgElementUrl($, img, pageUrl), from: 'selector', alt: img.attr('alt') || '', caption: fig.find('figcaption').first().text().replace(/\s+/g, ' ').trim() });
  }
  return out.filter((c) => c.url);
}

// Kandidat dari item RSS (rss-parser dengan customFields media:*).
function rssCandidates(item, pageUrl) {
  const out = [];
  const medias = [].concat(item.mediaContent || [], item.mediaThumbnail || []);
  for (const m of medias) {
    const a = (m && m.$) || m || {};
    if (a.medium && a.medium !== 'image') continue;
    if (a.type && !/^image\//.test(a.type)) continue;
    out.push({ url: absolute(a.url, pageUrl), from: 'rss' });
  }
  if (item.enclosure && item.enclosure.url && (!item.enclosure.type || /^image\//.test(item.enclosure.type))) out.push({ url: absolute(item.enclosure.url, pageUrl), from: 'rss' });
  return out.filter((c) => c.url);
}

function sameSite(a, b) {
  const strip = (h) => h.replace(/^www\./, '').toLowerCase();
  return strip(a) === strip(b);
}

// Host yang dipercaya untuk gambar sumber: domain artikel itu sendiri + CDN yang diverifikasi admin.
function hostChecker(source, articleUrl) {
  const extra = String(source.image_hosts || '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
  const own = new URL(articleUrl).hostname.replace(/^www./, '').toLowerCase();
  // Domain penerbit sendiri beserta subdomainnya (mis. img./cdn.antaranews.com), plus CDN lain yang diverifikasi admin.
  return (host) => { const h = host.toLowerCase(); return sameSite(h, own) || h.endsWith('.' + own) || extra.includes(h); };
}

function dedupe(cands) {
  const seen = new Set();
  return cands.filter((c) => {
    const k = c.url.replace(/^https?:/, '');
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// Validasi satu kandidat: unduh (dengan pengaman), cek byte awal & dekode, tolak gambar kecil/aneh.
async function validate(candidate, { allowHost, policy }) {
  if (JUNK.test(new URL(candidate.url).pathname)) return { ok: false, status: 'ditolak', note: 'tampak seperti logo/ikon/iklan/placeholder' };
  let res;
  try {
    await checkTarget(candidate.url, allowHost); // host terverifikasi & IP publik dulu, baru robots.txt
    const rob = await robots.isAllowed(candidate.url);
    if (!rob.allowed) return { ok: false, status: 'tidak-diizinkan', note: 'gambar diblokir robots.txt' };
    res = await fetchImage(candidate.url, { allowHost, referer: config.appUrl });
  } catch (err) {
    if (!(err instanceof FetchError)) throw err;
    return { ok: false, status: err.blocked ? 'diblokir' : (/belum diverifikasi|ditolak|tidak valid|kredensial|protokol/.test(err.message) ? 'ditolak' : 'gagal'), note: err.message };
  }
  const b = res.buffer;
  const head = b.subarray(0, 512).toString('latin1').toLowerCase();
  if (/<(!doctype|html|head|body|script|svg)/.test(head)) return { ok: false, status: 'ditolak', note: 'konten HTML/SVG menyamar sebagai gambar' };
  if (res.contentType && !/^image\/(jpeg|jpg|png|webp|gif|avif)/i.test(res.contentType) && !/octet-stream/i.test(res.contentType)) {
    return { ok: false, status: 'ditolak', note: `tipe berkas bukan gambar (${res.contentType.split(';')[0]})` };
  }
  const sharp = require('sharp');
  let meta;
  try {
    meta = await sharp(b, { limitInputPixels: 40e6 }).metadata();
    await sharp(b, { limitInputPixels: 40e6 }).resize(8, 8).toBuffer(); // pastikan benar-benar bisa didekode
  } catch {
    return { ok: false, status: 'ditolak', note: 'berkas tidak dapat didekode sebagai gambar' };
  }
  if (!['jpeg', 'png', 'webp', 'gif', 'heif', 'avif'].includes(meta.format)) return { ok: false, status: 'ditolak', note: `format ${meta.format} tidak didukung` };
  if (meta.width < MIN_W || meta.height < MIN_H) return { ok: false, status: 'ditolak', note: `terlalu kecil (${meta.width}×${meta.height}) — kemungkinan ikon/logo` };
  const ratio = meta.width / meta.height;
  if (ratio < 0.6 || ratio > 3.2) return { ok: false, status: 'ditolak', note: `proporsi tidak wajar (${meta.width}×${meta.height}) — kemungkinan banner` };
  let display = res.url;
  if (policy === 'salin') {
    const name = crypto.createHash('sha256').update(res.url).digest('hex').slice(0, 32) + '.webp';
    const out = await sharp(b).rotate().resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true }).webp({ quality: 78 }).toBuffer();
    await require('../storage').putFile(`berita/${name}`, out, 'image/webp');
    display = '/media-berita/' + name;
  }
  return { ok: true, status: 'ok', url: res.url, display, width: meta.width, height: meta.height };
}

// Menentukan gambar untuk satu artikel eksternal. Tidak menulis ke database.
// Urutan: kandidat RSS → (bila belum ada yang lolos) halaman artikel: JSON-LD, og:image, twitter:image, selector.
async function resolve(article, source, { html = null, rssItem = null } = {}) {
  const policy = source.image_policy || 'tautan';
  if (policy === 'tidak') return { status: 'tidak-diizinkan', note: 'gambar dari sumber ini dinonaktifkan admin' };
  let cfg = {};
  try { cfg = JSON.parse(source.config_json || '{}'); } catch { /* sumber RSS tanpa konfigurasi */ }
  const allowHost = hostChecker(source, article.source_url);
  const tried = new Set();
  let last = null;

  async function tryList(list) {
    for (const c of dedupe(list).filter((x) => !tried.has(x.url)).slice(0, 4)) {
      tried.add(c.url);
      // Gambar yang sudah dipakai berita lain dari sumber yang sama = gambar umum situs, bukan foto berita ini.
      if (await db.get("SELECT 1 FROM articles WHERE source_id = ? AND id != ? AND image_source_url = ? AND image_status = 'ok'", source.id, article.id || 0, c.url)) {
        last = { status: 'ditolak', note: 'gambar umum situs (dipakai berita lain)' };
        continue;
      }
      const v = await validate(c, { allowHost, policy });
      if (v.ok) {
        return {
          status: 'ok', kind: 'sumber', sourceUrl: v.url, display: v.display, from: c.from,
          alt: (c.alt || '').slice(0, 200) || `Foto dari berita “${article.title.slice(0, 120)}” — ${source.name}`,
          caption: (c.caption || '').slice(0, 300) || null,
          credit: c.credit ? `Foto: ${c.credit} / ${source.name}` : `Foto: ${source.name}`,
        };
      }
      last = v;
      if (v.status === 'diblokir') return null; // penerbit menolak: jangan coba akali dengan kandidat lain
    }
    return null;
  }

  if (rssItem) {
    const r = await tryList(rssCandidates(rssItem, article.source_url));
    if (r) return r;
    if (last && last.status === 'diblokir') return last;
  }
  if (!html) {
    const rob = await robots.isAllowed(article.source_url);
    if (!rob.allowed) return last || { status: 'tidak-diizinkan', note: 'halaman artikel diblokir robots.txt' };
    try {
      html = (await politeFetch(article.source_url)).text;
    } catch (err) {
      if (!(err instanceof FetchError)) throw err;
      return { status: err.blocked ? 'diblokir' : 'gagal', note: `halaman artikel: ${err.message}` };
    }
  }
  const pageList = pageCandidates(html, article.source_url, cfg);
  if (!pageList.length && !tried.size) return { status: 'tidak-ada', note: 'sumber tidak menyediakan gambar utama' };
  const r = await tryList(pageList);
  return r || last || { status: 'tidak-ada', note: 'sumber tidak menyediakan gambar utama' };
}

async function save(articleId, r) {
  if (r.status === 'ok') {
    await db.run(
      `UPDATE articles SET image_url = ?, image_source_url = ?, image_alt = ?, image_credit = ?, image_caption = ?, image_kind = 'sumber',
              image_status = 'ok', image_note = ?, image_checked_at = datetime('now') WHERE id = ? AND origin = 'external'`,
      r.display, r.sourceUrl, r.alt, r.credit, r.caption, `dari ${r.from}`, articleId,
    );
  } else {
    // Tidak menghapus gambar valid yang sudah ada; hanya mencatat status untuk artikel yang belum bergambar.
    await db.run(
      `UPDATE articles SET image_kind = 'fallback', image_status = ?, image_note = ?, image_checked_at = datetime('now')
        WHERE id = ? AND origin = 'external' AND (image_status IS NULL OR image_status != 'ok')`,
      r.status, (r.note || '').slice(0, 300), articleId,
    );
  }
}

// Backfill & proses lanjutan: idempoten — artikel yang sudah 'ok' atau berstatus final dilewati;
// 'gagal' (galat jaringan) dicoba lagi setelah 6 jam. Satu kegagalan tidak menghentikan proses.
async function processPending({ sourceId = null, limit = 200, force = false, onItem = null } = {}) {
  const report = { checked: 0, updated: 0, fallback: 0, failed: 0, skipped: 0, items: [] };
  const rows = await db.all(
    `SELECT a.id, a.title, a.source_url, a.source_id, a.image_status FROM articles a
      WHERE a.origin = 'external' AND a.source_url IS NOT NULL ${sourceId ? 'AND a.source_id = ?' : ''}
        AND (${force ? "a.image_status IS NULL OR a.image_status != 'ok'" : "a.image_status IS NULL OR (a.image_status = 'gagal' AND a.image_checked_at < datetime('now', '-6 hours'))"})
      ORDER BY a.id LIMIT ?`, ...(sourceId ? [sourceId] : []), limit,
  );
  const sources = new Map((await db.all('SELECT * FROM news_sources')).map((s) => [s.id, s]));
  const blockedHosts = new Set();
  for (const a of rows) {
    const source = sources.get(a.source_id);
    if (!source) { report.skipped++; continue; }
    const host = new URL(a.source_url).hostname;
    let r;
    if (blockedHosts.has(host)) r = { status: 'diblokir', note: 'situs menolak permintaan sebelumnya dalam proses ini' };
    else {
      try {
        r = await resolve(a, source);
      } catch (err) {
        r = { status: 'gagal', note: err.message };
      }
    }
    if (r.status === 'diblokir' && /halaman artikel/.test(r.note || '')) blockedHosts.add(host);
    await save(a.id, r);
    report.checked++;
    if (r.status === 'ok') report.updated++;
    else if (r.status === 'gagal') report.failed++;
    else report.fallback++;
    const item = { id: a.id, title: a.title, source: source.name, status: r.status, note: r.note || (r.from ? `dari ${r.from}` : '') };
    report.items.push(item);
    if (onItem) onItem(item);
  }
  return report;
}

module.exports = { pageCandidates, rssCandidates, pickSrcset, absolute, decodeUrl, validate, resolve, save, processPending, JUNK };
