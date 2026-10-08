// Server and CLI only. Stage 04's recorder: a person performs lines into the app, the takes are saved as recorded
// (WAV under public/generated/<film>/voice/), then converted to the role's voice with the ElevenLabs voice changer.
// Speech-to-speech keeps the performer's timing, melody and accent and swaps the timbre. Henrick converts to the clone
// of his real lines, so nothing is trained; every other role converts to the voice cast for it.
//
// Two ways in: one line at a time (perform), or scene mode (performScene): the whole read in one continuous
// recording against the other roles' lines as cues, converted in one pass so the voice stays the same from line to
// line, then cut into lines by matching the words said to the script (cutByWords). buildRead turns the picked takes
// into a read paced by the script's beats.
// The recorder (POST /api/perform, /api/perform/scene) and the CLI (`stitch voice ...`) call these; every write is an op.

import { execFile, spawn } from "node:child_process"
import { existsSync, promises as fs } from "node:fs"
import path from "node:path"
import { promisify } from "node:util"
import { acted, API, elAudio, key, TTS_MODEL } from "../scripts/eleven"
import type { Id } from "./model"
import type { Conversion, Performance, Process, SceneEvent, Voice, VoiceLine, VoiceTake } from "./process"
import { load, mutate, projectRoot } from "./store"

const exec = promisify(execFile)
// The dev server may start with a bare PATH; ffmpeg (here and inside voice-score.py) lives in Homebrew.
const env = { ...process.env, PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH ?? ""}` }

/** The only ElevenLabs voice changer models are v2 (checked 2026-10-08): v3 and v4 are text to speech only. */
export const STS_MODEL = "eleven_multilingual_sts_v2"
const SETTINGS = { stability: 0.5, similarity_boost: 0.9 }

const pub = (rel: string) => path.join(projectRoot(), "public", rel)
const safe = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
const pad = (n: number) => String(n).padStart(2, "0")
const round = (x: number) => Math.round(x * 100) / 100
const stamp = () => new Date().toISOString()
const filmOf = (slug?: string) => slug || process.env.STITCH_PROJECT || "ministry"

/** The file extension for an uploaded recording's content type. */
export const extOf = (type: string) => (type.includes("mp4") || type.includes("aac") ? "m4a" : type.includes("ogg") ? "ogg" : type.includes("wav") ? "wav" : type.includes("mpeg") ? "mp3" : "webm")

/** The voice a role's performances convert to: a real person's clone, else the voice cast for the role. */
export function targetVoice(v: Voice, who: string): { voice: string; voiceId: string } | undefined {
  const role = v.roles.find((r) => r.who === who)
  if (!role) return undefined
  const a = role.real ? role.auditions.find((x) => x.source === "clone" && x.voiceId) : role.auditions.find((x) => x.voice === role.voice && x.voiceId)
  return a?.voiceId ? { voice: a.voice, voiceId: a.voiceId } : undefined
}

/** Save an upload as 48 kHz mono 16-bit WAV, as recorded. The upload stays on disk until it decodes. */
async function saveWav(audio: Uint8Array, ext: string, rel: string): Promise<string> {
  const raw = pub(`${rel}.in.${safe(ext) || "webm"}`)
  await fs.mkdir(path.dirname(raw), { recursive: true })
  await fs.writeFile(raw, audio)
  await exec("ffmpeg", ["-v", "error", "-y", "-i", raw, "-vn", "-ac", "1", "-ar", "48000", "-c:a", "pcm_s16le", pub(`${rel}.wav`)], { env }).catch((e: Error) => {
    throw new Error(`could not read the recording (kept at public/${path.relative(pub(""), raw)}): ${e.message.split("\n")[0]}`)
  })
  await fs.rm(raw, { force: true })
  return `${rel}.wav`
}

const seconds = async (file: string) => Number((await exec("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { env })).stdout.trim()) || 0

/** One voice changer call: a WAV in, the same performance in the target voice out (MP3). Returns the request id.
 *  A `seed` (and other settings) gives a different try at the same performance. */
async function sts(src: string, target: { voiceId: string }, out: string, o: { seed?: number; settings?: typeof SETTINGS } = {}): Promise<string | undefined> {
  const form = new FormData()
  form.append("audio", new Blob([new Uint8Array(await fs.readFile(src))], { type: "audio/wav" }), path.basename(src))
  form.append("model_id", STS_MODEL)
  form.append("voice_settings", JSON.stringify(o.settings ?? SETTINGS))
  if (o.seed !== undefined) form.append("seed", String(o.seed))
  const res = await fetch(`${API}/v1/speech-to-speech/${target.voiceId}?output_format=mp3_44100_192`, { method: "POST", headers: { "xi-api-key": key() }, body: form, signal: AbortSignal.timeout(300_000) })
  if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${(await res.text()).slice(0, 300)}`)
  await fs.writeFile(out, new Uint8Array(await res.arrayBuffer()))
  return res.headers.get("request-id") ?? undefined
}

/** Word timings for a recording (ElevenLabs Scribe), to cut each line at its first and last word. */
async function words(file: string): Promise<{ text: string; start: number; end: number }[]> {
  let last = ""
  for (const model of ["scribe_v2", "scribe_v1"]) {
    const form = new FormData()
    form.append("file", new Blob([new Uint8Array(await fs.readFile(file))], { type: "audio/wav" }), path.basename(file))
    form.append("model_id", model)
    form.append("timestamps_granularity", "word")
    form.append("tag_audio_events", "false")
    const res = await fetch(`${API}/v1/speech-to-text`, { method: "POST", headers: { "xi-api-key": key() }, body: form, signal: AbortSignal.timeout(300_000) })
    if (!res.ok) {
      last = `${res.status} ${(await res.text()).slice(0, 200)}`
      continue
    }
    const j = (await res.json()) as { words?: { text: string; start: number; end: number; type?: string }[] }
    return (j.words ?? []).filter((w) => (w.type ?? "word") === "word")
  }
  throw new Error(`Scribe could not transcribe the recording: ${last}`)
}

/** Run ffmpeg with raw samples in or out (stdin, stdout). */
function pcm(args: string[], input?: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const p = spawn("ffmpeg", args, { env })
    const out: Buffer[] = []
    p.stdout.on("data", (d: Buffer) => out.push(d))
    p.on("error", reject)
    p.on("close", (code) => (code === 0 ? resolve(Buffer.concat(out)) : reject(new Error(`ffmpeg exited ${code}`))))
    p.stdin.end(input)
  })
}

/** Pops: the voice changer turns a small lip or key click (about -26 dBFS in the recording) into a pop of a few
 *  milliseconds near full scale. Find only those, a 2 ms window whose high-frequency energy is 150 times its
 *  neighbourhood's (or 40 times and as loud as the loudest speech), and dip each over 12 ms; every other sample is left
 *  as it is. Rewrites the WAV in place and returns how many windows it dipped. */
async function depop(file: string): Promise<number> {
  const buf = await pcm(["-v", "error", "-i", file, "-ac", "1", "-ar", "48000", "-f", "f32le", "-"])
  const x = new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
  const w = 96
  const n = Math.max(0, Math.floor((x.length - 2) / w))
  const e = new Float64Array(n)
  const peak = new Float64Array(n)
  let top = 0
  for (let k = 0; k < n; k++) {
    let s = 0
    let p = 0
    for (let i = k * w; i < (k + 1) * w; i++) {
      const d = x[i + 2] - 2 * x[i + 1] + x[i]
      s += d * d
      p = Math.max(p, Math.abs(x[i]))
    }
    e[k] = Math.sqrt(s / w)
    peak[k] = p
    top = Math.max(top, p)
  }
  const pops: number[] = []
  for (let k = 0; k < n; k++) {
    const near = Array.from(e.subarray(Math.max(0, k - 25), Math.min(n, k + 25))).sort((a, b) => a - b)
    const r = e[k] / (near[near.length >> 1] + 1e-7)
    if (r >= 150 || (r >= 40 && peak[k] >= 0.6 * top)) pops.push(k)
  }
  if (!pops.length) return 0
  const half = 288 // 6 ms either side of the window's centre
  for (const k of pops) {
    const c = k * w + w / 2
    for (let i = -half; i <= half; i++) {
      const j = c + i
      if (j >= 0 && j < x.length) x[j] *= 1 - 0.97 * 0.5 * (1 + Math.cos((Math.PI * i) / half))
    }
  }
  await pcm(["-v", "error", "-y", "-f", "f32le", "-ar", "48000", "-ac", "1", "-i", "-", "-c:a", "pcm_s16le", file], Buffer.from(x.buffer))
  return pops.length
}

/** Speaker similarity of each clip to his real recording (scripts/voice-score.py, one model load for all clips). */
async function scores(files: string[]): Promise<(number | undefined)[]> {
  const py = path.join(projectRoot(), "work/venv/bin/python")
  if (!files.length || !existsSync(py)) return files.map(() => undefined)
  const r = await exec(py, [path.join(projectRoot(), "scripts/voice-score.py"), ...files], { env, maxBuffer: 1 << 20 }).catch(() => null)
  const out = r?.stdout.trim().split("\n") ?? []
  return files.map((_, i) => {
    const m = out[i]?.match(/voice ([0-9.]+)/)
    return m ? Number(m[1]) : undefined
  })
}

/** Save a recorded line as its performance, then convert it to the role's voice. `scoreLater` answers as soon as the
 *  conversion exists and fills in the match afterwards (the recorder plays the take back without waiting for it).
 *  `keep` picks the new take for its line and rebuilds the working read, so a redo lands in the read by itself. */
export async function perform(o: { slug?: string; n: number; audio: Uint8Array; ext: string; by: string; scoreLater?: boolean; keep?: boolean }): Promise<Performance> {
  const v = (await load(o.slug)).process?.voice
  const take = v ? (v.takes.find((t) => t.id === v.pick) ?? v.takes.at(-1)) : undefined
  const line = take?.lines.find((l) => l.n === o.n)
  if (!line) throw new Error(`no line ${o.n} in the read`)
  const id = `p${Date.now().toString(36)}`
  const file = await saveWav(o.audio, o.ext, `generated/${filmOf(o.slug)}/voice/perf/${pad(o.n)}-${line.who}-${id}`)
  const perf: Performance = { id, n: o.n, who: line.who, text: line.text, file, duration: (await seconds(pub(file))) || undefined, by: o.by, at: stamp() }
  await mutate([{ op: "voice.perform", performance: perf, by: o.by }], o.slug)
  const done = await convert(o.slug, id, { scoreLater: o.scoreLater })
  if (o.keep && done.converted) {
    const after = mutate([{ op: "voice.keep", n: o.n, id, by: o.by }], o.slug)
      .then(() => buildRead(o.slug, o.by))
      .catch(() => {})
    if (!o.scoreLater) await after
  }
  return done
}

/** Convert a saved performance to its role's voice (again, after a recast or a failed call). */
export async function convert(slug: string | undefined, id: string, opts: { scoreLater?: boolean } = {}): Promise<Performance> {
  const v = (await load(slug)).process?.voice
  const perf = v?.performances?.find((x) => x.id === id)
  if (!v || !perf) throw new Error(`no performance ${id}`)
  const target = targetVoice(v, perf.who)
  let next: Performance
  if (!target) next = { ...perf, error: `cast a voice for ${perf.who} first` }
  else {
    try {
      const rel = perf.file.replace(/\.wav$/, `-${safe(target.voice)}.mp3`)
      const job = await sts(pub(perf.file), target, pub(rel))
      next = { ...perf, error: undefined, converted: { file: rel, model: "ElevenLabs Voice Changer", provider: "ElevenLabs", voice: target.voice, voiceId: target.voiceId, job, at: stamp() } }
    } catch (e) {
      next = { ...perf, error: (e as Error).message }
    }
  }
  await mutate([{ op: "voice.perform", performance: next, by: "claude" }], slug)
  // The match to his real recording (real roles only) takes a few seconds; it lands on the take when it is done.
  const file = next.converted?.file
  if (file && v.roles.find((r) => r.who === perf.who)?.real) {
    const scoring = scores([pub(file)])
      .then(async ([match]) => {
        const cur = match === undefined ? undefined : (await load(slug)).process?.voice?.performances?.find((x) => x.id === id)
        if (cur?.converted?.file === file) await mutate([{ op: "voice.perform", performance: { ...cur, converted: { ...cur.converted, match } }, by: "claude" }], slug)
      })
      .catch(() => {})
    if (!opts.scoreLater) await scoring
  }
  return next
}

// ---------- cutting a scene recording into lines by its words ----------

type Word = { text: string; start: number; end: number }
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9']/g, "")
const toks = (s: string) => s.split(/\s+/).map(norm).filter(Boolean)
function lev(a: string, b: string) {
  const d = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0]
    d[0] = i
    for (let j = 1; j <= b.length; j++) {
      const t = d[j]
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1))
      prev = t
    }
  }
  return d[b.length]
}
/** How alike two words are (0 to 1): the same word, a name spelled another way ("Henrik"), or a word cut short. */
const alike = (a: string, b: string) => (a === b ? 1 : a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a)) ? 0.85 : 1 - lev(a, b) / Math.max(a.length, b.length, 1))

/** Align the script's words with the words said (global alignment): for each word said, the index of the script word
 *  it stands for, or -1 for a word the script does not have. */
function align(script: string[], said: string[]): number[] {
  const m = script.length
  const n = said.length
  const S = Array.from({ length: m + 1 }, () => new Float64Array(n + 1))
  const B = Array.from({ length: m + 1 }, () => new Uint8Array(n + 1)) // 1 both, 2 a script word not said, 3 a word not in the script
  for (let i = 1; i <= m; i++) {
    S[i][0] = -i
    B[i][0] = 2
  }
  for (let j = 1; j <= n; j++) {
    S[0][j] = -j
    B[0][j] = 3
  }
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++) {
      const a = alike(script[i - 1], said[j - 1])
      const both = S[i - 1][j - 1] + (a >= 0.7 ? 2 * a : -1.5)
      const skip = S[i - 1][j] - 1
      const extra = S[i][j - 1] - 1
      if (both >= skip && both >= extra) {
        S[i][j] = both
        B[i][j] = 1
      } else if (skip >= extra) {
        S[i][j] = skip
        B[i][j] = 2
      } else {
        S[i][j] = extra
        B[i][j] = 3
      }
    }
  const out = new Array<number>(n).fill(-1)
  for (let i = m, j = n; i > 0 || j > 0; ) {
    if (B[i][j] === 1) {
      if (alike(script[i - 1], said[j - 1]) >= 0.7) out[j - 1] = i - 1
      i--
      j--
    } else if (B[i][j] === 2) i--
    else j--
  }
  return out
}

/** A line's cut: the spans of the recording (seconds) that make it, what was cut, and script words never said. */
type LineCut = { line: VoiceLine; spans: [number, number][]; trimmed: string[]; missing: string[] }

/** Cut each performed line out of a scene recording by its words, not by when Space was pressed: every word said goes
 *  to the script line it belongs to, so a word finished after Space lands in its own line. Ad-libs stay with the line
 *  they are said in (they tie the read together); only the first try of a repeated word and stray words far from any
 *  line are cut. A pause inside a line longer than `pause(line)` is shortened to it. */
function cutByWords(lines: VoiceLine[], said: Word[], pause: (l: VoiceLine) => number, presses: number[] = []): LineCut[] {
  const script = lines.flatMap((l, li) => toks(l.text).map((w) => ({ li, w })))
  const heard = said.map((w) => norm(w.text))
  const at = align(script.map((x) => x.w), heard)
  const lineOf = at.map((k) => (k >= 0 ? script[k].li : -1))
  const keep = at.map((k) => k >= 0)
  const trimmed: string[][] = lines.map(() => [])
  for (let j = 0; j < said.length; j++) {
    if (at[j] >= 0) continue
    let p = j - 1
    while (p >= 0 && at[p] < 0) p--
    let q = j + 1
    while (q < said.length && at[q] < 0) q++
    const lp = p >= 0 ? lineOf[p] : -1
    const lq = q < said.length ? lineOf[q] : -1
    const li = lp < 0 ? lq : lq < 0 ? lp : lp === lq ? lp : said[j].start - said[p].end <= said[q].start - said[j].end ? lp : lq
    lineOf[j] = li
    if (li < 0) continue
    if (j - p === 1 && lineOf[p] === li && alike(heard[p], heard[j]) >= 0.8) {
      // A repeat: keep the second, cleaner try and cut the first.
      keep[p] = false
      keep[j] = true
      trimmed[li].push(`the first "${said[p].text}" of a repeat`)
    } else if (q - j === 1 && lineOf[q] === li && alike(heard[q], heard[j]) >= 0.8) trimmed[li].push(`the first "${said[j].text}" of a repeat`)
    else {
      // An ad-lib stays with its line, unless it stands alone, far from the line's words (a stray word or noise).
      const near = Math.min(lp === li ? said[j].start - said[p].end : Infinity, lq === li ? said[q].start - said[j].end : Infinity)
      if (near <= 1.2) keep[j] = true
      else trimmed[li].push(`the stray "${said[j].text}"`)
    }
  }
  const got = new Set(at.filter((k) => k >= 0))
  return lines.map((line, li) => {
    const kept = said.map((_, j) => j).filter((j) => lineOf[j] === li && keep[j])
    const cap = pause(line)
    const cutOff = /[-–—]\s*$/.test(line.text) // an interrupted line stops on its last word
    const spans: [number, number][] = []
    let s: number | undefined
    for (const [k, j] of kept.entries()) {
      const before = j > 0 ? said[j - 1].end : 0
      if (s === undefined) s = Math.max(before, said[j].start - Math.min(0.12, (said[j].start - before) / 2))
      const next = kept[k + 1]
      const joined = next === j + 1 // the next word said is this line's next kept word: no cut between them
      if (joined && said[next].start - said[j].end <= cap) continue
      if (joined) {
        // A long pause inside the line: keep `cap` of it, around its middle.
        spans.push([s, said[j].end + cap / 2])
        s = said[next].start - cap / 2
      } else {
        const after = j + 1 < said.length ? said[j + 1].start : said[j].end + 1
        spans.push([s, said[j].end + (next === undefined && cutOff ? 0.04 : Math.min(0.22, (after - said[j].end) / 2))])
        s = undefined
      }
    }
    // A Space press clicks the keyboard, and the voice changer turns that tick into a pop: cut a short window around
    // each press out of the line wherever no word of it is said.
    const clear = (a: number, b: number) => !kept.some((j) => said[j].end > a && said[j].start < b)
    let cut: [number, number][] = spans
    // A press right after the last word (Space hit as the line ends) is too close to cut around: end the line on it.
    const last = kept.length ? said[kept[kept.length - 1]] : undefined
    for (const p of presses)
      if (last && cut.length && p - 0.012 >= last.end - 0.005 && p < last.end + 0.3) {
        const [x, y] = cut[cut.length - 1]
        cut = [...cut.slice(0, -1), [x, Math.min(y, p - 0.012)]]
      }
    for (const p of presses) {
      const [a, b] = [p - 0.05, p + 0.12]
      if (!clear(a, b)) continue
      cut = cut.flatMap(([x, y]): [number, number][] => (b <= x || a >= y ? [[x, y]] : ([[x, Math.min(y, a)], [Math.max(x, b), y]] as [number, number][]).filter(([u, w]) => w - u > 0.03)))
    }
    const missing = script.map((x, k) => ({ ...x, k })).filter((x) => x.li === li && !got.has(x.k)).map((x) => x.w)
    return { line, spans: cut, trimmed: trimmed[li], missing }
  })
}

/** Render spans of a recording into one file: each span faded in and out over a few milliseconds and joined end to
 *  end, then played `tempo` times faster (a speed-read). */
async function render(src: string, spans: [number, number][], out: string, tempo = 1) {
  const n = spans.length
  const graph = [
    `[0:a]asplit=${n}${spans.map((_, i) => `[s${i}]`).join("")}`,
    ...spans.map(([s, e], i) => `[s${i}]atrim=start=${s.toFixed(3)}:end=${e.toFixed(3)},asetpts=PTS-STARTPTS,afade=t=in:d=0.008,afade=t=out:st=${Math.max(0, e - s - 0.012).toFixed(3)}:d=0.012[p${i}]`),
    `${spans.map((_, i) => `[p${i}]`).join("")}concat=n=${n}:v=0:a=1${tempo !== 1 ? `,atempo=${tempo}` : ""}[out]`,
  ].join(";")
  await exec("ffmpeg", ["-v", "error", "-y", "-i", src, "-filter_complex", graph, "-map", "[out]", "-ac", "1", ...(out.endsWith(".mp3") ? ["-c:a", "libmp3lame", "-b:a", "192k"] : ["-ar", "48000", "-c:a", "pcm_s16le"]), out], { env })
}

/** The script's direction for a line ("after a beat", "speed-read"), found by beat, speaker and words. */
const scriptHow = (script?: Process["script"]) => (l: VoiceLine) => script?.beats.find((b) => b.id === l.beat)?.lines.find((x) => x.who.toLowerCase() === l.who && (x.text.includes(l.text) || l.text.includes(x.text)))?.how
const speedRead = (how?: string) => /speed/i.test(how ?? "")
/** When Space was pressed to end each performed line, in recording time (the key click lands about 20 ms later). */
const pressesOf = (events: SceneEvent[]) => events.filter((e) => e.kind === "mine").map((e) => e.end + 0.02)

/** Word timings for a recording, kept next to it so a recut does not transcribe again. */
async function wordsOf(file: string): Promise<Word[]> {
  const cache = `${file}.words.json`
  if (existsSync(cache)) return JSON.parse(await fs.readFile(cache, "utf8")) as Word[]
  const w = await words(file)
  await fs.writeFile(cache, JSON.stringify(w))
  return w
}

/** Cut a scene's performed lines by their words and render each from its role's conversion pass (and from the raw
 *  recording, for the "You" player). Pauses inside a line: 0.6 s for the real person's deadpan, 0.12 s in a
 *  speed-read (also played 1.25x), 0.45 s otherwise. */
async function cutScene(o: { slug?: string; sceneId: Id; file: string; lines: VoiceLine[]; passes: Map<string, Conversion>; said: Word[]; presses: number[]; script?: Process["script"]; real: (who: string) => boolean; by: string }): Promise<Performance[]> {
  const film = filmOf(o.slug)
  await fs.mkdir(pub(`generated/${film}/voice/perf`), { recursive: true })
  const how = scriptHow(o.script)
  const cuts = cutByWords(o.lines, o.said, (l) => (speedRead(how(l)) ? 0.12 : o.real(l.who) ? 0.6 : 0.45), o.presses)
  const at = stamp()
  const out: Performance[] = []
  for (const [k, c] of cuts.entries()) {
    const pass = o.passes.get(c.line.who)
    if (!c.spans.length || !pass) continue
    const tempo = speedRead(how(c.line)) ? 1.25 : 1
    const pid = `p${Date.now().toString(36)}${k}`
    const rel = `generated/${film}/voice/perf/${pad(c.line.n)}-${c.line.who}-${pid}`
    const conv = `${rel}-${safe(pass.voice)}.mp3`
    await Promise.all([render(pub(o.file), c.spans, pub(`${rel}.wav`), tempo), render(pub(pass.file), c.spans, pub(conv), tempo)])
    const note = [c.trimmed.length ? `Cut ${c.trimmed.join(", ")}.` : "", c.missing.length ? `Not said: ${c.missing.join(" ")}.` : "", tempo !== 1 ? `Played ${tempo}x as a speed-read.` : ""].filter(Boolean).join(" ")
    out.push({ id: pid, n: c.line.n, who: c.line.who, text: c.line.text, file: `${rel}.wav`, duration: round(c.spans.reduce((t, [s, e]) => t + e - s, 0) / tempo), by: o.by, at, scene: o.sceneId, converted: { ...pass, file: conv }, ...(note ? { note } : {}) })
  }
  const real = out.filter((p) => o.real(p.who))
  ;(await scores(real.map((p) => pub(p.converted!.file)))).forEach((m, i) => (real[i].converted!.match = m))
  return out
}

/** Scene mode: save the whole recording, convert it in one pass per role performed (the same voice in every line of a
 *  role), cut the performed lines by their words, pick those takes, and build a new read from the picks.
 *  `who` is the role performed against the others as cues, or "all": the performer read every part. */
export async function performScene(o: { slug?: string; who: string; take: Id; audio: Uint8Array; ext: string; events: SceneEvent[]; by: string }) {
  const pr = (await load(o.slug)).process
  const v = pr?.voice
  const base = v?.takes.find((t) => t.id === o.take)
  if (!v || !base) throw new Error(`no read ${o.take}`)
  const reached = new Set(o.events.filter((e) => e.kind === "mine").map((e) => e.n))
  const lines = [...base.lines].sort((a, b) => a.n - b.n).filter((l) => (o.who === "all" || l.who === o.who) && reached.has(l.n))
  const roles = [...new Set(lines.map((l) => l.who))]
  if (!roles.length) throw new Error("none of your lines were recorded")
  const targets = new Map(roles.map((w) => [w, targetVoice(v, w)]))
  const uncast = roles.filter((w) => !targets.get(w))
  if (uncast.length) throw new Error(`cast a voice for ${uncast.join(", ")} first`)
  const film = filmOf(o.slug)
  const id = `s${Date.now().toString(36)}`
  const file = await saveWav(o.audio, o.ext, `generated/${film}/voice/scene/${id}-${o.who}`)
  const at = stamp()
  // One pass of the whole recording per role, so every line of a role comes out of the same conversion.
  const passes = new Map<string, Conversion>()
  const [, said] = await Promise.all([
    Promise.all(
      roles.map(async (w) => {
        const t = targets.get(w)!
        const whole = file.replace(/\.wav$/, `-${safe(t.voice)}.mp3`)
        passes.set(w, { file: whole, model: "ElevenLabs Voice Changer", provider: "ElevenLabs", voice: t.voice, voiceId: t.voiceId, job: await sts(pub(file), t, pub(whole)), at })
      }),
    ),
    wordsOf(pub(file)),
  ])
  const real = (w: string) => !!v.roles.find((r) => r.who === w)?.real
  const mine = await cutScene({ slug: o.slug, sceneId: id, file, lines, passes, said, presses: pressesOf(o.events), script: pr?.script, real, by: o.by })
  if (!mine.length) throw new Error("none of your lines had words in them")
  await mutate(
    [
      { op: "voice.scene", scene: { id, who: o.who, take: o.take, file, conversions: Object.fromEntries(passes), events: o.events, by: o.by, at }, by: o.by },
      ...mine.map((p) => ({ op: "voice.perform" as const, performance: p, by: o.by })),
      ...mine.map((p) => ({ op: "voice.keep" as const, n: p.n, id: p.id, by: o.by })),
    ],
    o.slug,
  )
  return { scene: id, performances: mine, take: await buildRead(o.slug, o.by, o.take, { fresh: true }) }
}

/** Cut an existing scene again with the current cutter: no new recording or conversion. The new cuts are picked, the
 *  scene's old cuts hidden, and a fresh read built. */
export async function recutScene(slug: string | undefined, sceneId: Id, by: string) {
  const pr = (await load(slug)).process
  const v = pr?.voice
  const sc = v?.scenes?.find((x) => x.id === sceneId)
  if (!v || !sc) throw new Error(`no scene ${sceneId}`)
  const base = v.takes.find((t) => t.id === sc.take) ?? v.takes.find((t) => t.id === v.pick)
  if (!base) throw new Error(`no read ${sc.take}`)
  const passes = new Map(Object.entries(sc.conversions ?? (sc.converted ? { [sc.who]: sc.converted } : {})))
  const reached = new Set(sc.events.filter((e) => e.kind === "mine").map((e) => e.n))
  const lines = [...base.lines].sort((a, b) => a.n - b.n).filter((l) => reached.has(l.n) && passes.has(l.who) && (sc.who === "all" || l.who === sc.who))
  const real = (w: string) => !!v.roles.find((r) => r.who === w)?.real
  const mine = await cutScene({ slug, sceneId, file: sc.file, lines, passes, said: await wordsOf(pub(sc.file)), presses: pressesOf(sc.events), script: pr?.script, real, by })
  if (!mine.length) throw new Error("no lines found in the scene")
  // The scene's own cuts are replaced; a line fixed by hand since (generated, or converted again) keeps its pick.
  const old = (v.performances ?? []).filter((p) => p.scene === sceneId && !p.removed && !p.note?.startsWith("Converted again"))
  const replace = new Set(old.map((p) => p.id))
  const picks = v.picks ?? {}
  const take = mine.filter((p) => !picks[p.n] || replace.has(picks[p.n]))
  await mutate(
    [
      ...mine.map((p) => ({ op: "voice.perform" as const, performance: p, by })),
      ...take.map((p) => ({ op: "voice.keep" as const, n: p.n, id: p.id, by })),
      ...old.map((p) => ({ op: "voice.remove" as const, id: p.id, by })),
    ],
    slug,
  )
  return { performances: mine, take: await buildRead(slug, by, undefined, { fresh: true }) }
}

/** A line read by its cast voice (Eleven v4 with the script's direction) instead of performed, for a line that needs no
 *  acting, like the disclaimer. Makes `tries` reads, keeps the one whose words match the script best (then the
 *  shortest), and plays it `tempo` times faster; a speed-read goes to broadcast-disclaimer pace by default, about 5.5
 *  words a second (1.05x to 1.35x). The read is added as a take of the line, picked, and the read rebuilt. */
export async function generateLine(slug: string | undefined, n: number, by: string, opts: { tries?: number; tempo?: number } = {}): Promise<Performance> {
  const pr = (await load(slug)).process
  const v = pr?.voice
  const take = v && (v.takes.find((t) => t.id === v.pick) ?? v.takes.at(-1))
  const line = take?.lines.find((l) => l.n === n)
  if (!v || !line) throw new Error(`no line ${n} in the read`)
  const target = targetVoice(v, line.who)
  if (!target) throw new Error(`cast a voice for ${line.who} first`)
  const how = scriptHow(pr?.script)(line)
  const text = acted({ beat: line.beat, who: line.who, text: line.text, how })
  const id = `p${Date.now().toString(36)}`
  const rel = `generated/${filmOf(slug)}/voice/perf/${pad(n)}-${line.who}-${id}`
  await fs.mkdir(path.dirname(pub(rel)), { recursive: true })
  const want = toks(line.text)
  const reads = await Promise.all(
    Array.from({ length: opts.tries ?? 3 }, async (_, k) => {
      const file = pub(`${rel}-read${k + 1}.mp3`)
      const job = await elAudio("/v1/text-to-dialogue?output_format=mp3_44100_192", { model_id: TTS_MODEL, inputs: [{ text, voice_id: target.voiceId }], seed: 1000 + k }, file)
      const at = align(want, (await words(file)).map((w) => norm(w.text)))
      const off = want.length - new Set(at.filter((x) => x >= 0)).size + at.filter((x) => x < 0).length
      return { file, job, off, secs: await seconds(file) }
    }),
  )
  const best = reads.sort((a, b) => a.off - b.off || a.secs - b.secs)[0]
  const tempo = opts.tempo ?? (speedRead(how) ? Math.min(1.35, Math.max(1.05, best.secs / (want.length / 5.5))) : 1)
  const out = `${rel}-${safe(target.voice)}.mp3`
  await exec("ffmpeg", ["-v", "error", "-y", "-i", best.file, "-af", `atempo=${tempo.toFixed(3)}`, "-c:a", "libmp3lame", "-b:a", "192k", pub(out)], { env })
  const at = stamp()
  const perf: Performance = {
    id,
    n,
    who: line.who,
    text: line.text,
    file: out,
    duration: round(await seconds(pub(out))),
    by,
    at,
    converted: { file: out, model: `${TTS_MODEL} (text to dialogue)`, provider: "ElevenLabs", voice: target.voice, voiceId: target.voiceId, job: best.job, at },
    note: `Generated, not performed: the best of ${reads.length} reads (${best.off} ${best.off === 1 ? "word" : "words"} off the script)${tempo > 1.001 ? `, played ${tempo.toFixed(2)}x` : ""}.`,
  }
  await mutate([{ op: "voice.perform", performance: perf, by }, { op: "voice.keep", n, id, by }], slug)
  await buildRead(slug, by)
  return perf
}

/** What a clip says, as normalized words (ElevenLabs Scribe, the clip heard on its own, with no context to help). */
const heardIn = async (file: string) => (await words(file)).map((w) => norm(w.text))
/** How many words two transcripts disagree on (each missing or extra word counts one). */
function differ(a: string[], b: string[]) {
  const at = align(a, b)
  return a.length - new Set(at.filter((x) => x >= 0)).size + at.filter((x) => x < 0).length
}

/** Convert a performed take again from its own recording, best of `tries`, for a conversion that mangled a word
 *  ("ministries" came out as "monasteries"). Each try uses another seed and alternates the stability setting; each is
 *  heard on its own, and the one that says what the performer said wins (then the closest to the real voice). The
 *  winner is a new take of the line, picked; the read is rebuilt unless `rebuild` is false. */
export async function reconvert(slug: string | undefined, id: Id, by: string, opts: { tries?: number; rebuild?: boolean } = {}): Promise<Performance> {
  const v = (await load(slug)).process?.voice
  const perf = v?.performances?.find((x) => x.id === id)
  if (!v || !perf) throw new Error(`no performance ${id}`)
  if (perf.converted?.file === perf.file) throw new Error("a generated take has no recording to convert again: generate the line instead")
  const target = targetVoice(v, perf.who)
  if (!target) throw new Error(`cast a voice for ${perf.who} first`)
  const want = await heardIn(pub(perf.file))
  const nid = `p${Date.now().toString(36)}`
  const rel = `generated/${filmOf(slug)}/voice/perf/${pad(perf.n)}-${perf.who}-${nid}`
  const tries = await Promise.all(
    Array.from({ length: opts.tries ?? 4 }, async (_, k) => {
      const out = pub(`${rel}-try${k + 1}.mp3`)
      const job = await sts(pub(perf.file), target, out, { seed: 11 + k, settings: k % 2 ? { stability: 0.65, similarity_boost: 0.8 } : SETTINGS })
      return { out, job, off: differ(want, await heardIn(out)) }
    }),
  )
  const real = !!v.roles.find((r) => r.who === perf.who)?.real
  const ms = real ? await scores(tries.map((t) => t.out)) : tries.map(() => undefined)
  const best = tries.map((t, i) => ({ ...t, match: ms[i] })).sort((a, b) => a.off - b.off || (b.match ?? 0) - (a.match ?? 0))[0]
  const conv = `${rel}-${safe(target.voice)}.mp3`
  await fs.copyFile(best.out, pub(conv))
  const at = stamp()
  const next: Performance = {
    ...perf,
    id: nid,
    by,
    at,
    error: undefined,
    converted: { file: conv, model: "ElevenLabs Voice Changer", provider: "ElevenLabs", voice: target.voice, voiceId: target.voiceId, job: best.job, match: best.match, at },
    note: `Converted again from the same recording: the best of ${tries.length} tries (${best.off === 0 ? "says exactly what was performed" : `${best.off} ${best.off === 1 ? "word" : "words"} off what was performed`}).`,
  }
  await mutate([{ op: "voice.perform", performance: next, by }, { op: "voice.keep", n: perf.n, id: nid, by }], slug)
  if (opts.rebuild !== false) await buildRead(slug, by)
  return next
}

/** Check every picked, performed line: hear the recording and its conversion each on its own, and convert again any
 *  line whose conversion says other words than the performer did. Rebuilds the read once at the end. */
export async function checkConversions(slug: string | undefined, by: string, opts: { tries?: number } = {}) {
  const v = (await load(slug)).process?.voice
  if (!v) throw new Error("no voice stage")
  const picked = Object.values(v.picks ?? {})
    .map((id) => v.performances?.find((p) => p.id === id && !p.removed && p.converted && p.converted.file !== p.file))
    .filter((p): p is Performance => !!p)
  const checked = await Promise.all(picked.map(async (p) => ({ p, said: await heardIn(pub(p.file)), got: await heardIn(pub(p.converted!.file)) })))
  const bad = checked.filter((c) => differ(c.said, c.got) > 0)
  const fixed: { n: number; was: string; now: Performance }[] = []
  for (const c of bad) fixed.push({ n: c.p.n, was: c.got.join(" "), now: await reconvert(slug, c.p.id, by, { tries: opts.tries, rebuild: false }) })
  if (fixed.length) await buildRead(slug, by)
  return { checked: checked.length, fixed, said: Object.fromEntries(bad.map((c) => [c.p.n, c.said.join(" ")])) }
}

/** The 1994 sound: an antenna broadcast heard on a tube TV, the same on every voice. The set's small speaker passes
 *  about 160 Hz to 6.5 kHz with a nasal resonance near 1.8 kHz; its amplifier compresses and saturates a little; the
 *  antenna adds a faint hiss that slowly fades in and out under everything, so there is no digital silence between
 *  lines. Then a fixed gain into a true-peak limiter lands the read near -14 LUFS (web), peaks under -1 dBTP. */
export const TUBE_TV = "highpass=f=160,highpass=f=160,lowpass=f=6500,lowpass=f=6500,equalizer=f=350:t=q:w=1:g=-2,equalizer=f=1800:t=q:w=1.2:g=3.5,acompressor=threshold=-24dB:ratio=4:attack=4:release=120:makeup=3,volume=4dB,asoftclip=type=tanh,volume=-4dB"
const antenna = (secs: number) => `anoisesrc=d=${secs.toFixed(2)}:c=white:a=0.02:r=48000,highpass=f=300,lowpass=f=6000,tremolo=f=0.25:d=0.25,volume=-12dB`

/** Master the picked read (or `take`) to an MP3 to share, with the tube-TV sound, at -14 LUFS into a limiter. */
export async function masterRead(slug: string | undefined, out: string, take?: Id) {
  const v = (await load(slug)).process?.voice
  const t = v && (v.takes.find((x) => x.id === (take ?? v.pick)) ?? v.takes.at(-1))
  if (!t) throw new Error("no read to master")
  const graph = (after: string) => `[0:a]aresample=48000,${TUBE_TV}[v];${antenna(t.duration + 1)}[n];[v][n]amix=inputs=2:normalize=0:duration=first${after}`
  const probe = await exec("ffmpeg", ["-hide_banner", "-nostats", "-i", pub(t.file), "-filter_complex", graph(",ebur128"), "-f", "null", "-"], { env, maxBuffer: 1 << 24 })
  const before = Number(probe.stderr.match(/I:\s+(-?[\d.]+) LUFS\s*\n\s*Threshold/)?.[1] ?? -20)
  const gain = -14 - before
  await exec("ffmpeg", ["-v", "error", "-y", "-i", pub(t.file), "-filter_complex", graph(`,volume=${gain.toFixed(2)}dB,alimiter=limit=0.84:attack=3:release=60:level=false`), "-ar", "44100", "-ac", "1", "-c:a", "libmp3lame", "-b:a", "192k", out], { env })
  return { take: t.id, out, gain: round(gain) }
}

/** The silence before a line in a built read, from the script: an interruption cuts straight in, "after a beat" holds
 *  0.9 s, a new beat (a new shot) 0.55 s, the real person answering someone 0.5 s, either side of a speed-read card
 *  0.6 s, and an audience reaction written into the beat before gets 0.3 s more room. */
function gapBefore(prev: VoiceLine | undefined, cur: VoiceLine, how: (l: VoiceLine) => string | undefined, sound: (beat: Id) => string | undefined, real: (who: string) => boolean) {
  if (!prev) return 0
  if (/[-–—]\s*$/.test(prev.text)) return 0.02
  if (/after a beat/i.test(how(cur) ?? "")) return 0.9
  let g = prev.beat !== cur.beat ? 0.55 : prev.who === cur.who ? 0.35 : 0.3
  if (real(cur.who) && prev.who !== cur.who) g = Math.max(g, 0.5)
  if (speedRead(how(cur)) || speedRead(how(prev))) g = Math.max(g, 0.6)
  if (prev.beat !== cur.beat && /applause|o{3,}h|wow/i.test(sound(prev.beat) ?? "")) g += 0.3
  return round(g)
}

/** A read built from the picks: every line of the base read in order, the picked take in place of a line when there
 *  is one, a picked line after the silence it was performed with (`lead`), every other gap as in the base read.
 *  A built base is rebuilt in place (one working read that follows the picks); `fresh` always makes a new read. */
export async function buildRead(slug: string | undefined, by: string, baseId?: Id, opts: { fresh?: boolean } = {}): Promise<VoiceTake> {
  const pr = (await load(slug)).process
  const v = pr?.voice
  const base = v && (v.takes.find((t) => t.id === (baseId ?? v.pick)) ?? v.takes.at(-1))
  if (!v || !base) throw new Error("no read to build on")
  const how = scriptHow(pr?.script)
  const sound = (b: Id) => pr?.script.beats.find((x) => x.id === b)?.sound
  const real = (w: string) => !!v.roles.find((r) => r.who === w)?.real
  const picked = new Map<number, Performance>()
  for (const [n, pid] of Object.entries(v.picks ?? {})) {
    const p = v.performances?.find((x) => x.id === pid && !x.removed && x.converted)
    if (p) picked.set(Number(n), p)
  }
  const built = base.built || base.model.startsWith("Performed lines")
  const id = built && !opts.fresh ? base.id : String(Math.max(0, ...v.takes.map((t) => Number(t.id) || 0)) + 1)
  const dir = `generated/${filmOf(slug)}/voice/read-${id}`
  await fs.mkdir(pub(dir), { recursive: true })
  const ordered = [...base.lines].sort((a, b) => a.n - b.n)
  const parts: string[] = []
  const lines: VoiceLine[] = []
  let t = 0
  let pops = 0
  for (const [i, l] of ordered.entries()) {
    const p = picked.get(l.n)
    const gap = gapBefore(ordered[i - 1], l, how, sound, real)
    if (gap > 0) {
      const sil = pub(`${dir}/${pad(l.n)}-gap.wav`)
      await exec("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=mono", "-t", gap.toFixed(3), "-c:a", "pcm_s16le", sil], { env })
      parts.push(sil)
      t += gap
    }
    const src = p ? p.converted!.file : l.file
    const seg = pub(`${dir}/${pad(l.n)}.wav`)
    // Silence trimmed off both ends (the script sets the gaps), and every line to the same loudness, so takes recorded
    // at different levels and moments read as one session.
    const edges = "silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.06,areverse,silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.12,areverse"
    await exec("ffmpeg", ["-v", "error", "-y", "-i", pub(src), "-vn", "-af", `${edges},loudnorm=I=-18:TP=-1.5:LRA=11`, "-ac", "1", "-ar", "48000", "-c:a", "pcm_s16le", seg], { env })
    pops += await depop(seg)
    const d = await seconds(seg)
    parts.push(seg)
    lines.push({ n: l.n, beat: l.beat, who: l.who, text: l.text, start: round(t), end: round(t + d), file: src, match: p ? p.converted!.match : l.match })
    t += d
  }
  const list = pub(`${dir}/parts.txt`)
  await fs.writeFile(list, parts.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join("\n"))
  const file = `${dir}/read.m4a`
  await exec("ffmpeg", ["-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", list, "-c:a", "aac", "-b:a", "192k", pub(file)], { env })
  const who = [...new Set([...picked.values()].map((p) => p.who))]
  const take: VoiceTake = {
    id,
    file,
    model: `Performed lines through the ElevenLabs Voice Changer; the rest from read ${base.id}`,
    provider: "ElevenLabs",
    cast: { ...base.cast, ...Object.fromEntries(who.map((w) => [w, `performed by ${by}`])) },
    duration: round(t),
    lines,
    note: `${picked.size} performed ${picked.size === 1 ? "line" : "lines"} (${who.join(", ") || "none"}), every other line as in read ${base.id}; gaps paced by the script's beats${pops ? `; ${pops} ${pops === 1 ? "pop" : "pops"} dipped` : ""}.`,
    at: stamp(),
    built: true,
  }
  await mutate([{ op: "voice.read", take, pick: true, by }], slug)
  return take
}
