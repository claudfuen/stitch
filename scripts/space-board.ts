#!/usr/bin/env bun
// Reference board: everything a frame needs to know about its room, in ONE labelled image.
//
//   bun run space-board <film> <room> <cam> [--out file.jpg]
//
// Image models degrade as separate references pile up, and they copy the framing of any full-frame picture they are
// given. So a frame gets two images: its grey-box layout (the composition) and this board. The board holds, each
// under a label that says what it is for: the top-down plan of the whole room with this camera highlighted, the
// approved set (materials and light only), and identity references for the people this camera sees. The labels are
// the tags the prompt refers to. Board sources come from the room's grey box (data/space/<film>/<room>.json "board").
import { mkdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { type Box, groundTruth, planSvg, shoot } from "./space-judge"

const argv = process.argv.slice(2)
const flag = (k: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined }
const [film, room, cam] = argv.filter((a, i) => !a.startsWith("--") && !argv[i - 1]?.startsWith("--"))
if (!film || !room || !cam) throw new Error("usage: bun run space-board <film> <room> <cam> [--out file.jpg]")

type Board = { room: string; cast: Record<string, string[]>; props?: string[] }
const box = JSON.parse(readFileSync(`data/space/${film}/${room}.json`, "utf8")) as Box & { board: Board }
const s = box.setups.find((u) => u.id === cam)
if (!s) throw new Error(`no setup ${cam} in ${room}`)
const truth = groundTruth(box, s)
// Who this camera sees, from the geometry: only their identity panels go on the board.
const seen = Object.keys(box.board.cast).filter((who) => truth.some((t) => t.toLowerCase().startsWith(who) && !/NOT in frame|no one in frame/.test(t)))
const src = (p: string) => `file://${path.resolve("public", p)}`
const panel = (label: string, body: string, style = "") =>
  `<div style="display:flex;flex-direction:column;min-width:0;background:#fff;border:3px solid #111;${style}"><div style="background:#111;color:#fff;font:700 21px/1.25 Arial;padding:7px 12px">${label}</div><div style="flex:1;display:flex;gap:8px;padding:8px;align-items:center;justify-content:center;min-height:0;min-width:0">${body}</div></div>`
const img = (p: string, h: number) => `<img src="${src(p)}" style="height:${h}px;width:auto;max-width:100%;min-width:0;flex:0 1 auto;object-fit:contain"/>`
const NAMES: Record<string, string> = { audience: "AUDIENCE: the same 48 people in the same seats" }
const cast = seen.map((who) => panel(NAMES[who] ?? `${who.toUpperCase()}: face and costume only`, box.board.cast[who].map((p) => img(p, 330)).join(""), "flex:0 1 auto"))
// The plan is sized to fit the top row: 580 px tall.
const mapW = Math.round((580 * (box.width + 1.6)) / (box.depth + 1.6))
const html = `<!doctype html><html><body style="margin:0;width:2048px;height:1152px;background:#d9d9d9;font-family:Arial;display:flex;flex-direction:column;gap:10px;padding:10px;box-sizing:border-box">
<div style="background:#111;color:#fff;font:700 24px Arial;padding:9px 14px">REFERENCE BOARD for camera ${cam}. Not a scene: never copy this layout, its labels or its text.</div>
<div style="height:650px;display:flex;gap:10px">
 ${panel(`MAP: top-down plan of the whole room. ${cam} is the purple cone. Positions and facing only, never drawn.`, planSvg(box, s, mapW), `flex:0 0 ${mapW + 22}px`)}
 ${panel("THE ROOM: the approved set. Materials, colours and light only, not its framing.", img(box.board.room, box.board.props ? 380 : 560), "flex:1")}
 ${box.board.props ? panel("PROPS AND SIGNS: these exact designs in every angle (shape, size, lettering).", box.board.props.map((p) => img(p, 380 / Math.max(1, box.board.props!.length - 0.6))).join(""), "flex:1") : ""}
</div>
<div style="flex:1;display:flex;gap:10px;min-height:0;justify-content:flex-start">${cast.join("")}</div>
</body></html>`
const out = flag("out") ?? `work/${film}/space/boards/${room}-${cam}.jpg`
mkdirSync(path.dirname(out), { recursive: true })
const png = out.replace(/\.jpe?g$/, ".png")
shoot(html, png, "2048,1152")
spawnSync("ffmpeg", ["-v", "error", "-y", "-i", png, "-vf", "crop=2048:1152:0:0", "-q:v", "2", out])
console.log(out, "cast:", seen.join(", ") || "none")
