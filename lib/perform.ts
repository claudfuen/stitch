// Server and CLI only. Stage 04's recorder: a person performs lines into the app, the takes are saved as recorded
// (WAV under public/generated/<film>/voice/), then converted to the role's voice with the ElevenLabs voice changer.
// Speech-to-speech keeps the performer's timing, melody and accent and swaps the timbre. Henrick converts to the clone
// of his real lines, so nothing is trained; every other role converts to the voice cast for it.
//
// Two ways in: one line at a time (perform), or scene mode (performScene): the whole read in one continuous
// recording against the other roles' lines as cues, converted in one pass so the voice stays the same from line to
// line, then cut into lines at their first and last words. buildRead turns the picked takes into a new read.
// The recorder (POST /api/perform, /api/perform/scene) and the CLI (`stitch voice ...`) call these; every write is an op.

import { execFile } from "node:child_process"
import { existsSync, promises as fs } from "node:fs"
import path from "node:path"
import { promisify } from "node:util"
import { API, key } from "../scripts/eleven"
import type { Id } from "./model"
import type { Performance, SceneEvent, Voice, VoiceLine, VoiceTake } from "./process"
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

/** One voice changer call: a WAV in, the same performance in the target voice out (MP3). Returns the request id. */
async function sts(src: string, target: { voiceId: string }, out: string): Promise<string | undefined> {
  const form = new FormData()
  form.append("audio", new Blob([new Uint8Array(await fs.readFile(src))], { type: "audio/wav" }), path.basename(src))
  form.append("model_id", STS_MODEL)
  form.append("voice_settings", JSON.stringify(SETTINGS))
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

/** Cut [s, e] seconds of a file into a WAV or an MP3 (by the output's extension). */
const cut = (src: string, s: number, e: number, out: string) =>
  exec("ffmpeg", ["-v", "error", "-y", "-ss", s.toFixed(3), "-t", (e - s).toFixed(3), "-i", src, "-ac", "1", ...(out.endsWith(".mp3") ? ["-c:a", "libmp3lame", "-b:a", "192k"] : ["-ar", "48000", "-c:a", "pcm_s16le"]), out], { env })

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

/** Save a recorded line as its performance, then convert it to the role's voice. */
export async function perform(o: { slug?: string; n: number; audio: Uint8Array; ext: string; by: string }): Promise<Performance> {
  const v = (await load(o.slug)).process?.voice
  const take = v ? (v.takes.find((t) => t.id === v.pick) ?? v.takes.at(-1)) : undefined
  const line = take?.lines.find((l) => l.n === o.n)
  if (!line) throw new Error(`no line ${o.n} in the read`)
  const id = `p${Date.now().toString(36)}`
  const file = await saveWav(o.audio, o.ext, `generated/${filmOf(o.slug)}/voice/perf/${pad(o.n)}-${line.who}-${id}`)
  const perf: Performance = { id, n: o.n, who: line.who, text: line.text, file, duration: (await seconds(pub(file))) || undefined, by: o.by, at: stamp() }
  await mutate([{ op: "voice.perform", performance: perf, by: o.by }], o.slug)
  return convert(o.slug, id)
}

/** Convert a saved performance to its role's voice (again, after a recast or a failed call). */
export async function convert(slug: string | undefined, id: string): Promise<Performance> {
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
      const real = v.roles.find((r) => r.who === perf.who)?.real
      next = { ...perf, error: undefined, converted: { file: rel, model: "ElevenLabs Voice Changer", provider: "ElevenLabs", voice: target.voice, voiceId: target.voiceId, job, match: real ? (await scores([pub(rel)]))[0] : undefined, at: stamp() } }
    } catch (e) {
      next = { ...perf, error: (e as Error).message }
    }
  }
  await mutate([{ op: "voice.perform", performance: next, by: "claude" }], slug)
  return next
}

/** Scene mode: save the whole recording, convert it in one pass (the same voice in every line), cut each of the
 *  performer's lines at its first and last word, pick those takes, and build a new read from the picks. */
export async function performScene(o: { slug?: string; who: string; take: Id; audio: Uint8Array; ext: string; events: SceneEvent[]; by: string }) {
  const v = (await load(o.slug)).process?.voice
  const base = v?.takes.find((t) => t.id === o.take)
  if (!v || !base) throw new Error(`no read ${o.take}`)
  const target = targetVoice(v, o.who)
  if (!target) throw new Error(`cast a voice for ${o.who} first`)
  const film = filmOf(o.slug)
  const id = `s${Date.now().toString(36)}`
  const file = await saveWav(o.audio, o.ext, `generated/${film}/voice/scene/${id}-${o.who}`)
  const whole = file.replace(/\.wav$/, `-${safe(target.voice)}.mp3`)
  const [job, said] = await Promise.all([sts(pub(file), target, pub(whole)), words(pub(file)), fs.mkdir(pub(`generated/${film}/voice/perf`), { recursive: true })])
  const at = stamp()
  const mine: Performance[] = []
  let prev = 0
  for (const ev of [...o.events].sort((a, b) => a.start - b.start)) {
    const line = base.lines.find((l) => l.n === ev.n)
    // Words that start inside the line's window: from when it was shown (a cue's tail cannot leak in) to just after done.
    const w = ev.kind === "mine" && line?.who === o.who ? said.filter((x) => x.start > ev.start - 0.15 && x.start < ev.end + 0.2) : []
    if (!line || !w.length) {
      prev = ev.end
      continue
    }
    const s = Math.max(0, w[0].start - 0.08)
    const e = w[w.length - 1].end + 0.2
    const pid = `p${Date.now().toString(36)}${mine.length}`
    const rel = `generated/${film}/voice/perf/${pad(line.n)}-${o.who}-${pid}`
    const conv = `${rel}-${safe(target.voice)}.mp3`
    await Promise.all([cut(pub(file), s, e, pub(`${rel}.wav`)), cut(pub(whole), s, e, pub(conv))])
    mine.push({ id: pid, n: line.n, who: o.who, text: line.text, file: `${rel}.wav`, duration: round(e - s), by: o.by, at, scene: id, lead: round(Math.min(1.5, Math.max(0.12, s - prev))), converted: { file: conv, model: "ElevenLabs Voice Changer", provider: "ElevenLabs", voice: target.voice, voiceId: target.voiceId, job, at } })
    prev = e
  }
  if (!mine.length) throw new Error("none of your lines had words in them")
  if (v.roles.find((r) => r.who === o.who)?.real) (await scores(mine.map((p) => pub(p.converted!.file)))).forEach((m, i) => (mine[i].converted!.match = m))
  await mutate(
    [
      { op: "voice.scene", scene: { id, who: o.who, take: o.take, file, converted: { file: whole, model: "ElevenLabs Voice Changer", provider: "ElevenLabs", voice: target.voice, voiceId: target.voiceId, job, at }, events: o.events, by: o.by, at }, by: o.by },
      ...mine.map((p) => ({ op: "voice.perform" as const, performance: p, by: o.by })),
      ...mine.map((p) => ({ op: "voice.keep" as const, n: p.n, id: p.id, by: o.by })),
    ],
    o.slug,
  )
  return { scene: id, performances: mine, take: await buildRead(o.slug, o.by, o.take) }
}

/** A read built from the picks: every line of the base read in order, the picked take in place of a line when there
 *  is one, a picked line after the silence it was performed with (`lead`), every other gap as in the base read. */
export async function buildRead(slug: string | undefined, by: string, baseId?: Id): Promise<VoiceTake> {
  const v = (await load(slug)).process?.voice
  const base = v && (v.takes.find((t) => t.id === (baseId ?? v.pick)) ?? v.takes.at(-1))
  if (!v || !base) throw new Error("no read to build on")
  const picked = new Map<number, Performance>()
  for (const [n, pid] of Object.entries(v.picks ?? {})) {
    const p = v.performances?.find((x) => x.id === pid && !x.removed && x.converted)
    if (p) picked.set(Number(n), p)
  }
  const id = String(Math.max(0, ...v.takes.map((t) => Number(t.id) || 0)) + 1)
  const dir = `generated/${filmOf(slug)}/voice/read-${id}`
  await fs.mkdir(pub(dir), { recursive: true })
  const ordered = [...base.lines].sort((a, b) => a.n - b.n)
  const parts: string[] = []
  const lines: VoiceLine[] = []
  let t = 0
  for (const [i, l] of ordered.entries()) {
    const p = picked.get(l.n)
    const gap = i === 0 ? 0 : Math.min(1.5, Math.max(0.1, p?.lead ?? l.start - ordered[i - 1].end))
    if (gap > 0) {
      const sil = pub(`${dir}/${pad(l.n)}-gap.wav`)
      await exec("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=mono", "-t", gap.toFixed(3), "-c:a", "pcm_s16le", sil], { env })
      parts.push(sil)
      t += gap
    }
    const src = p ? p.converted!.file : l.file
    const seg = pub(`${dir}/${pad(l.n)}.wav`)
    // Every line to the same loudness, so takes recorded at different levels read as one session.
    await exec("ffmpeg", ["-v", "error", "-y", "-i", pub(src), "-vn", "-af", "loudnorm=I=-18:TP=-1.5:LRA=11", "-ac", "1", "-ar", "48000", "-c:a", "pcm_s16le", seg], { env })
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
    note: `${picked.size} performed ${picked.size === 1 ? "line" : "lines"} (${who.join(", ") || "none"}), each after the silence it was performed with; every other line and gap as in read ${base.id}.`,
    at: stamp(),
  }
  await mutate([{ op: "voice.read", take, pick: true, by }], slug)
  return take
}
