#!/usr/bin/env python3
"""Lay sound effects and crowd on the film's timeline as one stem, from a cue sheet.

    python3 scripts/sfx.py <cues.json> <out.wav> --length 90.45

cues: [{"file": path, "at": film seconds, "from": s, "to": s, "gain": dB, "fade_in": s, "fade_out": s,
        "hp": Hz, "lp": Hz, "loop": true, "what": "..."}]
"from"/"to" pick the part of the file; "loop" repeats it to fill "to" - "from" seconds when the file is shorter.
Every cue is resampled to 48 kHz stereo; the stem is the sum, unnormalized, so gains are absolute.

Each cue is rendered on its own (a single -af chain, which trims exactly) and summed here at its sample offset.
One big amix graph is not used: in ffmpeg 8.1 a many-input graph with atrim + adelay + apad cut cues short and
ended the stem early (an end-card applause cue vanished).
"""
import json
import subprocess
import sys
from array import array

SR = 48000
args = sys.argv[1:]
cues = json.load(open(args[0]))
out = args[1]
length = float(args[args.index("--length") + 1]) if "--length" in args else 90.0

buf = array("f", bytes(4 * 2 * int(round(length * SR))))
for c in cues:
    a, b = c.get("from", 0.0), c.get("to")
    f = [f"aresample={SR}", "aformat=channel_layouts=stereo"]
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
    loop = ["-stream_loop", "-1"] if c.get("loop") else []
    pcm = subprocess.run(["ffmpeg", "-v", "error", *loop, "-i", c["file"], "-af", ",".join(f), "-f", "f32le", "-ac", "2", "-ar", str(SR), "-"],
                         capture_output=True, check=True).stdout
    cue = array("f")
    cue.frombytes(pcm[: len(pcm) // 8 * 8])
    o = 2 * int(round(c["at"] * SR))
    n = max(0, min(len(cue), len(buf) - o))
    for i in range(n):
        buf[o + i] += cue[i]
    want = None if b is None else b - a
    if want is not None and abs(len(cue) / 2 / SR - want) > 0.05:
        print(f"  note: {c.get('what', c['file'])} rendered {len(cue) / 2 / SR:.2f} s of {want:.2f} s (file shorter)")
subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "f32le", "-ac", "2", "-ar", str(SR), "-i", "-", "-c:a", "pcm_s24le", out], input=buf.tobytes(), check=True)
print(f"{len(cues)} cues -> {out} ({len(buf) / 2 / SR:.2f} s)")
