#!/usr/bin/env python3
"""Captions from word timings: an SRT for the master and short burn-in chunks for social cuts.

    python3 scripts/captions.py <words.json> <out-dir> [--fix fixes.json] [--skip a-b,c-d] [--name film]

words.json: [{"text", "start", "end"}] (ElevenLabs Scribe on the clean dialogue stem is accurate to about a frame).
fixes.json: {"<start seconds, 2 decimals>": "replacement word"} to correct names and punctuation ("Henrik," -> "Henrick!").
--skip: film ranges kept out of the burn-in chunks (a card that already shows the words); the SRT keeps them.
Writes <name>.srt (phrases, at most 42 characters a line and two lines a cue) and <name>.chunks.json (at most three
words or 20 characters, never across a pause, each held until the next starts or 0.4 s past its last word).
"""
import json
import os
import sys

args = sys.argv[1:]
opt = {args[i][2:]: args[i + 1] for i in range(len(args)) if args[i].startswith("--")}
src, out = [a for i, a in enumerate(args) if not a.startswith("--") and (i == 0 or not args[i - 1].startswith("--"))][:2]
name = opt.get("name", "captions")
words = json.load(open(src))
fixes = json.load(open(opt["fix"])) if "fix" in opt else {}
skip = [tuple(map(float, r.split("-"))) for r in opt.get("skip", "").split(",") if r]
for w in words:
    k = f"{w['start']:.2f}"
    if k in fixes:
        w["text"] = fixes[k]
# keep names and product terms on one line: "Comp AI", "SOC 2", "type two"
glue = {"Comp": "AI", "SOC": "2", "type": "two"}
merged = []
for w in words:
    if merged and merged[-1]["text"] in glue and w["text"].startswith(glue[merged[-1]["text"]]) and w["start"] - merged[-1]["end"] < 0.35:
        merged[-1] = {"text": merged[-1]["text"] + " " + w["text"], "start": merged[-1]["start"], "end": w["end"]}
    else:
        merged.append(dict(w))
words = merged
os.makedirs(out, exist_ok=True)

phrases, cur = [], []
for w in words:
    if cur and w["start"] - cur[-1]["end"] > 0.35:
        phrases.append(cur)
        cur = []
    cur.append(w)
if cur:
    phrases.append(cur)


def ts(t):
    ms = int(round(t * 1000))
    return f"{ms // 3600000:02d}:{ms // 60000 % 60:02d}:{ms // 1000 % 60:02d},{ms % 1000:03d}"


def wrap(ws, width):
    lines, line = [], ""
    for w in ws:
        t = w["text"]
        if line and len(line) + 1 + len(t) > width:
            lines.append(line)
            line = t
        else:
            line = f"{line} {t}".strip()
    return lines + ([line] if line else [])


cues = []
for ph in phrases:
    group = []
    for w in ph:
        if group and len(wrap(group + [w], 42)) > 2:
            cues.append(group)
            group = []
        group.append(w)
    cues.append(group)
srt = []
for k, c in enumerate(cues):
    end = c[-1]["end"] + 0.3
    if k + 1 < len(cues):
        end = min(end, cues[k + 1][0]["start"] - 0.04)
    srt.append(f"{k + 1}\n{ts(c[0]['start'])} --> {ts(end)}\n" + "\n".join(wrap(c, 42)) + "\n")
open(os.path.join(out, f"{name}.srt"), "w").write("\n".join(srt))

# Burn-in chunks: up to two lines of LINE characters, phrases joined across pauses under 0.5 s, broken after
# punctuation or an interruption ("your-"), never ending on a little word ("the", "of"), and never held past a
# picture cut (--cuts, film seconds) after their last word.
LINE = int(opt.get("line", 20))
SMALL = {"the", "a", "an", "of", "to", "and", "in", "with", "our", "my", "this", "is", "it", "from", "on", "we'll", "i", "you"}
cuts = sorted(float(x) for x in open(opt["cuts"]).read().split()) if "cuts" in opt else []
groups, cur = [], []
for w in words:
    if cur and w["start"] - cur[-1]["end"] > 0.5:
        groups.append(cur)
        cur = []
    cur.append(w)
if cur:
    groups.append(cur)
chunks = []
for ph in groups:
    if any(a <= ph[0]["start"] < b for a, b in skip):
        continue
    group = []
    for w in ph:
        fits = len(wrap(group + [w], LINE)) <= 2 and all(len(x) <= LINE + 4 for x in wrap(group + [w], LINE))
        punct = group and group[-1]["text"][-1] in ".?!-"
        if group and (not fits or punct):
            # split at the latest punctuation in the chunk, else before any trailing little words
            cut = len(group)
            if not punct:
                marks = [i for i in range(1, len(group)) if group[i - 1]["text"][-1] in ",.?!-"]
                if marks:
                    cut = marks[-1]
                else:
                    while cut > 1 and group[cut - 1]["text"].lower().strip(",") in SMALL:
                        cut -= 1
            chunks.append(group[:cut])
            group = group[cut:]
        group.append(w)
    chunks.append(group)
res = []
for k, c in enumerate(chunks):
    end = c[-1]["end"] + 0.4
    if k + 1 < len(chunks):
        end = min(end, chunks[k + 1][0]["start"])
    for t in cuts:  # a caption leaves with its speaker's shot
        if c[-1]["end"] - 0.02 <= t < end:
            end = t
            break
    res.append({"start": round(c[0]["start"], 3), "end": round(end, 3), "text": " ".join(w["text"] for w in c)})
json.dump(res, open(os.path.join(out, f"{name}.chunks.json"), "w"), indent=1)
print(f"{len(cues)} SRT cues, {len(res)} burn-in chunks -> {out}")
