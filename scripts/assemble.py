#!/usr/bin/env python3
"""Assemble the cut: scene clips in order, motion-graphics overlays composited at scene-relative times,
then the end card appended. Reads clip paths from data/graph.json (v1..v7 nodes).

usage: assemble.py [out-name]      -> public/generated/<out-name>.mp4  (default rough-cut-v2)
"""
import json, os, subprocess, sys
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
out_name = sys.argv[1] if len(sys.argv) > 1 else "rough-cut-v2"
g = json.load(open(f"{root}/data/graph.json"))
clip = {n["id"]: n["data"].get("video") for n in g["nodes"]}
scenes = []
for i in range(1, 8):
    v = clip.get(f"v{i}")
    if not v: sys.exit(f"scene {i} has no video yet")
    scenes.append(f"{root}/public{v}")
dur = [float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", s]).decode()) for s in scenes]
starts = [sum(dur[:i]) for i in range(7)]
# (composition, scene number, offset inside scene, seconds)
OVERLAYS = [("MinistrySign", 2, 0.3, 2.0), ("TicketDisplay", 2, 0.8, 4.0), ("FormStamp", 3, 0.0, 5.0),
            ("CalendarFlip", 4, 0.5, 4.0), ("DashboardScore", 5, 0.0, 5.0), ("Captions", 6, 0.2, 4.8)]
inputs, filt, last = [], [], "base"
for s in scenes: inputs += ["-i", s]
concat = "".join(f"[{i}:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,fps=24,setsar=1,format=yuv420p[s{i}];" for i in range(7))
concat += "".join(f"[s{i}]" for i in range(7)) + "concat=n=7:v=1:a=0[base];"
filt.append(concat)
k = 7
for n, (comp, sc, off, secs) in enumerate(OVERLAYS):
    t0 = starts[sc - 1] + off
    secs = min(secs, dur[sc - 1] - off)  # never bleed into the next scene
    inputs += ["-i", f"{root}/motion/out/{comp}.mov"]
    filt.append(f"[{k}:v]format=yuva420p,setpts=PTS-STARTPTS+{t0}/TB[o{n}];[{last}][o{n}]overlay=eof_action=pass:enable='between(t,{t0},{t0 + secs})'[v{n}];")
    last = f"v{n}"; k += 1
inputs += ["-i", f"{root}/motion/out/EndCard.mov"]
filt.append(f"[{k}:v]format=yuv420p,fps=24,setsar=1[end];[{last}][end]concat=n=2:v=1:a=0[outv]")
out = f"{root}/public/generated/{out_name}.mp4"
cmd = ["ffmpeg", "-v", "error", "-y", *inputs, "-filter_complex", "".join(filt), "-map", "[outv]", "-c:v", "libx264", "-crf", "20", "-preset", "medium", "-pix_fmt", "yuv420p", out]
subprocess.run(cmd, check=True)
print(out, round(sum(dur) + 3, 2), "s")
