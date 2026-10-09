#!/usr/bin/env python3
"""Drop re-rendered clips (a lip-sync pass, a paint-out) back into a picture on its frame grid.

    python3 scripts/splice.py <picture.mp4> <out.mp4> <first_frame>:<clip.mp4>[:<source_clip.mp4>] ...

Each clip replaces as many frames as it has, starting at first_frame. With a source clip (the cut the clip was made
from), the picture's frames at that spot are checked against it first (PSNR), so a clip never lands on frames that
moved since it was cut. Picture only; mux the sound after.
"""
import subprocess
import sys


def frames(p):
    return int(subprocess.run(["ffprobe", "-v", "error", "-count_frames", "-select_streams", "v:0", "-show_entries", "stream=nb_read_frames",
                               "-of", "csv=p=0", p], capture_output=True, text=True).stdout.strip())


def psnr(a, fa, b):
    r = subprocess.run(["ffmpeg", "-v", "info", "-i", a, "-i", b, "-filter_complex",
                        f"[0]trim=start_frame={fa}:end_frame={fa + 3},setpts=PTS-STARTPTS[x];[1]trim=end_frame=3,setpts=PTS-STARTPTS[y];[x][y]psnr", "-f", "null", "-"],
                       capture_output=True, text=True).stderr
    for tok in r.split():
        if tok.startswith("average:"):
            v = tok.split(":")[1]
            return 99.0 if v == "inf" else float(v)
    return 0.0


pic, out = sys.argv[1], sys.argv[2]
N = frames(pic)
reps = []
for arg in sys.argv[3:]:
    parts = arg.split(":")
    a, clip = int(parts[0]), parts[1]
    n = frames(clip)
    if len(parts) > 2:
        q = psnr(pic, a, parts[2])
        if q < 30:
            sys.exit(f"{clip}: the picture at frame {a} no longer matches {parts[2]} (PSNR {q:.1f} dB)")
    reps.append((a, a + n, clip))
reps.sort()
for (a0, b0, c0), (a1, _, c1) in zip(reps, reps[1:]):
    if a1 < b0:
        sys.exit(f"{c0} and {c1} overlap")
inputs, parts, k, cur = ["-i", pic], [], 0, 0
for a, b, clip in reps:
    if a > cur:
        parts.append(f"[0:v]trim=start_frame={cur}:end_frame={a},setpts=PTS-STARTPTS[p{k}]")
        k += 1
    inputs += ["-i", clip]
    parts.append(f"[{len(inputs) // 2 - 1}:v]scale=1280:720,setsar=1,fps=24,setpts=PTS-STARTPTS[p{k}]")
    k += 1
    cur = b
if cur < N:
    parts.append(f"[0:v]trim=start_frame={cur},setpts=PTS-STARTPTS[p{k}]")
    k += 1
parts.append("".join(f"[p{i}]" for i in range(k)) + f"concat=n={k}:v=1:a=0[v]")
subprocess.run(["ffmpeg", "-v", "error", "-y", *inputs, "-filter_complex", ";".join(parts), "-map", "[v]", "-c:v", "libx264", "-crf", "16",
                "-preset", "medium", "-pix_fmt", "yuv420p", out], check=True)
print(f"{len(reps)} clips spliced, {frames(out)} frames (was {N}) -> {out}")
