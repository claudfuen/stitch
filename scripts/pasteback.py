"""Paste a real frame's own pixels back over an AI extension of it (outpaint or reframe), with a feathered edge.

    work/venv/bin/python scripts/pasteback.py <generated> <original> <out> [--feather 48] [--size 1920x1080]

Edit models re-render the whole picture, including the part that was real. This finds where the original sits inside
the generated frame (multi-scale template matching on edges), scales it to fit, and composites it back so everything
that was photographed stays photographed. Only the extension is generated. Prints the match score, scale and offset;
a score under 0.5 means the model moved or reframed the original and the paste-back is skipped (exit code 2).
"""
import argparse
import sys

import cv2
import numpy as np

p = argparse.ArgumentParser()
p.add_argument("generated")
p.add_argument("original")
p.add_argument("out")
p.add_argument("--feather", type=int, default=48)
p.add_argument("--size", default="1920x1080")
p.add_argument("--at", help="x,y of the original in the generated frame at --size; skips matching (for canvases you padded yourself)")
a = p.parse_args()

W, H = map(int, a.size.split("x"))
gen = cv2.resize(cv2.imread(a.generated), (W, H), interpolation=cv2.INTER_AREA)
orig = cv2.imread(a.original)


def edges(img):
    g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    return cv2.Canny(cv2.GaussianBlur(g, (5, 5), 0), 40, 120)


ge = edges(gen)
best = (-1.0, 1.0, (0, 0))
if a.at:
    ax, ay = map(int, a.at.split(","))
    best = (1.0, 1.0, (ax, ay))
for scale in ([] if a.at else np.linspace(0.6, 1.1, 51)):
    w = int(W * scale)
    h = int(orig.shape[0] * w / orig.shape[1])
    if w > W or h > H or w < 200:
        continue
    oe = edges(cv2.resize(orig, (w, h), interpolation=cv2.INTER_AREA))
    res = cv2.matchTemplate(ge, oe, cv2.TM_CCOEFF_NORMED)
    _, mx, _, loc = cv2.minMaxLoc(res)
    if mx > best[0]:
        best = (mx, scale, loc)

score, scale, (x, y) = best
w = orig.shape[1] if a.at else int(W * scale)
h = int(orig.shape[0] * w / orig.shape[1])
print(f"match {score:.3f} scale {scale:.3f} at ({x},{y}) size {w}x{h}")
if score < 0.5:
    print("the model moved or reframed the original: not pasting back")
    sys.exit(2)

src = cv2.resize(orig, (w, h), interpolation=cv2.INTER_AREA).astype(np.float32)
mask = np.zeros((h, w), np.float32)
f = max(1, a.feather)
mask[f:h - f, f:w - f] = 1.0
mask = cv2.GaussianBlur(mask, (0, 0), f / 2)
out = gen.astype(np.float32)
roi = out[y:y + h, x:x + w]
# Match the extension's tone to the real frame along the seam, so the feather does not show a step.
ring = (mask > 0.05) & (mask < 0.6)
if ring.any():
    for c in range(3):
        roi[..., c] *= (src[..., c][ring].mean() + 1) / (roi[..., c][ring].mean() + 1)
m3 = mask[..., None]
out[y:y + h, x:x + w] = src * m3 + roi * (1 - m3)
cv2.imwrite(a.out, np.clip(out, 0, 255).astype(np.uint8), [cv2.IMWRITE_JPEG_QUALITY, 95])
print("wrote", a.out)
