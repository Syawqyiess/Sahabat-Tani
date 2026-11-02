"""Menyiapkan dataset latih dari IP102 (bagian klasifikasi) untuk scanner hama padi.

Mendukung dua format sumber:
  1. images/ + train.txt / val.txt / test.txt   (baris: "<nama_file> <label_0based>")
  2. folder per kelas: train/<label>/*.jpg, val/<label>/..., test/<label>/...

Keluaran: ml/data/padi/{train,val,test}/<kunci_kelas>/*.jpg, diperkecil (sisi pendek 320 px)
agar hemat ruang dan cepat dilatih. Pembagian train/val/test mengikuti IP102 resmi.

Contoh:
  python ml/prepare_data.py --src ml/data/ip102 --out ml/data/padi --other-per-split 1800,300,600
"""
import argparse
import json
import random
from collections import Counter
from pathlib import Path

from PIL import Image, ImageOps
from tqdm import tqdm

from classes import CLASS_KEYS, IP102_TO_KEY, OTHER_KEY

SPLITS = ("train", "val", "test")


def find_root(src: Path) -> Path:
    """Cari folder yang berisi train.txt, atau berisi folder train/ per kelas."""
    for p in [src, *src.rglob("*")]:
        if p.is_dir() and (p / "train.txt").exists():
            return p
    for p in [src, *src.rglob("*")]:
        if p.is_dir() and (p / "train").is_dir() and any((p / "train").iterdir()):
            return p
    raise SystemExit(f"Tidak menemukan train.txt atau folder train/ di {src}")


def list_split(root: Path, split: str):
    """Hasil: daftar (path_gambar, label_ip102_0based)."""
    txt = root / f"{split}.txt"
    if txt.exists():
        img_dir = next((d for d in [root / "images", root / "JPEGImages", root] if d.is_dir() and any(d.glob("*.jpg"))), root / "images")
        items = []
        for line in txt.read_text().splitlines():
            parts = line.strip().split()
            if len(parts) >= 2:
                items.append((img_dir / parts[0], int(parts[1])))
        return items
    d = root / split
    items = []
    for cls_dir in d.iterdir():
        if cls_dir.is_dir() and cls_dir.name.isdigit():
            for f in cls_dir.iterdir():
                if f.suffix.lower() in (".jpg", ".jpeg", ".png"):
                    items.append((f, int(cls_dir.name)))
    return items


class TarSource:
    """Membaca IP102 langsung dari ip102_v1.1.tar tanpa mengekstrak seluruh arsip (hemat ruang)."""

    def __init__(self, path: Path):
        import tarfile
        self.tf = tarfile.open(path)
        self.members = {m.name: m for m in self.tf.getmembers() if m.isfile()}
        self.base = next(n.rsplit("/", 1)[0] for n in self.members if n.endswith("/train.txt") or n == "train.txt")

    def list_split(self, split):
        name = f"{self.base}/{split}.txt"
        lines = self.tf.extractfile(self.members[name]).read().decode().splitlines()
        items = []
        for line in lines:
            parts = line.strip().split()
            if len(parts) >= 2:
                items.append((f"{self.base}/images/{parts[0]}", int(parts[1])))
        return items

    def open(self, member_name):
        return self.tf.extractfile(self.members[member_name])


def save_small(src, dst: Path, short=320):
    try:
        with Image.open(src) as im:
            im = ImageOps.exif_transpose(im).convert("RGB")
            w, h = im.size
            s = short / min(w, h)
            if s < 1:
                im = im.resize((max(1, round(w * s)), max(1, round(h * s))), Image.BICUBIC)
            dst.parent.mkdir(parents=True, exist_ok=True)
            im.save(dst, "JPEG", quality=90)
        return True
    except Exception as e:  # gambar rusak di dataset publik bukan hal langka
        print(f"  lewati {getattr(src, 'name', src)}: {e}")
        return False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default="ml/data/ip102")
    ap.add_argument("--out", default="ml/data/padi")
    ap.add_argument("--other-per-split", default="1800,300,600", help="jumlah sampel kelas 'bukan_hama_padi' untuk train,val,test")
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()

    random.seed(args.seed)
    src = Path(args.src)
    tar = TarSource(src) if src.suffix == ".tar" else None
    root = None if tar else find_root(src)
    out = Path(args.out)
    caps = dict(zip(SPLITS, map(int, args.other_per_split.split(","))))
    print(f"Sumber: {src if tar else root}")
    summary = {}
    for split in SPLITS:
        items = tar.list_split(split) if tar else list_split(root, split)
        if not items:
            raise SystemExit(f"Split {split} kosong")
        rice = [(p, IP102_TO_KEY[l]) for p, l in items if l in IP102_TO_KEY]
        others = [(p, OTHER_KEY) for p, l in items if l not in IP102_TO_KEY]
        random.shuffle(others)
        chosen = rice + others[: caps[split]]
        counts = Counter()
        for p, key in tqdm(chosen, desc=split):
            stem = Path(str(p)).stem
            if save_small(tar.open(p) if tar else p, out / split / key / (stem + ".jpg")):
                counts[key] += 1
        summary[split] = {k: counts.get(k, 0) for k in CLASS_KEYS}
        print(f"  {split}: {sum(counts.values())} gambar")
    (out / "summary.json").write_text(json.dumps(summary, indent=2, ensure_ascii=False))
    print(json.dumps(summary, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
