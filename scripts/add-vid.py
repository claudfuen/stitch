#!/usr/bin/env python3
"""Download a finished video and attach it to a generation node on the board.

usage: add-vid.py <node-id> <video-url> <job-id> "<title>" "<model>"
The node must already exist (its poster is the keyframe image already on the node).
"""
import json, os, subprocess, sys
nid, url, job, title, model = sys.argv[1:6]
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.makedirs(f"{root}/public/generated", exist_ok=True)
fn = f"{nid}-{job[:6]}.mp4"
subprocess.run(["curl", "-s", "-o", f"{root}/public/generated/{fn}", url], check=True)
p = f"{root}/data/graph.json"
g = json.load(open(p))
for n in g["nodes"]:
    if n["id"] == nid:
        n["data"].update({"video": f"/generated/{fn}", "title": title, "model": model, "status": "done", "job": job})
        break
else:
    sys.exit(f"no node {nid}")
json.dump(g, open(p + ".tmp", "w"), indent=2); os.replace(p + ".tmp", p)
print("attached", fn)
