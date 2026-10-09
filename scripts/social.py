#!/usr/bin/env python3
"""Social cuts of a finished 16:9 master: 9:16 and 1:1, the whole frame kept (no graphic or two-shot is cropped),
over a blurred, darkened fill of the same picture, with a title header above and burned-in captions below.

    uv run --with pillow scripts/social.py <master.mp4> <chunks.json> <header.png> <out-base> [--formats 916,11]

chunks.json comes from scripts/captions.py. Captions are drawn with Pillow (this ffmpeg has no drawtext or libass)
as one PNG per chunk, laid on the timeline with the concat demuxer, so the whole caption track is one input.
Writes <out-base>-9x16.mp4 and/or <out-base>-1x1.mp4 (1080 wide, 24 fps, the master's audio).
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile

from PIL import Image, ImageDraw, ImageFont

args = sys.argv[1:]
opt = {args[i][2:]: args[i + 1] for i in range(len(args)) if args[i].startswith("--")}
master, chunks_p, header, base = [a for i, a in enumerate(args) if not a.startswith("--") and (i == 0 or not args[i - 1].startswith("--"))][:4]
formats = opt.get("formats", "916,11").split(",")
FONT = "/System/Library/Fonts/Supplemental/Arial Black.ttf"
dur = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", master], capture_output=True, text=True).stdout)
chunks = json.load(open(chunks_p))

LAYOUT = {  # canvas, frame top, caption box (top, height, text x range), header box (top, height), caption size, URL line
    # 9:16 keeps text out of the Reels/TikTok/Shorts UI: top ~150 px, bottom ~350 px, right ~120 px
    "916": dict(W=1080, H=1920, fy=500, cy=1140, ch=300, x0=90, x1=930, hy=130, hh=330, size=76, url=1452),
    "11": dict(W=1080, H=1080, fy=158, cy=778, ch=290, x0=60, x1=1020, hy=4, hh=150, size=64, url=None),
}
URL = "trycomp.ai"


def caption_png(text, path, W, h, size, x0=0, x1=None):
    x1 = x1 or W
    img = Image.new("RGBA", (W, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    font = ImageFont.truetype(FONT, size)
    words = text.split()
    width = lambda ws: d.textlength(" ".join(ws), font=font)
    if width(words) <= x1 - x0:
        lines = [" ".join(words)]
    else:  # two balanced lines: the split that keeps the longer line shortest, preferring a break after punctuation
        best = None
        for i in range(1, len(words)):
            a, b = words[:i], words[i:]
            score = max(width(a), width(b)) - (60 if a[-1][-1] in ",.?!" else 0)
            if best is None or score < best[0]:
                best = (score, [" ".join(a), " ".join(b)])
        lines = best[1]
    lh = int(size * 1.18)
    y = (h - lh * len(lines)) // 2
    for ln in lines:
        x = x0 + (x1 - x0 - d.textlength(ln, font=font)) // 2
        d.text((x + 5, y + 6), ln, font=font, fill=(0, 0, 0, 200))  # drop shadow, 1994 character-generator style
        d.text((x, y), ln, font=font, fill=(255, 255, 255, 255), stroke_width=7, stroke_fill=(0, 0, 0, 255))
        y += lh
    img.save(path)


headers = dict(zip(formats, header.split(","))) if "," in header else {f: header for f in formats}
for f in formats:
    L = LAYOUT[f]
    hdr = headers[f]
    W, H = L["W"], L["H"]
    tmp = tempfile.mkdtemp(prefix=f"social-{f}-")
    blank = os.path.join(tmp, "blank.png")
    Image.new("RGBA", (W, L["ch"]), (0, 0, 0, 0)).save(blank)
    lst, t = [], 0.0
    for k, c in enumerate(chunks):
        if c["start"] > t:
            lst += [f"file '{blank}'", f"duration {c['start'] - t:.3f}"]
        p = os.path.join(tmp, f"c{k:03d}.png")
        caption_png(c["text"], p, W, L["ch"], L["size"], L["x0"], L["x1"])
        lst += [f"file '{p}'", f"duration {c['end'] - c['start']:.3f}"]
        t = c["end"]
    lst += [f"file '{blank}'", f"duration {max(0.1, dur - t):.3f}", f"file '{blank}'"]
    open(os.path.join(tmp, "caps.txt"), "w").write("\n".join(lst) + "\n")
    urlpng = os.path.join(tmp, "url.png")
    img = Image.new("RGBA", (W, 70), (0, 0, 0, 0))
    if L["url"]:
        d = ImageDraw.Draw(img)
        font = ImageFont.truetype(FONT, 46)
        x = L["x0"] + (L["x1"] - L["x0"] - d.textlength(URL, font=font)) // 2
        d.text((x + 3, 6), URL, font=font, fill=(0, 0, 0, 200))
        d.text((x, 3), URL, font=font, fill=(255, 230, 128, 255), stroke_width=5, stroke_fill=(0, 0, 0, 255))
    img.save(urlpng)
    fh = round(W * 9 / 16 / 2) * 2
    graph = (f"[0:v]split=2[a][b];"
             f"[a]scale=-2:{H},crop={W}:{H},boxblur=28:2,eq=brightness=-0.22:saturation=0.8[bg];"
             f"[b]scale={W}:{fh}[fg];"
             f"[bg][fg]overlay=0:{L['fy']}[v1];"
             f"[1:v]scale={W}:{L['hh']}:force_original_aspect_ratio=decrease,pad={W}:{L['hh']}:(ow-iw)/2:(oh-ih)/2:color=0x00000000[hd];"
             f"[v1][hd]overlay=0:{L['hy']}[v2];"
             f"[2:v]format=rgba,fps=24[cap];[v2][cap]overlay=0:{L['cy']}:eof_action=pass[v3];"
             f"[v3][3:v]overlay=0:{L['url'] or 0}:shortest=0,format=yuv420p[v]")
    out = f"{base}-{'9x16' if f == '916' else '1x1'}.mp4"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", master, "-loop", "1", "-i", hdr, "-f", "concat", "-safe", "0", "-i", os.path.join(tmp, "caps.txt"), "-loop", "1", "-i", urlpng,
                    "-filter_complex", graph, "-map", "[v]", "-map", "0:a", "-t", f"{dur:.3f}", "-r", "24", "-c:v", "libx264", "-crf", "19", "-preset", "medium",
                    "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", out], check=True)
    shutil.rmtree(tmp, ignore_errors=True)
    print(out)
