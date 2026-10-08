// Server and CLI only. Stage 04's recorder: a person performs a line into the app, the take is saved as recorded
// (a WAV under public/generated/<film>/voice/perf/), then converted to the role's voice with the ElevenLabs voice
// changer. Speech-to-speech keeps the performer's timing, melody and accent and swaps the timbre. Henrick converts to
// the clone of his real lines, so nothing is trained; every other role converts to the voice cast for it.
// The recorder (POST /api/perform) and the CLI (`stitch voice perform`) both call these; every write is voice.perform.

import { execFile } from "node:child_process"
import { existsSync, promises as fs } from "node:fs"
import path from "node:path"
import { promisify } from "node:util"
import { API, key } from "../scripts/eleven"
import type { Performance, Voice } from "./process"
import { load, mutate, projectRoot } from "./store"

const exec = promisify(execFile)
// The dev server may start with a bare PATH; ffmpeg (here and inside voice-score.py) lives in Homebrew.
const env = { ...process.env, PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH ?? ""}` }

/** The only ElevenLabs voice changer models are v2 (checked 2026-10-08): v3 and v4 are text to speech only. */
export const STS_MODEL = "eleven_multilingual_sts_v2"
const SETTINGS = { stability: 0.5, similarity_boost: 0.9 }

/** The voice a role's performances convert to: a real person's clone, else the voice cast for the role. */
export function targetVoice(v: Voice, who: string): { voice: string; voiceId: string } | undefined {
  const role = v.roles.find((r) => r.who === who)
  if (!role) return undefined
  const a = role.real ? role.auditions.find((x) => x.source === "clone" && x.voiceId) : role.auditions.find((x) => x.voice === role.voice && x.voiceId)
  return a?.voiceId ? { voice: a.voice, voiceId: a.voiceId } : undefined
}

const pub = (rel: string) => path.join(projectRoot(), "public", rel)
const safe = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")

/** Save a recorded line as its performance (48 kHz mono WAV, no processing), then convert it to the role's voice. */
export async function perform(o: { slug?: string; n: number; audio: Uint8Array; ext: string; by: string }): Promise<Performance> {
  const v = (await load(o.slug)).process?.voice
  const take = v ? (v.takes.find((t) => t.id === v.pick) ?? v.takes.at(-1)) : undefined
  const line = take?.lines.find((l) => l.n === o.n)
  if (!line) throw new Error(`no line ${o.n} in the read`)
  const film = o.slug || process.env.STITCH_PROJECT || "ministry"
  const id = `p${Date.now().toString(36)}`
  const rel = `generated/${film}/voice/perf/${String(o.n).padStart(2, "0")}-${line.who}-${id}`
  const raw = pub(`${rel}.in.${safe(o.ext) || "webm"}`)
  await fs.mkdir(path.dirname(raw), { recursive: true })
  await fs.writeFile(raw, o.audio)
  try {
    await exec("ffmpeg", ["-v", "error", "-y", "-i", raw, "-vn", "-ac", "1", "-ar", "48000", "-c:a", "pcm_s16le", pub(`${rel}.wav`)], { env })
  } finally {
    await fs.rm(raw, { force: true })
  }
  const probe = await exec("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", pub(`${rel}.wav`)], { env })
  const perf: Performance = { id, n: o.n, who: line.who, text: line.text, file: `${rel}.wav`, duration: Number(probe.stdout.trim()) || undefined, by: o.by, at: new Date().toISOString() }
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
      const form = new FormData()
      form.append("audio", new Blob([new Uint8Array(await fs.readFile(pub(perf.file)))], { type: "audio/wav" }), path.basename(perf.file))
      form.append("model_id", STS_MODEL)
      form.append("voice_settings", JSON.stringify(SETTINGS))
      const res = await fetch(`${API}/v1/speech-to-speech/${target.voiceId}?output_format=mp3_44100_192`, { method: "POST", headers: { "xi-api-key": key() }, body: form, signal: AbortSignal.timeout(120_000) })
      if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${(await res.text()).slice(0, 300)}`)
      const rel = perf.file.replace(/\.wav$/, `-${safe(target.voice)}.mp3`)
      await fs.writeFile(pub(rel), new Uint8Array(await res.arrayBuffer()))
      const real = v.roles.find((r) => r.who === perf.who)?.real
      next = { ...perf, error: undefined, converted: { file: rel, model: "ElevenLabs Voice Changer", provider: "ElevenLabs", voice: target.voice, voiceId: target.voiceId, job: res.headers.get("request-id") ?? undefined, match: real ? await score(pub(rel)) : undefined, at: new Date().toISOString() } }
    } catch (e) {
      next = { ...perf, error: (e as Error).message }
    }
  }
  await mutate([{ op: "voice.perform", performance: next, by: "claude" }], slug)
  return next
}

/** Speaker similarity to his real recording (scripts/voice-score.py), when the scorer's venv is on this machine. */
async function score(file: string): Promise<number | undefined> {
  const py = path.join(projectRoot(), "work/venv/bin/python")
  if (!existsSync(py)) return undefined
  const r = await exec(py, [path.join(projectRoot(), "scripts/voice-score.py"), file], { env }).catch(() => null)
  const m = r?.stdout.match(/voice ([0-9.]+)/)
  return m ? Number(m[1]) : undefined
}
