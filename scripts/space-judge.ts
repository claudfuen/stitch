#!/usr/bin/env bun
// Space judge: checks each stage 03 frame against the whole room, not just its own layout render.
//
//   bun run space-judge <film> [room ...] [--cam C1,C2] [--judge anthropic/claude-opus-5.5]
//
// For every camera with a layout and a frame it builds one review sheet (work/<film>/space/judge/<room>-<cam>.png):
// a labelled top-down plan of the room with every person, prop and camera (this one highlighted, other beats' marks
// faded), every camera's layout render, then this camera's layout beside its frame. It computes from the geometry what
// the camera must see (each person and object, and where across the frame) and what it must not. A vision model
// gets the sheet, the full-size layout and frame, the space map and that ground truth, and returns findings, each
// classed as model (the frame contradicts the layout), layout (the box itself is wrong) or plan (the camera or the plan
// does not serve the shot). Results go to work/<film>/space/judge.json. A judge is a second pair of eyes; a person
// still looks at every frame. `--truth` prints the computed ground truth and calls no model.
import { gateway } from "@ai-sdk/gateway"
import { generateText } from "ai"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

;(globalThis as { AI_SDK_LOG_WARNINGS?: boolean }).AI_SDK_LOG_WARNINGS = false
const IS_MAIN = (import.meta as ImportMeta & { main?: boolean }).main === true

type Pt = [number, number]
export type Item = { id: string; kind: string; label: string; at: Pt; size: [number, number, number]; z?: number; rot?: number; beat?: string; beats?: string[] }
export type Mark = { id: string; who: string; at: Pt; facing: number; pose: string; beat?: string; beats?: string[]; z?: number; stand_in?: string[] }
export type Setup = { id: string; name: string; size: string; lens: number; height: number; at: Pt; facing: number; tilt?: number; beat?: string }
export type Box = { width: number; depth: number; height: number; items: Item[]; marks: Mark[]; setups: Setup[] }

const argv = process.argv.slice(2)
const flag = (k: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined }
const pos = argv.filter((a, i) => !a.startsWith("--") && !argv[i - 1]?.startsWith("--"))
const [film, ...rooms] = pos
if (!film && IS_MAIN) throw new Error("usage: bun run space-judge <film> [room ...] [--cam C1,C2] [--judge model]")
const onlyCams = flag("cam")?.split(",")
const JUDGE = flag("judge") ?? "anthropic/claude-opus-5.5"
const TRUTH_ONLY = argv.includes("--truth")
/** Candidates to judge instead of the registered frames: a JSON list of { room, cam, file, tag }. */
const CANDIDATES = flag("frames") ? (JSON.parse(readFileSync(flag("frames")!, "utf8")) as { room: string; cam: string; file: string; tag: string }[]) : undefined
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
const SENSOR = 24.9

type Space =  { rooms: { id: string; name: string; map: string; look: string; cameras: { id: string; name: string; size: string; lens: number; from: string; why: string; behind?: string; look?: string; layout?: string; frame?: { file: string } }[] }[]; cuts: { t0: number; t1: number; room: string; cam: string; what: string }[] }
export const loadSpace = (film: string) => JSON.parse(readFileSync(`data/projects/${film}.json`, "utf8")).process.space as Space

// ---------- geometry: what a camera sees ----------
// The same camera as scripts/greybox.py: Super 35 horizontal sensor, 16:9 frame, facing 0 = +y, tilt up is positive.
const rad = (d: number) => (d * Math.PI) / 180
const wrap = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180
const bearing = (a: Pt, b: Pt) => (Math.atan2(b[0] - a[0], b[1] - a[1]) * 180) / Math.PI
const hfov = (lens: number) => (2 * Math.atan(SENSOR / (2 * lens)) * 180) / Math.PI
type P3 = [number, number, number]
/** Where a point lands in the frame: u 0 = left edge, 1 = right edge; v 0 = bottom, 1 = top. Undefined behind the lens. */
export function project(s: Setup, [x, y, z]: P3): { u: number; v: number } | undefined {
  const f = rad(s.facing), t = rad(s.tilt ?? 0)
  const dx = x - s.at[0], dy = y - s.at[1], dz = z - s.height
  const depth = dx * Math.sin(f) + dy * Math.cos(f)
  const lat = dx * Math.cos(f) - dy * Math.sin(f)
  const fwd = depth * Math.cos(t) + dz * Math.sin(t)
  const up = -depth * Math.sin(t) + dz * Math.cos(t)
  if (fwd < 0.05) return undefined
  const tw = SENSOR / (2 * s.lens), th = (SENSOR * 9) / 16 / (2 * s.lens)
  return { u: 0.5 + lat / fwd / (2 * tw), v: 0.5 + up / fwd / (2 * th) }
}
/** Screen extent of a set of 3D points, clipped to the frame, with which edges it runs past. */
export function extent(s: Setup, pts: P3[]) {
  const pr = pts.map((p) => project(s, p)).filter((q): q is { u: number; v: number } => !!q)
  if (!pr.length) return undefined
  const u0 = Math.min(...pr.map((q) => q.u)), u1 = Math.max(...pr.map((q) => q.u))
  const v0 = Math.min(...pr.map((q) => q.v)), v1 = Math.max(...pr.map((q) => q.v))
  if (u1 < 0 || u0 > 1 || v1 < 0 || v0 > 1) return undefined
  const cut = [u0 < 0 && "left", u1 > 1 && "right", v1 > 1 && "top", v0 < 0 && "bottom"].filter(Boolean) as string[]
  const c = (n: number) => Math.min(1, Math.max(0, n))
  return { u0: c(u0), u1: c(u1), v0: c(v0), v1: c(v1), cut }
}
/** Points along every edge of an item's box, so a part behind the lens or past an edge still clips correctly. */
export function boxPoints(it: Item): P3[] {
  const [w, d, h] = it.size, z = it.z ?? 0, r = rad(-(it.rot ?? 0))
  const at = (a: number, b: number, c: number): P3 => [it.at[0] + a * Math.cos(r) - b * Math.sin(r), it.at[1] + a * Math.sin(r) + b * Math.cos(r), c]
  const out: P3[] = []
  const N = 12
  for (let i = 0; i <= N; i++) {
    const k = i / N
    for (const zz of [z, z + h]) {
      out.push(at(-w / 2 + k * w, -d / 2, zz), at(-w / 2 + k * w, d / 2, zz), at(-w / 2, -d / 2 + k * d, zz), at(w / 2, -d / 2 + k * d, zz))
    }
    for (const [a, b] of [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]]) out.push(at(a, b, z + k * h))
  }
  return out
}
/** A person as a column from the floor (or seat) to the top of the head. */
const personPoints = (m: Mark): P3[] => {
  const lift = m.z ?? 0, top = (m.pose === "sit" ? 1.32 : 1.72) + lift
  return [0, 0.25, 0.5, 0.75, 1].map((k) => [m.at[0], m.at[1], lift + k * (top - lift)] as P3)
}
const corners = (it: Item): Pt[] => {
  const [w, d] = it.size
  const r = rad(-(it.rot ?? 0))
  return [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]].map(([x, y]) => [it.at[0] + x * Math.cos(r) - y * Math.sin(r), it.at[1] + x * Math.sin(r) + y * Math.cos(r)] as Pt)
}
const pct = (x: number) => `${Math.round(x * 100)}%`
const where = (e: NonNullable<ReturnType<typeof extent>>) =>
  `${pct(e.u0)} to ${pct(e.u1)} across, ${pct(e.v0)} to ${pct(e.v1)} up from the bottom${e.cut.length ? `, running out of frame at the ${e.cut.join(" and ")}` : ""}`
const facingWords = (m: Mark, s: Setup) => {
  const off = Math.abs(wrap(bearing(m.at, s.at) - m.facing))
  return off < 35 ? "faces the camera" : off < 70 ? "three-quarter toward the camera" : off < 110 ? "in profile" : off < 145 ? "three-quarter away from the camera" : "back to the camera"
}
/** Which way a person looks across the frame, from their facing against the camera's right-hand direction. Nothing
 *  when they look roughly along the lens axis (at the camera or away), where left and right would be noise. */
const looks = (m: Mark, s: Setup) => {
  const f = rad(m.facing), c = rad(s.facing)
  const dot = Math.sin(f) * Math.cos(c) - Math.cos(f) * Math.sin(c)
  return Math.abs(dot) < 0.3 ? "" : dot > 0 ? ", looking toward screen right" : ", looking toward screen left"
}

/** An item or mark with "beat" (or a "beats" list) exists only in those beats; a camera with no beat sees every one. */
export const inBeat = (x: { beat?: string; beats?: string[] }, s: { beat?: string }) => (!x.beat && !x.beats) || !s.beat || x.beat === s.beat || !!x.beats?.includes(s.beat)
export function groundTruth(box: Box, s: Setup) {
  const lines: string[] = []
  const marks = box.marks.filter((m) => inBeat(m, s)).map((m) => (s.beat && m.stand_in?.includes(s.beat) ? { ...m, pose: "stand" } : m))
  const items = box.items.filter((it) => inBeat(it, s))
  const crowd = marks.filter((m) => m.who === "audience")
  if (crowd.length) {
    const vis = crowd.map((m) => ({ m, e: extent(s, personPoints(m)), d: Math.hypot(m.at[0] - s.at[0], m.at[1] - s.at[1]) })).filter((v) => v.e)
    lines.push(vis.length
      ? `Audience: ${vis.length} of ${crowd.length} people at least partly in frame, spanning ${pct(Math.min(...vis.map((v) => v.e!.u0)))} to ${pct(Math.max(...vis.map((v) => v.e!.u1)))} across; nearest ${Math.min(...vis.map((v) => v.d)).toFixed(1)} m from the lens, the tallest of them ${pct(Math.max(...vis.map((v) => v.e!.v1 - v.e!.v0)))} of frame height; they are ${crowd[0].pose === "sit" ? "seated" : "standing"} and ${facingWords(vis[0].m, s)}.`
      : "Audience: no one in frame (the bleachers are outside this angle).")
  }
  for (const m of marks.filter((m) => m.who !== "audience")) {
    const e = extent(s, personPoints(m))
    const d = Math.hypot(m.at[0] - s.at[0], m.at[1] - s.at[1])
    lines.push(e ? `${m.who}: in frame, ${where(e)}, ${d.toFixed(1)} m from the lens, ${m.pose === "sit" ? "seated" : "standing"}, ${facingWords(m, s)}${looks(m, s)}.` : `${m.who}: NOT in frame.`)
  }
  for (const it of items) {
    if (/^(tier|stair|part|phone|chair)\d/.test(it.id)) continue
    const e = extent(s, boxPoints(it))
    if (e) lines.push(`${it.label}: ${where(e)}.`)
  }
  const out = items.filter((it) => !/^(tier|stair|part|phone|chair)\d/.test(it.id) && !extent(s, boxPoints(it))).map((it) => it.label)
  if (out.length) lines.push(`Outside this frame entirely (must not appear): ${[...new Set(out)].join("; ")}.`)
  return lines
}

// ---------- the labelled top-down plan ----------
const PEOPLE: Record<string, string> = { henrick: "#7dd3fc", brock: "#2dd4bf", kyle: "#93c5fd", gerald: "#fcd34d", audience: "#a8a29e" }
export function planSvg(box: Box, sel: Setup, W = 900) {
  const pad = 0.8
  const s = W / (box.width + pad * 2)
  const H = (box.depth + pad * 2) * s
  const X = (x: number) => (x + pad) * s
  const Y = (y: number) => (box.depth - y + pad) * s
  const out: string[] = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Inter,Arial" >`, `<rect width="100%" height="100%" fill="#0b1020"/>`, `<rect x="${X(0)}" y="${Y(box.depth)}" width="${box.width * s}" height="${box.depth * s}" fill="#111827" stroke="#94a3b8" stroke-width="2"/>`]
  const labelled = new Set<string>()
  for (const it of box.items.filter((i) => inBeat(i, sel))) {
    const pts = corners(it).map(([x, y]) => `${X(x)},${Y(y)}`).join(" ")
    const fill = it.kind === "board" ? "#e879f9" : it.kind === "counter" ? "#a3a3a3" : it.kind === "prop" ? "#f87171" : "#64748b"
    out.push(`<polygon points="${pts}" fill="${fill}" fill-opacity="0.75" stroke="#0b1020" stroke-width="0.6"/>`)
    const name = it.label.replace(/ \d+$/, "").replace(/ \(.*\)$/, "")
    // Small props on a desk would pile their labels up; the plan names furniture and big props only.
    if (!labelled.has(name) && !(it.kind === "prop" && it.size[0] * it.size[1] < 0.5 && !/palm/.test(it.label))) {
      labelled.add(name)
      out.push(`<text x="${X(it.at[0])}" y="${Y(it.at[1]) - 4}" font-size="11" fill="#e5e7eb" text-anchor="middle">${name}</text>`)
    }
  }
  for (const u of box.setups) {
    const on = u.id === sel.id
    const half = hfov(u.lens) / 2
    const reach = on ? 9 : 3
    const l = rad(u.facing - half), r = rad(u.facing + half)
    const [cx, cy] = u.at
    out.push(`<path d="M${X(cx)},${Y(cy)} L${X(cx + Math.sin(l) * reach)},${Y(cy + Math.cos(l) * reach)} L${X(cx + Math.sin(r) * reach)},${Y(cy + Math.cos(r) * reach)} Z" fill="#a78bfa" fill-opacity="${on ? 0.28 : 0.08}" stroke="#a78bfa" stroke-opacity="${on ? 1 : 0.4}" stroke-width="${on ? 2 : 1}"/>`)
    out.push(`<circle cx="${X(cx)}" cy="${Y(cy)}" r="${on ? 7 : 4}" fill="#a78bfa"/><text x="${X(cx) + 8}" y="${Y(cy) + 4}" font-size="${on ? 15 : 11}" font-weight="700" fill="#ede9fe">${u.id}</text>`)
  }
  const seenWho = new Set<string>()
  for (const m of box.marks) {
    const active = inBeat(m, sel)
    const c = PEOPLE[m.who] ?? "#cbd5e1"
    const f = rad(m.facing)
    out.push(`<g opacity="${active ? 1 : 0.25}"><circle cx="${X(m.at[0])}" cy="${Y(m.at[1])}" r="${m.who === "audience" ? 3.5 : 7}" fill="${c}" stroke="#0b1020"/><line x1="${X(m.at[0])}" y1="${Y(m.at[1])}" x2="${X(m.at[0] + Math.sin(f) * 0.6)}" y2="${Y(m.at[1] + Math.cos(f) * 0.6)}" stroke="${c}" stroke-width="2"/></g>`)
    const key = `${m.who}${m.beat ?? ""}`
    if (m.who !== "audience" && !seenWho.has(key)) {
      seenWho.add(key)
      out.push(`<text x="${X(m.at[0]) + 9}" y="${Y(m.at[1]) - 7}" font-size="12" font-weight="700" fill="${c}" opacity="${active ? 1 : 0.35}">${m.who}${m.beat ? ` (beat ${m.beat})` : ""}</text>`)
    }
  }
  if (box.marks.some((m) => m.who === "audience")) {
    const a = box.marks.filter((m) => m.who === "audience")
    out.push(`<text x="${X(Math.min(...a.map((m) => m.at[0])))}" y="${Y(Math.max(...a.map((m) => m.at[1]))) - 10}" font-size="12" font-weight="700" fill="${PEOPLE.audience}">audience (${a.length}, facing ${a[0].facing === 90 ? "the stage, +x" : a[0].facing})</text>`)
  }
  out.push(`<text x="${X(box.width / 2)}" y="${Y(0) + 18}" font-size="12" fill="#94a3b8" text-anchor="middle">front / entrance side · ${box.width} x ${box.depth} m · cones: every camera, ${sel.id} highlighted · arrows: facing</text></svg>`)
  return out.join("\n")
}

// ---------- the review sheet (HTML, screenshotted by Chrome) ----------
function sheet(roomName: string, svg: string, cams: { id: string; layout: string }[], sel: string, layout: string, frame: string) {
  const img = (p: string) => `file://${path.resolve("public", p)}`
  return `<!doctype html><html><body style="margin:0;background:#0b1020;color:#e5e7eb;font:14px Inter,Arial;padding:16px;width:1868px">
<h2 style="margin:0 0 10px">${roomName} · camera ${sel}</h2>
<div style="display:flex;gap:16px;align-items:flex-start">
<div>${svg}</div>
<div style="display:grid;grid-template-columns:repeat(3,300px);gap:8px">${cams.map((c) => `<figure style="margin:0"><img src="${img(c.layout)}" style="width:300px;border:${c.id === sel ? "3px solid #a78bfa" : "1px solid #334155"}"/><figcaption>${c.id} layout</figcaption></figure>`).join("")}</div>
</div>
<div style="display:flex;gap:16px;margin-top:16px"><figure style="margin:0"><img src="${img(layout)}" style="width:918px"/><figcaption>${sel}: layout (grey box from this camera)</figcaption></figure><figure style="margin:0"><img src="${frame.startsWith("public/") || frame.startsWith("work/") ? `file://${path.resolve(frame)}` : img(frame)}" style="width:918px"/><figcaption>${sel}: the frame</figcaption></figure></div>
</body></html>`
}

export function shoot(html: string, out: string, size = "1900,1500") {
  const file = out.replace(/\.png$/, ".html")
  writeFileSync(file, html)
  const r = spawnSync(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--allow-file-access-from-files", "--virtual-time-budget=8000", `--window-size=${size}`, `--screenshot=${out}`, `file://${path.resolve(file)}`], { encoding: "utf8", timeout: 60_000 })
  if (r.status !== 0 || !existsSync(out)) throw new Error(`screenshot failed: ${r.stderr?.slice(0, 300)}`)
}

const ASK = (room: { name: string; map: string }, cam: { id: string; name: string; size: string; lens: number; from: string; why: string; behind?: string }, beats: string[], truth: string[], board: boolean) => `You are the script supervisor, continuity checker and stills editor on a film. Decide whether one camera's still frame is good enough to animate. It has to be right in space, identity, look and realism, against the whole room.

You get ${board ? "four" : "three"} images:
1. A review sheet: a labelled top-down plan of the whole room (every person, prop and camera; the camera under review is highlighted; marks for other beats are faded), every camera's layout render, and this camera's layout beside its frame.
2. This camera's layout render at full size: it is the intended camera, framing and position of everything.
3. This camera's frame at full size: what the image model actually made.${board ? "\n4. The reference board the frame was made from: THE ROOM (the approved set: its colours, materials and light) and the cast panels (each person's face and costume). It is a reference, not a scene." : ""}

Room: ${room.name}
Space map (the rules): ${room.map}
Camera ${cam.id} "${cam.name}": ${cam.size}, ${cam.lens} mm. ${cam.from} Purpose: ${cam.why}${cam.behind ? ` Behind the camera: ${cam.behind}` : ""}
Used in: ${beats.join("; ") || "-"}

Ground truth computed from the 3D geometry for this camera (positions across the frame, 0% = left edge; up from the bottom edge):
${truth.map((t) => `- ${t}`).join("\n")}

Score four things, 0 to 10 each:
- space: the frame matches the layout, the plan and the ground truth. Look for: a person or object on the wrong side or at the wrong size; something in frame that the plan says this angle cannot see, or missing when it should be visible; furniture turned or flipped; people facing or looking the wrong way; the wrong number of people; props that break the continuity rules; anything that would make a cut to or from the other cameras jump.
- identity: every named person matches their cast panel (face, hair, skin tone, build, costume). A different face, a changed costume or an exaggerated skin tone is an identity fault.
- look: the frame matches THE ROOM and the set's period and palette (wall colours, materials, the signage, the light). A grey wall where the set has a coloured gradient, or swapped column colours, is a look fault.
- realism: it reads as a real photograph: plausible anatomy and hands, no melted or duplicated objects, no garbled text, no painterly or plastic texture.
Crowds: hold a studio audience to the same crowd (the mix of ages, 1994 wardrobe, the people in the AUDIENCE panel), and to the front-row people when the front row is close and clearly visible. Do not fail a frame over which extra sits in which seat in a cutaway.
Say when the layout or the plan itself is wrong (kind "layout" or "plan"); that is not the image model's fault.

Answer with JSON only:
{"verdict": "pass" | "fail", "scores": {"space": n, "identity": n, "look": n, "realism": n}, "adherence": <the space score>, "findings": [{"what": "<specific problem>", "where": "<where in the frame>", "kind": "model" | "layout" | "plan", "area": "space" | "identity" | "look" | "realism", "severity": "high" | "medium" | "low", "fix": "<the one change that fixes it, phrased as an edit instruction>"}]}
Pass only when every score is 8 or more and there is no high-severity finding.`

function key() {
  if (process.env.AI_GATEWAY_API_KEY?.trim()) return
  const r = spawnSync("security", ["find-generic-password", "-s", "AI_GATEWAY_API_KEY", "-w"], { encoding: "utf8" })
  if (r.status !== 0 || !r.stdout.trim()) throw new Error("No AI Gateway key (env AI_GATEWAY_API_KEY or Keychain service AI_GATEWAY_API_KEY)")
  process.env.AI_GATEWAY_API_KEY = r.stdout.trim()
}

/** An image part for the judge. The API takes at most 10 MB per image, so big PNGs go as a 2560 px JPEG copy. */
function media(f: string) {
  let file = f
  if (statSync(f).size > 4_500_000) {
    file = path.join(tmpdir(), `judge-${path.basename(f).replace(/\.\w+$/, "")}.jpg`)
    spawnSync("ffmpeg", ["-v", "error", "-y", "-i", f, "-vf", "scale='min(2560,iw)':-2", "-q:v", "3", file])
  }
  return { type: "file" as const, data: new Uint8Array(readFileSync(file)), mediaType: file.endsWith(".png") ? "image/png" : "image/jpeg" }
}

async function main() {
  const space = loadSpace(film)
  if (!TRUTH_ONLY) key()
  const dir = `work/${film}/space/judge`
  mkdirSync(dir, { recursive: true })
  const results: Record<string, unknown>[] = []
  for (const room of space.rooms) {
    if (rooms.length && !rooms.includes(room.id)) continue
    const boxFile = `data/space/${film}/${room.id}.json`
    if (!existsSync(boxFile)) continue
    const box = JSON.parse(readFileSync(boxFile, "utf8")) as Box
    const cams = room.cameras.filter((c) => c.layout && (c.frame || CANDIDATES))
    // One review per (camera, frame): the registered frame, or each candidate file for that camera.
    const work = cams.filter((c) => !onlyCams || onlyCams.includes(c.id)).flatMap((c) =>
      CANDIDATES ? CANDIDATES.filter((k) => k.room === room.id && k.cam === c.id).map((k) => ({ cam: c, file: k.file, tag: k.tag })) : [{ cam: c, file: path.join("public", c.frame!.file), tag: c.id }])
    const limit = 6
    for (let i = 0; i < work.length; i += limit) await Promise.all(work.slice(i, i + limit).map(async ({ cam, file, tag }) => {
      const s = box.setups.find((u) => u.id === cam.id)
      if (!s) return
      if (TRUTH_ONLY) return void console.log(`\n${room.id}/${cam.id}\n${groundTruth(box, s).map((t) => `  ${t}`).join("\n")}`)
      const png = `${dir}/${room.id}-${tag}.png`
      shoot(sheet(room.name, planSvg(box, s), cams.map((c) => ({ id: c.id, layout: c.layout! })), cam.id, cam.layout!, file), png)
      const truth = groundTruth(box, s)
      const beats = space.cuts.filter((c) => c.room === room.id && c.cam === cam.id).map((c) => `${c.t0}-${c.t1}s ${c.what}`)
      try {
        const boardFile = `work/${film}/space/boards/${room.id}-${cam.id}.jpg`
        const hasBoard = existsSync(boardFile)
        const r = await generateText({ model: gateway(JUDGE), messages: [{ role: "user", content: [media(png), media(path.join("public", cam.layout!)), media(file), ...(hasBoard ? [media(boardFile)] : []), { type: "text", text: ASK(room, cam, beats, truth, hasBoard) }] }] })
        const json = JSON.parse(r.text.slice(r.text.indexOf("{"), r.text.lastIndexOf("}") + 1))
        results.push({ room: room.id, cam: cam.id, tag, file, sheet: png, truth, ...json })
      } catch (e) {
        results.push({ room: room.id, cam: cam.id, tag, file, sheet: png, error: String((e as Error).message ?? e).slice(0, 300) })
      }
    }))
  }
  if (TRUTH_ONLY) return
  results.sort((a, b) => String(a.room + "/" + a.cam).localeCompare(String(b.room + "/" + b.cam)))
  writeFileSync(flag("out") ?? `work/${film}/space/judge.json`, JSON.stringify({ judge: JUDGE, at: new Date().toISOString(), results }, null, 1))
  for (const r of results) {
    const f = (r.findings ?? []) as { what: string; kind: string; severity: string; fix: string }[]
    const sc = r.scores as Record<string, number> | undefined
    console.log(`\n${r.room}/${r.tag ?? r.cam}  ${r.error ? `ERROR ${r.error}` : `${String(r.verdict).toUpperCase()}  ${sc ? Object.entries(sc).map(([k, v]) => `${k} ${v}`).join("  ") : `adherence ${r.adherence}/10`}`}`)
    for (const x of f) console.log(`  [${x.severity} · ${x.kind}] ${x.what}  ->  ${x.fix}`)
  }
}
if (IS_MAIN) await main()
