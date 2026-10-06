"""Put a rendered screen onto the screen in a still: find the bright screen quad, corner-pin the screen video into it
frame by frame, and add a slow push-in so the insert breathes.

    work/venv/bin/python scripts/screenpin.py <still> <screen.mov> <out.mp4> [--dur 3.5] [--push 1.04] [--glow 0.9]

The still's screen should be a plain bright page (a keyframe brief can ask for that), which makes the quad easy to find
and keeps the composite honest: the product UI is on the laptop, not floating in the frame.
"""
import argparse
import subprocess

import cv2
import numpy as np

p = argparse.ArgumentParser()
p.add_argument("still")
p.add_argument("screen")
p.add_argument("out")
p.add_argument("--dur", type=float, default=3.5)
p.add_argument("--zoom0", type=float, default=1.0, help="punch-in at the first frame")
p.add_argument("--push", type=float, default=1.04, help="punch-in at the last frame")
p.add_argument("--anchor", type=float, default=0.45, help="vertical position of the punch-in (0 top, 1 bottom)")
p.add_argument("--glow", type=float, default=0.9, help="screen brightness relative to the render")
a = p.parse_args()

W, H, FPS = 1920, 1080, 24
bg = cv2.resize(cv2.imread(a.still), (W, H), interpolation=cv2.INTER_AREA)

# 1. The screen quad: the largest bright, four-cornered region.
gray = cv2.cvtColor(bg, cv2.COLOR_BGR2GRAY)
mask = cv2.morphologyEx((gray > 225).astype(np.uint8) * 255, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))
mask = cv2.dilate(mask, np.ones((7, 7), np.uint8))  # cover the bright edge pixels the threshold misses
contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
c = max(contours, key=cv2.contourArea)
# Corner extremes of the whole outline (not a polygon fit, which cuts rounded corners and leaves white slivers).
pts = c.reshape(-1, 2).astype(np.float32)
s = pts.sum(1)
d = np.diff(pts, axis=1).ravel()  # y - x
quad = np.float32([pts[np.argmin(s)], pts[np.argmin(d)], pts[np.argmax(s)], pts[np.argmax(d)]])  # TL TR BR BL
print("screen quad", quad.round(1).tolist())

# 2. Decode the screen render and composite each frame.
probe = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", a.screen], capture_output=True, text=True).stdout.strip().split(",")
sw, sh = int(probe[0]), int(probe[1])
dec = subprocess.Popen(["ffmpeg", "-v", "error", "-i", a.screen, "-f", "rawvideo", "-pix_fmt", "bgr24", "-"], stdout=subprocess.PIPE)
n = int(a.dur * FPS)
enc = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
                        "-vf", "noise=c0s=5:c0f=t+u", "-c:v", "libx264", "-crf", "16", "-pix_fmt", "yuv420p", a.out], stdin=subprocess.PIPE)
M = cv2.getPerspectiveTransform(np.float32([[0, 0], [sw, 0], [sw, sh], [0, sh]]), quad)
inner = cv2.erode(cv2.fillConvexPoly(np.zeros((H, W), np.uint8), quad.astype(np.int32), 255), np.ones((3, 3), np.uint8))
alpha = (cv2.GaussianBlur(inner, (0, 0), 1.2).astype(np.float32) / 255)[..., None]
last = None
for i in range(n):
    raw = dec.stdout.read(sw * sh * 3)
    if len(raw) == sw * sh * 3:
        last = np.frombuffer(raw, np.uint8).reshape(sh, sw, 3)
    scr = cv2.warpPerspective(last, M, (W, H), flags=cv2.INTER_AREA).astype(np.float32) * a.glow
    frame = bg.astype(np.float32) * (1 - alpha) + scr * alpha
    k = a.zoom0 + (a.push - a.zoom0) * i / max(1, n - 1)
    if k > 1.0001:
        cw, ch = int(W / k), int(H / k)
        x0, y0 = (W - cw) // 2, int((H - ch) * a.anchor)
        frame = cv2.resize(frame[y0:y0 + ch, x0:x0 + cw], (W, H), interpolation=cv2.INTER_CUBIC)
    enc.stdin.write(np.clip(frame, 0, 255).astype(np.uint8).tobytes())
enc.stdin.close()
enc.wait()
dec.kill()
print("wrote", a.out, f"{n} frames")
