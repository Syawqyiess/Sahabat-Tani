'use strict';
// Vercel menjalankan fungsi Node dengan flag --no-experimental-require-module, sehingga require() terhadap
// paket yang hanya berbentuk ES Module (mis. marked, htmlparser2 v12 milik sanitize-html) selalu gagal
// (ERR_REQUIRE_ESM), walau di laptop berjalan. Modul ini memuat paket-paket tersebut lebih dulu dengan
// import() (selalu diizinkan), lalu mengembalikan hasilnya saat kode CommonJS memanggil require() — tanpa
// menurunkan versi library. Di lingkungan yang mendukung require(esm), fungsi ini tidak mengubah apa pun.
const Module = require('node:module');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const loaded = new Map(); // nama berkas absolut → namespace ESM
let patched = false;

function patch() {
  if (patched) return;
  patched = true;
  const origLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (loaded.size) {
      try {
        const file = Module._resolveFilename(request, parent, isMain);
        if (loaded.has(file)) return loaded.get(file);
      } catch { /* biarkan pemuat asli yang menangani */ }
    }
    return origLoad.apply(this, arguments);
  };
}

// targets: [{ request: 'htmlparser2', from: 'sanitize-html' }, { request: 'marked' }]
// `from` = paket yang me-require (agar versi yang diselesaikan sama, mis. htmlparser2 v12 milik sanitize-html).
async function preloadEsm(targets, root = path.resolve(__dirname, '..')) {
  const rootRequire = Module.createRequire(path.join(root, 'package.json'));
  for (const t of targets) {
    const req = t.from ? Module.createRequire(rootRequire.resolve(t.from)) : rootRequire;
    let file;
    try { file = req.resolve(t.request); } catch { continue; } // paket tidak terpasang: lewati
    if (loaded.has(file)) continue;
    const ns = await import(pathToFileURL(file).href);
    loaded.set(file, ns);
  }
  patch();
  return loaded.size;
}

module.exports = { preloadEsm };
