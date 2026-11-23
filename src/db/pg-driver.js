'use strict';
// Driver Postgres (Supabase). Query aplikasi ditulis dengan gaya SQLite (placeholder `?`, `IS ?`, LIKE
// tanpa membedakan huruf besar/kecil) lalu diterjemahkan di sini, agar satu kode berjalan di kedua database.
// Fungsi SQLite yang dipakai (datetime('now'), json_extract) disediakan sebagai fungsi SQL di skema Postgres.
const pg = require('pg');

// COUNT(*) dan BIGINT dikembalikan sebagai angka (bukan string), sama seperti SQLite.
pg.types.setTypeParser(20, (v) => (v === null ? null : Number.parseInt(v, 10)));
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number.parseFloat(v)));

const cache = new Map();

// Terjemahkan SQL gaya SQLite → Postgres. Bagian di dalam tanda kutip tunggal tidak diubah.
function translate(sql) {
  const hit = cache.get(sql);
  if (hit) return hit;
  let s = sql;
  let ignore = false;
  if (/^\s*INSERT\s+OR\s+IGNORE\s+INTO/i.test(s)) {
    s = s.replace(/^(\s*)INSERT\s+OR\s+IGNORE\s+INTO/i, '$1INSERT INTO');
    ignore = true;
  }
  let out = '';
  let n = 0;
  const parts = s.split(/('(?:[^']|'')*')/);
  for (let i = 0; i < parts.length; i++) {
    let p = parts[i];
    if (i % 2 === 1) { out += p; continue; }
    p = p.replace(/\bIS\s+NOT\s+\?/gi, 'IS DISTINCT FROM ?')
      .replace(/\bIS\s+\?/gi, 'IS NOT DISTINCT FROM ?')
      .replace(/\bLIKE\b/gi, 'ILIKE')
      .replace(/\?/g, () => `$${++n}`);
    out += p;
  }
  const isInsert = /^\s*INSERT\b/i.test(out);
  if (isInsert && !/\bRETURNING\b/i.test(out)) {
    out = out.replace(/;\s*$/, '') + (ignore ? ' ON CONFLICT DO NOTHING' : '') + ' RETURNING *';
  }
  const res = { text: out, isInsert, isRead: /^\s*(SELECT|WITH)\b/i.test(out) };
  cache.set(sql, res);
  return res;
}

// Nilai boolean JS disimpan sebagai 0/1 (kolom INTEGER), sama seperti SQLite.
function normParams(params) {
  return params.map((v) => (v === true ? 1 : v === false ? 0 : v === undefined ? null : v));
}

// Galat jaringan sesaat (koneksi diputus di tengah jalan) — aman dicoba ulang untuk koneksi baru & query baca.
const TRANSIENT = new Set(['ECONNRESET', 'EPIPE', 'ETIMEDOUT', 'ECONNREFUSED', 'EAI_AGAIN', 'ENOTFOUND', '57P01', '08006', '08003', '08001']);
function isTransient(err) {
  return !!err && (TRANSIENT.has(err.code) || /Connection terminated|connection timeout|Client has encountered a connection error/i.test(String(err.message)));
}
// Alamat tidak terjangkau dari jaringan ini (mis. IPv6 tidak didukung) → pindah ke koneksi cadangan.
const UNREACHABLE = new Set(['ENETUNREACH', 'EHOSTUNREACH', 'EADDRNOTAVAIL', 'ENOTFOUND', 'EAI_AGAIN']);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function toResult(r) {
  const first = r.rows && r.rows[0];
  return { changes: r.rowCount || 0, lastInsertRowid: first && first.id != null ? Number(first.id) : undefined };
}

// Koneksi untuk satu transaksi (sudah memegang klien sendiri).
function wrapClient(client) {
  const q = (sql, params) => { const t = translate(sql); return client.query(t.text, normParams(params)); };
  return {
    async get(sql, params) { return (await q(sql, params)).rows[0]; },
    async all(sql, params) { return (await q(sql, params)).rows; },
    async run(sql, params) { return toResult(await q(sql, params)); },
    async exec(sql) { await client.query(sql); },
  };
}

function create({ connectionString, fallbackConnectionString, schema = 'public', max = 10, ssl }) {
  if (!connectionString || /\[YOUR-.*PASSWORD\]/i.test(connectionString)) {
    throw new Error('SUPABASE_DB_URL belum diisi dengan password database (masih [YOUR-DATABASE-PASSWORD]).');
  }
  if (!/^[a-z_][a-z0-9_]*$/.test(schema)) throw new Error(`Nama skema Postgres tidak valid: ${schema}`);
  const makePool = (url) => {
    const p = new pg.Pool({
      connectionString: url,
      max,
      idleTimeoutMillis: 60_000,
      allowExitOnIdle: true, // skrip & uji bisa selesai tanpa menunggu koneksi menganggur ditutup
      connectionTimeoutMillis: 15_000,
      keepAlive: true, // cegah perangkat jaringan memutus koneksi yang menganggur
      // Supabase mewajibkan koneksi terenkripsi (TLS). Bila SUPABASE_DB_CA_FILE diisi (sertifikat CA dari
      // dashboard Supabase), sertifikat server juga diverifikasi penuh.
      ssl: ssl || { rejectUnauthorized: false },
    });
    p.on('error', (err) => { console.error('[postgres] koneksi menganggur terputus:', err.code || err.message); });
    return p;
  };
  // Koneksi utama (mis. langsung ke database, IPv6) + cadangan (pooler Supabase, IPv4).
  // Bila koneksi utama tidak bisa dibuka (jaringan tanpa IPv6, dsb.), aplikasi pindah ke cadangan.
  const pools = [makePool(connectionString)];
  if (fallbackConnectionString && fallbackConnectionString !== connectionString) pools.push(makePool(fallbackConnectionString));
  let active = 0;

  // Ambil klien yang siap pakai: dicoba ulang bila jaringan memutus saat membuka koneksi,
  // lalu skema aplikasi dipasang sekali per koneksi (berurutan, sebelum query pertama).
  const prepared = new WeakSet();
  async function acquireFrom(pool) {
    let lastErr;
    for (let attempt = 0; attempt < 4; attempt++) {
      let client;
      try {
        client = await pool.connect();
        if (!prepared.has(client)) {
          await client.query(`SET search_path TO ${schema}, public`);
          prepared.add(client);
        }
        return client;
      } catch (err) {
        if (client) client.release(err); // buang koneksi rusak dari pool
        lastErr = err;
        if (!isTransient(err) && !UNREACHABLE.has(err.code)) throw err;
        if (UNREACHABLE.has(err.code)) break; // jaringan tidak punya rute ke alamat ini: langsung coba cadangan
        await sleep(300 * (attempt + 1));
      }
    }
    throw lastErr;
  }
  async function acquire() {
    try {
      return await acquireFrom(pools[active]);
    } catch (err) {
      if (active + 1 < pools.length && (isTransient(err) || UNREACHABLE.has(err.code))) {
        console.warn(`[postgres] koneksi utama tidak tersedia (${err.code || 'galat'}); memakai koneksi cadangan (pooler).`);
        active += 1;
        return acquireFrom(pools[active]);
      }
      throw err;
    }
  }

  // Query di luar transaksi: satu klien per query. Query baca dicoba ulang bila koneksi putus.
  async function query(sql, params) {
    const t = translate(sql);
    for (let attempt = 0; ; attempt++) {
      const client = await acquire();
      try {
        const r = await client.query(t.text, normParams(params));
        client.release();
        return r;
      } catch (err) {
        client.release(isTransient(err) ? err : undefined);
        if (!(isTransient(err) && t.isRead && attempt < 2)) throw err;
        await sleep(300 * (attempt + 1));
      }
    }
  }

  const conn = {
    async get(sql, params) { return (await query(sql, params)).rows[0]; },
    async all(sql, params) { return (await query(sql, params)).rows; },
    async run(sql, params) { return toResult(await query(sql, params)); },
    async exec(sql) {
      const client = await acquire();
      try { await client.query(sql); client.release(); } catch (err) { client.release(isTransient(err) ? err : undefined); throw err; }
    },
  };

  async function transaction(fn) {
    const client = await acquire();
    let broken;
    try {
      await client.query('BEGIN');
      try {
        const out = await fn(wrapClient(client));
        await client.query('COMMIT');
        return out;
      } catch (err) {
        if (isTransient(err)) broken = err;
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      }
    } finally {
      client.release(broken);
    }
  }

  return {
    name: 'postgres', schema, conn, transaction,
    get pool() { return pools[active]; },
    get route() { return active === 0 ? 'utama' : 'cadangan (pooler)'; },
    async close() { await Promise.all(pools.map((p) => p.end().catch(() => {}))); },
  };
}

module.exports = { create, translate };
