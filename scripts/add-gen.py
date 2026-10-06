#!/usr/bin/env python3
"""Download a finished generation and place it on the canvas.

usage: add-gen.py <node-id> <url> <job-id> "<title>" "<model>" x y [src-node ...]
Creates or updates the generation node in data/graph.json (the viewer polls it).
"""
import json, os, subprocess, sys
nid, url, job, title, model, x, y, *srcs = sys.argv[1:]
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.makedirs(f"{root}/public/generated", exist_ok=True)
ext = url.split("?")[0].rsplit(".", 1)[-1]
fn = f"{nid}-{job[:6]}.{ext}"
subprocess.run(["curl", "-s", "-o", f"{root}/public/generated/{fn}", url], check=True)
if ext == "png":  # keep the repo small: high-quality JPG, max 2560 wide
    jp = fn[:-3] + "jpg"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", f"{root}/public/generated/{fn}", "-vf", "scale='min(2560,iw)':-2", "-q:v", "3", f"{root}/public/generated/{jp}"], check=True)
    os.remove(f"{root}/public/generated/{fn}")
    fn = jp
p = f"{root}/data/graph.json"
g = json.load(open(p))
g["nodes"] = [n for n in g["nodes"] if n["id"] != nid]
g["nodes"].append({"id": nid, "type": "generation", "position": {"x": float(x), "y": float(y)},
  "data": {"title": title, "kind": "image", "model": model, "status": "done", "hue": 0, "url": f"/generated/{fn}", "job": job}})
have = {e["id"] for e in g["edges"]}
for s in srcs:
    eid = f"{s}-{nid}"
    if eid not in have: g["edges"].append({"id": eid, "source": s, "target": nid})
json.dump(g, open(p + ".tmp", "w"), indent=2); os.replace(p + ".tmp", p)
print("placed", nid, fn)
