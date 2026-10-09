#!/usr/bin/env python3
"""Finish a cut: lay the on-screen graphics on the picture, mix dialogue + score + effects, and write a clean master
and a VHS master (1994 broadcast taped off the air: soft luma, smeared and shifted chroma, sharpening halos, tape
noise, lifted blacks, a head-switching band at the bottom, a little tape wobble; band-limited sound with hiss).

    python3 scripts/finish.py <finish.json>

finish.json: {"picture": mp4, "dialogue": wav, "score": wav, "sfx": wav, "length": s, "out": "dir/name",
              "graphics": [{"png": path, "from": s, "to": s, "in": "cut" | "slide" | "pop"}],
              "score_gain": dB, "sfx_gain": dB}
Writes <out>-clean.mp4 and <out>-vhs.mp4.
"""
import json
import subprocess
import sys

cfg = json.load(open(sys.argv[1]))
L = cfg["length"]
gfx = cfg.get("graphics", [])

inputs = ["-i", cfg["picture"]]
for g in gfx:
    inputs += ["-loop", "1", "-framerate", "24", "-t", f"{g['to'] - g['from'] + 0.1:.3f}", "-i", g["png"]]
inputs += ["-i", cfg["dialogue"], "-i", cfg["score"], "-i", cfg["sfx"]]
na = 1 + len(gfx)

f, cur = [], "[0:v]"
for k, g in enumerate(gfx, 1):
    a, b = g["from"], g["to"]
    src = f"[{k}:v]format=rgba"
    if g.get("in") == "pop":  # quick zoom in with an overshoot, anchored at the top right
        s = "if(lt(t,0.08),0.55+t/0.08*0.67,if(lt(t,0.16),1.22-(t-0.08)/0.08*0.22,1))"
        src += f",scale=w='trunc(1280*{s}/2)*2':h='trunc(720*{s}/2)*2':eval=frame"
        x, y = "W-w", "0"
    elif g.get("in") == "slide":  # push on from the left in 0.22 s, like a 1994 character generator
        x, y = f"-w*(1-min(1\\,max(0\\,(t-{a})/0.22)))", "0"
    else:
        x, y = "0", "0"
    f.append(f"{src},setpts=PTS+{a}/TB[g{k}]")
    f.append(f"{cur}[g{k}]overlay=x='{x}':y='{y}':eof_action=pass:enable='between(t,{a},{b})'[v{k}]")
    cur = f"[v{k}]"
f.append(f"{cur}format=yuv420p,split=2[clean][vin]")

# VHS: luma down to ~270 lines and back (soft), chroma smeared and shifted right, sharpening halos, tape noise,
# lifted blacks and warm saturation, a slow sub-pixel wobble, and the head-switching band at the bottom.
vhs = ("[vin]scale=480:270:flags=area,scale=1280:720:flags=bicubic,"
       "format=yuv444p,boxblur=luma_radius=0:luma_power=0:chroma_radius=7:chroma_power=2,chromashift=cbh=5:crh=4,"
       "unsharp=7:7:1.1:3:3:0,eq=contrast=0.93:brightness=0.02:saturation=1.18,curves=all='0/0.055 0.5/0.52 1/0.94',"
       "noise=c0s=9:c0f=t+u:c1s=6:c1f=t:c2s=6:c2f=t,"
       "crop=1272:714:'4+1.6*sin(t*2.1)+0.8*sin(t*9.7)':3,scale=1280:720,vignette=PI/5,format=yuv420p,split=2[vb][vh];"
       "[vh]crop=1280:9:0:711,noise=alls=70:allf=t,eq=brightness=-0.05[hs];[vb][hs]overlay=x=9:y=711[vhs]")
f.append(vhs)

d, s, x = na, na + 1, na + 2
sg, xg = cfg.get("score_gain", -9), cfg.get("sfx_gain", 0)
f.append(f"[{d}:a]aresample=48000,aformat=channel_layouts=stereo,apad,atrim=0:{L},asplit=3[dlg][sc1][sc2]")
f.append(f"[{s}:a]aresample=48000,aformat=channel_layouts=stereo,volume={sg}dB,apad,atrim=0:{L}[mus]")
f.append(f"[{x}:a]aresample=48000,aformat=channel_layouts=stereo,volume={xg}dB,apad,atrim=0:{L}[fx]")
f.append("[mus][sc1]sidechaincompress=threshold=0.015:ratio=12:attack=10:release=350:makeup=1[mduck]")
f.append("[fx][sc2]sidechaincompress=threshold=0.02:ratio=3:attack=15:release=300:makeup=1[fduck]")
f.append("[dlg][mduck][fduck]amix=inputs=3:normalize=0:duration=longest,atrim=0:" + f"{L}" + ",asplit=2[mixa][mixb]")
f.append("[mixa]loudnorm=I=-14:TP=-1.5:LRA=11[aclean]")
f.append("[mixb]highpass=f=70,lowpass=f=11500,acompressor=threshold=0.25:ratio=2.5:attack=8:release=120,"
         "vibrato=f=0.5:d=0.0012,loudnorm=I=-14:TP=-1.5:LRA=9[atape]")
f.append(f"anoisesrc=color=pink:amplitude=0.0035:duration={L},highpass=f=2500,lowpass=f=9000,aformat=channel_layouts=stereo[hiss]")
f.append("[atape][hiss]amix=inputs=2:normalize=0:duration=first[avhs]")

out = cfg["out"]
common = ["-c:v", "libx264", "-crf", "17", "-preset", "medium", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-t", f"{L}"]
subprocess.run(["ffmpeg", "-v", "error", "-y", *inputs, "-filter_complex", ";".join(f),
                "-map", "[clean]", "-map", "[aclean]", *common, f"{out}-clean.mp4",
                "-map", "[vhs]", "-map", "[avhs]", *common, f"{out}-vhs.mp4"], check=True)
print(f"{out}-clean.mp4\n{out}-vhs.mp4")
