#!/usr/bin/env python3
"""Build the cut from data/cut.json: picture, motion graphics and a mixed sound track in one pass.

usage: build-cut.py [out-name]        -> public/generated/<name>.mp4 (and public/generated/<name>.cues.txt)

Per shot: clip (node id of a generation node with a video), optional trim ("speech" cuts the clip 0.7 s after its
last spoken word), "native" (use the clip's own audio, e.g. Seedance speech), overlays [comp, offset, seconds],
audio cues [file, at, gain dB, tempo, role], ambience bed. A shot may name a fallback used when its clip is missing.
Dialogue and native speech are loudness-matched per line; the whole mix is normalised to the target LUFS.
"""
import json, os, re, subprocess, sys
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
cut = json.load(open(f"{root}/data/cut.json"))
name = sys.argv[1] if len(sys.argv) > 1 else cut["name"]
graph = json.load(open(f"{root}/data/graph.json"))
video_of = {n["id"]: n["data"].get("video") for n in graph["nodes"]}
R = lambda p: p if os.path.isabs(p) else f"{root}/{p}"

def dur(p):
    return float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", p]).decode())

def speech_end(p):
    out = subprocess.run(["ffmpeg", "-hide_banner", "-i", p, "-vn", "-af", "silencedetect=noise=-38dB:d=0.35", "-f", "null", "-"], capture_output=True, text=True).stderr
    starts = [float(x) for x in re.findall(r"silence_start: ([\d.]+)", out)]
    d = dur(p)
    return min(d, (starts[-1] if starts and starts[-1] > 0.5 else d) + 0.45)

shots, t = [], 0.0
for s in cut["shots"]:
    s = dict(s)
    if s.get("comp"):
        path, d = f"{root}/motion/out/{s['comp']}.mov", float(s["secs"])
    else:
        vid = video_of.get(s["clip"])
        if (not vid or not os.path.exists(f"{root}/public{vid}")) and s.get("fallback"):
            fb = s["fallback"]; s.update({k: v for k, v in fb.items() if k != "clip"}); s["clip"] = fb["clip"]; vid = video_of.get(s["clip"])
            s.pop("trim", None)
        if not vid: print("skip", s["id"], "(no clip)"); continue
        path = f"{root}/public{vid}"
        d = speech_end(path) if s.get("trim") == "speech" else dur(path)
        if s.get("trim") == "speech": d = min(d, dur(path))
    s["path"], s["dur"], s["start"] = path, d, t
    t += d; shots.append(s)
total = t

inp, vf = [], []
for i, s in enumerate(shots):
    inp += ["-i", s["path"]]
    vf.append(f"[{i}:v]trim=0:{s['dur']:.3f},setpts=PTS-STARTPTS,scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,fps=24,setsar=1,format=yuv420p[sv{i}];")
vf.append("".join(f"[sv{i}]" for i in range(len(shots))) + f"concat=n={len(shots)}:v=1:a=0[base];")
last, k = "base", len(shots)
for s in shots:
    for comp, off, secs in s.get("overlays", []):
        secs = min(secs, s["dur"] - off)
        if secs <= 0: continue
        t0 = s["start"] + off
        inp += ["-i", f"{root}/motion/out/{comp}.mov"]
        vf.append(f"[{k}:v]format=yuva420p,setpts=PTS-STARTPTS+{t0:.3f}/TB[o{k}];[{last}][o{k}]overlay=eof_action=pass:enable='between(t,{t0:.3f},{t0 + secs:.3f})'[v{k}];")
        last = f"v{k}"; k += 1

af, labels, cues = [], [], []
def add(label_in, delay, vol_db, norm=None, tempo=None, trim=None, fade=None, tag=""):
    chain = []
    if trim: chain.append(f"atrim=0:{trim:.3f},asetpts=PTS-STARTPTS")
    if tempo: chain.append(f"atempo={tempo}")
    chain.append("aresample=48000,aformat=channel_layouts=stereo" if False else "aresample=48000")
    if norm is not None: chain.append(f"loudnorm=I={norm}:TP=-2:LRA=6")
    chain.append("pan=stereo|c0=c0|c1=c0" if label_in.startswith("DIALOGUE") else "aformat=channel_layouts=stereo")
    if vol_db: chain.append(f"volume={vol_db}dB")
    if fade: chain.append(f"afade=t=in:d={fade}:st=0,afade=t=out:d={fade}:st={max(0.0, trim - fade):.3f}")
    chain.append(f"adelay={int(delay * 1000)}|{int(delay * 1000)}")
    return chain

n_a = 0
for i, s in enumerate(shots):
    if s.get("native") and not s.get("comp"):
        src = f"{i}:a"
        ch = [f"atrim=0:{s['dur']:.3f}", "asetpts=PTS-STARTPTS", "aresample=48000", "highpass=f=70", "loudnorm=I=-19:TP=-2:LRA=6", "pan=stereo|c0=c0|c1=c0", f"adelay={int(s['start']*1000)}|{int(s['start']*1000)}"]
        af.append(f"[{src}]{','.join(ch)}[a{n_a}];"); labels.append(f"[a{n_a}]"); cues.append(f"{s['start']:7.2f}  native speech  {s['id']}"); n_a += 1
    amb = s.get("amb")
    if amb:
        inp += ["-stream_loop", "-1", "-i", R(cut["ambience"][amb])]
        ai = (len(inp) - 0)  # placeholder, fixed below
        s["_amb_input"] = sum(1 for x in inp if x == "-i") - 1
    for c in s.get("audio", []):
        inp += ["-i", R(c["file"])]
        c["_input"] = sum(1 for x in inp if x == "-i") - 1
# rebuild amb cues now that input indices are final
for s in shots:
    if s.get("amb"):
        ai, d0 = s["_amb_input"], s["dur"] + 0.8
        af.append(f"[{ai}:a]atrim=0:{d0:.3f},asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo,volume=-27dB,afade=t=in:d=0.5:st=0,afade=t=out:d=0.5:st={d0 - 0.5:.3f},adelay={int(max(0, s['start'] - 0.4) * 1000)}|{int(max(0, s['start'] - 0.4) * 1000)}[a{n_a}];")
        labels.append(f"[a{n_a}]"); cues.append(f"{s['start']:7.2f}  ambience {s['amb']}  {s['id']}"); n_a += 1
    for c in s.get("audio", []):
        at = s["start"] + c["at"]
        dialogue = c.get("role") == "dialogue"
        ch = ["aresample=48000"]
        if c.get("tempo"): ch.append(f"atempo={c['tempo']}")
        if dialogue: ch += ["highpass=f=70", "loudnorm=I=-19:TP=-2:LRA=6", "pan=stereo|c0=c0|c1=c0"]
        else: ch.append("aformat=channel_layouts=stereo")
        if c.get("gain"): ch.append(f"volume={c['gain']}dB")
        ch.append(f"adelay={int(at * 1000)}|{int(at * 1000)}")
        af.append(f"[{c['_input']}:a]{','.join(ch)}[a{n_a}];"); labels.append(f"[a{n_a}]")
        cues.append(f"{at:7.2f}  {'dialogue' if dialogue else 'sfx     '}  {os.path.basename(c['file'])}  ({s['id']})"); n_a += 1

target = cut.get("target_lufs", -14)
af.append("".join(labels) + f"amix=inputs={len(labels)}:normalize=0:dropout_transition=0,loudnorm=I={target}:TP=-1.5:LRA=9,atrim=0:{total:.3f}[outa]")
out = f"{root}/public/generated/{name}.mp4"
cmd = ["ffmpeg", "-v", "error", "-y", *inp, "-filter_complex", "".join(vf) + "".join(af), "-map", f"[{last}]", "-map", "[outa]", "-c:v", "libx264", "-crf", "19", "-preset", "medium", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-t", f"{total:.3f}", out]
subprocess.run(cmd, check=True)
open(f"{root}/public/generated/{name}.cues.txt", "w").write("\n".join(sorted(cues)) + "\n")
print(out, f"{total:.2f}s", "shots:", ",".join(s["id"] + ("*" if s.get("fallback") and "fallback" not in s else "") for s in shots))
