'use strict';
// Penyaring relevansi pertanian & penentu subkategori berbasis kata kunci (judul berbobot dua kali).
// Sederhana dan dapat dijelaskan; admin tetap bisa memindahkan kategori artikel secara manual.

// Kata kunci kuat: berita dianggap relevan untuk kanal pertanian bila memuatnya.
const AGRI = ['padi', 'beras', 'gabah', 'petani', 'pertanian', 'sawah', 'pupuk', 'hama', 'irigasi', 'kementan', 'mentan', 'wamentan',
  'panen', 'tanam', 'benih', 'alsintan', 'penyuluh', 'gapoktan', 'poktan', 'agribisnis', 'hortikultura', 'jagung', 'kedelai',
  'swasembada', 'pangan', 'tani', 'bulog', 'cabai', 'bawang merah', 'wereng', 'penggerek batang', 'walang sangit', 'tungro', 'hawar daun'];

// Urutan = prioritas bila skor sama (yang lebih spesifik lebih dulu).
const CATEGORIES = [
  { slug: 'hama-dan-penyakit-tanaman', words: ['hama', 'wereng', 'penggerek', 'walang sangit', 'tikus', 'keong', 'opt', 'organisme pengganggu', 'penyakit tanaman', 'blas', 'kresek', 'tungro', 'hawar', 'jamur', 'pestisida', 'insektisida', 'fungisida', 'serangan', 'ulat'] },
  { slug: 'pupuk-dan-kesehatan-tanah', words: ['pupuk', 'urea', 'npk', 'kompos', 'organik', 'tanah', 'hara', 'kesuburan', 'rdkk', 'e-rdkk', 'dolomit', 'biochar', 'pemupukan'] },
  { slug: 'irigasi-dan-pengelolaan-air', words: ['irigasi', 'pompa', 'pompanisasi', 'embung', 'bendungan', 'saluran', 'sumur', 'rawa', 'tata air', 'pengairan', 'air'] },
  { slug: 'cuaca-dan-iklim-pertanian', words: ['cuaca', 'iklim', 'el nino', 'la nina', 'kemarau', 'hujan', 'banjir', 'kekeringan', 'bmkg', 'musim', 'suhu', 'asuransi usaha tani', 'autp'] },
  { slug: 'teknologi-pertanian', words: ['teknologi', 'inovasi', 'mekanisasi', 'modernisasi', 'alsintan', 'combine', 'harvester', 'traktor', 'drone', 'digital', 'aplikasi', 'smart farming', 'sensor', 'transplanter', 'mesin', 'robot', 'pm-aas', 'riset', 'perakitan'] },
  // Hanya untuk berita yang memang tentang padi (lihat PADI_ONLY); harga/distribusi beras bukan budidaya.
  { slug: 'budidaya-padi', words: ['padi', 'sawah', 'tanam', 'benih', 'varietas', 'panen', 'gabah', 'produktivitas', 'persemaian', 'jajar legowo', 'luas tambah tanam', 'ltt', 'indeks pertanaman'] },
];
const PADI_ONLY = ['padi', 'sawah', 'gabah'];
const FALLBACK = 'berita-pertanian-umum';

function hits(text, word) {
  const re = new RegExp(`(^|[^a-z0-9])${word.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')}(?=[^a-z0-9]|$)`, 'g');
  return (text.match(re) || []).length;
}

function score(title, summary, words) {
  const t = String(title || '').toLowerCase();
  const s = String(summary || '').toLowerCase();
  return words.reduce((n, w) => n + hits(t, w) * 2 + hits(s, w), 0);
}

// Relevan bila judul memuat kata kunci pertanian, atau ringkasan memuat minimal dua.
function isRelevant(title, summary) {
  const t = String(title || '').toLowerCase();
  if (AGRI.some((w) => hits(t, w))) return true;
  const s = String(summary || '').toLowerCase();
  return AGRI.reduce((n, w) => n + (hits(s, w) ? 1 : 0), 0) >= 2;
}

function classify(title, summary) {
  let best = { slug: FALLBACK, score: 0 };
  // Tentang padi bila disebut di judul, atau minimal dua kali di ringkasan.
  const mentionsPadi = score(title, '', PADI_ONLY) > 0 || score('', summary, PADI_ONLY) >= 2;
  for (const c of CATEGORIES) {
    if (c.slug === 'budidaya-padi' && !mentionsPadi) continue;
    const sc = score(title, summary, c.words);
    if (sc > best.score) best = { slug: c.slug, score: sc };
  }
  return best.slug;
}

module.exports = { isRelevant, classify, CATEGORIES, FALLBACK };
