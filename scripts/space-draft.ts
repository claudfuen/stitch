#!/usr/bin/env bun
// The stage 03 draft: every camera's chosen still, graded in the film's look, laid out in cut order with its gates.
//
//   bun run space-draft <film> --picks picks.json [--status status.json] [--out work/<film>/space/draft]
//        picks:  { "<room>/<cam>": "<file>" }   status: { "<room>/<cam>": { space?: {..scores}, cohesion?: string, note?: string } }
//
// Each pick is graded with scripts/look.sh (the camera's look: betacam for colour, before for the black-and-white
// opening) into <out>/<room>--<cam>.jpg, and the board <out>/draft.png shows the cuts in film order with the time,
// the beat, the model that made the frame (from its sidecar) and the gate scores, so the whole film reads at a glance.
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { shoot } from "./space-judge"

const argv = process.argv.slice(2)
const flag = (k: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined }
const film = argv[0]
const out = flag("out") ?? `work/${film}/space/draft`
mkdirSync(out, { recursive: true })
const picks = JSON.parse(readFileSync(flag("picks")!, "utf8")) as Record<string, string>
const status = flag("status") ? (JSON.parse(readFileSync(flag("status")!, "utf8")) as Record<string, { space?: Record<string, number>; cohesion?: string; note?: string }>) : {}
type Cam = { id: string; name: string; look?: string }
type Room = { id: string; name: string; look: string; cameras: Cam[] }
const space = JSON.parse(readFileSync(`data/projects/${film}.json`, "utf8")).process.space as { rooms: Room[]; cuts: { t0: number; t1: number; room: string; cam: string; what: string }[] }

const graded: Record<string, string> = {}
for (const [key, file] of Object.entries(picks)) {
  const [roomId, camId] = key.split("/")
  const room = space.rooms.find((r) => r.id === roomId)!
  const cam = room.cameras.find((c) => c.id === camId)!
  const look = (cam.look ?? room.look) === "before" ? "before" : "betacam"
  const dst = `${out}/${roomId}--${camId}.jpg`
  const r = spawnSync("zsh", ["scripts/look.sh", look, file, dst, "1920"], { encoding: "utf8" })
  if (r.status !== 0) throw new Error(`grade failed for ${key}: ${r.stderr}`)
  graded[key] = dst
}

const model = (file: string) => {
  try { return (JSON.parse(readFileSync(`${file}.json`, "utf8")) as { model?: string }).model ?? "" } catch { return "" }
}
const seen = new Set<string>()
const cells = space.cuts.filter((c) => graded[`${c.room}/${c.cam}`]).map((c) => {
  const key = `${c.room}/${c.cam}`
  const again = seen.has(key)
  seen.add(key)
  const st = status[key] ?? {}
  const sc = st.space ? Object.entries(st.space).map(([k, v]) => `${k} ${v}`).join(" · ") : ""
  const ok = st.space && Object.values(st.space).every((v) => v >= 8)
  return `<figure style="margin:0;opacity:${again ? 0.55 : 1}">
  <img src="file://${path.resolve(graded[key])}" style="width:100%;display:block;border-radius:4px"/>
  <figcaption style="font:600 15px Inter,Arial;color:#f1f5f9;margin-top:6px">${c.t0.toFixed(1)}-${c.t1.toFixed(1)}s · ${c.cam}${again ? " (again)" : ""} <span style="font-weight:700;color:${ok ? "#4ade80" : "#fbbf24"}">${ok ? "PASS" : "near"}</span></figcaption>
  <div style="font:400 13px Inter,Arial;color:#cbd5e1;line-height:1.35">${c.what.replace(/</g, "&lt;").slice(0, 110)}</div>
  <div style="font:400 12px Inter,Arial;color:#94a3b8">${model(picks[key])}${sc ? ` · ${sc}` : ""}${st.note ? ` · ${st.note}` : ""}</div>
</figure>`
})
const html = `<!doctype html><html><body style="margin:0;background:#0b1020;padding:28px;width:2344px">
<div style="font:700 30px Inter,Arial;color:#fff;margin-bottom:6px">${film}: stage 03 draft, every cut in film order</div>
<div style="font:400 17px Inter,Arial;color:#94a3b8;margin-bottom:20px">Stills graded in the film's look. Green PASS: all four space-judge scores 8 or more. Amber: the best take so far.</div>
<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:22px">${cells.join("")}</div></body></html>`
const rows = Math.ceil(cells.length / 4)
shoot(html, `${out}/draft.png`, `2400,${rows * 450 + 140}`)
console.log(`${out}/draft.png: ${cells.length} cuts, ${Object.keys(graded).length} cameras`)
