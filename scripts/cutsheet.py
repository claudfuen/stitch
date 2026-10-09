#!/usr/bin/env python3
"""Every cut in a film, frame by frame: the last frames of the outgoing shot and the first of the incoming one, one row
per cut, so cuts can be judged for awkwardness (mid-gesture jumps, repeated action, eyeline and screen-direction
breaks, a glitch frame either side, a graphic that pops on the wrong frame).

    python3 scripts/cutsheet.py <video> <out-dir> [--side 6] [--per-page 8] [--threshold 30]

Cuts are found where a frame differs strongly from the one before it while the frames around agree with their own
neighbours (so a fast pan is not a cut). Each row shows `--side` frames before and after the cut at full frame rate,
the incoming side outlined. Pages are written as <name>.cuts-NN.png, plus <name>.cuts.txt listing every cut time.
"""
import html
import os
import shutil
import subprocess
import sys
import tempfile

args = sys.argv[1:]
opt = {args[i][2:]: args[i + 1] for i in range(len(args)) if args[i].startswith("--")}
video, out = [a for i, a in enumerate(args) if not a.startswith("--") and (i == 0 or not args[i - 1].startswith("--"))][:2]
SIDE, PER, TH = int(opt.get("side", 6)), int(opt.get("per-page", 8)), float(opt.get("threshold", 30))
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
os.makedirs(out, exist_ok=True)
name = os.path.splitext(os.path.basename(video))[0]

fps_s = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=r_frame_rate", "-of", "csv=p=0", video],
                       capture_output=True, text=True).stdout.strip()
fps = float(fps_s.split("/")[0]) / float(fps_s.split("/")[1])
raw = subprocess.run(["ffmpeg", "-v", "error", "-i", video, "-vf", "gblur=sigma=2,scale=64:36,format=gray", "-f", "rawvideo", "-"], capture_output=True).stdout
n = 64 * 36
g = [raw[i:i + n] for i in range(0, len(raw) - n + 1, n)]
d = [0.0] + [sum(abs(a - b) for a, b in zip(g[i], g[i - 1])) / n for i in range(1, len(g))]
cuts = []
for i in range(2, len(g) - 2):
    calm = max(d[i - 1], d[i + 1])
    if d[i] > TH and d[i] > 2.5 * calm and (not cuts or i - cuts[-1] > 3):
        cuts.append(i)
open(os.path.join(out, f"{name}.cuts.txt"), "w").write("".join(f"{c / fps:.3f}\n" for c in cuts))

tmp = tempfile.mkdtemp(prefix="cuts-")
subprocess.run(["ffmpeg", "-v", "error", "-i", video, "-vf", "scale=240:-2", "-q:v", "4", os.path.join(tmp, "f%06d.jpg")], check=True)
for p in range(0, len(cuts), PER):
    rows = []
    for c in cuts[p:p + PER]:
        cells = []
        for k in range(c - SIDE, c + SIDE):
            f = os.path.join(tmp, f"f{k + 1:06d}.jpg")
            if not os.path.exists(f):
                continue
            inc = k >= c
            cells.append(f"<div class='c{' in' if inc else ''}'><img src='file://{f}'><span>{k / fps:.2f}</span></div>")
        rows.append(f"<div class='r'><b>cut {cuts.index(c) + 1}<br>{c / fps:.2f}s</b>{''.join(cells)}</div>")
    page = os.path.join(tmp, f"p{p}.html")
    open(page, "w").write("<html><head><style>body{margin:8px;background:#111;color:#ddd;font:13px Menlo}.r{display:flex;align-items:center;margin:0 0 6px}"
                          "b{width:70px;flex:none}.c{position:relative;margin-right:2px;border:2px solid #111}.c.in{border-color:#e33}.c img{display:block;width:240px}"
                          "span{position:absolute;left:2px;top:2px;background:#000c;padding:0 3px;font-size:11px}</style></head><body>"
                          f"<div style='margin-bottom:6px'>{html.escape(name)}: cuts {p + 1}-{min(p + PER, len(cuts))} of {len(cuts)}, {SIDE} frames each side at {fps:g} fps; red = incoming shot</div>"
                          + "".join(rows) + "</body></html>")
    png = os.path.join(out, f"{name}.cuts-{p // PER:02d}.png")
    prof = tempfile.mkdtemp(prefix="cuts-chrome-")
    h = 40 + len(rows) * 148
    subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars", f"--user-data-dir={prof}", "--force-device-scale-factor=1",
                    f"--window-size={90 + SIDE * 2 * 244},{h}", f"--screenshot={png}", "file://" + page], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=90)
    shutil.rmtree(prof, ignore_errors=True)
    print(png)
shutil.rmtree(tmp, ignore_errors=True)
print(f"{len(cuts)} cuts: " + ", ".join(f"{c / fps:.2f}" for c in cuts))
