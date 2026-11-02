'use strict';
// SEMUA DATA DI FILE INI ADALAH DATA DEMO — bukan data petani, lahan, atau pengetahuan terverifikasi.

const DEMO_PASSWORD_FARMER = 'tani12345';
const DEMO_PASSWORD_ADMIN = 'admin12345';

const users = [
  {
    key: 'admin', role: 'admin', email: 'admin@sahabattani.test', phone: null, password: DEMO_PASSWORD_ADMIN,
    profile: { full_name: 'Admin Demo' },
  },
  {
    key: 'sarno', role: 'farmer', phone: '081200000001', email: 'sarno.demo@sahabattani.test', password: DEMO_PASSWORD_FARMER,
    profile: {
      full_name: 'Pak Sarno (Akun Demo)', village: 'Desa Contoh Makmur', district: 'Kecamatan Contoh', regency: 'Kabupaten Karawang',
      province: 'Jawa Barat', farmer_group: 'Kelompok Tani Demo Sri Rejeki', experience_years: 15, main_commodity: 'Padi',
    },
    lands: [
      {
        name: 'Sawah Blok A (Demo)', address_desc: 'Lokasi contoh dekat saluran irigasi — bukan lahan asli', area_ha: 0.5, commodity: 'Padi',
        variety: 'Inpari 32', planting_date: '2026-09-20', season_status: 'Vegetatif', lat: -6.3215, lng: 107.3362,
        polygon: [[-6.3205, 107.3352], [-6.3205, 107.3372], [-6.3225, 107.3372], [-6.3225, 107.3352]],
      },
      {
        name: 'Sawah Blok B (Demo)', address_desc: 'Lokasi contoh di sebelah timur — bukan lahan asli', area_ha: 0.35, commodity: 'Padi',
        variety: 'Ciherang', planting_date: '2026-09-28', season_status: 'Tanam', lat: -6.3238, lng: 107.3398,
        polygon: [[-6.3230, 107.3390], [-6.3230, 107.3406], [-6.3246, 107.3406], [-6.3246, 107.3390]],
      },
    ],
  },
  {
    key: 'wati', role: 'farmer', phone: '081200000002', email: null, password: DEMO_PASSWORD_FARMER,
    // Profil sengaja belum lengkap untuk menunjukkan "Belum diisi" dan ajakan "Lengkapi Profil".
    profile: { full_name: 'Bu Wati (Akun Demo)', regency: 'Kabupaten Klaten', province: 'Jawa Tengah' },
    lands: [
      // Lahan tanpa koordinat dan tanpa luas: tetap bisa disimpan.
      { name: 'Sawah dekat rumah (Demo)', address_desc: 'Koordinat belum diisi', area_ha: null, commodity: 'Padi', variety: null, planting_date: null, season_status: 'Persiapan lahan', lat: null, lng: null, polygon: null },
    ],
  },
];

const categories = [
  'Hama dan penyakit padi', 'Budidaya padi', 'Pemupukan', 'Teknologi pertanian', 'Lingkungan dan cuaca', 'Berita pertanian',
];

// Referensi hama: ringkasan pengetahuan umum PHT, DITANDAI belum diverifikasi.
// Admin perlu memeriksa bersama penyuluh, mengisi sumber rujukan resmi, lalu menandai "terverifikasi".
const pests = [
  {
    name: 'Wereng batang cokelat', scientific_name: 'Nilaparvata lugens', aliases: 'wereng coklat, wbc, wereng',
    symptoms: 'Tanaman menguning lalu mengering seperti terbakar (hopperburn), sering dimulai berbentuk lingkaran di petak sawah.',
    visual_signs: 'Serangga kecil berwarna cokelat berkumpul di pangkal batang dekat permukaan air.',
    ipm_control: 'Amati pangkal batang secara rutin; hindari pupuk nitrogen berlebih; atur air (pengeringan berselang); lindungi musuh alami seperti laba-laba dan kepik; gunakan varietas tahan bila tersedia.',
    prevention: 'Tanam serempak, gunakan varietas tahan, jarak tanam tidak terlalu rapat (mis. jajar legowo), sanitasi sisa tanaman.',
    when_to_consult: 'Bila populasi terlihat banyak di pangkal batang atau muncul bercak kering melingkar.',
  },
  {
    name: 'Penggerek batang padi', scientific_name: 'Scirpophaga incertulas', aliases: 'penggerek batang, sundep, beluk, penggerek padi kuning',
    symptoms: 'Fase vegetatif: pucuk mati/kering (sundep). Fase generatif: malai hampa berwarna putih (beluk).',
    visual_signs: 'Kelompok telur di daun tertutup bulu cokelat; lubang gerekan pada batang; larva di dalam batang.',
    ipm_control: 'Kumpulkan dan musnahkan kelompok telur; potong jerami rendah setelah panen; manfaatkan musuh alami parasitoid telur.',
    prevention: 'Tanam serempak, pengolahan tanah dan pembenaman jerami setelah panen, pengamatan ngengat di persemaian.',
    when_to_consult: 'Bila banyak rumpun menunjukkan sundep atau beluk.',
  },
  {
    name: 'Walang sangit', scientific_name: 'Leptocorisa oratorius', aliases: 'walangsangit, kepinding tanah',
    symptoms: 'Bulir padi hampa atau berbintik cokelat kehitaman karena dihisap saat masak susu.',
    visual_signs: 'Serangga ramping berwarna hijau-cokelat, berkaki panjang, berbau menyengat.',
    ipm_control: 'Bersihkan gulma di pematang; tangkap secara mekanis pada pagi/sore hari; tanam serempak agar fase berbunga tidak berurutan.',
    prevention: 'Sanitasi gulma inang, tanam serempak dalam satu hamparan.',
    when_to_consult: 'Bila populasi tinggi saat padi berbunga hingga masak susu.',
  },
  {
    name: 'Tikus sawah', scientific_name: 'Rattus argentiventer', aliases: 'tikus',
    symptoms: 'Batang padi terpotong miring, kerusakan dimulai dari tengah petak, lubang aktif di pematang.',
    visual_signs: 'Jejak, kotoran, dan lubang sarang di pematang atau tanggul.',
    ipm_control: 'Gropyokan bersama, sanitasi habitat, pemasangan bubu perangkap, pengendalian serentak satu hamparan.',
    prevention: 'Tanam serempak, pematang tidak terlalu lebar dan tinggi, bersihkan semak sekitar sawah.',
    when_to_consult: 'Bila kerusakan meluas atau perlu pengendalian bersama kelompok tani.',
  },
  {
    name: 'Keong mas', scientific_name: 'Pomacea canaliculata', aliases: 'keong emas, siput murbei',
    symptoms: 'Bibit muda hilang atau terpotong di bagian pangkal, terutama 1–3 minggu setelah tanam.',
    visual_signs: 'Keong bercangkang kuning-cokelat; kelompok telur berwarna merah muda di batang atau pematang.',
    ipm_control: 'Pungut keong dan kumpulan telur; pasang saringan di saluran masuk air; buat parit kecil untuk mengumpulkan keong.',
    prevention: 'Atur air macak-macak pada awal tanam, tanam bibit yang lebih tua, pasang penghalang di pintu air.',
    when_to_consult: 'Bila populasi tinggi di awal tanam.',
  },
  {
    name: 'Hama putih palsu', scientific_name: 'Cnaphalocrocis medinalis', aliases: 'penggulung daun, pelipat daun',
    symptoms: 'Daun terlipat memanjang dengan garis-garis putih transparan karena jaringan hijau dimakan.',
    visual_signs: 'Ulat hijau kecil di dalam lipatan daun.',
    ipm_control: 'Amati lipatan daun; lindungi musuh alami; hindari pupuk nitrogen berlebih.',
    prevention: 'Pemupukan berimbang, jarak tanam sesuai anjuran.',
    when_to_consult: 'Bila kerusakan daun bendera tinggi pada fase generatif.',
  },
];

const articles = [
  {
    cat: 'Hama dan penyakit padi', title: 'Mengenal Gejala Awal Serangan Wereng Batang Cokelat',
    summary: 'Cara sederhana mengamati pangkal batang padi agar serangan wereng diketahui lebih awal.',
    tags: 'wereng,pht,pengamatan',
    body: `Wereng batang cokelat sering tidak terlihat dari pematang karena berkumpul di **pangkal batang**.

## Langkah pengamatan
1. Masuk ke petak sawah, bukan hanya melihat dari pinggir.
2. Sibak rumpun dan lihat pangkal batang dekat permukaan air.
3. Amati beberapa titik secara diagonal.

## Kapan menghubungi penyuluh
Bila serangga terlihat banyak atau muncul bercak kering melingkar, segera hubungi penyuluh (PPL) atau petugas POPT. Untuk pengendalian kimia, ikuti label resmi dan saran penyuluh.`,
  },
  {
    cat: 'Budidaya padi', title: 'Manfaat Tanam Serempak dalam Satu Hamparan',
    summary: 'Tanam serempak membantu memutus siklus hama dan memudahkan pengelolaan air.',
    tags: 'budidaya,tanam serempak',
    body: `Tanam serempak berarti petani dalam satu hamparan menanam pada waktu yang berdekatan.

- Siklus hidup hama lebih mudah diputus.
- Pengaturan air irigasi lebih teratur.
- Pengendalian tikus bersama lebih efektif.

Diskusikan jadwal tanam bersama kelompok tani dan penyuluh setempat.`,
  },
  {
    cat: 'Pemupukan', title: 'Prinsip Pemupukan Berimbang untuk Padi Sawah',
    summary: 'Pupuk berlebihan, terutama nitrogen, dapat membuat tanaman lebih rentan hama.',
    tags: 'pupuk,nitrogen,hara',
    body: `Pemupukan berimbang berarti memberi hara sesuai kebutuhan tanaman dan kondisi tanah.

## Kenapa penting?
Nitrogen berlebih membuat daun sangat hijau dan lunak, yang disukai wereng dan hama pemakan daun.

## Langkah praktis
- Gunakan rekomendasi pemupukan setempat dari penyuluh.
- Manfaatkan alat bantu seperti Bagan Warna Daun bila tersedia.

Takaran pupuk berbeda di setiap lokasi; ikuti rekomendasi resmi setempat.`,
  },
  {
    cat: 'Teknologi pertanian', title: 'Memotret Tanaman Padi untuk Identifikasi Hama',
    summary: 'Tips mengambil foto yang terang, fokus, dan cukup dekat agar mudah diperiksa.',
    tags: 'foto,scan,teknologi',
    body: `Foto yang baik membantu penyuluh maupun alat bantu AI memahami kondisi tanaman.

1. Ambil foto saat terang, hindari bayangan tangan.
2. Dekatkan kamera sekitar 20–30 cm dari bagian yang bergejala.
3. Ketuk layar untuk fokus sebelum memotret.
4. Foto juga bagian bawah daun atau pangkal batang bila perlu.

Hasil identifikasi foto tetap perlu dikonfirmasi di lapangan.`,
  },
  {
    cat: 'Lingkungan dan cuaca', title: 'Membaca Informasi Kualitas Udara dengan Bijak',
    summary: 'Indeks kualitas udara membantu menjaga kesehatan petani saat bekerja di luar ruangan.',
    tags: 'udara,aqi,kesehatan',
    body: `Indeks kualitas udara (AQI) menggambarkan perkiraan polusi di wilayah Anda, bukan hasil sensor di lahan.

- Gunakan informasi ini untuk menjaga kesehatan saat bekerja di luar ruangan.
- AQI **tidak** bisa dipakai untuk menyimpulkan serangan hama atau kesehatan tanaman.
- Indeks yang dipakai aplikasi ini adalah US AQI, berbeda dengan ISPU Indonesia.`,
  },
  {
    cat: 'Berita pertanian', title: 'Contoh Tampilan Berita Pertanian',
    summary: 'Ini artikel contoh. Berita asli akan muncul setelah admin menghubungkan sumber RSS yang mengizinkan penggunaannya.',
    tags: 'demo',
    body: 'Artikel ini adalah **Konten Demo** untuk menunjukkan tampilan kategori berita. Aplikasi tidak mengarang berita terbaru; berita asli diambil dari sumber RSS yang dikonfigurasi admin, lengkap dengan tanggal asli dan tautan ke penerbit.',
  },
];

module.exports = { users, categories, pests, articles, DEMO_PASSWORD_FARMER, DEMO_PASSWORD_ADMIN };
