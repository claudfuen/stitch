#!/usr/bin/env python3
"""Paint a small flat object (a sign, a logo, a stray prop) off a plain wall in a shot where the camera drifts.

    uv run --with opencv-python-headless --with numpy scripts/paintout.py <in.mp4> <out.mp4> --box x0,y0,x1,y1 --ref 0.9
        [--keep-above x0,y0,x1,y1,xr]   an occluder in front (a nearer sign): keep pixels above the line (x0,y0)-(x1,y1), left of xr
        [--wire x0,y0,x1,y1]            extra thin bits to remove (a hanging wire), in reference-frame pixels
        [--until 3.06]                  stop patching at this source time (a cut)

The object is tracked in every frame by template matching (position and scale) against the reference frame at `--ref`
seconds. Each frame's hole is filled with a smooth quadratic surface fitted to the wall around it in that same frame,
plus fresh grain matched to the wall's own noise, so the fill follows the frame's light and never freezes. The occluder
is tracked separately (it is nearer, so it moves more) and its pixels are never touched.
"""
import subprocess
import sys

import cv2
import numpy as np

args = sys.argv[1:]
opt = {args[i][2:]: args[i + 1] for i in range(len(args)) if args[i].startswith("--")}
src, dst = [a for i, a in enumerate(args) if not a.startswith("--") and (i == 0 or not args[i - 1].startswith("--"))][:2]
box = [int(v) for v in opt["box"].split(",")]
ref_t = float(opt.get("ref", 0))
until = float(opt.get("until", 1e9))
occ = [float(v) for v in opt["keep-above"].split(",")] if "keep-above" in opt else None
wire = [int(v) for v in opt["wire"].split(",")] if "wire" in opt else None

cap = cv2.VideoCapture(src)
fps = cap.get(cv2.CAP_PROP_FPS)
frames = []
while True:
    ok, f = cap.read()
    if not ok:
        break
    frames.append(f)
H, W = frames[0].shape[:2]
ref = frames[int(round(ref_t * fps))]
gray = lambda f: cv2.cvtColor(f, cv2.COLOR_BGR2GRAY)
x0, y0, x1, y1 = box
tpl = gray(ref)[y0:y1, x0:x1]
if occ:  # occluder template: a patch around its corner (xr, line end)
    ox, oy = int(occ[4]), int(occ[3])
    otpl = gray(ref)[oy - 50:oy + 10, ox - 60:ox + 6]


def track(g, t, cx, cy, scales):
    best = (-1, 0, 0, 1)
    for s in scales:
        tt = cv2.resize(t, None, fx=s, fy=s, interpolation=cv2.INTER_AREA)
        th, tw = tt.shape
        sx0, sy0 = max(0, int(cx - tw / 2 - 60)), max(0, int(cy - th / 2 - 60))
        win = g[sy0:min(H, int(cy + th / 2 + 60)), sx0:min(W, int(cx + tw / 2 + 60))]
        if win.shape[0] < th or win.shape[1] < tw:
            continue
        r = cv2.matchTemplate(win, tt, cv2.TM_CCOEFF_NORMED)
        _, mx, _, loc = cv2.minMaxLoc(r)
        if mx > best[0]:
            best = (mx, sx0 + loc[0] + tw / 2, sy0 + loc[1] + th / 2, s)
    return best


scales = np.arange(0.96, 1.08, 0.005)
cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
ocx, ocy = (occ[4] - 27, occ[3] - 20) if occ else (0, 0)
proc = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{W}x{H}", "-r", f"{fps}", "-i", "-",
                         "-i", src, "-map", "0:v", "-map", "1:a?", "-c:a", "copy", "-c:v", "libx264", "-crf", "16", "-pix_fmt", "yuv420p", dst], stdin=subprocess.PIPE)
yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
rng = np.random.default_rng(7)
patched = 0
for k, f in enumerate(frames):
    if k / fps >= until:
        proc.stdin.write(f.tobytes())
        continue
    g = gray(f)
    sc, tx, ty, s = track(g, tpl, cx, cy, scales)
    if sc < 0.5:
        proc.stdin.write(f.tobytes())
        continue
    cx, cy = tx, ty
    # the object's box and wire in this frame: the reference geometry scaled about the box centre and moved
    rcx, rcy = (x0 + x1) / 2, (y0 + y1) / 2
    mp = lambda px, py: (tx + (px - rcx) * s, ty + (py - rcy) * s)
    hole = np.zeros((H, W), np.uint8)
    a, b = mp(x0 - 3, y0 - 3)
    c, d = mp(x1 + 3, y1 + 3)
    cv2.rectangle(hole, (int(a), int(b)), (int(c), int(d)), 255, -1)
    wr = None
    if wire:
        a, b = mp(wire[0], wire[1])
        c, d = mp(wire[2], wire[3])
        wr = (int(a), int(b), int(c), int(d))
    keep = np.zeros((H, W), bool)
    if occ:
        osc, otx, oty, os_ = track(g, otpl, ocx, ocy, scales)
        ocx, ocy = otx, oty
        dx, dy = otx - (occ[4] - 27), oty - (occ[3] - 20)
        lx0, ly0, lx1, ly1, xr = occ[0] + dx, occ[1] + dy, occ[2] + dx, occ[3] + dy, occ[4] + dx
        edge = ly0 + (xx - lx0) * (ly1 - ly0) / (lx1 - lx0)
        keep = (yy < edge + 2.5) & (xx < xr + 2.5)
    hm = (hole > 0) & ~keep
    # wall ring around the hole, minus the occluder and anything far off the wall's colour
    ring = cv2.dilate(hole, np.ones((25, 25), np.uint8)) > 0
    ring &= ~(hole > 0) & ~cv2.dilate(keep.astype(np.uint8), np.ones((7, 7), np.uint8)).astype(bool)
    ring &= yy >= np.nonzero(hole.any(1))[0][0]  # only the wall beside and below: above is the ceiling line
    ys, xs = np.nonzero(ring)
    A = np.stack([np.ones_like(xs), xs, ys, xs * xs, xs * ys, ys * ys], 1).astype(np.float64)
    A[:, 1:] /= 100.0
    A[:, 3:] /= 100.0
    hy, hx = np.nonzero(hm)
    B = np.stack([np.ones_like(hx), hx, hy, hx * hx, hx * hy, hy * hy], 1).astype(np.float64)
    B[:, 1:] /= 100.0
    B[:, 3:] /= 100.0
    out = f.copy().astype(np.float32)
    lum = f[ys, xs].astype(np.float64).mean(1)
    lc, *_ = np.linalg.lstsq(A, lum, rcond=None)
    sd = min(2.0, 1.4826 * np.median(np.abs(lum - A @ lc - np.median(lum - A @ lc))))  # the wall's own grain (robust)
    noise = cv2.GaussianBlur(rng.normal(0, 1, (H, W)).astype(np.float32), (0, 0), 0.7)
    noise *= sd / (noise[hm].std() + 1e-6)
    for ch in range(3):
        coef, *_ = np.linalg.lstsq(A, f[ys, xs, ch].astype(np.float64), rcond=None)
        fill = np.zeros((H, W), np.float32)
        fill[hy, hx] = (B @ coef).astype(np.float32)
        out[..., ch][hm] = fill[hm] + noise[hm]  # one grain for all channels: luma grain, no colour speckle
    if wr:  # a thin wire: each row bridged from its own left and right neighbours (it crosses the ceiling line)
        a, b, c, d = wr
        for y in range(max(0, b), min(H, d + 1)):
            l, r = out[y, a - 2].copy(), out[y, c + 2].copy()
            for x in range(a, c + 1):
                w = (x - a + 1) / (c - a + 2)
                out[y, x] = l * (1 - w) + r * w
        hm[max(0, b):d + 1, a:c + 1] = True
    # feather the hole's outer edge into the original over 3 px
    alpha = cv2.GaussianBlur(hm.astype(np.float32), (0, 0), 1.2)
    alpha = np.maximum(alpha, hm.astype(np.float32) * (cv2.erode(hm.astype(np.uint8), np.ones((5, 5), np.uint8)) > 0))
    alpha[keep] = 0
    res_f = f.astype(np.float32) * (1 - alpha[..., None]) + out * alpha[..., None]
    proc.stdin.write(np.clip(res_f, 0, 255).astype(np.uint8).tobytes())
    patched += 1
proc.stdin.close()
proc.wait()
print(f"patched {patched} of {len(frames)} frames -> {dst}")
