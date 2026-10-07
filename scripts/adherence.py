#!/usr/bin/env python3
"""Check stage 03 frames against their grey-box layouts.

For every camera that has a layout (its grey-box render) and a frame, writes one row: the layout, the frame, and the
two blended 50/50, so a moved desk, a flipped direction, a person at the wrong size or a crowd where the angle cannot
see one shows at a glance. Look at every row before a frame is accepted.

    python3 scripts/adherence.py <film> [room ...]      ->  work/<film>/space/adherence.jpg
"""
import json
import os
import subprocess
import sys

film, rooms = sys.argv[1], set(sys.argv[2:])
p = json.load(open(f"data/projects/{film}.json"))["process"]["space"]
rows = [(r["id"], c) for r in p["rooms"] for c in r["cameras"] if c.get("layout") and c.get("frame") and (not rooms or r["id"] in rooms)]
if not rows:
    sys.exit("no camera has both a layout and a frame")
args, filt = [], ""
for i, (_, c) in enumerate(rows):
    args += ["-i", "public/" + c["layout"], "-i", "public/" + c["frame"]["file"]]
    a, b = 2 * i, 2 * i + 1
    filt += (f"[{a}:v]scale=640:360,format=gbrp,split[l{i}][m{i}];[{b}:v]scale=640:360,format=gbrp,split[f{i}][n{i}];"
             f"[n{i}][m{i}]blend=all_mode=normal:all_opacity=0.5[o{i}];[l{i}][f{i}][o{i}]hstack=3[r{i}];")
filt += "".join(f"[r{i}]" for i in range(len(rows))) + f"vstack={len(rows)}" if len(rows) > 1 else "[r0]copy"
out = f"work/{film}/space/adherence.jpg"
os.makedirs(os.path.dirname(out), exist_ok=True)
subprocess.run(["ffmpeg", "-v", "error", "-y", *args, "-filter_complex", filt, "-frames:v", "1", out], check=True)
print(out, "rows:", ", ".join(f"{r}/{c['id']}" for r, c in rows))
