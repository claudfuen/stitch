#!/usr/bin/env bun
// Stage 04 casting on the state of the art: ElevenLabs direct, every audition on Eleven v4.
//
//   bun run voice-cast <film> [--roles brock,kyle] [--design 2] [--seed 101]
//
// For each role: the Voice Library voices named in LIBRARY (added to the account), Voice Design voices written from
// the role's brief (DESIGN, eleven_ttv_v3, saved to the account), and for Henrick an instant clone of his real
// recorded lines. Every candidate reads that role's own lines, with the same direction, as one Text to Dialogue
// request on eleven_v4, so you compare voices, not performances. Henrick's auditions are scored against his real
// recording (scripts/voice-score.py).
//
// Why not Leap or fal: they carry Eleven v4 with only the 21 stock voices and no dialogue mode. Claudio, 2026-10-07:
// "for everything we do, we should always be using state-of-the-art".
//
// Writes public/generated/<film>/voice/cast/<who>-<slug>.mp3 with sidecars, work/<film>/voice/cast/voices.json
// (name -> voice_id and where the voice came from, read by voice-take) and work/<film>/voice/voice.json for
// `stitch voice set` (which keeps the picks already made). Safe to re-run: voices already in the account are reused.
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { acted, DESIGN_MODEL, el, elAudio, scriptLines, sidecar, TTS_MODEL } from "./eleven"

const argv = process.argv.slice(2)
const flag = (k: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined }
const film = argv[0]
if (!film) throw new Error("usage: voice-cast <film> [--roles a,b] [--design 2] [--seed 101]")
const project = JSON.parse(readFileSync(`data/projects/${film}.json`, "utf8"))
const lines = scriptLines(project)
const roles = (flag("roles") ?? [...new Set(lines.map((l) => l.who))].join(",")).split(",")
const designs = Number(flag("design") ?? 2)
const seed = Number(flag("seed") ?? 101)
const pub = `generated/${film}/voice/cast`
const work = `work/${film}/voice/cast`
mkdirSync(`public/${pub}`, { recursive: true })
mkdirSync(work, { recursive: true })

// Chosen from Voice Library searches on 2026-10-07 (sorted by clones, English, no custom rates or live moderation).
const LIBRARY: Record<string, string[]> = {
  brock: ["Ed - Late Night Announcer", "Phil - Explosive, Passionate Announcer", "John - Energetic, Unstoppable and Upbeat"],
  kyle: ["Nelson - High-Pitched, Anxious Nerd", "Lukas - Excited youthful young man", "Erby - Nerdy Regular Dude"],
  gerald: ["Henry - Serious Professor", "Grampa Werthers - Old & Cranky", "David - Slow & Charming"],
  narrator: ["Elliot Quick - Fast and Clear", "Tagg - Short Announcements", "Danny DJ - Radio Announcer Voice"],
}
// Voice Design briefs, from each character's description.
const DESIGN: Record<string, string> = {
  brock: "A booming American TV infomercial host in his mid-forties, 1994 cable. A huge, bright, slightly nasal showman voice that grins through every word, relentless energy, every sentence lands like an exclamation. Clean studio microphone.",
  kyle: "An eager American software-startup founder in his late twenties in 1994. A slightly high, reedy voice, quick and frantic, cracking with stress, sincere and a bit nerdy. Clean studio microphone.",
  gerald: "An American corporate auditor of about sixty. Dry, precise and fussy: clipped consonants, a faintly nasal, pedantic tone, slow and deliberate, the kind of man who asks for evidence of the evidence. Clean studio microphone.",
  narrator: "A middle-aged American TV announcer from a 1990s commercial reading the legal disclaimer at the end at extreme speed. Crisp, flat, monotone, perfectly articulated, no emotion at all. Clean studio microphone.",
}
// Henrick's real recorded lines (dialogue-isolated from Comp AI's videos). Only real recordings train his clone.
const HENRICK_REAL = ["r1_isolated", "r2a_isolated", "r2b_isolated", "r3_isolated"].map((f) => `${process.env.HOME}/Downloads/henrick-cup-hype-assets/4-henrick-real-lines/${f}.mp3`)

type Source = "library" | "designed" | "clone"
type Cand = { who: string; name: string; voice_id: string; source: Source; about: string }
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40)
const accountName = (who: string, name: string) => `${film} ${who}: ${name}`

async function accountVoices() {
  const out: { voice_id: string; name: string }[] = []
  let token: string | undefined
  do {
    const r = await el<{ voices: { voice_id: string; name: string }[]; has_more: boolean; next_page_token?: string }>(`/v2/voices?page_size=100${token ? `&next_page_token=${token}` : ""}`)
    out.push(...r.voices)
    token = r.has_more ? r.next_page_token : undefined
  } while (token)
  return out
}

async function library(who: string, name: string, have: Map<string, string>): Promise<Cand | null> {
  const mine = accountName(who, name)
  const q = new URLSearchParams({ search: name.split(" - ")[0], page_size: "100", language: "en", include_custom_rates: "false" })
  const r = await el<{ voices: { name: string; voice_id: string; public_owner_id: string; description?: string }[] }>(`/v1/shared-voices?${q}`)
  const v = r.voices.find((x) => x.name.trim() === name)
  if (!v) { console.warn(`  not in the library any more: ${name}`); return null }
  let id = have.get(mine)
  if (!id) {
    id = (await el<{ voice_id: string }>(`/v1/voices/add/${v.public_owner_id}/${v.voice_id}`, { method: "POST", body: JSON.stringify({ new_name: mine }) })).voice_id
    have.set(mine, id)
  }
  return { who, name, voice_id: id, source: "library", about: (v.description ?? "").replace(/\s+/g, " ").trim() }
}

async function designed(who: string, n: number, text: string, have: Map<string, string>): Promise<Cand[]> {
  const names = Array.from({ length: n }, (_, i) => `Designed ${String.fromCharCode(65 + i)}`)
  const out: Cand[] = names.flatMap((name) => { const id = have.get(accountName(who, name)); return id ? [{ who, name, voice_id: id, source: "designed" as const, about: DESIGN[who] }] : [] })
  if (out.length === n) return out
  const body = { voice_description: DESIGN[who], model_id: DESIGN_MODEL, text, seed }
  const r = await el<{ previews: { generated_voice_id: string }[] }>("/v1/text-to-voice/design", { method: "POST", body: JSON.stringify(body) })
  for (const [i, name] of names.entries()) {
    if (out.some((c) => c.name === name) || !r.previews[i]) continue
    const v = await el<{ voice_id: string }>("/v1/text-to-voice", { method: "POST", body: JSON.stringify({ voice_name: accountName(who, name), voice_description: DESIGN[who], generated_voice_id: r.previews[i].generated_voice_id }) })
    have.set(accountName(who, name), v.voice_id)
    out.push({ who, name, voice_id: v.voice_id, source: "designed", about: DESIGN[who] })
  }
  return out
}

async function clone(have: Map<string, string>): Promise<Cand> {
  const name = "v4 clone"
  const about = `Instant clone of his ${HENRICK_REAL.length} real recorded lines (13.6 s)`
  const existing = have.get(accountName("henrick", name))
  if (existing) return { who: "henrick", name, voice_id: existing, source: "clone", about }
  const form = new FormData()
  form.set("name", accountName("henrick", name))
  form.set("description", "Henrick Johansson (signed likeness), real lines only")
  form.set("remove_background_noise", "false")
  for (const f of HENRICK_REAL) form.append("files", new Blob([readFileSync(f)], { type: "audio/mpeg" }), f.split("/").pop())
  const v = await el<{ voice_id: string }>("/v1/voices/add", { method: "POST", body: form })
  have.set(accountName("henrick", name), v.voice_id)
  return { who: "henrick", name, voice_id: v.voice_id, source: "clone", about }
}

const score = (file: string) => {
  const r = spawnSync("work/venv/bin/python", ["scripts/voice-score.py", file], { encoding: "utf8" })
  const m = r.stdout.match(/voice ([\d.]+)/)
  return m ? Number(m[1]) : undefined
}

async function main() {
  const have = new Map((await accountVoices()).map((v) => [v.name, v.voice_id]))
  const all: Cand[] = []
  for (const who of roles) {
    const mine = lines.filter((l) => l.who === who)
    const read = mine.map((l) => l.text).join(" ")
    // Voice Design needs 100 to 1000 characters of preview text.
    const preview = read.length >= 100 ? read.slice(0, 1000) : `${read} ${read}`.padEnd(100, ".")
    const cands: Cand[] = []
    if (who === "henrick") cands.push(await clone(have))
    for (const name of LIBRARY[who] ?? []) { const c = await library(who, name, have); if (c) cands.push(c) }
    if (DESIGN[who]) cands.push(...(await designed(who, designs, preview, have)))
    for (const c of cands) {
      const file = `public/${pub}/${who}-${slug(c.name)}.mp3`
      if (!existsSync(file)) {
        const body = { model_id: TTS_MODEL, inputs: mine.map((l) => ({ text: acted(l), voice_id: c.voice_id })), seed }
        const id = await elAudio("/v1/text-to-dialogue?output_format=mp3_44100_192", body, file)
        sidecar(file, TTS_MODEL, "/v1/text-to-dialogue", id, body, { voice: c })
      }
      const match = who === "henrick" ? score(file) : undefined
      console.log(`${who.padEnd(9)} ${c.source.padEnd(8)} ${c.name}${match ? `  match ${match.toFixed(2)}` : ""}`)
      all.push({ ...c, file: file.replace(/^public\//, ""), match } as Cand & { file: string; match?: number })
    }
  }
  // voices.json accumulates across runs, so a partial re-run (--roles) keeps the other roles.
  const vf = `${work}/voices.json`
  const prev: Cand[] = existsSync(vf) ? JSON.parse(readFileSync(vf, "utf8")) : []
  const merged = [...prev.filter((p) => !roles.includes(p.who)), ...all]
  writeFileSync(vf, JSON.stringify(merged, null, 1))
  console.log(`wrote ${vf} (${merged.length} voices)`)
}

main().catch((e) => { console.error(e); process.exit(1) })
