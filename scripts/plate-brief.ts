// Plate briefs written from a camera's visibility report (lightbox.py --ids), the plan's own lights and the location's
// art direction, never from memory. A hand-written brief once put the study reverse's window and doorway on the wrong
// sides and pasted the back wall's cabinet onto the front wall (plan conformance 38; briefs from the report score 97-100).
//
//   bun run plate-brief <location> <setup.vis.json> [--geo] [--refs "Images 3-4: ..."] [--materials ".."] [--tail ".."] [--people] [--out brief.txt]
//
// Image 1 is always the lit grey render; with --geo, Image 2 is lightbox's --geo shape render of the same camera, which
// pins the geometry (the lit render alone let the model re-compose the master vertically). --refs says what the rest are. --people writes the actor pass instead
// (who sits where, which way each one looks, where their light comes from). Fails above Flare's 2000 characters.
import { readFileSync, writeFileSync } from "node:fs"
import type { Project } from "../lib/model"

type Seen = { id: string; label: string; kind: string; share: number; box: [number, number, number, number]; where: string }
type Vis = { visible: Seen[]; edges: { id: string; label: string; kind: string; side: string }[]; behind: { id: string; label: string; kind: string }[]; lights: { id: string; type: string; side: string }[]; eyelines: { mark: string; who: string; looks: string }[] }

const argv = process.argv.slice(2)
const flag = (n: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined }
const [locId, visFile] = argv
const p: Project = JSON.parse(readFileSync("data/project.json", "utf8"))
const loc = p.locations.find((l) => l.id === locId)
if (!loc?.plan) throw new Error(`no plan on ${locId}`)
const vis: Vis = JSON.parse(readFileSync(visFile, "utf8"))
const items = new Map(loc.plan.items.map((it) => [it.id, it]))
const look = loc.look

/** The label up to its first colon (the thing with its dressing: "tall window, sheers drawn"), or with `short`, up to
 *  its first comma (the thing alone). Dressing matters for what is in shot: dropping "sheers drawn" left a bare window. */
const name = (label: string, short = false) => {
  let n = label.replace(/^(key|fill|practical)\s*:\s*/i, "").split(":")[0].trim()
  if (short) n = n.split(",")[0].trim()
  return /^[A-Z][a-z]+'s\b/.test(n) ? n : n[0].toLowerCase() + n.slice(1)
}
const third = (box: Seen["box"]) => ["left", "centre", "right"][Math.min(2, Math.floor(((box[0] + box[2]) / 2) * 3))]
const SALIENT = /window|door|guitar|sketch|cabinet|lamp|bookcase|sconce|bulb|board|counter|dispenser|clock|plant|poster|screen/i
const people = argv.includes("--people")

// The light, from the plan: the key (or the first area light), then the practicals.
const lights = loc.plan.items.filter((it) => it.light)
const key = lights.find((it) => it.light!.role === "key") ?? lights.find((it) => it.light!.type === "area")
// Practicals this camera sees are named; the rest only add to the glow.
const inFrame = new Set(vis.visible.map((x) => x.id))
const practicals = [...new Set(lights.filter((it) => it !== key && it.light!.role !== "fill" && inFrame.has(it.id)).map((it) => name(it.label, true)))]
const keySide = vis.visible.some((x) => x.id === key?.id || (x.kind === "window" && key && Math.hypot(items.get(x.id)!.at[0] - key.at[0], items.get(x.id)!.at[1] - key.at[1]) < 0.5))
  ? "from the window in frame"
  : vis.lights.find((l) => l.id === key?.id)?.side ?? ""
// Fills (overhead tubes, a bounce) light the whole room, so a plan with fills is not a low-key room: name them and take
// the contrast from the look instead of a deep falloff (the hall's tubes; the study has none).
const fills = lights.filter((it) => it !== key && it.light!.role === "fill")
const panels = fills.filter((it) => it.light!.type === "panel")
const dead = panels.filter((it) => (it.light!.strength ?? 1) <= 0).length
const fillWords = [
  panels.length ? `${panels.length - dead} ${name(panels[0].label, true).replace(/\s*\(.*\)/, "")}s overhead${dead ? ` (${dead} dead and dark)` : ""}` : "",
  fills.some((it) => it.light!.type === "area") ? "softer daylight from the other windows" : "",
].filter(Boolean).join(" and ").concat(fills.length ? " fill the room evenly; " : "")
const light = key
  ? `Light: the ${fills.length ? "" : "only "}key is ${name(key.label)}, coming ${keySide}; ${fillWords}${practicals.length ? `the practicals in shot (${practicals.slice(0, 5).join(", ")}) glow` : "practicals out of shot add a faint warm glow"}; ${fills.length ? `${(look?.contrast ?? "soft and flat, real shadows").toLowerCase()}.` : "nothing else; deep falloff into dark corners."}`
  : `Light: ${look?.light ?? "as in the photos"}.`

const seen = vis.visible.filter((x) => x.kind !== "wall" && x.kind !== "person" && x.share >= 0.0005).sort((a, b) => a.box[0] + a.box[2] - (b.box[0] + b.box[2]))
const inShot = (short: boolean) => [...new Map(seen.map((x) => [name(x.label, true), `${name(x.label, short)} (${third(x.box)})`])).values()]
const shown = new Set(seen.map((x) => name(x.label, true)))
const away = [...new Set([...vis.edges, ...vis.behind].filter((x) => x.kind !== "wall" && x.kind !== "person" && SALIENT.test(x.label)).map((x) => name(x.label, true)).filter((n) => !shown.has(n)))]
// Surfaces: the walls this camera sees, in the plan's words (the materials line a hand brief would carry).
const walls = [...new Set(vis.visible.filter((x) => x.kind === "wall" && x.share >= 0.02).map((x) => name(x.label).replace(/\s*\((back|front|left|right) wall\)/i, "")))]

function people_lines() {
  return vis.eyelines.map((e) => {
    const box = vis.visible.find((x) => x.id === `mark:${e.mark}`)?.box
    const who = p.characters.find((c) => c.id === e.who)?.name ?? e.who
    return `${who}: ${box ? `${third(box)} of frame` : "out of frame"}, looking ${e.looks}.`
  }).join(" ")
}

function brief(awayList: string[], concept = true, short = false) {
  const head = people
    ? `Image 1 is a real photograph of a room. Change only this: add the people below; keep everything else exactly (room, furniture, light, framing, grain, colour). Image 2 shows where they are and how this room's light falls on them: keep that light. ${flag("refs") ?? ""}`
    : `Image 1: lit grey 3D layout of a real room from a new camera, already lit by the room's lighting plan.${argv.includes("--geo") ? " Image 2: the same camera as an evenly lit shape render: every wall edge, corner, the ceiling line and every object's outline exactly where they must be, at that size." : ""} ${flag("refs") ?? "The other images: real photos of this place."}
Make Image 1 a real photograph of that room. Keep its camera, lens, framing, perspective and every wall, opening and piece of furniture where it is${argv.includes("--geo") ? " (match Image 2's outlines and horizon exactly)" : ""}; keep its light exactly (where it comes from, how bright, where shadows fall). Materials and colour from the photos. No people.`
  const parts = [head.trim()]
  if (concept && look?.concept) parts.push(`The place: ${look.concept}`)
  parts.push(light)
  if (walls.length || flag("materials")) parts.push([walls.length ? `Walls in shot: ${walls.join("; ")}.` : "", flag("materials") ?? ""].filter(Boolean).join(" "))
  if (people) parts.push(`Blocking from the plan: ${people_lines()}`)
  else {
    let cam = `This camera, left to right: ${inShot(short).join("; ")}.`
    if (awayList.length) cam += ` Not in this picture (out of shot or behind the camera): ${awayList.join(", ")}.`
    parts.push(cam)
  }
  if (look?.never?.length) parts.push(`Never: ${look.never.join("; ")}.`)
  parts.push(flag("tail") ?? "Real sensor grain in the shadows, slight edge softness; no readable text anywhere.")
  return parts.join("\n")
}

// Over Flare's limit: drop what is out of shot first, then the concept line, then the dressing of what is in shot.
let list = away.slice(0, 10)
let text = brief(list)
while (text.length > 2000 && list.length) text = brief((list = list.slice(0, -1)))
if (text.length > 2000) text = brief(list, false)
if (text.length > 2000) text = brief(list, false, true)
if (text.length > 2000) throw new Error(`brief is ${text.length} characters (max 2000): shorten labels or --refs`)
const out = flag("out")
if (out) writeFileSync(out, `${text}\n`)
console.log(text)
console.error(`${text.length} characters`)
