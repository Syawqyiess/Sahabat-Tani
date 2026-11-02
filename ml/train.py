"""Melatih model scanner hama padi (EfficientNet-B0, transfer learning) lalu mengekspor ke ONNX.

Langkah:
  1. Latih kepala klasifikasi (backbone dibekukan), lalu fine-tuning seluruh jaringan.
  2. Pilih bobot terbaik berdasarkan macro-F1 data validasi.
  3. Kalibrasi skor dengan temperature scaling (data validasi) agar skor lebih bermakna.
  4. Pilih ambang "cukup yakin" dari data validasi (bukan ditebak).
  5. Evaluasi pada data uji yang tidak pernah dipakai melatih.
  6. Ekspor ONNX + labels.json + model-card.json ke models/scanner-padi/.

Contoh:
  python ml/train.py --data ml/data/padi --epochs 15
"""
import argparse
import json
import math
import time
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from PIL import Image
from sklearn.metrics import classification_report, confusion_matrix, f1_score
from torch.utils.data import DataLoader, Dataset
from torchvision import models, transforms

from classes import CLASS_KEYS, labels_metadata

MEAN = [0.485, 0.456, 0.406]
STD = [0.229, 0.224, 0.225]
SIZE = 224
ROOT = Path(__file__).resolve().parent.parent


class FolderDataset(Dataset):
    """Seperti ImageFolder, tetapi urutan kelas mengikuti CLASS_KEYS (bukan abjad)."""

    def __init__(self, root: Path, tf):
        self.items = []
        for idx, key in enumerate(CLASS_KEYS):
            for f in sorted((root / key).glob("*.jpg")) if (root / key).is_dir() else []:
                self.items.append((f, idx))
        self.tf = tf

    def __len__(self):
        return len(self.items)

    def __getitem__(self, i):
        p, y = self.items[i]
        with Image.open(p) as im:
            return self.tf(im.convert("RGB")), y


def build_model(num_classes):
    m = models.efficientnet_b0(weights=models.EfficientNet_B0_Weights.IMAGENET1K_V1)
    m.classifier[1] = nn.Linear(m.classifier[1].in_features, num_classes)
    return m


@torch.no_grad()
def predict(model, loader, device):
    model.eval()
    logits, ys = [], []
    for x, y in loader:
        with torch.autocast(device_type=device.type, enabled=device.type == "cuda"):
            out = model(x.to(device, non_blocking=True))
        logits.append(out.float().cpu())
        ys.append(y)
    return torch.cat(logits), torch.cat(ys)


def fit_temperature(logits, ys):
    """Temperature scaling: cari T > 0 yang meminimalkan NLL pada data validasi."""
    log_t = torch.zeros(1, requires_grad=True)
    opt = torch.optim.LBFGS([log_t], lr=0.1, max_iter=200)

    def closure():
        opt.zero_grad()
        loss = F.cross_entropy(logits / log_t.exp(), ys)
        loss.backward()
        return loss

    opt.step(closure)
    return float(log_t.exp().item())


def ece(probs, ys, bins=15):
    """Expected Calibration Error: selisih rata-rata antara skor dan ketepatan sebenarnya."""
    conf, pred = probs.max(1)
    acc = pred.eq(ys).float()
    edges = torch.linspace(0, 1, bins + 1)
    e = 0.0
    for lo, hi in zip(edges[:-1], edges[1:]):
        m = (conf > lo) & (conf <= hi)
        if m.any():
            e += m.float().mean().item() * abs(acc[m].mean().item() - conf[m].mean().item())
    return e


def choose_threshold(probs, ys, target=0.85):
    """Ambang terkecil yang membuat ketepatan prediksi yang diterima >= target (pada validasi)."""
    conf, pred = probs.max(1)
    curve = []
    chosen = None
    for t in np.arange(0.30, 0.96, 0.05):
        keep = conf >= t
        cov = keep.float().mean().item()
        acc = pred[keep].eq(ys[keep]).float().mean().item() if keep.any() else float("nan")
        curve.append({"threshold": round(float(t), 2), "coverage": round(cov, 4), "accuracy": None if math.isnan(acc) else round(acc, 4)})
        if chosen is None and not math.isnan(acc) and acc >= target and cov > 0.2:
            chosen = round(float(t), 2)
    return (chosen if chosen is not None else 0.6), curve


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="ml/data/padi")
    ap.add_argument("--epochs", type=int, default=15)
    ap.add_argument("--freeze-epochs", type=int, default=2)
    ap.add_argument("--batch", type=int, default=32)
    ap.add_argument("--lr", type=float, default=3e-4)
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--patience", type=int, default=4)
    ap.add_argument("--out", default="models/scanner-padi")
    ap.add_argument("--from-run", default="", help="lewati pelatihan; pakai best.pt dari folder ml/runs/<waktu> untuk kalibrasi, evaluasi, dan ekspor")
    args = ap.parse_args()

    torch.manual_seed(42)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"Perangkat: {device} {torch.cuda.get_device_name(0) if device.type == 'cuda' else ''}")

    tf_train = transforms.Compose([
        transforms.RandomResizedCrop(SIZE, scale=(0.55, 1.0)),
        transforms.RandomHorizontalFlip(),
        transforms.RandomVerticalFlip(0.2),
        transforms.RandomRotation(20),
        transforms.ColorJitter(0.3, 0.3, 0.2, 0.03),
        transforms.ToTensor(),
        transforms.Normalize(MEAN, STD),
    ])
    tf_eval = transforms.Compose([transforms.Resize(256), transforms.CenterCrop(SIZE), transforms.ToTensor(), transforms.Normalize(MEAN, STD)])

    data = Path(args.data)
    ds = {s: FolderDataset(data / s, tf_train if s == "train" else tf_eval) for s in ("train", "val", "test")}
    for s, d in ds.items():
        print(f"  {s}: {len(d)} gambar")
    counts = Counter(y for _, y in ds["train"].items)
    # Bobot kelas (akar invers frekuensi) untuk mengurangi bias ke kelas yang banyak contohnya.
    weights = torch.tensor([(len(ds["train"]) / (len(CLASS_KEYS) * max(counts.get(i, 1), 1))) ** 0.5 for i in range(len(CLASS_KEYS))], dtype=torch.float)

    kw = dict(num_workers=args.workers, pin_memory=device.type == "cuda", persistent_workers=args.workers > 0)
    dl_train = DataLoader(ds["train"], batch_size=args.batch, shuffle=True, drop_last=True, **kw)
    dl_val = DataLoader(ds["val"], batch_size=64, **kw)
    dl_test = DataLoader(ds["test"], batch_size=64, **kw)

    model = build_model(len(CLASS_KEYS)).to(device)
    crit = nn.CrossEntropyLoss(weight=weights.to(device), label_smoothing=0.1)
    scaler = torch.amp.GradScaler(enabled=device.type == "cuda")
    run_dir = Path(args.from_run) if args.from_run else ROOT / "ml" / "runs" / datetime.now().strftime("%Y%m%d-%H%M%S")
    run_dir.mkdir(parents=True, exist_ok=True)
    best_f1, best_epoch, bad, history = -1.0, -1, 0, []
    if args.from_run:
        prev = json.loads((run_dir / "history.json").read_text()) if (run_dir / "history.json").exists() else []
        if prev:
            top = max(prev, key=lambda h: h["val_macro_f1"])
            best_f1, best_epoch, history = top["val_macro_f1"], top["epoch"], prev

    for epoch in range(0 if args.from_run else args.epochs):
        frozen = epoch < args.freeze_epochs
        for p in model.features.parameters():
            p.requires_grad = not frozen
        if epoch == 0 or epoch == args.freeze_epochs:
            params = [p for p in model.parameters() if p.requires_grad]
            lr = 1e-3 if frozen else args.lr
            opt = torch.optim.AdamW(params, lr=lr, weight_decay=1e-4)
            steps = (args.freeze_epochs if frozen else args.epochs - args.freeze_epochs) * len(dl_train)
            sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=lr, total_steps=max(steps, 1), pct_start=0.15)

        model.train()
        t0, run_loss, n = time.time(), 0.0, 0
        for x, y in dl_train:
            x, y = x.to(device, non_blocking=True), y.to(device, non_blocking=True)
            opt.zero_grad(set_to_none=True)
            with torch.autocast(device_type=device.type, enabled=device.type == "cuda"):
                loss = crit(model(x), y)
            scaler.scale(loss).backward()
            scaler.step(opt)
            scaler.update()
            sched.step()
            run_loss += loss.item() * x.size(0)
            n += x.size(0)

        vl, vy = predict(model, dl_val, device)
        vpred = vl.argmax(1)
        f1 = f1_score(vy, vpred, average="macro")
        acc = vpred.eq(vy).float().mean().item()
        history.append({"epoch": epoch + 1, "loss": run_loss / n, "val_acc": acc, "val_macro_f1": f1, "frozen": frozen})
        print(f"Epoch {epoch + 1:2d}/{args.epochs} {'(beku) ' if frozen else ''}loss {run_loss / n:.3f} | val acc {acc:.3f} | val macro-F1 {f1:.3f} | {time.time() - t0:.0f} dtk")
        (run_dir / "history.json").write_text(json.dumps(history, indent=2))
        if f1 > best_f1:
            best_f1, best_epoch, bad = f1, epoch + 1, 0
            torch.save(model.state_dict(), run_dir / "best.pt")
        else:
            bad += 1
            if not frozen and bad >= args.patience:
                print("Berhenti lebih awal: macro-F1 validasi tidak membaik.")
                break

    model.load_state_dict(torch.load(run_dir / "best.pt", map_location=device))

    # Kalibrasi & ambang dari data validasi
    vl, vy = predict(model, dl_val, device)
    T = fit_temperature(vl, vy)
    vprob = F.softmax(vl / T, 1)
    thr, curve = choose_threshold(vprob, vy)
    print(f"Temperatur kalibrasi: {T:.3f} | ECE val sebelum {ece(F.softmax(vl, 1), vy):.3f} -> sesudah {ece(vprob, vy):.3f} | ambang yakin {thr}")

    # Evaluasi akhir pada data uji
    tl, ty = predict(model, dl_test, device)
    tprob = F.softmax(tl / T, 1)
    tconf, tpred = tprob.max(1)
    top3 = tprob.topk(3, 1).indices.eq(ty[:, None]).any(1).float().mean().item()
    keep = tconf >= thr
    names = [m["name_id"] for m in labels_metadata()]
    report = classification_report(ty, tpred, labels=list(range(len(CLASS_KEYS))), target_names=names, digits=3, zero_division=0)
    metrics = {
        "test_images": len(ty),
        "test_accuracy": round(tpred.eq(ty).float().mean().item(), 4),
        "test_macro_f1": round(f1_score(ty, tpred, average="macro"), 4),
        "test_top3_accuracy": round(top3, 4),
        "test_ece_calibrated": round(ece(tprob, ty), 4),
        "threshold": thr,
        "test_coverage_at_threshold": round(keep.float().mean().item(), 4),
        "test_accuracy_at_threshold": round(tpred[keep].eq(ty[keep]).float().mean().item(), 4) if keep.any() else None,
        "best_epoch": best_epoch,
        "val_macro_f1_best": round(best_f1, 4),
    }
    print(json.dumps(metrics, indent=2))
    print(report)
    (run_dir / "report.txt").write_text(report, encoding="utf-8")
    (run_dir / "confusion_matrix.json").write_text(json.dumps(confusion_matrix(ty, tpred, labels=list(range(len(CLASS_KEYS)))).tolist()))
    if history:
        (run_dir / "history.json").write_text(json.dumps(history, indent=2))

    # Ekspor ONNX (logit mentah; softmax & temperatur diterapkan di aplikasi)
    out = ROOT / args.out
    out.mkdir(parents=True, exist_ok=True)
    model.eval().to("cpu").float()
    dummy = torch.randn(1, 3, SIZE, SIZE)
    torch.onnx.export(model, dummy, out / "model.onnx", input_names=["input"], output_names=["logits"], opset_version=17, dynamo=False)

    # Periksa hasil ONNX sama dengan PyTorch
    import onnxruntime as ort
    sess = ort.InferenceSession(str(out / "model.onnx"), providers=["CPUExecutionProvider"])
    diff = np.abs(sess.run(None, {"input": dummy.numpy()})[0] - model(dummy).detach().numpy()).max()
    print(f"Selisih maksimum ONNX vs PyTorch: {diff:.2e}")

    labels = {
        "version": datetime.now(timezone.utc).strftime("%Y%m%d-%H%M"),
        "classes": labels_metadata(),
        "input": {"name": "input", "size": SIZE, "resize_short": 256, "mean": MEAN, "std": STD, "layout": "NCHW", "color": "RGB"},
        "temperature": round(T, 4),
        "min_score": thr,
    }
    (out / "labels.json").write_text(json.dumps(labels, indent=2, ensure_ascii=False), encoding="utf-8")
    card = {
        "name": "Sahabat Tani — scanner hama padi (EfficientNet-B0)",
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "dataset": "IP102 v1.1 (klasifikasi), 14 kelas hama padi + sampel serangga lain; pembagian train/val/test resmi IP102. Lisensi dataset: bebas untuk penggunaan akademik.",
        "metrics": metrics,
        "threshold_curve_val": curve,
        "limitations": [
            "Hanya mengenali 14 hama padi dari IP102; walang sangit, keong mas, dan tikus belum termasuk.",
            "Foto IP102 sebagian besar dari internet, bukan foto lapangan Indonesia; akurasi di sawah bisa lebih rendah.",
            "Kelas 'bukan hama padi' hanya berisi serangga lain; foto daun/penyakit/non-serangga bisa tetap diberi skor tinggi untuk salah satu kelas.",
            "Skor adalah keyakinan model setelah kalibrasi pada data validasi, bukan peluang pasti benar.",
        ],
    }
    (out / "model-card.json").write_text(json.dumps(card, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Model tersimpan di {out}")


if __name__ == "__main__":
    main()
