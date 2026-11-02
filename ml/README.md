# Model scanner hama padi buatan sendiri

Folder ini berisi pipeline untuk melatih model pengenal hama padi milik Sahabat Tani sendiri,
lalu memakainya di aplikasi tanpa layanan AI luar (penyedia `lokal`).

```
ml/
  classes.py        definisi 15 kelas (14 hama padi IP102 + "bukan hama padi")
  prepare_data.py   menyiapkan & memperkecil foto dari IP102 ke ml/data/padi
  train.py          melatih, mengkalibrasi skor, mengevaluasi, mengekspor ONNX
  data/  runs/  .venv/   (tidak masuk Git)
models/scanner-padi/
  model.onnx  labels.json  model-card.json   (hasil latih yang dipakai aplikasi)
```

## 1. Lingkungan Python

```bash
py -3.13 -m venv ml/.venv
```
```bash
ml/.venv/Scripts/python -m pip install torch torchvision --index-url https://download.pytorch.org/whl/cu128
```
```bash
ml/.venv/Scripts/python -m pip install -r ml/requirements.txt
```

## 2. Data

Dataset: **IP102 v1.1** (Wu dkk., CVPR 2019), bagian *Classification* dari tautan resmi di
<https://github.com/xpwu95/IP102>. Lisensi: **bebas untuk penggunaan akademik**; untuk keperluan lain hubungi penulis.
Ekstrak ke `ml/data/ip102`, lalu:

```bash
ml/.venv/Scripts/python ml/prepare_data.py --src ml/data/ip102 --out ml/data/padi
```

Yang dipakai: kelas 1–14 IP102 (hama padi) + sampel serangga lain sebagai kelas “bukan hama padi”.
Pembagian train/val/test mengikuti berkas resmi IP102.

**Menambah foto lapangan sendiri:** letakkan foto JPG di `ml/data/padi/<split>/<kunci_kelas>/`
(kunci kelas lihat `classes.py`), mis. 70% ke `train`, 15% `val`, 15% `test`. Pastikan label dicek penyuluh.
Untuk hama baru (walang sangit, keong mas, tikus), tambahkan kelasnya di `classes.py` lalu latih ulang.

## 3. Latih

```bash
ml/.venv/Scripts/python ml/train.py --data ml/data/padi --epochs 15
```

Hasil:
- `models/scanner-padi/model.onnx` — model (≈16 MB) yang dijalankan aplikasi dengan `onnxruntime-node`.
- `models/scanner-padi/labels.json` — kelas, prapemrosesan, **temperatur kalibrasi**, dan **ambang yakin**.
- `models/scanner-padi/model-card.json` — metrik data uji dan keterbatasan model.
- `ml/runs/<waktu>/` — laporan per kelas, confusion matrix, riwayat latih.

Skor dikalibrasi dengan *temperature scaling* pada data validasi, dan ambang “cukup yakin” dipilih
sebagai ambang terkecil yang memberi ketepatan ≥ 85% pada data validasi. Di bawah ambang, aplikasi
menyatakan hama belum dapat diidentifikasi dan hanya menampilkan kemungkinan.

## 4. Pakai di aplikasi

Di `.env`:
```
AI_VISION_PROVIDER=lokal
# opsional: LOCAL_SCANNER_MIN_SCORE=0.6
```
Mulai ulang aplikasi, lalu jalankan `npm run cek-ai`. Chatbot tetap memakai penyedia percakapan yang aktif
(mis. Gemini) dan otomatis menerima hasil serta skor dari model lokal.

## Keterbatasan (wajib disampaikan saat presentasi/pemakaian)
- Hanya 14 hama padi dari IP102; walang sangit, keong mas, tikus belum ada.
- Foto IP102 banyak dari internet, bukan sawah Indonesia — uji ulang dengan foto lapangan.
- Model mengenali pola gambar; ia tidak menjelaskan ciri visual dan tidak dilatih untuk penyakit/kekurangan hara.
