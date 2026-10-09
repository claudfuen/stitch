#!/usr/bin/env python3
"""Lip-sync sheets: for every spoken line, the speaker's mouth at every frame with the word being said under it.

    python3 scripts/mouthsheet.py <video> <av-card report.md> <out-dir> [--fps 24] [--lines a-b,c-d] [--speaker x]
        [--words words.json] [--speakers a-b:x,c-d:x]

--words: word timings to use instead of the report's (e.g. ElevenLabs Scribe on the clean dialogue stem; whisper on a
music mix can be off by most of a second); lines are then the words grouped at pauses over 0.35 s.
--speakers: the speaking face per time range, by its centre x (0-1), for two-shots.

Words and times come from the av-card report (whisper on the finished mix). For each line, frames run from 0.2 s before
its first word to its last word, the speaking face is found by Apple Vision (the av-review helper; the largest face, or
the face nearest --speaker x in 0-1 when two people are in frame), and its lower face is cropped and enlarged. Under each
frame: the word sounding at that moment, bold where a word starts. Lips that lead the sound open before their word's
label; lips that lag still move after it. Bilabials (m, b, p) need closed lips at their word's start; "o", "oo" and "w"
need rounded lips. Writes <name>.mouths-NN.png.
"""
import glob
import html
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

args = sys.argv[1:]
opt = {args[i][2:]: args[i + 1] for i in range(len(args)) if args[i].startswith("--")}
video, report, out = [a for i, a in enumerate(args) if not a.startswith("--") and (i == 0 or not args[i - 1].startswith("--"))][:3]
FPS = float(opt.get("fps", 24))
only = [tuple(map(float, r.split("-"))) for r in opt.get("lines", "").split(",") if r]
spk = float(opt["speaker"]) if "speaker" in opt else None
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
helper = sorted(glob.glob(os.path.expanduser("~/.cache/av-review/bin/avvision-*")), key=os.path.getmtime)[-1]
os.makedirs(out, exist_ok=True)
name = os.path.splitext(os.path.basename(video))[0]

rep = open(report).read()
words = [(w, float(a), float(b)) for w, a, b in re.findall(r"(\S+)\[(\d+\.\d+)-(\d+\.\d+) p", rep)]
lines = [(float(a), float(b), t) for a, b, t in re.findall(r'^- ([\d.]+)-([\d.]+)s margin .*?: "(.*)"', rep, re.M)]
if "words" in opt:
    ws = json.load(open(opt["words"]))
    words = [(w["text"], w["start"], w["end"]) for w in ws]
    lines, cur = [], []
    for w in ws:
        if cur and w["start"] - cur[-1]["end"] > 0.35:
            lines.append((cur[0]["start"], cur[-1]["end"], " ".join(x["text"] for x in cur)))
            cur = []
        cur.append(w)
    if cur:
        lines.append((cur[0]["start"], cur[-1]["end"], " ".join(x["text"] for x in cur)))
spk_map = [(float(r.split(":")[0].split("-")[0]), float(r.split(":")[0].split("-")[1]), float(r.split(":")[1])) for r in opt.get("speakers", "").split(",") if r]
if only:
    lines = [ln for ln in lines if any(a <= ln[0] + 0.05 and ln[1] <= b + 0.05 for a, b in only)]

tmp = tempfile.mkdtemp(prefix="mouths-")
rows = []
for t0, t1, text in lines:
    a, b = int((t0 - 0.2) * FPS), int(t1 * FPS) + 1
    d = os.path.join(tmp, f"l{a}")
    os.makedirs(d)
    subprocess.run(["ffmpeg", "-v", "error", "-ss", f"{a / FPS:.4f}", "-i", video, "-frames:v", str(b - a), "-q:v", "2", os.path.join(d, "f%04d.jpg")], check=True)
    frames = sorted(glob.glob(os.path.join(d, "f*.jpg")))
    faces = {}
    for k in range(0, len(frames), 60):
        o = subprocess.run([helper, "faces", *frames[k:k + 60]], capture_output=True, text=True).stdout
        for l in o.splitlines():
            if l.startswith("{"):
                j = json.loads(l)
                faces[j["file"]] = [f for f in j.get("faces", []) if f.get("conf", 0) > 0.5]
    cells, prev = [], None
    for i, f in enumerate(frames):
        fs = faces.get(f, [])
        if fs:
            want = next((x for a0, b0, x in spk_map if a0 <= (a + i) / FPS <= b0), spk)
            if want is not None:
                fc = min(fs, key=lambda z: abs(z["box"][0] + z["box"][2] / 2 - want))
            else:
                fc = max(fs, key=lambda z: z["box"][2])
            prev = fc["box"]
        box = prev
        t = (a + i) / FPS
        cur = [w for w in words if w[1] <= t < max(w[2], w[1] + 1 / FPS)]
        start = [w for w in words if abs(w[1] - t) < 0.5 / FPS]
        label = html.escape(cur[0][0]) if cur else ""
        crop = os.path.join(d, f"c{i:04d}.jpg")
        if box:
            x, y, w, h = box  # Vision: normalised, top-left origin (av-review helper)
            cx, cy = x + w / 2, y + h * 0.78
            vf = f"crop=iw*{w * 0.9:.4f}:ih*{h * 0.62:.4f}:iw*{cx - w * 0.45:.4f}:ih*{max(0, cy - h * 0.31):.4f},scale=150:-2"
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", f, "-vf", vf, crop], check=False)
        if not os.path.exists(crop):
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", f, "-vf", "scale=150:-2", crop], check=False)
        cells.append(f"<div class='c{' s' if start else ''}'><img src='file://{crop}'><i>{t:.2f}</i><b>{label}</b></div>")
    rows.append(f"<div class='r'><div class='h'>{t0:.2f}-{t1:.2f}s: {html.escape(text)}</div><div class='g'>{''.join(cells)}</div></div>")

PER = 4
for p in range(0, len(rows), PER):
    page = os.path.join(tmp, f"p{p}.html")
    open(page, "w").write("<html><head><style>body{margin:8px;background:#111;color:#ddd;font:12px Menlo;width:1880px}.r{margin:0 0 10px}"
                          ".h{font-size:14px;color:#fff;margin:2px 0}.g{display:flex;flex-wrap:wrap}.c{width:150px;margin:0 2px 4px 0;border-top:3px solid #333}"
                          ".c.s{border-top-color:#e33}.c img{display:block;width:150px}i{display:block;color:#999;font-style:normal}b{display:block;color:#ffd84a;height:15px}"
                          "</style></head><body>" + "".join(rows[p:p + PER]) + "</body></html>")
    png = os.path.join(out, f"{name}.mouths-{p // PER:02d}.png")
    prof = tempfile.mkdtemp(prefix="mouths-chrome-")
    subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars", f"--user-data-dir={prof}", "--force-device-scale-factor=1",
                    "--window-size=1900,2600", f"--screenshot={png}", "file://" + page], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=120)
    shutil.rmtree(prof, ignore_errors=True)
    print(png)
shutil.rmtree(tmp, ignore_errors=True)
