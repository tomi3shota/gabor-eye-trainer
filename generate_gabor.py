"""
既存のガボールパッチ画像（白背景・グレースケール・ガウス包絡×正弦波格子）
のスタイルに合わせて、追加のガボールパッチ画像を生成するスクリプト。

観察したスタイル:
- 背景は白 (255,255,255,255) の不透明PNG
- 中心が暗く、ガウス包絡で周辺が白へフェードアウト
- サイズは概ね 210〜320px 前後の正方形に近い矩形
"""
import numpy as np
from PIL import Image
import random

random.seed(42)
np.random.seed(42)

OUT_DIR = "images"

def make_gabor_array(size_w, size_h, orientation_deg, cycles, sigma_ratio, phase, contrast):
    y, x = np.mgrid[0:size_h, 0:size_w].astype(float)
    cx, cy = (size_w - 1) / 2.0, (size_h - 1) / 2.0
    x -= cx
    y -= cy

    theta = np.deg2rad(orientation_deg)
    xp = x * np.cos(theta) + y * np.sin(theta)
    yp = -x * np.sin(theta) + y * np.cos(theta)

    sigma = sigma_ratio * min(size_w, size_h)
    envelope = np.exp(-(xp ** 2 + yp ** 2) / (2 * sigma ** 2))

    grating = np.cos(2 * np.pi * cycles * xp / size_w + phase)

    # 白背景(1.0)から、包絡×格子の分だけ暗く落とす
    darkness = envelope * ((1 - grating) / 2.0) * contrast
    value = 1.0 - darkness
    value = np.clip(value, 0, 1)
    return value

def save_gabor(index, size_w, size_h, orientation_deg, cycles, sigma_ratio, phase, contrast):
    value = make_gabor_array(size_w, size_h, orientation_deg, cycles, sigma_ratio, phase, contrast)
    gray = (value * 255).astype(np.uint8)
    rgba = np.zeros((size_h, size_w, 4), dtype=np.uint8)
    rgba[:, :, 0] = gray
    rgba[:, :, 1] = gray
    rgba[:, :, 2] = gray
    rgba[:, :, 3] = 255  # 不透明（既存画像と同じ）
    img = Image.fromarray(rgba, mode="RGBA")
    fname = f"{OUT_DIR}/gabor_{index:02d}.png"
    img.save(fname)
    return fname

# --- 生成パラメータ: 向き・周波数・包絡サイズにバリエーションを持たせる ---
configs = [
    # (orientation_deg, cycles, sigma_ratio, phase)
    (0,   1.2, 0.30, 0.0),
    (15,  2.0, 0.24, 0.0),
    (30,  1.4, 0.28, 0.3),
    (45,  3.0, 0.20, 0.0),
    (60,  1.6, 0.27, 0.0),
    (75,  4.0, 0.18, 0.2),
    (90,  1.3, 0.29, 0.0),
    (105, 2.4, 0.22, 0.0),
    (120, 1.5, 0.27, 0.4),
    (135, 5.0, 0.16, 0.0),
    (150, 2.0, 0.24, 0.0),
    (165, 1.4, 0.28, 0.1),
    (10,  4.5, 0.17, 0.0),
    (40,  1.2, 0.30, 0.0),
    (70,  2.6, 0.22, 0.3),
    (100, 1.6, 0.26, 0.0),
    (130, 3.4, 0.19, 0.0),
    (160, 1.3, 0.29, 0.2),
    (20,  2.2, 0.23, 0.0),
    (95,  5.5, 0.15, 0.0),
]

start_index = 28
generated = []
for i, (ang, cyc, sig, ph) in enumerate(configs):
    idx = start_index + i
    w = random.randint(220, 300)
    h = int(w * random.uniform(0.92, 1.08))
    contrast = random.uniform(0.85, 0.98)
    fname = save_gabor(idx, w, h, ang, cyc, sig, ph, contrast)
    generated.append((fname, w, h, ang, cyc))

for g in generated:
    print(g)
print(f"\n合計 {len(generated)} 枚生成しました。")
