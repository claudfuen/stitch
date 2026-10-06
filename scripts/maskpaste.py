"""Paste the original pixels back inside a mask after an edit model re-rendered the whole frame.

    work/venv/bin/python scripts/maskpaste.py <original> <edited> <mask.png> <out> [--grow 12] [--feather 10]

The edit is aligned to the original first (ECC affine on a downscaled copy, so a model that nudged the framing still
lines up), then the original is composited inside the grown, feathered mask. Use it to keep actors' faces and bodies
exactly as shot while the model fixes the set around them. Prints the alignment and the mean difference outside the mask.
"""
import argparse

import cv2
import numpy as np

p = argparse.ArgumentParser()
p.add_argument("original")
p.add_argument("edited")
p.add_argument("mask")
p.add_argument("out")
p.add_argument("--grow", type=int, default=12)
p.add_argument("--feather", type=int, default=10)
p.add_argument("--align-on", choices=["people", "background"], default="people", help="background: the people differ (another take on the same plate), align on the room")
a = p.parse_args()

orig = cv2.imread(a.original)
H, W = orig.shape[:2]
ed = cv2.resize(cv2.imread(a.edited), (W, H), interpolation=cv2.INTER_AREA)
m = cv2.resize(cv2.imread(a.mask, cv2.IMREAD_GRAYSCALE), (W, H), interpolation=cv2.INTER_LINEAR)

# Align the edit to the original on the people (they should not have moved). ECC can lock onto a wrong fit, so try
# no warp, translation, rotation+translation and affine, and keep whichever leaves the people closest to the original.
s = 640 / W
go = cv2.cvtColor(cv2.resize(orig, None, fx=s, fy=s), cv2.COLOR_BGR2GRAY).astype(np.float32) / 255
ge = cv2.cvtColor(cv2.resize(ed, None, fx=s, fy=s), cv2.COLOR_BGR2GRAY).astype(np.float32) / 255
roi = cv2.dilate((cv2.resize(m, None, fx=s, fy=s) > 127).astype(np.uint8), np.ones((15, 15), np.uint8))
if a.align_on == "background":
    roi = (1 - roi).astype(np.uint8)
people = roi > 0
best = (float(np.abs(go - ge)[people].mean()), "none", None)
for name, mode in (("translation", cv2.MOTION_TRANSLATION), ("euclidean", cv2.MOTION_EUCLIDEAN), ("affine", cv2.MOTION_AFFINE)):
    warp = np.eye(2, 3, dtype=np.float32)
    try:
        _, warp = cv2.findTransformECC(go, ge, warp, mode, (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 200, 1e-6), roi, 5)
    except cv2.error:
        continue
    w = cv2.warpAffine(ge, warp, (go.shape[1], go.shape[0]), flags=cv2.INTER_LINEAR | cv2.WARP_INVERSE_MAP, borderMode=cv2.BORDER_REPLICATE)
    d = float(np.abs(go - w)[people].mean())
    if d < best[0]:
        best = (d, name, warp)
print(f"alignment: {best[1]} (aligned region differs by {best[0] * 255:.1f})")
if best[2] is not None:
    warp = best[2].copy()
    warp[:, 2] /= s
    ed = cv2.warpAffine(ed, warp, (W, H), flags=cv2.INTER_LINEAR | cv2.WARP_INVERSE_MAP, borderMode=cv2.BORDER_REPLICATE)

k = max(1, a.grow)
mm = cv2.dilate((m > 127).astype(np.uint8) * 255, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * k + 1, 2 * k + 1)))
alpha = cv2.GaussianBlur(mm.astype(np.float32) / 255, (0, 0), max(1, a.feather))[..., None]
out = orig.astype(np.float32) * alpha + ed.astype(np.float32) * (1 - alpha)
diff = np.abs(orig.astype(np.float32) - ed.astype(np.float32)).mean(2)
print(f"mean change outside the mask {diff[alpha[..., 0] < 0.05].mean():.1f}, inside the seam ring {diff[(alpha[..., 0] > 0.05) & (alpha[..., 0] < 0.95)].mean():.1f}")
cv2.imwrite(a.out, np.clip(out, 0, 255).astype(np.uint8), [cv2.IMWRITE_JPEG_QUALITY, 95])
print("wrote", a.out)
