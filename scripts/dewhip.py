#!/usr/bin/env python3
"""Turn the whip pans left in a cut into hard cuts, keeping the picture in sync with the sound.

    python3 scripts/dewhip.py <in.mp4> <out.mp4> [--keep a-b,c-d] [--window 16] [--threshold 12] [--speech read.wav]

The blockouts whip between camera setups so a take can be sliced there: a 1994 multi-camera studio cuts between
cameras, it never whips. The video model also renders the whip frames as smears with melted faces. A whip frame
differs strongly from BOTH of its neighbours (a clean frame at a hard cut differs from only one), so every run of
such frames is found, dropped and replaced: the half before the cut point extends the outgoing shot and the half after
it extends the incoming one, each by slowing its last (first) `--window` frames slightly (frames repeated evenly), so
the total length and every later frame stay exactly where they were. With `--speech`, the stretch goes to the side
of the cut where nobody is talking, so a speaking face keeps its exact timing (lips stay on the words). Camera flashes (a frame much brighter than both
neighbours) and `--keep` ranges (seconds) are left alone. Writes picture only; mux the sound after.
"""
import os
import subprocess
import sys
import tempfile

args = sys.argv[1:]
opt = {args[i][2:]: args[i + 1] for i in range(len(args)) if args[i].startswith("--")}
src, dst = [a for i, a in enumerate(args) if not a.startswith("--") and (i == 0 or not args[i - 1].startswith("--"))][:2]
W = int(opt.get("window", 16))
TH = float(opt.get("threshold", 12))
keep = [tuple(map(float, r.split("-"))) for r in opt.get("keep", "").split(",") if r]
speech = None
if opt.get("speech"):
    pcm = subprocess.run(["ffmpeg", "-v", "error", "-i", opt["speech"], "-ac", "1", "-ar", "8000", "-f", "s16le", "-"], capture_output=True).stdout
    smp = [int.from_bytes(pcm[i:i + 2], "little", signed=True) for i in range(0, len(pcm) - 1, 2)]
    rms = [(sum(x * x for x in smp[k:k + 80]) / 80) ** 0.5 for k in range(0, len(smp) - 79, 80)]  # 10 ms
    speech = [r > 600 for r in rms]


def talking(t0, t1):
    """Share of 10 ms frames with speech between t0 and t1 (seconds)."""
    if not speech:
        return 0.5
    a, b = max(0, int(t0 * 100)), min(len(speech), int(t1 * 100))
    return sum(speech[a:b]) / max(1, b - a)

fps_s = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=r_frame_rate", "-of", "csv=p=0", src], capture_output=True, text=True).stdout.strip()
num, den = fps_s.split("/")
fps = float(num) / float(den)
raw = subprocess.run(["ffmpeg", "-v", "error", "-i", src, "-vf", "scale=96:54,format=gray", "-f", "rawvideo", "-"], capture_output=True).stdout
n = 96 * 54
g = [raw[i:i + n] for i in range(0, len(raw) - n + 1, n)]
N = len(g)
luma = [sum(f) / n for f in g]
ch = [0.0] + [sum(abs(a - b) for a, b in zip(g[i], g[i - 1])) / n for i in range(1, N)]
nxt = ch[1:] + [0.0]


def kept(i):
    t = i / fps
    return any(a <= t <= b for a, b in keep)


bad = [False] * N
for i in range(1, N - 1):
    flash = luma[i] > luma[i - 1] + 25 and luma[i] > luma[i + 1] + 25
    bad[i] = min(ch[i], nxt[i]) > TH and not flash and not kept(i)
runs, i = [], 0
while i < N:
    if bad[i]:
        j = i
        while j + 1 < N and bad[j + 1]:
            j += 1
        runs.append((i, j))
        i = j + 1
    else:
        i += 1
# A whip eases in and out: grow each run over the softer blurred frames at its ends (up to 4 a side) until the
# picture is still, so neither shot keeps a smeared frame.
grown = []
for a, b in runs:
    lo = grown[-1][1] + 2 if grown else 1
    k = 0
    while a - 1 >= lo and k < 4 and ch[a - 1] > TH * 0.4 and not kept(a - 1):
        a, k = a - 1, k + 1
    k = 0
    while b + 2 < N and k < 4 and nxt[b + 1] > TH * 0.4 and not kept(b + 1):
        b, k = b + 1, k + 1
    grown.append((a, b))
runs = grown

m = list(range(N))  # output frame -> source frame
prev_end = 0
for k, (a, b) in enumerate(runs):
    p, q = a - 1, b + 1  # last clean outgoing, first clean incoming
    gap = b - a + 1
    before, after = talking((a - W) / fps, a / fps), talking((b + 1) / fps, (b + 1 + W) / fps)
    if speech and before > after + 0.15:
        h1 = 0  # someone is talking in the outgoing shot: the incoming one absorbs the gap
    elif speech and after > before + 0.15:
        h1 = gap  # talking in the incoming shot: the outgoing one absorbs it
    else:
        h1 = gap // 2
    h2 = gap - h1
    nxt_start = runs[k + 1][0] if k + 1 < len(runs) else N
    w1 = max(1, min(W, p - prev_end + 1))
    w2 = max(1, min(W, nxt_start - q))
    # outgoing: source frames p-w1+1..p spread over output frames p-w1+1..p+h1
    if h1:
        for o in range(w1 + h1):
            m[p - w1 + 1 + o] = p - w1 + 1 + min(w1 - 1, int(o * w1 / (w1 + h1)))
    # incoming: source frames q..q+w2-1 spread over output frames q-h2..q+w2-1
    if h2:
        for o in range(w2 + h2):
            m[q - h2 + o] = q + min(w2 - 1, int(o * w2 / (w2 + h2)))
    prev_end = q + w2
    print(f"whip {a / fps:6.2f}-{b / fps:6.2f}s ({gap} frames) -> cut at {(a + h1) / fps:6.2f}s (stretch: out {h1}, in {h2})")

tmp = tempfile.mkdtemp(prefix="dewhip-")
subprocess.run(["ffmpeg", "-v", "error", "-i", src, "-q:v", "1", os.path.join(tmp, "s%06d.jpg")], check=True)
out = os.path.join(tmp, "o")
os.makedirs(out)
for o, s in enumerate(m):
    os.symlink(os.path.join(tmp, f"s{s + 1:06d}.jpg"), os.path.join(out, f"o{o + 1:06d}.jpg"))
subprocess.run(["ffmpeg", "-v", "error", "-y", "-framerate", fps_s, "-i", os.path.join(out, "o%06d.jpg"), "-c:v", "libx264", "-crf", "17", "-preset", "medium",
                "-pix_fmt", "yuv420p", dst], check=True)
subprocess.run(["rm", "-rf", tmp])
print(f"{len(runs)} whips cut, {N} frames -> {dst}")
