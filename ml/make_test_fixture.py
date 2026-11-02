"""Membuat model ONNX mini untuk tes otomatis penyedia `lokal` (test/fixtures/scanner-mini).

Model ini TIDAK mengenali hama: keluarannya ditentukan warna rata-rata gambar
(merah → kelas 0, hijau → kelas 7 "wereng batang cokelat", biru → kelas 14 "bukan hama padi"),
sehingga tes bisa memeriksa alur aplikasi secara pasti.
"""
import json
from pathlib import Path

import torch
import torch.nn as nn

from classes import CLASS_KEYS, labels_metadata

OUT = Path(__file__).resolve().parent.parent / "test" / "fixtures" / "scanner-mini"


class Mini(nn.Module):
    def forward(self, x):  # x: [1,3,224,224] ternormalisasi ImageNet
        m = x.mean(dim=(2, 3))  # [1,3]
        logits = torch.full((1, len(CLASS_KEYS)), -4.0)
        logits = logits.clone()
        logits[:, 0] = m[:, 0] * 6
        logits[:, 7] = m[:, 1] * 6
        logits[:, 14] = m[:, 2] * 6
        return logits


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    torch.onnx.export(Mini(), torch.zeros(1, 3, 224, 224), OUT / "model.onnx", input_names=["input"], output_names=["logits"], opset_version=17, dynamo=False)
    (OUT / "labels.json").write_text(json.dumps({
        "version": "fixture",
        "classes": labels_metadata(),
        "input": {"name": "input", "size": 224, "resize_short": 256, "mean": [0.485, 0.456, 0.406], "std": [0.229, 0.224, 0.225], "layout": "NCHW", "color": "RGB"},
        "temperature": 1.0,
        "min_score": 0.6,
    }, indent=2, ensure_ascii=False), encoding="utf-8")
    (OUT / "model-card.json").write_text(json.dumps({"metrics": {"test_accuracy": 0.5, "test_top3_accuracy": 0.8, "test_macro_f1": 0.4, "test_images": 10}, "limitations": ["fixture"]}, indent=2), encoding="utf-8")
    print("Fixture dibuat di", OUT)
