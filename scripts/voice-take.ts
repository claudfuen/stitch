#!/usr/bin/env bun
// Stage 04: the whole film's dialogue performed in ONE take, then split into lines and tracks, with Henrick's lines
// converted to his real voice.
//
//   bun run voice-take <film> <take> --cast brock=Brian,kyle=Liam,gerald=Bill,henrick=Daniel,narrator=Eric
//        [--seed 101] [--stability 0.5] [--no-convert]
//
// Why one take: on The Ministry (2026-10-06) every line read in the context of the conversation acted far better
// than lines generated one at a time (questions rose, the deadpan stayed deadpan). ElevenLabs v3 Text to Dialogue
// acts best but only with stock voices, so Henrick's track is converted afterwards (speech to speech, Chatterbox HD,
// target = his real recording) and scored with scripts/voice-score.py against that recording.
//
// Writes work/<film>/voice/<take>/: full-take.mp3 (as performed), full-take-henrick.wav (Henrick converted),
// lines/NN-<who>.wav, track-<who>.wav (the full timeline with only that speaker audible), lines.json (times,
// text, scores) and a provenance sidecar for every file (provider, model, request ID, the input that ran).
// Leap carries ElevenLabs v3 but not its dialogue mode, custom voices or voice conversion to a sample, so this
// runs on fal with the Keychain key (FAL_KEY).
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

const argv = process.argv.slice(2)
const flag = (k: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined }
const [film, take] = argv
if (!film || !take) throw new Error("usage: voice-take <film> <take> --cast who=Voice,...")
const dir = `work/${film}/voice/${take}`
mkdirSync(`${dir}/lines`, { recursive: true })
const cast = Object.fromEntries((flag("cast") ?? "").split(",").filter(Boolean).map((p) => p.split("=").map((s) => s.trim()))) as Record<string, string>
const DIALOGUE = "fal-ai/elevenlabs/text-to-dialogue/eleven-v3"
const STT = "fal-ai/elevenlabs/speech-to-text/scribe-v2"
const S2S = "resemble-ai/chatterboxhd/speech-to-speech"
const HENRICK_REF = "public/audio/voice/henrick-reference.mp3"

// ---------- fal ----------
function key() {
  if (process.env.FAL_KEY?.trim()) return process.env.FAL_KEY.trim()
  const r = spawnSync("security", ["find-generic-password", "-s", "FAL_KEY", "-w"], { encoding: "utf8" })
  if (r.status !== 0 || !r.stdout.trim()) throw new Error("No fal key (Keychain service FAL_KEY)")
  return (process.env.FAL_KEY = r.stdout.trim())
}
async function fal(url: string, init: RequestInit = {}) {
  const res = await fetch(url, { ...init, headers: { authorization: `Key ${key()}`, "content-type": "application/json", ...init.headers }, signal: AbortSignal.timeout(180_000) })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`fal ${res.status} ${url}: ${JSON.stringify(body).slice(0, 400)}`)
  return body
}
async function run(endpoint: string, input: Record<string, unknown>) {
  const sub = await fal(`https://queue.fal.run/${endpoint}`, { method: "POST", body: JSON.stringify(input) })
  const base = `https://queue.fal.run/${endpoint.split("/").slice(0, 2).join("/")}/requests/${sub.request_id}`
  for (let i = 0; i < 300; i++) {
    const st = await fal(`${base}/status`)
    if (st.status === "COMPLETED") return { id: sub.request_id as string, out: await fal(base) }
    if (st.status === "FAILED" || st.error) throw new Error(`${endpoint} ${sub.request_id} failed: ${JSON.stringify(st).slice(0, 300)}`)
    await new Promise((r) => setTimeout(r, 1500))
  }
  throw new Error(`${endpoint} timed out`)
}
const dataUri = (file: string) => `data:${file.endsWith(".wav") ? "audio/wav" : "audio/mpeg"};base64,${readFileSync(file).toString("base64")}`
async function download(url: string, file: string) { writeFileSync(file, new Uint8Array(await (await fetch(url)).arrayBuffer())) }
const sidecar = (file: string, model: string, endpoint: string, id: string, input: unknown) =>
  writeFileSync(`${file}.json`, JSON.stringify({ provider: "fal", model, endpoint, request_id: id, input, at: new Date().toISOString() }, null, 1))
const sh = (cmd: string, args: string[]) => { const r = spawnSync(cmd, args, { encoding: "utf8" }); if (r.status !== 0) throw new Error(`${cmd} failed: ${r.stderr.slice(0, 300)}`); return r.stdout }
const duration = (f: string) => Number(sh("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).trim())

// ---------- the script, as acting text ----------
type Line = { beat: string; who: string; text: string; how?: string }
const project = JSON.parse(readFileSync(`data/projects/${film}.json`, "utf8"))
const lines: Line[] = project.process.script.beats.flatMap((b: { id: string; lines?: { who: string; text: string; how?: string }[] }) =>
  (b.lines ?? []).map((l) => ({ beat: b.id, who: l.who.toLowerCase(), text: l.text, how: l.how })))
// ElevenLabs v3 reads bracketed audio tags as direction. Each character's standing direction plus the line's own.
const STANDING: Record<string, string> = { brock: "[excited]", henrick: "[flat]", gerald: "[dry]", kyle: "", narrator: "[very fast]" }
const HOW: Record<string, string> = { flat: "[deadpan]", "to camera": "[desperate]", "after a beat": "[pause]", "speed-read": "[rushed]", "off screen, not looking": "[flat]" }
const acted = (l: Line) => [l.how && HOW[l.how], STANDING[l.who], /[A-Z]{3,}/.test(l.text) && l.who === "brock" ? "[shouting]" : ""].filter(Boolean).join(" ") + " " + l.text

async function main() {
  const missing = [...new Set(lines.map((l) => l.who))].filter((w) => !cast[w])
  if (missing.length) throw new Error(`no voice for: ${missing.join(", ")} (--cast who=Voice)`)
  // 1. The whole film in one take.
  const input = { inputs: lines.map((l) => ({ voice: cast[l.who], text: acted(l).trim() })), stability: Number(flag("stability") ?? 0.5), seed: Number(flag("seed") ?? 101) }
  const full = `${dir}/full-take.mp3`
  if (!existsSync(full)) {
    const r = await run(DIALOGUE, input)
    await download(r.out.audio.url, full)
    sidecar(full, "ElevenLabs v3 Text to Dialogue", DIALOGUE, r.id, { ...input, cast })
    console.log(`take: ${full} (${duration(full).toFixed(1)} s)`)
  }
  // 2. Where each line landed: word timings from speech to text, aligned to the script in order.
  const sttFile = `${dir}/stt.json`
  if (!existsSync(sttFile)) {
    const r = await run(STT, { audio_url: dataUri(full), language_code: "en" })
    writeFileSync(sttFile, JSON.stringify({ request_id: r.id, ...r.out }, null, 1))
  }
  const stt = JSON.parse(readFileSync(sttFile, "utf8")) as { text: string; words: { text: string; start: number; end: number; type?: string }[] }
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9']/g, "")
  const heard = stt.words.filter((w) => (w.type ?? "word") === "word" && norm(w.text))
  const want = lines.flatMap((l, i) => l.text.split(/\s+/).map(norm).filter(Boolean).map((t) => ({ t, i })))
  // Greedy in-order match: each script token takes the next heard token that equals it within a short window.
  const span: { start: number; end: number }[] = lines.map(() => ({ start: Infinity, end: -Infinity }))
  let h = 0
  for (const w of want) {
    for (let k = h; k < Math.min(h + 6, heard.length); k++) {
      if (norm(heard[k].text) === w.t) { span[w.i].start = Math.min(span[w.i].start, heard[k].start); span[w.i].end = Math.max(span[w.i].end, heard[k].end); h = k + 1; break }
    }
  }
  const total = duration(full)
  for (let i = 0; i < lines.length; i++) if (!Number.isFinite(span[i].start)) span[i] = { start: i ? span[i - 1].end : 0, end: i ? span[i - 1].end : 0 }
  const matched = Math.round((lines.filter((_, i) => span[i].end > span[i].start).length / lines.length) * 100)
  // 3. Cut each line (with a little air, never into the neighbour) and build one track per speaker.
  const out: Record<string, unknown>[] = []
  for (let i = 0; i < lines.length; i++) {
    const a = Math.max(0, span[i].start - 0.06, i ? span[i - 1].end : 0)
    const b = Math.min(total, span[i].end + 0.12, i < lines.length - 1 && Number.isFinite(span[i + 1].start) ? span[i + 1].start : total)
    const file = `${dir}/lines/${String(i + 1).padStart(2, "0")}-${lines[i].who}.wav`
    sh("ffmpeg", ["-v", "error", "-y", "-i", full, "-ss", a.toFixed(3), "-to", b.toFixed(3), "-ar", "44100", "-ac", "1", file])
    out.push({ n: i + 1, beat: lines[i].beat, who: lines[i].who, voice: cast[lines[i].who], text: lines[i].text, acted: acted(lines[i]).trim(), start: +a.toFixed(3), end: +b.toFixed(3), file })
  }
  for (const who of new Set(lines.map((l) => l.who))) {
    const on = out.filter((l) => l.who === who).map((l) => `between(t,${l.start},${l.end})`).join("+")
    sh("ffmpeg", ["-v", "error", "-y", "-i", full, "-af", `volume=0:enable='not(${on})'`, "-ar", "44100", `${dir}/track-${who}.wav`])
  }
  // 4. Henrick in his own voice: each of his lines converted, then laid back into the take at the same time.
  if (!argv.includes("--no-convert")) {
    const mine = out.filter((l) => l.who === "henrick")
    await Promise.all(mine.map(async (l) => {
      const conv = String(l.file).replace(/\.wav$/, "-real.wav")
      if (!existsSync(conv)) {
        const inp = { source_audio_url: dataUri(String(l.file)), target_voice_audio_url: dataUri(HENRICK_REF), high_quality_audio: true }
        const r = await run(S2S, inp)
        await download(r.out.audio?.url ?? r.out.audio_url ?? r.out.url, conv)
        sidecar(conv, "Chatterbox HD speech to speech (Resemble AI)", S2S, r.id, { source: l.file, target: HENRICK_REF, high_quality_audio: true })
      }
      l.real = conv
      const score = (f: string) => Number((spawnSync("work/venv/bin/python", ["scripts/voice-score.py", f], { encoding: "utf8" }).stdout.match(/voice ([0-9.]+)/) ?? [])[1])
      l.voice_stock = score(String(l.file)); l.voice_real = score(conv)
    }))
    const parts = mine.map((l, k) => `[${k + 1}:a]aresample=44100,adelay=${Math.round(Number(l.start) * 1000)}|${Math.round(Number(l.start) * 1000)}[h${k}]`)
    const muted = `[0:a]aresample=44100,volume=0:enable='${mine.map((l) => `between(t,${l.start},${l.end})`).join("+")}'[base]`
    sh("ffmpeg", ["-v", "error", "-y", "-i", full, ...mine.flatMap((l) => ["-i", String(l.real)]), "-filter_complex",
      `${muted};${parts.join(";")};[base]${mine.map((_, k) => `[h${k}]`).join("")}amix=inputs=${mine.length + 1}:normalize=0:duration=first[out]`, "-map", "[out]", `${dir}/full-take-henrick.wav`])
  }
  writeFileSync(`${dir}/lines.json`, JSON.stringify({ film, take, cast, model: "ElevenLabs v3 Text to Dialogue", seed: input.seed, stability: input.stability, aligned: `${matched}% of lines`, duration: +total.toFixed(2), heard: stt.text, lines: out }, null, 1))
  console.log(`${dir}: ${lines.length} lines, ${total.toFixed(1)} s, aligned ${matched}% of lines`)
  for (const l of out) console.log(`  ${String(l.n).padStart(2)} ${String(l.who).padEnd(8)} ${Number(l.start).toFixed(2)}-${Number(l.end).toFixed(2)}${l.voice_real !== undefined ? `  voice stock ${l.voice_stock} -> real ${l.voice_real}` : ""}  ${String(l.text).slice(0, 60)}`)
}
await main()
