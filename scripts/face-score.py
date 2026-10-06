#!/usr/bin/env python3
"""ArcFace similarity of faces in images/videos against the real Henrick anchors.

usage: face-score.py <image-or-video> [...]      (videos: 1 frame per 0.5s)
Prints mean cosine similarity to the real stills (baseline: two real frames score about 0.82).
Needs the venv at work/venv (insightface, onnxruntime, opencv-python-headless).
"""
import glob, os, subprocess, sys, tempfile
import cv2, numpy as np
from insightface.app import FaceAnalysis
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
app = FaceAnalysis(name="buffalo_l", providers=["CPUExecutionProvider"]); app.prepare(ctx_id=-1, det_size=(640, 640))

def faces(img):
    out = []
    for f in app.get(img):
        w, h = f.bbox[2] - f.bbox[0], f.bbox[3] - f.bbox[1]
        out.append((w * h, f.normed_embedding))
    return sorted(out, key=lambda t: -t[0])

def best(img, refs):
    """Score the face that looks most like the references (handles multi-person shots)."""
    fs = faces(img)
    if not fs: return None
    return max(float(np.mean([e @ r for r in refs])) for _, e in fs)

refs = []
for p in sorted(glob.glob(f"{root}/public/characters/henrick/real/real-*.jpg")):
    fs = faces(cv2.imread(p))
    if fs: refs.append(fs[0][1])

def frames(path):
    if path.lower().endswith((".mp4", ".mov", ".webm")):
        d = tempfile.mkdtemp()
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", path, "-vf", "fps=2", f"{d}/f%03d.png"], check=True)
        return sorted(glob.glob(f"{d}/f*.png"))
    return [path]

for path in sys.argv[1:]:
    sc = [s for s in (best(cv2.imread(f), refs) for f in frames(path)) if s is not None]
    n = len(frames(path))
    if not sc: print(f"{os.path.basename(path):40s} no face found"); continue
    print(f"{os.path.basename(path):40s} mean {np.mean(sc):.2f}  min {np.min(sc):.2f}  max {np.max(sc):.2f}  ({len(sc)}/{n} frames with a face)")
