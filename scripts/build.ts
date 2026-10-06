// Renders the cut straight from data/project.json: picture, grade, graphics, captions and a mixed track.
//   bun run stitch build --version v3.1
//   bun run stitch build --version hall-s2-v1 --shots 2.1,2.2,2.3,2.4,2.5 --scope "Scene 2"   (a scene cut)
// Craft rules it enforces, so they never depend on memory:
//   - head trims skip the model warm-up and keep ~0.35 s before speech; "speech" tails end 0.45 s after the last word
//   - frames are scaled to fill and cropped (never padded), optional punch-in for same-framing cuts
//   - every shot is colour-matched to its location's look (real footage for the study)
//   - one continuous room-tone bed per location run; laid voices are convolved with a recorded room
//   - captions on every line with the series bug; a dissolve into the end card; 48 kHz, -14 LUFS by a measured linear gain
import { execFileSync, spawnSync } from "node:child_process"
import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import type { Asset, Cut, CutLine, CutShot, Location, Shot } from "../lib/model"
import { indexProject, pick } from "../lib/derive"
import { load, mutate } from "../lib/store"

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..")
const pub = (p: string) => path.join(root, "public", p)
const sh = (cmd: string, args: string[], cwd = root) => execFileSync(cmd, args, { encoding: "utf8", cwd, maxBuffer: 256 * 1024 * 1024 })
const err = (cmd: string, args: string[]) => spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 }).stderr ?? ""
const dur = (f: string) => Number(sh("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).trim())
const hasAudio = (f: string) => sh("ffprobe", ["-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", f]).trim().length > 0
const r3 = (n: number) => Math.round(n * 1000) / 1000
const XF = 0.35 // dissolve into a title or end card

type Span = { start: number; end: number }
type Seg = {
  shot: Shot; loc?: Location; asset: Asset | null; file: string; card: boolean
  in: number; dur: number; start: number; native: boolean; speech: Span[]; lead: number; punch: number; lut?: string
}

function speech(file: string): Span[] {
  if (!hasAudio(file)) return []
  const d = dur(file)
  // Listen in the voice band only, so a generated room bed is not read as speech; threshold 22 dB under that band's
  // own peak (room tone in generated clips sits well above a fixed -38 dB).
  const band = "highpass=f=250,lowpass=f=3500"
  const peak = Number(err("ffmpeg", ["-hide_banner", "-i", file, "-vn", "-af", `${band},volumedetect`, "-f", "null", "-"]).match(/max_volume: (-?[\d.]+) dB/)?.[1] ?? -10)
  const thr = Math.max(-45, Math.min(-20, peak - 22))
  const out = err("ffmpeg", ["-hide_banner", "-i", file, "-vn", "-af", `${band},silencedetect=noise=${thr}dB:d=0.3`, "-f", "null", "-"])
  const starts = [...out.matchAll(/silence_start: ([\d.]+)/g)].map((m) => Number(m[1]))
  const ends = [...out.matchAll(/silence_end: ([\d.]+)/g)].map((m) => Number(m[1]))
  const spans: Span[] = []
  let cursor = 0
  starts.forEach((s, i) => {
    if (s - cursor > 0.05) spans.push({ start: cursor, end: s })
    cursor = ends[i] ?? d
  })
  if (d - cursor > 0.05) spans.push({ start: cursor, end: d })
  return spans.filter((s) => s.end - s.start >= 0.12)
}

// A static gain for a clip's own audio. Single-pass loudnorm is an AGC: on a shot that is mostly room tone it pumps the
// bed up to dialogue level, so a quiet line drowns and the bed jumps at the cut. Instead: a shot with speech gets its
// loudest 400 ms window to -17 LUFS (where a line sits under I=-19); a shot without speech gets its room to -32.
function clipGain(file: string, start: number, len: number, talks: boolean): number {
  const out = err("ffmpeg", ["-hide_banner", "-ss", String(Math.max(0, start)), "-t", String(len), "-i", file, "-vn", "-af", "aresample=48000,highpass=f=80,ebur128", "-f", "null", "-"])
  const ms = [...out.matchAll(/ M: *(-?[\d.]+)/g)].map((m) => Number(m[1])).filter((x) => x > -70)
  const integ = Number(out.match(/I: *(-?[\d.]+) LUFS\s*\n\s*Threshold/)?.[1] ?? NaN)
  if (talks && ms.length) return Math.max(-12, Math.min(24, -17 - Math.max(...ms)))
  if (Number.isFinite(integ) && integ > -70) return Math.max(-20, Math.min(10, -32 - integ))
  return 0
}

function headFreeze(file: string): number {
  const out = err("ffmpeg", ["-hide_banner", "-t", "2.5", "-i", file, "-vf", "freezedetect=n=-55dB:d=0.15", "-an", "-f", "null", "-"])
  const s = out.match(/freeze_start: ([\d.]+)/)
  if (!s || Number(s[1]) > 0.08) return 0
  const e = out.match(/freeze_end: ([\d.]+)/)
  return e ? Math.min(Number(e[1]), 1.2) : 0.6
}

function irFile(room: string): string | null {
  if (!existsSync(room)) return null
  mkdirSync(path.join(root, "work/ir"), { recursive: true })
  const out = path.join(root, "work/ir", path.basename(room).replace(/[^a-z0-9.]+/gi, "_") + ".wav")
  if (!existsSync(out)) sh("ffmpeg", ["-v", "error", "-y", "-f", "aiff", "-i", room, "-ac", "1", "-ar", "48000", "-af", "atrim=0:2.4,afade=t=out:st=1.6:d=0.8", out])
  return out
}

export async function build(version?: string, opts: { shots?: string[]; scope?: string } = {}) {
  const p0 = await load()
  // A scene cut renders only the named shots, in board order, and is registered with a scope.
  const p = opts.shots?.length ? { ...p0, shots: p0.shots.filter((s) => opts.shots!.includes(s.id)) } : p0
  const ix = indexProject(p)
  const v = version ?? `v${p.cuts.length + 2}`
  const name = `final-cut-${v.replace(/[^a-z0-9.]+/gi, "-")}`
  const warnings: string[] = []
  await mutate([{ op: "log", text: `Building cut ${v}: trims, grade, room tone, captions, mix.`, kind: "run" }])

  // 1. Segments with trims.
  const segs: Seg[] = []
  for (const shot of p.shots) {
    const loc = shot.location ? ix.locs.get(shot.location) : undefined
    if (shot.card_graphic) {
      const g = ix.graphics.get(shot.card_graphic.graphic)
      const file = path.join(root, "motion/out", `${g?.comp ?? shot.card_graphic.graphic}.mov`)
      segs.push({ shot, loc, asset: null, file, card: true, in: 0, dur: shot.card_graphic.dur, start: 0, native: false, speech: [], lead: 0, punch: 1 })
      continue
    }
    const t = pick(shot.takes)
    const asset = t ? ix.assets.get(t.asset) ?? null : null
    if (!asset) { warnings.push(`shot ${shot.id} has no take`); continue }
    const file = pub(asset.path)
    const native = shot.lines.some((l) => l.mode === "native")
    const sp = native ? speech(file) : []
    const clip = dur(file)
    let inP: number
    if (typeof shot.edit.in === "number") inP = shot.edit.in
    else {
      const fz = headFreeze(file)
      if (native && sp.length) inP = Math.min(Math.max(fz, sp[0].start - 0.35), Math.max(0, sp[0].start - 0.15))
      else inP = Math.min(fz, 1.0)
    }
    let out = clip
    if (shot.edit.out === "speech" && sp.length) out = sp[sp.length - 1].end + 0.45
    else if (typeof shot.edit.out === "number") out = shot.edit.out
    out = Math.min(out, clip)
    const lead = Math.min(shot.edit.lead ?? 0, inP)
    segs.push({ shot, loc, asset, file, card: false, in: r3(inP), dur: r3(Math.max(0.5, out - inP)), start: 0, native, speech: sp, lead, punch: shot.edit.punch ?? 1 })
  }
  let t = 0
  segs.forEach((s, i) => {
    s.start = r3(s.card && i > 0 ? t - XF : t)
    t = s.start + s.dur
  })
  const total = r3(t)

  // 2. Grade: match each take to its location's look.
  mkdirSync(path.join(root, "work/luts"), { recursive: true })
  for (const s of segs.filter((x) => !x.card)) {
    const refs = (s.loc?.gradeRef ?? []).map((id) => ix.assets.get(id)).filter((a): a is Asset => !!a).map((a) => ({ path: pub(a.path) }))
    const targets = refs.length ? refs : segs.filter((o) => !o.card && o.loc?.id === s.loc?.id).map((o) => ({ path: o.file, in: o.in, dur: o.dur }))
    if (!targets.length) continue
    const lut = path.join(root, "work/luts", `${s.asset!.id}-${s.loc?.id ?? "none"}-${s.in.toFixed(2)}.cube`)
    if (!existsSync(lut)) {
      const spec = path.join(root, "work/luts", `${s.asset!.id}.json`)
      writeFileSync(spec, JSON.stringify({ source: { path: s.file, in: s.in, dur: s.dur }, targets, strength: 0.6, out: lut }))
      sh(path.join(root, "work/venv/bin/python"), [path.join(root, "scripts/grade.py"), spec])
    }
    s.lut = lut
  }

  // 3. Timeline (lines and graphics in cut time) and captions.
  const timeline: CutShot[] = segs.map((s) => {
    const lines: CutLine[] = []
    const native = s.shot.lines.filter((l) => l.mode === "native")
    const used = s.speech.filter((x) => x.end > s.in && x.start < s.in + s.dur)
    if (native.length && used.length) {
      // Group speech into one cluster per native line, split at the longest gaps.
      const gaps = used.slice(1).map((x, i) => ({ i: i + 1, g: x.start - used[i].end })).sort((a, b) => b.g - a.g).slice(0, native.length - 1).map((x) => x.i).sort((a, b) => a - b)
      const bounds = [0, ...gaps, used.length]
      native.forEach((l, k) => {
        const part = used.slice(bounds[k], bounds[k + 1])
        if (!part.length) return
        lines.push({ who: l.who, text: l.text, mode: "native", start: r3(s.start + Math.max(0, part[0].start - s.in)), end: r3(s.start + Math.min(s.dur, part[part.length - 1].end - s.in)) })
      })
    }
    for (const l of s.shot.lines.filter((x) => x.mode !== "native")) {
      const a = l.audio ? ix.assets.get(l.audio) : undefined
      const d = a ? dur(pub(a.path)) / (l.tempo ?? 1) : 1.5
      const start = s.start + (l.at ?? 0)
      if (start + d > s.start + s.dur + 0.05) warnings.push(`shot ${s.shot.id}: "${l.text}" runs ${(start + d - s.start - s.dur).toFixed(1)} s past the shot`)
      lines.push({ who: l.who, text: l.text, mode: l.mode, start: r3(start), end: r3(start + d) })
    }
    return {
      shot: s.shot.id, start: s.start, dur: s.dur, in: s.in, asset: s.asset?.id ?? null, lines,
      graphics: s.shot.graphics.map((g) => ({ graphic: g.graphic, start: r3(s.start + g.at), end: r3(s.start + Math.min(g.at + g.dur, s.dur)) })),
    }
  })
  const card = segs.find((s) => s.card)
  const captions = timeline.flatMap((c) => c.lines).filter((l) => l.end > l.start).map((l) => ({ text: l.text, from: l.start, to: l.end }))
  writeFileSync(path.join(root, "work/captions.json"), JSON.stringify({ lines: captions, bugUntil: card ? card.start : total, duration: total }))
  // Remotion's headless Chrome can stall on a frame seek when the machine is busy; retry before failing the build.
  for (let attempt = 1; ; attempt++) {
    try { sh("bun", ["run", "render.mjs", "CaptionTrack", "--props", "../work/captions.json"], path.join(root, "motion")); break }
    catch (e) { if (attempt >= 3) throw e; console.log(`caption render failed (attempt ${attempt}), retrying`) }
  }

  // 4. ffmpeg graph.
  const inputs: string[] = []
  const add = (...a: string[]) => (inputs.push(...a), inputs.filter((x) => x === "-i").length - 1)
  const fc: string[] = []
  const vi = segs.map((s) => add("-i", s.file))
  const takes = segs.map((s, i) => ({ s, i })).filter((x) => !x.s.card)
  for (const { s, i } of takes) {
    const punch = s.punch > 1 ? `,scale=iw*${s.punch}:ih*${s.punch},crop=1920:1080:(iw-1920)/2:(ih-1080)*0.35` : ""
    const lut = s.lut ? `,lut3d=file='${s.lut}':interp=tetrahedral` : ""
    fc.push(`[${vi[i]}:v]trim=start=${s.in}:duration=${s.dur},setpts=PTS-STARTPTS,fps=24,scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080${punch},setsar=1${lut},format=yuv420p[sv${i}];`)
  }
  fc.push(`${takes.map(({ i }) => `[sv${i}]`).join("")}concat=n=${takes.length}:v=1:a=0,settb=AVTB[main];`)
  let last = "main"
  if (card) {
    const ci = segs.indexOf(card)
    fc.push(`[${vi[ci]}:v]trim=0:${card.dur},setpts=PTS-STARTPTS,fps=24,scale=1920:1080,setsar=1,format=yuv420p,settb=AVTB[card];`)
    fc.push(`[main][card]xfade=transition=fade:duration=${XF}:offset=${r3(card.start)}[cutv];`)
    last = "cutv"
  }
  let k = 0
  for (const c of timeline) for (const g of c.graphics) {
    const gr = ix.graphics.get(g.graphic)
    const file = path.join(root, "motion/out", `${gr?.comp ?? g.graphic}.mov`)
    if (!existsSync(file) || g.end <= g.start || segs.find((s) => s.shot.id === c.shot)?.card) continue
    const gi = add("-i", file)
    fc.push(`[${gi}:v]format=yuva420p,setpts=PTS-STARTPTS+${g.start}/TB[o${k}];[${last}][o${k}]overlay=eof_action=pass:enable='between(t,${g.start},${g.end})'[g${k}];`)
    last = `g${k++}`
  }
  fc.push(`[${last}]noise=c0s=4:c0f=t+u,vignette=angle=PI/6[fin];`)
  const capi = add("-i", path.join(root, "motion/out/CaptionTrack.mov"))
  fc.push(`[${capi}:v]format=yuva420p[capv];[fin][capv]overlay=eof_action=pass[outv];`)

  // Audio.
  const a: string[] = []
  const lab = () => `a${a.length}`
  const ms = (x: number) => Math.max(0, Math.round(x * 1000))
  for (const [i, s] of segs.entries()) {
    if (!s.native || !hasAudio(s.file)) continue
    const l = lab()
    fc.push(`[${vi[i]}:a]atrim=start=${r3(s.in - s.lead)}:duration=${r3(s.dur + s.lead)},asetpts=PTS-STARTPTS,aresample=48000,highpass=f=80,volume=${r3(clipGain(s.file, s.in - s.lead, s.dur + s.lead, s.speech.some((x) => x.end > s.in && x.start < s.in + s.dur)))}dB,pan=stereo|c0=c0|c1=c0,afade=t=out:st=${r3(Math.max(0, s.dur + s.lead - 0.08))}:d=0.08,adelay=${ms(s.start - s.lead)}|${ms(s.start - s.lead)}[${l}];`)
    a.push(l)
  }
  for (const s of segs) {
    for (const line of s.shot.lines.filter((x) => x.mode !== "native" && x.audio)) {
      const asset = ix.assets.get(line.audio!)
      if (!asset) continue
      const li = add("-i", pub(asset.path))
      const at = s.start + (line.at ?? 0)
      const tempo = line.tempo ? `atempo=${line.tempo},` : ""
      const ir = s.loc?.room ? irFile(s.loc.room) : null
      const l = lab()
      const wet = line.mode === "vo" ? 0.3 : s.loc?.id === "hall" ? 0.24 : 0.14
      if (ir) {
        const ii = add("-i", ir)
        fc.push(`[${li}:a]aresample=48000,${tempo}highpass=f=90,loudnorm=I=-19:TP=-2:LRA=7,aformat=channel_layouts=mono,asplit=2[d${l}][w${l}];[w${l}][${ii}:a]afir[x${l}];[d${l}][x${l}]amix=inputs=2:weights='1 ${wet}':normalize=0,pan=stereo|c0=c0|c1=c0,adelay=${ms(at)}|${ms(at)}[${l}];`)
      } else {
        fc.push(`[${li}:a]aresample=48000,${tempo}highpass=f=90,loudnorm=I=-19:TP=-2:LRA=7,pan=stereo|c0=c0|c1=c0,adelay=${ms(at)}|${ms(at)}[${l}];`)
      }
      a.push(l)
    }
    for (const cue of s.shot.sfx) {
      const asset = ix.assets.get(cue.asset)
      if (!asset) continue
      const si = add("-i", pub(asset.path))
      const at = s.start + cue.at
      const l = lab()
      fc.push(`[${si}:a]aresample=48000,aformat=channel_layouts=stereo,volume=${cue.gain ?? 0}dB,adelay=${ms(at)}|${ms(at)}[${l}];`)
      a.push(l)
    }
  }
  // One continuous room-tone bed per run of shots in the same location.
  const runs: { loc: Location; start: number; end: number }[] = []
  for (const s of segs.filter((x) => !x.card && x.loc)) {
    const r = runs[runs.length - 1]
    if (r && r.loc.id === s.loc!.id && Math.abs(r.end - s.start) < 0.01) r.end = s.start + s.dur
    else runs.push({ loc: s.loc!, start: s.start, end: s.start + s.dur })
  }
  for (const r of runs) {
    const amb = r.loc.ambience ? ix.assets.get(r.loc.ambience) : undefined
    if (!amb) continue
    const ai = add("-stream_loop", "-1", "-i", pub(amb.path))
    const s0 = Math.max(0, r.start - 0.3)
    const L = r3(r.end + 0.3 - s0)
    const l = lab()
    fc.push(`[${ai}:a]atrim=0:${L},asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo,lowpass=f=9000,loudnorm=I=-42:TP=-9:LRA=7,aresample=48000,afade=t=in:d=0.4,afade=t=out:st=${r3(L - 0.4)}:d=0.4,adelay=${ms(s0)}|${ms(s0)}[${l}];`)
    a.push(l)
  }
  // The mix keeps its balance here; loudness is set afterwards with a measured, linear (non-pumping) gain.
  fc.push(`${a.map((x) => `[${x}]`).join("")}amix=inputs=${a.length}:normalize=0:dropout_transition=0,aresample=48000,atrim=0:${total}[outa]`)

  const outFile = pub(`/generated/${name}.mp4`)
  const filter = fc.join("")
  writeFileSync(path.join(root, "work/last-filter.txt"), filter)
  const rawFile = path.join(root, "work", `${name}.raw.mkv`)
  sh("ffmpeg", ["-v", "error", "-y", ...inputs, "-filter_complex", filter, "-map", "[outv]", "-map", "[outa]", "-c:v", "libx264", "-crf", "18", "-preset", "medium", "-pix_fmt", "yuv420p", "-c:a", "pcm_s24le", "-ar", "48000", "-t", String(total), rawFile])
  // Two-pass loudness: measure the whole mix, then apply one linear gain to -14 LUFS (true peak -1.5), so room tone
  // stays under the dialogue instead of being pumped up in quiet stretches.
  const LN = "I=-14:TP=-1.5:LRA=11"
  const m = JSON.parse(err("ffmpeg", ["-hide_banner", "-i", rawFile, "-vn", "-af", `loudnorm=${LN}:print_format=json`, "-f", "null", "-"]).match(/\{[^{}]*"input_i"[^{}]*\}/)![0])
  const lin = `loudnorm=${LN}:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`
  sh("ffmpeg", ["-v", "error", "-y", "-i", rawFile, "-c:v", "copy", "-af", `${lin},aresample=48000`, "-c:a", "aac", "-b:a", "192k", "-ar", "48000", outFile])

  // 5. Register.
  const assetId = `cut-${v}`
  const cut: Cut = { id: v, version: v, ...(opts.scope ? { scope: opts.scope } : {}), date: new Date().toISOString().slice(0, 10), asset: assetId, duration: total, timeline, notes: warnings }
  await mutate([
    p.assets.some((x) => x.id === assetId)
      ? { op: "asset.update", id: assetId, patch: { path: `/generated/${name}.mp4`, duration: total } }
      : { op: "asset.add", asset: { id: assetId, media: "video", path: `/generated/${name}.mp4`, label: opts.scope ? `${opts.scope} (${v})` : `Cut ${v}`, origin: "rendered", duration: total } },
    { op: "cut.add", cut },
    { op: "log", text: `Cut ${v} built: ${total.toFixed(1)} s${warnings.length ? `, ${warnings.length} warnings` : ""}.`, kind: "done" },
  ])
  console.log(outFile, `${total.toFixed(2)} s`)
  for (const w of warnings) console.log("warning:", w)
}
