#!/usr/bin/env python3
"""How far each line's lips are from the sound, across a whole cut, from the takes' own audio.

    python3 scripts/lipdrift.py <segs.json> <dewhip-map.json> <dialogue.wav> <lines.json> [--synced a-b,c-d] [--fps 24]

A video model renders mouths to the audio it generates with the take, so each take's own soundtrack is a record of
where its lips are. This rebuilds that "lips track" for the finished picture: every segment's take audio, cut exactly
like its picture (same source time, same frames, same de-whip frame map), then compares it with the dialogue the film
actually plays, line by line. lag > 0: the lips come after the sound (late); lag < 0: early. Frames re-rendered by a
lip-sync pass (--synced, seconds) follow the dialogue by construction and are reported as synced.
lines.json: [{"start": s, "end": s, "text": "..."}] in film seconds.
"""
import json
import math
import re
import subprocess
import sys

args = sys.argv[1:]
opt = {args[i][2:]: args[i + 1] for i in range(len(args)) if args[i].startswith("--")}
segs_p, map_p, dlg_p, lines_p = [a for i, a in enumerate(args) if not a.startswith("--") and (i == 0 or not args[i - 1].startswith("--"))][:4]
FPS = float(opt.get("fps", 24))
SR = 8000
HOP = int(SR / FPS)  # samples per frame (333 at 24 fps)
synced = [tuple(map(float, r.split("-"))) for r in opt.get("synced", "").split(",") if r]
segs, m, lines = json.load(open(segs_p)), json.load(open(map_p)), json.load(open(lines_p))


def pcm(path, ss=None, t=None):
    cmd = ["ffmpeg", "-v", "error"] + (["-ss", f"{ss:.4f}"] if ss is not None else []) + (["-t", f"{t:.4f}"] if t else []) + \
          ["-i", path, "-vn", "-ac", "1", "-ar", str(SR), "-f", "s16le", "-"]
    b = subprocess.run(cmd, capture_output=True).stdout
    return [int.from_bytes(b[i:i + 2], "little", signed=True) for i in range(0, len(b) - 1, 2)]


N = len(m)
raw = [0] * (N * HOP + HOP)
has = [False] * N
for s in segs:
    if "take" not in s:
        continue
    a, b = round(s["r0"] * FPS), round(s["r1"] * FPS)
    hold = 0.0
    mt = re.search(r"start_duration=([\d.]+)", s.get("vf", "") or "")
    if mt:
        hold = float(mt.group(1))
    x = pcm(s["take"], s["src"], (b - a) / FPS + 0.2)
    if not x:
        continue
    off = int(round(hold * FPS)) * HOP
    for k in range(min((b - a) * HOP - off, len(x))):
        raw[a * HOP + off + k] = x[k]
    for f in range(a, b):
        has[f] = True
lips = [0] * (N * HOP)
lip_has = [False] * N
for o, src in enumerate(m):
    lips[o * HOP:(o + 1) * HOP] = raw[src * HOP:(src + 1) * HOP]
    lip_has[o] = has[src] if src < N else False
dlg = pcm(dlg_p)


def env(x, a, b):  # 10 ms RMS in dB between samples a and b
    w = SR // 100
    return [20 * math.log10(max(1.0, (sum(v * v for v in x[i:i + w]) / w) ** 0.5)) for i in range(a, b - w, w)]


def lag(t0, t1):
    a, b = int(t0 * SR), int(t1 * SR)
    e1, e2 = env(dlg, a, b), env(lips, a, b)
    if len(e1) < 20 or max(e2) < 45:
        return None, 0
    best, bl = -2, 0
    for L in range(-50, 51):  # +-0.5 s in 10 ms steps
        p = [(e1[i], e2[i + L]) for i in range(len(e1)) if 0 <= i + L < len(e2)]
        mx, my = sum(u for u, _ in p) / len(p), sum(v for _, v in p) / len(p)
        sx = sum((u - mx) ** 2 for u, _ in p) ** 0.5
        sy = sum((v - my) ** 2 for _, v in p) ** 0.5
        r = sum((u - mx) * (v - my) for u, v in p) / (sx * sy + 1e-9)
        if r > best:
            best, bl = r, L
    return bl / 100, best


if "segments" in opt:  # one lag per take segment: how far to slip its source time (src -= lag)
    for s in segs:
        if "take" not in s or s["r1"] - s["r0"] < 1.0:
            continue
        sp = [ln for ln in lines if ln["start"] < s["r1"] - 0.1 and ln["end"] > s["r0"] + 0.1]
        if not sp:
            continue
        L, r = lag(max(s["r0"], sp[0]["start"] - 0.25), min(s["r1"], sp[-1]["end"] + 0.25))
        if L is not None:
            print(f"{s['r0']:6.2f}-{s['r1']:6.2f} {s.get('cam', ''):5} lips {L * 1000:+5.0f} ms  r={r:.2f}  {s['take'].split('takes/')[-1]}")
    sys.exit(0)
print(f"{'line':>13}  {'lips':>18}  text")
for ln in lines:
    t0, t1 = ln["start"], ln["end"]
    f0, f1 = int(t0 * FPS), int(t1 * FPS)
    if any(a <= t0 and t1 <= b + 0.05 for a, b in synced):
        verdict = "synced (re-rendered)"
    elif not any(lip_has[f0:f1]):
        verdict = "no take audio"
    else:
        L, r = lag(t0 - 0.25, t1 + 0.25)
        if L is None:
            verdict = "take silent here"
        else:
            tag = "OK" if abs(L) <= 0.045 else ("LATE" if L > 0 else "EARLY")
            verdict = f"{tag:5} {L * 1000:+5.0f} ms r={r:.2f}"
    print(f"{t0:6.2f}-{t1:6.2f}  {verdict:>18}  {ln['text'][:60]}")
