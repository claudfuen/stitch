#!/usr/bin/env python3
"""Colour-match a shot to a target look and write a 3D LUT (.cube) for ffmpeg's lut3d.

usage: grade.py spec.json
spec: {"source": {"path": "...mp4", "in": 0.5, "dur": 4.0},
       "targets": [{"path": "...jpg"} | {"path": "...mp4", "in": 0, "dur": 5}],
       "strength": 0.65, "out": "work/luts/x.cube"}

Statistics transfer in Lab (mean and spread per channel), damped by `strength` and clamped so a
shot is nudged toward the look, never repainted. Targets are real footage where it exists.
"""
import json, sys
import cv2
import numpy as np

N = 33

def frames(path, t0=None, dur=None, n=8):
    if path.lower().endswith((".jpg", ".jpeg", ".png")):
        img = cv2.imread(path)
        return [img] if img is not None else []
    cap = cv2.VideoCapture(path)
    fps = cap.get(cv2.CAP_PROP_FPS) or 24
    total = (cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0) / fps
    t0 = t0 or 0.0
    dur = dur or max(0.1, total - t0)
    out = []
    for k in range(n):
        cap.set(cv2.CAP_PROP_POS_MSEC, (t0 + dur * (k + 0.5) / n) * 1000)
        ok, f = cap.read()
        if ok:
            out.append(f)
    return out

def lab_stats(imgs):
    px = []
    for im in imgs:
        small = cv2.resize(im, (480, 270)).astype(np.float32) / 255.0
        px.append(cv2.cvtColor(small, cv2.COLOR_BGR2LAB).reshape(-1, 3))
    a = np.concatenate(px)
    return a.mean(0), a.std(0) + 1e-6

spec = json.load(open(sys.argv[1]))
src = spec["source"]
s_mean, s_std = lab_stats(frames(src["path"], src.get("in"), src.get("dur")))
t_imgs = []
for t in spec["targets"]:
    t_imgs += frames(t["path"], t.get("in"), t.get("dur"))
t_mean, t_std = lab_stats(t_imgs)
k = float(spec.get("strength", 0.65))
ratio = np.clip(t_std / s_std, 0.75, 1.35)

g = np.linspace(0, 1, N, dtype=np.float32)
b, gg, r = np.meshgrid(g, g, g, indexing="ij")          # b slowest, r fastest (cube order)
bgr = np.stack([b, gg, r], -1).reshape(-1, 1, 3)
lab = cv2.cvtColor(bgr, cv2.COLOR_BGR2LAB).reshape(-1, 3)
moved = (lab - s_mean) * ratio + t_mean
lab2 = lab + k * (moved - lab)
lab2[:, 0] = np.clip(lab2[:, 0], 0, 100)
out = cv2.cvtColor(lab2.reshape(-1, 1, 3).astype(np.float32), cv2.COLOR_LAB2BGR).reshape(-1, 3)
out = np.clip(out, 0, 1)
with open(spec["out"], "w") as f:
    f.write(f"TITLE \"stitch grade\"\nLUT_3D_SIZE {N}\n")
    for bb, gg2, rr in out:  # stored as B,G,R; .cube wants R G B
        f.write(f"{rr:.6f} {gg2:.6f} {bb:.6f}\n")
print(json.dumps({"source_L": round(float(s_mean[0]), 1), "target_L": round(float(t_mean[0]), 1), "out": spec["out"]}))
