#!/usr/bin/env python3
"""Measure lip sync: how well each visible mouth's opening follows the speech, frame by frame.

    python3 scripts/lipscore.py <video> <speech.wav> [--fps 24]

Every frame goes through Apple Vision face landmarks (the av-review avvision helper): inner-lip opening relative to
the face. Faces are tracked left to right by position. For each face it prints the correlation of mouth opening with
the speech loudness at zero lag, the lag (s) where it peaks (negative = lips early), and the share of loud speech
frames where that mouth is shut. A face that is not the speaker shows low correlation everywhere; a dubbed or
re-synced mouth should peak near lag 0.
"""
import glob
import json
import math
import os
import subprocess
import sys
import tempfile

args = sys.argv[1:]
video, wav = args[0], args[1]
fps = float(args[args.index("--fps") + 1]) if "--fps" in args else 24.0
helper = sorted(glob.glob(os.path.expanduser("~/.cache/av-review/bin/avvision-*")), key=os.path.getmtime)[-1]
tmp = tempfile.mkdtemp(prefix="lips-")
subprocess.run(["ffmpeg", "-v", "error", "-i", video, "-vf", f"fps={fps}", "-q:v", "3", os.path.join(tmp, "f%05d.jpg")], check=True)
frames = sorted(glob.glob(os.path.join(tmp, "f*.jpg")))
rows = {}
for k in range(0, len(frames), 60):
    out = subprocess.run([helper, "faces", *frames[k:k + 60]], capture_output=True, text=True).stdout
    for line in out.splitlines():
        if line.startswith("{"):
            d = json.loads(line)
            rows[d["file"]] = d.get("faces", [])
pcm = subprocess.run(["ffmpeg", "-v", "error", "-i", wav, "-ac", "1", "-ar", "16000", "-f", "s16le", "-"], capture_output=True).stdout
smp = [int.from_bytes(pcm[i:i + 2], "little", signed=True) for i in range(0, len(pcm) - 1, 2)]
hop = int(16000 / fps)
env = []
for i in range(len(frames)):
    w = smp[i * hop:(i + 1) * hop] or [0]
    env.append(20 * math.log10(max(1.0, (sum(x * x for x in w) / len(w)) ** 0.5)))
loud = max(env) - 18  # within 18 dB of the loudest frame counts as speech
# track faces by box centre x
tracks = []  # each: {"x": last centre, "m": [mouth per frame or None]}
for i, f in enumerate(frames):
    faces = [fc for fc in rows.get(f, []) if fc.get("conf", 0) > 0.5 and "mouthOpen" in fc and fc["box"][3] > 0.05]
    used = set()
    for fc in sorted(faces, key=lambda c: c["box"][0]):
        cx = fc["box"][0] + fc["box"][2] / 2
        best = min((t for t in tracks if id(t) not in used), key=lambda t: abs(t["x"] - cx), default=None)
        if best is None or abs(best["x"] - cx) > 0.15:
            best = {"x": cx, "m": [None] * len(frames), "w": fc["box"][2]}
            tracks.append(best)
        best["x"], best["w"] = cx, fc["box"][2]
        best["m"][i] = fc["mouthOpen"]
        used.add(id(best))


def corr(a, b):
    p = [(x, y) for x, y in zip(a, b) if x is not None]
    if len(p) < 10:
        return float("nan")
    mx, my = sum(x for x, _ in p) / len(p), sum(y for _, y in p) / len(p)
    sx = sum((x - mx) ** 2 for x, _ in p) ** 0.5
    sy = sum((y - my) ** 2 for _, y in p) ** 0.5
    return sum((x - mx) * (y - my) for x, y in p) / (sx * sy + 1e-9)


print(f"{os.path.basename(video)}: {len(frames)} frames, {len(tracks)} face track(s)")
for t in sorted(tracks, key=lambda t: t["x"]):
    seen = sum(m is not None for m in t["m"])
    if seen < len(frames) * 0.3:
        continue
    lags = range(-int(0.8 * fps), int(0.8 * fps) + 1)
    # lag L: mouth at frame i is compared with speech at frame i+L (positive L = speech later = lips early)
    cs = {L: corr([t["m"][i] if 0 <= i + L < len(env) else None for i in range(len(env))], [env[min(max(i + L, 0), len(env) - 1)] for i in range(len(env))]) for L in lags}
    bl = max(cs, key=lambda L: -1 if math.isnan(cs[L]) else cs[L])
    sp = [i for i in range(len(env)) if env[i] > loud and t["m"][i] is not None]
    shut = sum(t["m"][i] < 0.02 for i in sp) / max(1, len(sp))
    print(f"  face at x={t['x']:.2f} (seen {seen}/{len(frames)}): r0={cs[0]:+.2f}  best r={cs[bl]:+.2f} at {'lips early' if bl > 0 else 'lips late'} {abs(bl) / fps:.2f} s  shut-while-talking {shut:.0%}")
subprocess.run(["rm", "-rf", tmp])
