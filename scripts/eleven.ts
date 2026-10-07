// ElevenLabs direct (Claudio's Pro plan): the state of the art for voice, which Leap and fal only carry in part.
// Leap and fal expose Eleven v4 with the 21 stock voices and no dialogue mode; here we get Text to Dialogue on
// eleven_v4, the Voice Library, Voice Design and instant clones (Henrick). Key: env ELEVENLABS_API_KEY, else the
// Keychain (MacBook), else ~/.config/assistant/elevenlabs.key (the mini). See `assistant doctor --service
// provider.elevenlabs`.
import { spawnSync } from "node:child_process"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import os from "node:os"

export const API = "https://api.elevenlabs.io"
export const TTS_MODEL = "eleven_v4"
export const DESIGN_MODEL = "eleven_ttv_v3"

export function key() {
  if (process.env.ELEVENLABS_API_KEY?.trim()) return process.env.ELEVENLABS_API_KEY.trim()
  const r = spawnSync("security", ["find-generic-password", "-s", "ELEVENLABS_API_KEY", "-w"], { encoding: "utf8" })
  const file = `${os.homedir()}/.config/assistant/elevenlabs.key`
  const k = (r.status === 0 && r.stdout.trim()) || (existsSync(file) ? readFileSync(file, "utf8").trim() : "")
  if (!k) throw new Error("No ElevenLabs key (Keychain ELEVENLABS_API_KEY or ~/.config/assistant/elevenlabs.key)")
  return (process.env.ELEVENLABS_API_KEY = k)
}

/** JSON in, JSON out. */
export async function el<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, { ...init, headers: { "xi-api-key": key(), ...(init.body && typeof init.body === "string" ? { "content-type": "application/json" } : {}), ...init.headers }, signal: AbortSignal.timeout(300_000) })
  const text = await res.text()
  if (!res.ok) throw new Error(`ElevenLabs ${res.status} ${path}: ${text.slice(0, 400)}`)
  return (text ? JSON.parse(text) : {}) as T
}

/** JSON in, audio out. Returns the provider's request ID for the sidecar. */
export async function elAudio(path: string, body: unknown, file: string) {
  const res = await fetch(`${API}${path}`, { method: "POST", headers: { "xi-api-key": key(), "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(300_000) })
  if (!res.ok) throw new Error(`ElevenLabs ${res.status} ${path}: ${(await res.text()).slice(0, 400)}`)
  writeFileSync(file, new Uint8Array(await res.arrayBuffer()))
  return res.headers.get("request-id") ?? res.headers.get("history-item-id") ?? undefined
}

export const sidecar = (file: string, model: string, endpoint: string, id: string | undefined, input: unknown, extra: Record<string, unknown> = {}) =>
  writeFileSync(`${file}.json`, JSON.stringify({ provider: "ElevenLabs", model, endpoint, request_id: id, input, ...extra, at: new Date().toISOString() }, null, 1))

// ---------- the script as acting text, for Eleven v4 ----------
// v4 reads free bracketed direction ("[Pause, dry amusement]"), so each line gets one bracket: the character's
// standing read (or a beat's override), the line's own `how`, and shouting for Brock's capitals.
export type Line = { beat: string; who: string; text: string; how?: string }
export const STANDING: Record<string, string> = {
  brock: "booming 1994 infomercial host, grinning, full volume",
  henrick: "flat, formal, unhurried",
  gerald: "dry, precise, fussy",
  kyle: "frantic, overwhelmed",
  narrator: "extremely fast legal disclaimer, flat monotone, no pauses",
}
const BEAT: Record<string, Record<string, string>> = {
  kyle: { "9": "serene, blissed out, relaxed" },
  gerald: { "10": "misty-eyed, moved, voice cracking" },
}
const HOW: Record<string, string> = {
  flat: "deadpan",
  "to camera": "desperate, pleading to camera",
  "after a beat": "after a pause",
  "speed-read": "",
  "off screen, not looking": "offhand, not looking up",
}
export function acted(l: Line) {
  const tags = [BEAT[l.who]?.[l.beat] ?? STANDING[l.who], l.how && HOW[l.how], l.who === "brock" && /[A-Z]{3,}/.test(l.text) ? "shouting" : ""].filter(Boolean).join(", ")
  return tags ? `[${tags}] ${l.text}` : l.text
}

export function scriptLines(project: { process: { script: { beats: { id: string; lines?: { who: string; text: string; how?: string }[] }[] } } }): Line[] {
  return project.process.script.beats.flatMap((b) => (b.lines ?? []).map((l) => ({ beat: b.id, who: l.who.toLowerCase(), text: l.text, how: l.how })))
}
