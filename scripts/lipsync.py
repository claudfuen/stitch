#!/usr/bin/env python3
"""Measure how far a generated shot's lips are from the locked read: Seedance re-voices the dialogue it was given
and moves the lips to its own audio, so the lag between that audio's speech envelope and the read's, over the same
stretch, is the lag of the lips. Prints the best lag for each segment and the src correction to apply.

    python3 scripts/lipsync.py <read.wav> <segments.json>
        segments: [{"take": gen.mp4, "src": seconds into gen, "r0": film start, "r1": film end, "what": ...}]

A positive lag means the lips come late: start the segment that much later in the gen (src += lag).
"""
import json
import math
import subprocess
import sys

RATE, HOP = 8000, 80  # 10 ms envelope frames


def env(path, t0, dur):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-ss", f"{max(0.0, t0):.3f}", "-t", f"{dur:.3f}", "-i", path, "-vn", "-ac", "1", "-ar", str(RATE), "-f", "s16le", "-"],
                         capture_output=True).stdout
    s = [int.from_bytes(raw[i:i + 2], "little", signed=True) for i in range(0, len(raw) - 1, 2)]
    out = []
    for k in range(0, len(s) - HOP + 1, HOP):
        e = sum(abs(x) for x in s[k:k + HOP]) / HOP
        out.append(math.log1p(e))
    pad = int(round(max(0.0, -t0) * 100))  # the gen starts after t0: leading silence
    return [0.0] * pad + out


def onset(e):
    """Rising edges of the envelope: syllable starts, which is what lips follow."""
    return [max(0.0, e[i] - e[i - 1]) for i in range(1, len(e))]


def corr(a, b, lag):
    n = 0
    sab = saa = sbb = 0.0
    for i in range(len(a)):
        j = i + lag
        if 0 <= j < len(b):
            sab += a[i] * b[j]
            saa += a[i] * a[i]
            sbb += b[j] * b[j]
            n += 1
    return sab / math.sqrt(saa * sbb) if n > 50 and saa > 0 and sbb > 0 else -1.0


def main():
    read, segs = sys.argv[1], json.load(open(sys.argv[2]))
    for s in segs:
        dur = s["r1"] - s["r0"]
        r = onset(env(read, s["r0"], dur))
        g = onset(env(s["take"], s["src"] - 0.8, dur + 1.6))
        # g index 80 corresponds to read index 0 at zero lag
        best = max(range(-80, 81), key=lambda L: corr(r, g, 80 + L))
        c = corr(r, g, 80 + best)
        print(f"{s['r0']:6.2f}-{s['r1']:6.2f}  lag {best / 100:+.2f}s  corr {c:.2f}  {s.get('what', '')[:60]}")


if __name__ == "__main__":
    main()
