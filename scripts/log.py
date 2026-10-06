#!/usr/bin/env python3
"""Append a line to the board's live activity feed and optionally set node statuses.

usage: log.py "text" [--kind run|done|info|warn] [--running id,id] [--done id,id] [--idle id,id]
"""
import argparse, datetime, json, os
ap = argparse.ArgumentParser()
ap.add_argument("text"); ap.add_argument("--kind", default="info")
ap.add_argument("--running", default=""); ap.add_argument("--done", default=""); ap.add_argument("--idle", default="")
a = ap.parse_args()
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
p = f"{root}/data/graph.json"
g = json.load(open(p))
g.setdefault("activity", []).append({"t": datetime.datetime.now(datetime.timezone.utc).isoformat(), "text": a.text, "kind": a.kind})
g["activity"] = g["activity"][-60:]
for status in ("running", "done", "idle"):
    ids = [x for x in getattr(a, status).split(",") if x]
    for n in g["nodes"]:
        if n["id"] in ids: n["data"]["status"] = status
tmp = p + ".tmp"
json.dump(g, open(tmp, "w"), indent=2)
os.replace(tmp, p)
