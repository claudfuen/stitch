#!/usr/bin/env python3
"""Lay sound effects and crowd on the film's timeline as one stem, from a cue sheet.

    python3 scripts/sfx.py <cues.json> <out.wav> --length 90.45

cues: [{"file": path, "at": film seconds, "from": s, "to": s, "gain": dB, "fade_in": s, "fade_out": s,
        "hp": Hz, "lp": Hz, "loop": true, "what": "..."}]
"from"/"to" pick the part of the file; "loop" repeats it to fill "to" - "from" seconds when the file is shorter.
Every cue is resampled to 48 kHz stereo; the stem is the sum, unnormalized, so gains are absolute.
"""
import json
import subprocess
import sys

args = sys.argv[1:]
cues = json.load(open(args[0]))
out = args[1]
length = float(args[args.index("--length") + 1]) if "--length" in args else 90.0

inputs, chains = [], []
for k, c in enumerate(cues):
    a, b = c.get("from", 0.0), c.get("to")
    if c.get("loop"):
        inputs += ["-stream_loop", "-1"]
    inputs += ["-i", c["file"]]
    f = [f"aresample=48000", "aformat=channel_layouts=stereo"]
    f.append(f"atrim={a}:{b}" if b is not None else f"atrim={a}")
    f.append("asetpts=PTS-STARTPTS")
    if c.get("hp"):
        f.append(f"highpass=f={c['hp']}")
    if c.get("lp"):
        f.append(f"lowpass=f={c['lp']}")
    if c.get("fade_in"):
        f.append(f"afade=t=in:d={c['fade_in']}")
    if c.get("fade_out") and b is not None:
        f.append(f"afade=t=out:st={max(0.0, b - a - c['fade_out']):.3f}:d={c['fade_out']}")
    f.append(f"volume={c.get('gain', 0)}dB")
    f.append(f"adelay={int(round(c['at'] * 1000))}:all=1")
    chains.append(f"[{k}:a]" + ",".join(f) + f"[c{k}]")
mix = "".join(f"[c{k}]" for k in range(len(cues))) + f"amix=inputs={len(cues)}:normalize=0:duration=longest,apad,atrim=0:{length}[o]"
subprocess.run(["ffmpeg", "-v", "error", "-y", *inputs, "-filter_complex", ";".join(chains) + ";" + mix, "-map", "[o]", "-ar", "48000", out], check=True)
print(f"{len(cues)} cues -> {out}")
