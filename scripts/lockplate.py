"""Locked plate: on a locked-off take, the room comes from the keyframe (a photographic still) and only the people come
from the video. Video models keep only 72-81% of a keyframe's fine detail and let a locked-off room drift (chairs,
boards); this puts the still's room back, exact and crisp. Then finish the result with Topaz Starlight Precise 2.6 at
softness 4 (fal topaz/upscale/video/generative, 2x) and bring it back to 1080p with `down`. Measured on 2.4 v4: face
detail 5.8 -> 9.1 (keyframe 7.7), Henrick's ArcFace match unchanged (0.68).

    work/venv/bin/python scripts/lockplate.py plate <take.mp4> <keyframe> <out.mp4> [--grow 20] [--feather 3] [--force]
    work/venv/bin/python scripts/lockplate.py down <starlight-4k.mp4> <take.mp4 (audio)> <out.mp4>

plate, step by step:
  1. Frames of the take and person mattes for every frame and for the keyframe (Apple Vision, scripts/personmattes.swift).
  2. The keyframe aligned to the first frame on the room (ECC affine, people masked out): a take that nudged the framing
     still lines up.
  3. Locked-off check: the room's shift against the first frame, every 6th frame. Above 1.5 px the camera moves and the
     plate would slide; refused unless --force.
  4. Per frame: the union of the frame's and the keyframe's mattes (a head that moved never reveals the keyframe's copy),
     grown and feathered; the keyframe colour-matched to the frame's room (gain and offset per channel); composited.
  5. H.264 at CRF 14 with the take's audio. Prints the alignment, the camera shift and the room's drift before and after.
"""
import argparse, glob, os, shutil, subprocess, sys, tempfile

import cv2
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def sh(*a, **k):
    return subprocess.run(a, check=True, **k)


def mattes_tool():
    exe = os.path.join(ROOT, "work", "bin", "personmattes")
    src = os.path.join(ROOT, "scripts", "personmattes.swift")
    if not os.path.exists(exe) or os.path.getmtime(exe) < os.path.getmtime(src):
        os.makedirs(os.path.dirname(exe), exist_ok=True)
        sh("swiftc", "-O", src, "-o", exe)
    return exe


def soft(mask, grow, feather):
    m = (mask > 127).astype(np.uint8) * 255
    if grow: m = cv2.dilate(m, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * grow + 1, 2 * grow + 1)))
    if feather: m = cv2.GaussianBlur(m, (0, 0), feather)
    return m.astype(np.float32) / 255


def shift(a, b, room):
    """Translation of b against a, measured on the room only (people filled with the room's mean)."""
    ga = cv2.cvtColor(a, cv2.COLOR_BGR2GRAY).astype(np.float32)
    gb = cv2.cvtColor(b, cv2.COLOR_BGR2GRAY).astype(np.float32)
    ga[~room] = ga[room].mean(); gb[~room] = gb[room].mean()
    win = cv2.createHanningWindow(ga.shape[::-1], cv2.CV_32F)
    (dx, dy), _ = cv2.phaseCorrelate(ga, gb, win)
    return float(np.hypot(dx, dy))


def drift(a, b, room):
    d = np.abs(cv2.GaussianBlur(a, (0, 0), 3).astype(np.float32) - cv2.GaussianBlur(b, (0, 0), 3).astype(np.float32)).mean(axis=2)
    return float(d[room].mean())


def plate(a):
    tmp = tempfile.mkdtemp(prefix="lockplate-", dir=os.path.join(ROOT, "work"))
    try:
        fr, ma = os.path.join(tmp, "frames"), os.path.join(tmp, "mattes")
        os.makedirs(fr)
        sh("ffmpeg", "-v", "error", "-i", a.take, os.path.join(fr, "f%04d.png"))
        first = cv2.imread(os.path.join(fr, "f0001.png"))
        H, W = first.shape[:2]
        key = cv2.resize(cv2.imread(a.keyframe), (W, H), interpolation=cv2.INTER_LANCZOS4)
        cv2.imwrite(os.path.join(fr, "key.png"), key)
        sh(mattes_tool(), fr, ma, stdout=subprocess.DEVNULL)
        files = sorted(glob.glob(os.path.join(fr, "f*.png")))
        mk = cv2.imread(os.path.join(ma, "key.png"), cv2.IMREAD_GRAYSCALE)
        m0 = cv2.imread(os.path.join(ma, "f0001.png"), cv2.IMREAD_GRAYSCALE)

        # 2. Align the keyframe to the first frame on the room.
        s = 0.25
        room0 = (soft(np.maximum(mk, m0), 24, 0) < 0.5)
        g = lambda im: cv2.resize(cv2.cvtColor(im, cv2.COLOR_BGR2GRAY), None, fx=s, fy=s).astype(np.float32)
        warp = np.eye(2, 3, dtype=np.float32)
        try:
            _, warp = cv2.findTransformECC(g(first), g(key), warp, cv2.MOTION_AFFINE, (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 200, 1e-6),
                                           cv2.resize(room0.astype(np.uint8) * 255, None, fx=s, fy=s), 5)
        except cv2.error as e:
            print("alignment did not converge; using the keyframe as is:", str(e).splitlines()[-1][:80])
        warp[:, 2] /= s
        key = cv2.warpAffine(key, warp, (W, H), flags=cv2.INTER_LANCZOS4 | cv2.WARP_INVERSE_MAP, borderMode=cv2.BORDER_REFLECT)
        mk = cv2.warpAffine(mk, warp, (W, H), flags=cv2.INTER_LINEAR | cv2.WARP_INVERSE_MAP)
        print(f"keyframe aligned: shift {warp[0, 2]:+.1f},{warp[1, 2]:+.1f} px, scale {np.sqrt(abs(np.linalg.det(warp[:, :2]))):.4f}")
        # Is this the take's room? The aligned keyframe against the first frame, on the room, in 8-bit levels.
        gap = drift(key, first, soft(np.maximum(mk, m0), 24, 0) < 0.5)
        print(f"keyframe against the first frame (room): {gap:.2f} levels")
        if gap > 8 and not a.force:
            print("refused: the take's room differs from the keyframe (above 8 levels); it did not start on this still. --force to override.")
            sys.exit(4)

        # 3. Locked off?
        shifts = []
        for f in files[::6]:
            im = cv2.imread(f)
            m = cv2.imread(os.path.join(ma, os.path.basename(f)), cv2.IMREAD_GRAYSCALE)
            shifts.append(shift(first, im, soft(np.maximum(m, m0), 24, 0) < 0.5))
        print(f"camera: the room moves up to {max(shifts):.2f} px against the first frame")
        if max(shifts) > 1.5 and not a.force:
            print("refused: the camera is not locked off (above 1.5 px); a still room would slide against it. --force to override.")
            sys.exit(3)

        # 4-5. Composite and encode.
        enc = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{W}x{H}", "-r", a.fps, "-i", "-", "-i", a.take,
                                "-map", "0:v", "-map", "1:a?", "-c:v", "libx264", "-preset", "slow", "-crf", "14", "-pix_fmt", "yuv420p", "-c:a", "copy", "-shortest", a.out], stdin=subprocess.PIPE)
        mkf = soft(mk, a.grow, a.feather)
        last = first_c = None
        for f in files:
            F = cv2.imread(f)
            U = np.maximum(soft(cv2.imread(os.path.join(ma, os.path.basename(f)), cv2.IMREAD_GRAYSCALE), a.grow, a.feather), mkf)[..., None]
            bg = (U[::4, ::4, 0] < 0.02)
            K = np.empty_like(key, dtype=np.float32)
            for c in range(3):
                gain, off = np.polyfit(key[::4, ::4, c][bg].astype(np.float32), F[::4, ::4, c][bg].astype(np.float32), 1)
                K[..., c] = key[..., c] * gain + off
            C = np.clip(U * F + (1 - U) * K, 0, 255).astype(np.uint8)
            enc.stdin.write(C.tobytes())
            first_c = C if first_c is None else first_c
            last = (F, C, U[..., 0] < 0.02)
        enc.stdin.close(); enc.wait()
        F, C, room = last
        print(f"room drift, first to last frame: take {drift(first, F, room):.2f}, locked {drift(first_c, C, room):.2f}")
        print(f"wrote {a.out} ({len(files)} frames)")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def down(a):
    sh("ffmpeg", "-v", "error", "-y", "-i", a.src, "-i", a.audio, "-map", "0:v", "-map", "1:a?", "-vf", "scale=1920:1080:flags=lanczos",
       "-c:v", "libx264", "-preset", "slow", "-crf", "14", "-pix_fmt", "yuv420p", "-c:a", "copy", "-shortest", a.out)
    print(f"wrote {a.out}")


ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
sub = ap.add_subparsers(dest="cmd", required=True)
p1 = sub.add_parser("plate"); p1.add_argument("take"); p1.add_argument("keyframe"); p1.add_argument("out")
p1.add_argument("--grow", type=int, default=20); p1.add_argument("--feather", type=float, default=3); p1.add_argument("--fps", default="24"); p1.add_argument("--force", action="store_true")
p2 = sub.add_parser("down"); p2.add_argument("src"); p2.add_argument("audio"); p2.add_argument("out")
a = ap.parse_args()
plate(a) if a.cmd == "plate" else down(a)
