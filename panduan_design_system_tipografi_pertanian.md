# 🌿 Design System & Typography Guide: Modern AgriTech Web

Panduan ini dirancang untuk menciptakan antarmuka web bertema pertanian modern (*AgriTech*), perkebunan, atau teknologi pangan yang memadukan kesan alami (organik) dengan teknologi tinggi (presisi & bersih).

---

## 1. Filosofi Desain (Visual Direction)
* **Modern Organic Tech:** Menggabungkan fotografi alam/lahan pertanian yang kaya tekstur dengan elemen antarmuka yang bersih, geometris, dan futuristik.
* **Bento & Card-Based Layout:** Menggunakan tata letak berbasis kartu (*card*) dengan sudut membulat (*rounded corners*) yang ramah dan terstruktur rapi.
* **Visual Breathing Room:** Pemanfaatan *whitespace* (ruang kosong) yang luas untuk menjaga keterbacaan dan memberikan kesan premium.
* **Interactive Micro-elements:** Penggunaan *pill buttons* (tombol berbentuk kapsul), *inline badges* di tengah teks judul, dan sudut kartu melengkung ke dalam (*inverted radius*) untuk tombol aksi cepat.

---

## 2. Palet Warna (Color Palette)

Kombinasi warna bumi (*earthy tones*) yang hangat dipadukan dengan hijau gelap yang tegas dan aksen hijau limau yang segar.

### A. Warna Utama (Primary & Brand Colors)
| Nama Warna | Hex Code | Penggunaan |
| :--- | :--- | :--- |
| **Deep Forest Green** | `#0A2E1D` | Footer, teks utama di atas latar terang, tombol aksi gelap. |
| **Lush Leaf Green** | `#4E8A3E` | Aksen alam, *highlight* badge, indikator aktif, tombol sekunder. |
| **Vibrant Lime Accent** | `#84C341` | Elemen interaktif, ikon sorotan, aksen pada mode gelap. |

### B. Warna Latar & Permukaan (Background & Surface)
| Nama Warna | Hex Code | Penggunaan |
| :--- | :--- | :--- |
| **Pure White** | `#FFFFFF` | Latar belakang utama halaman (*Canvas*). |
| **Warm Sand / Cream** | `#F5EFEA` | Latar belakang kartu produk, kartu fitur (*Bento box*), dan *section container*. |
| **Soft Sage Tint** | `#F2F6F3` | Latar belakang alternatif atau *hover state* pada elemen daftar. |

### C. Warna Teks & Netral (Typography & Neutrals)
| Nama Warna | Hex Code | Penggunaan |
| :--- | :--- | :--- |
| **Charcoal Ink** | `#181C19` | Judul utama (H1-H3) di atas latar terang. |
| **Muted Moss Gray** | `#5C6660` | Teks paragraf, deskripsi produk, dan sub-judul. |
| **Soft Border Gray** | `#E0E4E1` | Garis pemisah (*divider*), *outline* pada tombol sekunder atau tag. |
| **Promo Coral** | `#E86A33` | *Badge* diskon atau label promosi khusus (misal: `-30%`). |

---

## 3. Tipografi (Typography)

Gaya tipografi menggunakan jenis huruf **Geometric Sans-Serif** yang modern, bersih, memiliki keterbacaan tinggi, dan proporsi lebar yang seimbang.

### Rekomendasi Font
1. **Primary Font (Headings & Display):** `Plus Jakarta Sans` atau `Outfit` atau `Manrope` (Google Fonts).
2. **Secondary Font (Body & UI):** `Inter` atau `Plus Jakarta Sans`.

### Skala Tipografi (Type Scale - Desktop)

| Elemen | Font Weight | Ukuran (Size) | Line Height | Letter Spacing | Catatan Penggunaan |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Hero Title (H1)** | Medium (500) / SemiBold (600) | `56px` – `64px` | `1.1` (110%) | `-0.03em` | Sering disisipi ikon/badge bundar di antara kata. |
| **Section Title (H2)** | SemiBold (600) | `40px` – `48px` | `1.15` (115%) | `-0.02em` | Judul setiap bagian (*section*). |
| **Card Title (H3)** | SemiBold (600) | `20px` – `24px` | `1.3` (130%) | `-0.01em` | Nama produk, judul fitur, atau judul artikel. |
| **Body Large** | Regular (400) | `18px` | `1.6` (160%) | `0em` | Paragraf pembuka atau deskripsi utama. |
| **Body Regular** | Regular (400) | `14px` – `16px` | `1.5` (150%) | `0em` | Teks deskripsi kartu dan spesifikasi. |
| **Caption / Tag** | Medium (500) | `11px` – `12px` | `1.2` (120%) | `+0.05em` | Label kategori (*Uppercase*, misal: `ABOUT US`, `GUIDELINE`). |
| **Footer Watermark** | Bold (700) | `140px` – `200px` | `0.85` (85%) | `-0.04em` | Nama merek raksasa di bagian paling bawah footer. |

---

## 4. Bentuk, Sudut & Spasi (Shapes, Radius & Spacing)

Ciri khas utama dari desain ini adalah penggunaan sudut melengkung yang konsisten dan efek potongan sudut (*cutout*) untuk tombol aksi.

### Border Radius
* **Section Container & Hero Banner:** `24px` – `32px`
* **Product & Feature Cards:** `16px` – `20px`
* **Buttons & Badges (Pill Shape):** `9999px` (Full rounded)
* **Circular Action Icon (Panah Diagonal `↗`):** `50%` (Ukuran `36px x 36px` atau `44px x 44px`)

### Gaya Tombol (Button Styles)
1. **Primary Pill Button (Dark/Green):**
   * Latar: `#0A2E1D` atau `#4E8A3E`, Teks: `#FFFFFF`.
   * Dilengkapi lingkaran kecil di sisi kanan berisi ikon panah (`→` atau `↗`).
2. **Outline Pill Button:**
   * Latar: Transparan / `#FFFFFF`, Border: `1px solid #181C19`, Teks: `#181C19`.
   * *Hover:* Latar berubah menjadi `#181C19`, teks menjadi `#FFFFFF`.
3. **Card Corner Action (Cutout / Floating Circle):**
   * Tombol lingkaran berikon panah diagonal (`↗`) yang diletakkan di sudut kanan atas atau kanan bawah kartu produk/artikel.

---

## 5. Komponen Utama (Key UI Components)

### 1. Floating Navbar
* **Bentuk:** Kapsul melayang (*floating pill*) dengan margin atas dan samping, latar belakang putih solid (`#FFFFFF`) atau *glassmorphism* ringan.
* **Isi:** Logo di kiri, menu navigasi di tengah, kolom pencarian (*search bar*) berbentuk kapsul, dan tombol kontak di kanan.

### 2. Inline Text Badges (Ciri Khas Visual)
* Menyisipkan ikon kecil berbentuk kapsul atau lingkaran di tengah kalimat judul (H1/H2).
* *Contoh:* `Elevates [ikon daun] agricultural operations to [ikon panah] new heights.`

### 3. Bento Hero Section
* Menggunakan foto latar belakang lanskap pertanian/perkebunan dari sudut pandang udara (*aerial view*).
* Di bagian bawah gambar terdapat 2–3 kartu produk unggulan (*floating cards*) dengan latar krem (`#F5EFEA`) dan kartu ulasan/rating pelanggan (*glassmorphism blur*).

### 4. Interactive Accordion List
* Daftar keunggulan atau fitur berbentuk baris horizontal dengan garis pemisah tipis (`#E0E4E1`), dilengkapi penomoran (`01`, `02`, `03`) di sisi kanan. Saat aktif, baris akan melebar menampilkan deskripsi singkat dan foto *thumbnail*.

### 5. Giant Typography Footer
* Latar belakang hijau hutan gelap (`#0A2E1D`).
* Kolom navigasi rapi di bagian atas, diakhiri dengan teks nama merek berukuran sangat besar (*oversized typography*) yang terpotong sedikit di bagian bawah layar.

---

## 6. Panduan Fotografi & Ikonografi

* **Fotografi:**
  * Gunakan foto lanskap pertanian yang cerah dengan pencahayaan alami (*golden hour* atau siang hari yang terang).
  * Untuk foto produk/alat pertanian, gunakan latar belakang bersih yang menyatu dengan warna kartu (`#F5EFEA`) atau foto *in-action* di lapangan.
* **Ikonografi:**
  * Gunakan gaya ikon garis tipis (*Stroke / Outline icons*) dengan ketebalan `1.5px` hingga `2px` (rekomendasi: **Lucide Icons** atau **Phosphor Icons**).
  * Gunakan simbol organik seperti daun, bulir padi/gandum, tetesan air, matahari, dan panah arah.

---

## 7. Contoh Konfigurasi CSS Variables (Siap Pakai)

```css
:root {
  /* Colors */
  --color-primary-dark: #0A2E1D;
  --color-primary-green: #4E8A3E;
  --color-accent-lime: #84C341;
  
  --bg-canvas: #FFFFFF;
  --bg-card-warm: #F5EFEA;
  --bg-card-sage: #F2F6F3;
  
  --text-heading: #181C19;
  --text-body: #5C6660;
  --text-inverse: #FFFFFF;
  
  --border-subtle: #E0E4E1;
  --badge-promo: #E86A33;

  /* Typography */
  --font-heading: 'Plus Jakarta Sans', sans-serif;
  --font-body: 'Inter', sans-serif;

  /* Border Radius */
  --radius-section: 28px;
  --radius-card: 18px;
  --radius-pill: 9999px;
}
```