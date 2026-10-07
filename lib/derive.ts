// Derived views. Computed once from the project; every component renders these, never re-derives.

import {
  CHECKS, type ActivityKind, type Asset, type Character, type Check, type CheckKey, type Cut, type CutShot, type Graphic,
  type GraphicUse, type Id, type Line, type Location, type Mark, type Plan, type Project, type Section, type Setup, type Shot,
  type Take, type TakeVerdict,
} from "./model"
import { MODELS, modelInfo, type ModelInfo } from "./models"

export type Index = ReturnType<typeof indexProject>
export function indexProject(p: Project) {
  return {
    assets: new Map(p.assets.map((a) => [a.id, a])),
    chars: new Map(p.characters.map((c) => [c.id, c])),
    locs: new Map(p.locations.map((l) => [l.id, l])),
    sections: new Map(p.sections.map((s) => [s.id, s])),
    graphics: new Map(p.graphics.map((g) => [g.id, g])),
  }
}

/** The take a shot uses: the circled one, else the first one not rejected. */
export function pick(list: Take[]): Take | undefined {
  return list.find((t) => t.verdict === "circled") ?? list.find((t) => t.verdict !== "reject")
}

/** The latest full cut of the film; scene cuts (with a scope) never stand in for it. */
export const latestCut = (p: Project): Cut | undefined => p.cuts.find((c) => !c.scope)

export type LineView = Line & { speaker?: Character; audioAsset?: Asset; risk?: string }
export type GraphicView = GraphicUse & { g?: Graphic; preview?: Asset }
export type CheckView = { key: CheckKey; label: string; hint: string; check?: Check }
export type Issue = { level: "fail" | "warn"; text: string }

export type ShotRow = {
  shot: Shot
  index: number
  section?: Section
  location?: Location
  setup?: Setup
  cast: Character[]
  keyframe?: Asset
  keyframeTakes: { take: Take; asset?: Asset }[]
  take?: Asset
  takes: { take: Take; asset?: Asset }[]
  lines: LineView[]
  graphics: GraphicView[]
  checks: CheckView[]
  checked: { ok: number; fail: number; total: number }
  timing?: CutShot
  /** Whether the latest full cut shows the picked take: "in", "older" (the cut has an earlier take), or "out". */
  cutState: CutState
  issues: Issue[]
}
export type CutState = "in" | "older" | "out"

export function shotRows(p: Project, ix: Index = indexProject(p)): ShotRow[] {
  const cut = latestCut(p)
  return p.shots.map((shot, index) => {
    const kf = pick(shot.keyframes)
    const tk = pick(shot.takes)
    const take = tk ? ix.assets.get(tk.asset) : undefined
    const cast = shot.characters.map((c) => ix.chars.get(c)).filter((c): c is Character => !!c)
    const lines: LineView[] = shot.lines.map((l) => ({
      ...l,
      speaker: ix.chars.get(l.who),
      audioAsset: l.audio ? ix.assets.get(l.audio) : undefined,
      risk: l.mode === "laid" ? "Audio laid over an on-camera speaker: not lip-synced" : undefined,
    }))
    const checks: CheckView[] = CHECKS.map((c) => ({ key: c.key, label: c.label, hint: c.hint, check: shot.checks[c.key] }))
    const checked = {
      ok: checks.filter((c) => c.check?.ok === true).length,
      fail: checks.filter((c) => c.check?.ok === false).length,
      total: checks.length,
    }
    const issues: Issue[] = []
    if (!shot.card_graphic && !take) issues.push({ level: "fail", text: "No take yet" })
    const laid = lines.filter((l) => l.mode === "laid").length
    if (laid) issues.push({ level: "fail", text: `${laid} line${laid > 1 ? "s" : ""} not lip-synced` })
    const face = take?.scores?.face
    if (face !== undefined && face < p.baselines.faceTarget) issues.push({ level: "warn", text: `Face ${face.toFixed(2)}, target ${p.baselines.faceTarget}` })
    if (take?.qa && take.qa.verdict !== "pass") issues.push({ level: take.qa.verdict === "fail" ? "fail" : "warn", text: take.qa.note })
    for (const c of checks) if (c.check?.ok === false) issues.push({ level: "fail", text: `${c.label}: ${c.check.note ?? "failed"}` })
    const loc = shot.location ? ix.locs.get(shot.location) : undefined
    const setup = shot.setup ? loc?.plan?.setups.find((u) => u.id === shot.setup) : undefined
    if (shot.setup && !setup) issues.push({ level: "fail", text: `Setup ${shot.setup} is not on the ${loc?.name ?? "location"} plan` })
    if (loc?.plan && !shot.setup && !shot.card_graphic) issues.push({ level: "warn", text: "No camera setup on the floor plan" })
    const prev = index > 0 ? p.shots[index - 1] : undefined
    const prevSetup = prev?.location === shot.location && prev?.setup ? loc?.plan?.setups.find((u) => u.id === prev.setup) : undefined
    if (setup && prevSetup && loc?.plan) {
      const cross = crossesLine(loc.plan, prevSetup, setup)
      if (cross) issues.push({ level: "fail", text: `Crosses the line (${cross}) from the previous shot` })
    }
    const timing = cut?.timeline.find((t) => t.shot === shot.id)
    return {
      shot, index, cast, lines, checks, checked, issues,
      section: ix.sections.get(shot.section),
      location: loc,
      setup,
      keyframe: kf ? ix.assets.get(kf.asset) : undefined,
      keyframeTakes: shot.keyframes.map((t) => ({ take: t, asset: ix.assets.get(t.asset) })),
      take,
      takes: shot.takes.map((t) => ({ take: t, asset: ix.assets.get(t.asset) })),
      graphics: shot.graphics.map((g) => {
        const gr = ix.graphics.get(g.graphic)
        return { ...g, g: gr, preview: gr?.preview ? ix.assets.get(gr.preview) : undefined }
      }),
      timing,
      cutState: !timing ? "out" : shot.card_graphic || !take || timing.asset === take.id ? "in" : "older",
    }
  })
}

export type Summary = { shots: number; approved: number; issues: number; laidLines: number; runtime?: number; target: number }
export function summary(p: Project, rows: ShotRow[]): Summary {
  return {
    shots: rows.length,
    approved: rows.filter((r) => r.shot.status === "approved").length,
    issues: rows.reduce((n, r) => n + r.issues.length, 0),
    laidLines: rows.reduce((n, r) => n + r.lines.filter((l) => l.mode === "laid").length, 0),
    runtime: latestCut(p)?.duration,
    target: p.runtimeTarget,
  }
}

// ---------- Timeline (from the latest rendered cut, so it always shows what was actually built) ----------

export type TimelineView = {
  duration: number
  version: string
  shots: { id: Id; name: string; start: number; end: number; color: string }[]
  lines: { who: string; text: string; start: number; end: number; mode: Line["mode"] }[]
  graphics: { label: string; start: number; end: number }[]
}
export function timeline(p: Project, ix: Index = indexProject(p)): TimelineView | undefined {
  const cut = latestCut(p)
  return cut ? cutTimeline(p, cut, ix) : undefined
}

/** Any cut's timeline: its shots, lines and graphics, as rendered. */
export function cutTimeline(p: Project, cut: Cut, ix: Index = indexProject(p)): TimelineView {
  const shotById = new Map(p.shots.map((s) => [s.id, s]))
  return {
    duration: cut.duration,
    version: cut.version,
    shots: cut.timeline.map((t) => {
      const s = shotById.get(t.shot)
      return { id: t.shot, name: s?.name ?? t.shot, start: t.start, end: t.start + t.dur, color: ix.sections.get(s?.section ?? "")?.color ?? "#64748b" }
    }),
    lines: cut.timeline.flatMap((t) => t.lines.map((l) => ({ who: ix.chars.get(l.who)?.name ?? l.who, text: l.text, start: l.start, end: l.end, mode: l.mode }))),
    graphics: cut.timeline.flatMap((t) => t.graphics.map((g) => ({ label: ix.graphics.get(g.graphic)?.label ?? g.graphic, start: g.start, end: g.end }))),
  }
}

// ---------- Canvas graph (pipeline view: library -> keyframe -> take -> final, edges from provenance) ----------

export type CanvasNode =
  | { id: string; kind: "asset"; x: number; y: number; data: { asset: Asset; role: string; circled?: boolean; alts?: number; shot?: Id } }
  | { id: string; kind: "shot"; x: number; y: number; data: { row: ShotRow } }
  | { id: string; kind: "lines"; x: number; y: number; data: { row: ShotRow } }
  | { id: string; kind: "graphic"; x: number; y: number; data: { use: GraphicView } }
  | { id: string; kind: "character"; x: number; y: number; data: { character: Character } }
  | { id: string; kind: "location"; x: number; y: number; data: { location: Location; style: Asset[]; ambience?: Asset; plan?: PlanView } }
  | { id: string; kind: "setup"; x: number; y: number; data: { location: Location; setup: SetupView; render?: Asset; plate?: Asset; takes: number; shots: Id[] } }
  | { id: string; kind: "final"; x: number; y: number; data: { cut?: Cut; asset?: Asset } }
export type CanvasEdge = { id: string; source: string; target: string; kind: "input" | "voice" | "graphic" | "cut" | "assumed" | "set" }

const COL = 340
export function canvasGraph(p: Project, rows: ShotRow[], ix: Index = indexProject(p)): { nodes: CanvasNode[]; edges: CanvasEdge[] } {
  const nodes: CanvasNode[] = []
  const edges: CanvasEdge[] = []
  const placed = new Set<string>()
  const put = (n: CanvasNode) => {
    if (placed.has(n.id)) return
    placed.add(n.id)
    const o = p.ui.positions[n.id]
    nodes.push(o ? { ...n, x: o.x, y: o.y } : n)
  }

  // Library: characters (anchors, sheets) and locations (look).
  let ly = 0
  for (const c of p.characters) {
    put({ id: `char:${c.id}`, kind: "character", x: -1500, y: ly, data: { character: c } })
    const refs = [...c.anchors, ...c.sheets]
    refs.forEach((a, i) => {
      const asset = ix.assets.get(a)
      if (asset) put({ id: `asset:${a}`, kind: "asset", x: -1180 + (i % 4) * 230, y: ly + Math.floor(i / 4) * 190, data: { asset, role: c.anchors.includes(a) ? "Anchor (real)" : "Sheet" } })
    })
    ly += Math.max(1, Math.ceil(refs.length / 4)) * 190 + 60
  }
  // Assets that a setup node stands in for (its grey render and its plates), so provenance edges start at the setup.
  const viaSetup = new Map<Id, string>()
  for (const l of p.locations) {
    const style = l.style.map((s) => ix.assets.get(s)).filter((a): a is Asset => !!a)
    const pv = planView(l)
    put({ id: `loc:${l.id}`, kind: "location", x: -1500, y: ly, data: { location: l, style, ambience: l.ambience ? ix.assets.get(l.ambience) : undefined, plan: pv } })
    if (pv) {
      // Camera setups: one node each, grey render beside the circled plate, in a grid right of the location.
      pv.setups.forEach((u, k) => {
        const id = `setup:${l.id}:${u.id}`
        const plate = pick(u.plates ?? [])
        put({
          id, kind: "setup", x: -1140 + (k % 3) * 320, y: ly + Math.floor(k / 3) * 250,
          data: { location: l, setup: u, render: u.render ? ix.assets.get(u.render) : undefined, plate: plate ? ix.assets.get(plate.asset) : undefined, takes: u.plates?.length ?? 0, shots: p.shots.filter((x) => x.location === l.id && x.setup === u.id).map((x) => x.id) },
        })
        edges.push({ id: `set:${l.id}:${u.id}`, source: `loc:${l.id}`, target: id, kind: "set" })
        for (const a of [u.render, ...(u.plates ?? []).map((t) => t.asset)]) if (a) viaSetup.set(a, id)
      })
      ly += Math.max(700, Math.ceil(pv.setups.length / 3) * 250) + 60
    }
    // Set pieces: style plates, prop sheets and grade references, each its own node.
    const pieces = [...l.style.map((id) => [id, "Set plate"] as const), ...(l.props ?? []).map((id) => [id, "Prop sheet"] as const), ...l.gradeRef.map((id) => [id, "Grade reference"] as const)]
    const seen = new Set<string>()
    let i = 0
    for (const [id, role] of pieces) {
      const asset = ix.assets.get(id)
      if (!asset || seen.has(id)) continue
      seen.add(id)
      put({ id: `asset:${id}`, kind: "asset", x: -1180 + (i % 4) * 230, y: ly + Math.floor(i / 4) * 190, data: { asset, role } })
      edges.push({ id: `set:${l.id}:${id}`, source: `loc:${l.id}`, target: `asset:${id}`, kind: "set" })
      i++
    }
    ly += Math.max(1, Math.ceil(i / 4)) * 190 + 60
  }

  // Shots: one column each.
  const cut = latestCut(p)
  rows.forEach((r, i) => {
    const x = i * COL
    put({ id: `shot:${r.shot.id}`, kind: "shot", x, y: -170, data: { row: r } })
    const kf = r.keyframe
    if (kf) put({ id: `asset:${kf.id}`, kind: "asset", x, y: 40, data: { asset: kf, role: "Keyframe", circled: true, alts: r.keyframeTakes.length - 1, shot: r.shot.id } })
    const tk = r.take
    if (tk) put({ id: `asset:${tk.id}`, kind: "asset", x, y: 300, data: { asset: tk, role: "Take", circled: true, alts: r.takes.length - 1, shot: r.shot.id } })
    if (r.lines.length) put({ id: `lines:${r.shot.id}`, kind: "lines", x, y: 560, data: { row: r } })
    r.graphics.forEach((g, gi) => put({ id: `gfx:${r.shot.id}:${gi}`, kind: "graphic", x, y: 760 + gi * 200, data: { use: g } }))

    if (kf && tk && !(tk.gen?.inputs ?? []).includes(kf.id)) edges.push({ id: `assumed:${kf.id}:${tk.id}`, source: `asset:${kf.id}`, target: `asset:${tk.id}`, kind: "assumed" })
    if (tk && r.lines.length) edges.push({ id: `voice:${r.shot.id}`, source: `lines:${r.shot.id}`, target: `asset:${tk.id}`, kind: "voice" })
    r.graphics.forEach((_, gi) => tk && edges.push({ id: `gfx:${r.shot.id}:${gi}`, source: `gfx:${r.shot.id}:${gi}`, target: `asset:${tk.id}`, kind: "graphic" }))
    if (tk && cut?.timeline.some((t) => t.asset === tk.id)) edges.push({ id: `cut:${tk.id}`, source: `asset:${tk.id}`, target: "final", kind: "cut" })
  })
  put({ id: "final", kind: "final", x: rows.length * COL + 80, y: 140, data: { cut, asset: cut ? ix.assets.get(cut.asset) : undefined } })

  // Provenance edges between any two assets on the canvas.
  for (const n of nodes) {
    if (n.kind !== "asset") continue
    for (const input of n.data.asset.gen?.inputs ?? []) {
      const source = placed.has(`asset:${input}`) ? `asset:${input}` : viaSetup.get(input)
      if (source) edges.push({ id: `in:${input}:${n.data.asset.id}`, source, target: n.id, kind: "input" })
    }
  }
  return { nodes, edges: dedupe(edges) }
}

function dedupe(edges: CanvasEdge[]) {
  const seen = new Set<string>()
  return edges.filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true)))
}

// ---------- Floor plans (cameras, marks and the 180-degree line) ----------

/** Super 35 sensor width in mm, for horizontal field of view. */
/** A light's colour from its colour temperature (Tanner Helland's fit), for glyphs on the plan and in the Rooms view. */
export function kelvinColor(kelvin: number): string {
  const t = kelvin / 100
  const r = t <= 66 ? 255 : 329.698727446 * Math.pow(t - 60, -0.1332047592)
  const g = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * Math.pow(t - 60, -0.0755148492)
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307
  const c = (v: number) => Math.round(Math.max(0, Math.min(255, v)))
  return `rgb(${c(r)}, ${c(g)}, ${c(b)})`
}

export const SENSOR_MM = 24.9
export const hfov = (lens: number) => (2 * Math.atan(SENSOR_MM / (2 * lens)) * 180) / Math.PI
const rad = (d: number) => (d * Math.PI) / 180
const wrap = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180
/** Compass bearing from a to b: 0 toward +y (the far wall), 90 toward +x. */
export const bearing = (a: [number, number], b: [number, number]) => (Math.atan2(b[0] - a[0], b[1] - a[1]) * 180) / Math.PI
/** Unit vector for a facing. */
export const heading = (deg: number): [number, number] => [Math.sin(rad(deg)), Math.cos(rad(deg))]

/** Which side of an axis (a to b) a point is on: 1 left, -1 right, 0 on the line. */
export function sideOf(plan: Plan, axisId: Id, at: [number, number]): 1 | -1 | 0 {
  const ax = plan.axes.find((x) => x.id === axisId)
  const a = plan.marks.find((m) => m.id === ax?.a)?.at
  const b = plan.marks.find((m) => m.id === ax?.b)?.at
  if (!a || !b) return 0
  const cross = (b[0] - a[0]) * (at[1] - a[1]) - (b[1] - a[1]) * (at[0] - a[0])
  return Math.abs(cross) < 1e-6 ? 0 : cross > 0 ? 1 : -1
}

/** The label of the line two setups disagree on, if any. Only setups that both name the same axis are compared. */
export function crossesLine(plan: Plan, a: Setup, b: Setup): string | undefined {
  if (!a.axis || a.axis !== b.axis) return undefined
  const sa = sideOf(plan, a.axis, a.at)
  const sb = sideOf(plan, b.axis, b.at)
  if (sa && sb && sa !== sb) return plan.axes.find((x) => x.id === a.axis)?.label ?? a.axis
  return undefined
}

/** Where a mark lands in a setup's frame: 0 is the left edge, 1 the right; undefined when out of frame. */
export function screenX(setup: Setup, at: [number, number]): number | undefined {
  const rel = wrap(bearing(setup.at, at) - setup.facing)
  const half = hfov(setup.lens) / 2
  if (Math.abs(rel) > half) return undefined
  return 0.5 + Math.tan(rad(rel)) / (2 * Math.tan(rad(half)))
}

/** Head height of a mark's stand-in above the floor, as the Blender builders seat and stand them. Leaning in lowers the
 *  head about 0.3 m for every metre it moves forward (a 35 cm lean drops it about 10 cm). */
export const headZ = (m: Mark) => (m.z ?? 0) + (m.pose === "sit" ? 1.2 : 1.58) - 0.3 * (m.lean ?? 0)
/** Where a mark's head is on the floor plan: the mark, moved forward along its facing by its lean. */
export const headAt = (m: Mark): [number, number] => {
  const [fx, fy] = heading(m.facing)
  return [m.at[0] + fx * (m.lean ?? 0), m.at[1] + fy * (m.lean ?? 0)]
}
/** Height of an Apple Vision face box (brow to chin) in metres: 0.158 on Henrick's real A-cam frame through its solved
 *  camera (head within 1% of where the plan puts it). Sets the face size a camera should give. */
export const FACE_M = 0.16

/** Where a mark's head lands in a setup's 16:9 frame: centre from the left and top (0 to 1), the face's height as a share
 *  of the frame height, and its depth along the lens axis. Pinhole on the Super 35 sensor, with the setup's tilt (positive
 *  looks up). undefined when the head is behind the lens or outside the frame. */
export function projectHead(u: Setup, m: Mark): { x: number; y: number; h: number; depth: number } | undefined {
  const [fx, fy] = heading(u.facing)
  const [hx, hy] = headAt(m)
  const dx = hx - u.at[0]
  const dy = hy - u.at[1]
  const ahead = dx * fx + dy * fy
  const right = dx * fy - dy * fx
  const up = headZ(m) - u.height
  const t = rad(u.tilt ?? 0)
  const depth = ahead * Math.cos(t) + up * Math.sin(t)
  const rise = up * Math.cos(t) - ahead * Math.sin(t)
  if (depth < 0.3) return undefined
  const k = u.lens / SENSOR_MM
  const x = 0.5 + (right / depth) * k
  const y = 0.5 - (rise / depth) * k * (16 / 9)
  if (x < -0.05 || x > 1.05 || y < -0.05 || y > 1.05) return undefined
  return { x, y, h: (FACE_M / depth) * k * (16 / 9), depth }
}

export type SetupView = Setup & {
  fov: number
  /** Marks inside the frame, left to right, with their screen position. */
  inFrame: { mark: Mark; x: number; dist: number }[]
  side?: 1 | -1 | 0
}
export type PlanView = { plan: Plan; setups: SetupView[]; issues: Issue[] }

export function planView(l: Location): PlanView | undefined {
  const plan = l.plan
  if (!plan) return undefined
  const setups: SetupView[] = plan.setups.map((u) => ({
    ...u,
    fov: hfov(u.lens),
    side: u.axis ? sideOf(plan, u.axis, u.at) : undefined,
    inFrame: plan.marks
      .filter((m) => !m.beat || m.beat === u.beat)
      .map((mark) => ({ mark, x: screenX(u, mark.at), dist: Math.hypot(mark.at[0] - u.at[0], mark.at[1] - u.at[1]) }))
      .filter((m): m is { mark: Mark; x: number; dist: number } => m.x !== undefined)
      .sort((a, b) => a.x - b.x),
  }))
  const issues: Issue[] = []
  for (const ax of plan.axes) {
    const on = setups.filter((u) => u.axis === ax.id)
    const sides = new Set(on.map((u) => u.side).filter((x) => x))
    if (sides.size > 1) issues.push({ level: "fail", text: `Setups ${on.map((u) => u.id).join(", ")} sit on both sides of ${ax.label}` })
  }
  for (const u of setups) {
    for (const s of u.subjects ?? []) if (!u.inFrame.some((m) => m.mark.id === s)) issues.push({ level: "warn", text: `${u.id}: ${s} is outside the frame` })
  }
  return { plan, setups, issues }
}

// ---------- History: which version is current, where each file is used, and the work as it happened ----------

export type AssetUse = { what: string; shot?: Id; cut?: Id; location?: Id; setup?: Id; picked?: boolean }
const verdictTag = (v: TakeVerdict) => (v === "circled" ? ", picked" : v === "reject" ? ", rejected" : v === "pending" ? ", pending" : "")

/** Where each asset is used, in words: "2.4 take, picked", "Ministry waiting hall B plate", "Cut v6". */
export function assetUses(p: Project): Map<Id, AssetUse[]> {
  const out = new Map<Id, AssetUse[]>()
  const add = (id: Id | null | undefined, u: AssetUse) => {
    if (!id) return
    const list = out.get(id)
    if (list) list.push(u)
    else out.set(id, [u])
  }
  for (const s of p.shots) {
    for (const k of s.keyframes) add(k.asset, { what: `${s.id} keyframe${verdictTag(k.verdict)}`, shot: s.id, picked: k.verdict === "circled" })
    for (const t of s.takes) add(t.asset, { what: `${s.id} take${verdictTag(t.verdict)}`, shot: s.id, picked: t.verdict === "circled" })
    for (const l of s.lines) add(l.audio, { what: `${s.id} line`, shot: s.id })
    for (const c of s.sfx) add(c.asset, { what: `${s.id} sound`, shot: s.id })
  }
  for (const g of p.graphics) add(g.preview, { what: `Graphic: ${g.label}` })
  for (const c of p.characters) {
    for (const a of c.anchors) add(a, { what: `${c.name} anchor (real)` })
    for (const a of c.sheets) add(a, { what: `${c.name} sheet` })
    add(c.voice?.ref, { what: `${c.name} voice reference` })
  }
  for (const l of p.locations) {
    for (const a of l.style) add(a, { what: `${l.name} set plate`, location: l.id })
    for (const a of l.gradeRef) add(a, { what: `${l.name} grade reference`, location: l.id })
    for (const a of l.props ?? []) add(a, { what: `${l.name} prop sheet`, location: l.id })
    add(l.ambience, { what: `${l.name} ambience`, location: l.id })
    add(l.model, { what: `${l.name} 3D room`, location: l.id })
    for (const u of l.plan?.setups ?? []) {
      add(u.render, { what: `${l.name} ${u.id} grey render`, location: l.id, setup: u.id })
      for (const t of u.plates ?? []) add(t.asset, { what: `${l.name} ${u.id} plate${verdictTag(t.verdict)}`, location: l.id, setup: u.id, picked: t.verdict === "circled" })
    }
  }
  for (const c of p.cuts) add(c.asset, { what: c.scope ? `${c.scope} cut ${c.version}` : `Cut ${c.version}`, cut: c.id })
  return out
}

export type CutChange = { shot: Id; change: "added" | "removed" | "new take" | "retimed" | "dialogue" }
export type CutEntry = { cut: Cut; asset?: Asset; at?: number; current: boolean; prev?: Cut; changes: CutChange[] }
export type CutHistory = { current?: CutEntry; full: CutEntry[]; scenes: { scope: string; entries: CutEntry[] }[] }

/** What changed between two versions of a cut, shot by shot. Line times are compared from their shot's start, since an
 *  earlier shot getting longer moves every later line without changing it. */
export function cutChanges(prev: Cut, cut: Cut): CutChange[] {
  const before = new Map(prev.timeline.map((t) => [t.shot, t]))
  const lines = (t: CutShot) => t.lines.map((l) => `${l.who}|${l.text}|${l.mode}|${Math.round((l.start - t.start) * 10)}|${Math.round((l.end - t.start) * 10)}`).join("\n")
  const out: CutChange[] = []
  for (const t of cut.timeline) {
    const b = before.get(t.shot)
    before.delete(t.shot)
    if (!b) out.push({ shot: t.shot, change: "added" })
    else if (b.asset !== t.asset) out.push({ shot: t.shot, change: "new take" })
    else if (Math.abs(b.dur - t.dur) > 0.05 || Math.abs(b.in - t.in) > 0.05) out.push({ shot: t.shot, change: "retimed" })
    else if (lines(b) !== lines(t)) out.push({ shot: t.shot, change: "dialogue" })
  }
  for (const shot of before.keys()) out.push({ shot, change: "removed" })
  return out
}

/** Every cut, newest first (the order the project keeps them in, as latestCut reads it): the full cuts, whose newest is
 *  the current cut of the film, and each scene's cuts in film order, whose newest is that scene's current version. */
export function cutHistory(p: Project, ix: Index = indexProject(p), mtimes: Record<Id, number> = {}): CutHistory {
  const entries = (list: Cut[]): CutEntry[] =>
    list.map((cut, i) => ({ cut, asset: ix.assets.get(cut.asset), at: mtimes[cut.asset], current: i === 0, prev: list[i + 1], changes: list[i + 1] ? cutChanges(list[i + 1], cut) : [] }))
  const full = entries(p.cuts.filter((c) => !c.scope))
  const sceneNo = (scope: string) => Number(/scene (\d+)/i.exec(scope)?.[1] ?? 99)
  const scopes = [...new Set(p.cuts.flatMap((c) => (c.scope ? [c.scope] : [])))].sort((a, b) => sceneNo(a) - sceneNo(b))
  return { current: full[0], full, scenes: scopes.map((scope) => ({ scope, entries: entries(p.cuts.filter((c) => c.scope === scope)) })) }
}

export type FeedItem =
  | { kind: "note"; t: number; tone: ActivityKind; text: string }
  | { kind: "media"; t: number; from: number; assets: Asset[] }
  | { kind: "cut"; t: number; cut: Cut; asset?: Asset }

/** The work as it happened, newest first: the agents' log, the files they made (by file time, in batches no more than
 *  three minutes apart) and every cut as it was rendered. */
export function activityFeed(p: Project, ix: Index, mtimes: Record<Id, number>): FeedItem[] {
  const items: FeedItem[] = p.activity.map((a) => ({ kind: "note", t: Date.parse(a.t), tone: a.kind ?? "info", text: a.text }))
  const cutFiles = new Set(p.cuts.map((c) => c.asset))
  for (const cut of p.cuts) if (mtimes[cut.asset]) items.push({ kind: "cut", t: mtimes[cut.asset], cut, asset: ix.assets.get(cut.asset) })
  const made = p.assets.filter((a) => mtimes[a.id] && !cutFiles.has(a.id)).sort((a, b) => mtimes[a.id] - mtimes[b.id])
  let batch: Asset[] = []
  const flush = () => {
    if (batch.length) items.push({ kind: "media", t: mtimes[batch[batch.length - 1].id], from: mtimes[batch[0].id], assets: [...batch].reverse() })
    batch = []
  }
  for (const a of made) {
    if (batch.length && mtimes[a.id] - mtimes[batch[batch.length - 1].id] > 3 * 60_000) flush()
    batch.push(a)
  }
  flush()
  return items.sort((a, b) => b.t - a.t)
}

// ---------- Models: what each model made, and what of it we kept ----------

export type ModelStat = {
  model: ModelInfo
  providers: string[]
  /** Assets with a step by this model (a lip-synced take counts for its picture, voice and lip-sync models). */
  assets: Asset[]
  picked: number
  rejected: number
  /** Assets the current cut plays or was made from (a keyframe behind a take in the cut counts). */
  inCut: number
  /** Steps with a provider job id (the rest were read from labels). */
  recorded: number
  steps: number
  costUsd: number
  face?: number
  voice?: number
  qa: { pass: number; borderline: number; fail: number }
}

/** Per model: what it made, how much of it was picked, rejected or is in the current cut, its scores and cost. */
export function modelBoard(p: Project): ModelStat[] {
  const verdicts = new Map<Id, TakeVerdict[]>()
  const add = (id: Id, v: TakeVerdict) => verdicts.set(id, [...(verdicts.get(id) ?? []), v])
  for (const s of p.shots) for (const t of [...s.keyframes, ...s.takes]) add(t.asset, t.verdict)
  for (const l of p.locations) for (const u of l.plan?.setups ?? []) for (const t of u.plates ?? []) add(t.asset, t.verdict)
  const cut = latestCut(p)
  const byId = new Map(p.assets.map((a) => [a.id, a]))
  const inCut = new Set<Id>()
  const walk = (id: Id) => {
    if (inCut.has(id)) return
    inCut.add(id)
    for (const i of byId.get(id)?.gen?.inputs ?? []) walk(i)
  }
  for (const t of cut?.timeline ?? []) if (t.asset) walk(t.asset)
  const stats = new Map<string, ModelStat & { faces: number[]; voices: number[] }>()
  for (const a of p.assets) {
    for (const id of new Set((a.gen?.steps ?? []).map((s) => s.model))) {
      const info = modelInfo(id)
      if (!info) continue
      const st = stats.get(id) ?? { model: info, providers: [], assets: [], picked: 0, rejected: 0, inCut: 0, recorded: 0, steps: 0, costUsd: 0, qa: { pass: 0, borderline: 0, fail: 0 }, faces: [], voices: [] }
      const steps = a.gen!.steps!.filter((s) => s.model === id)
      for (const s of steps) {
        if (!st.providers.includes(s.provider)) st.providers.push(s.provider)
        st.steps++
        if (s.job) st.recorded++
        st.costUsd += s.costUsd ?? 0
      }
      const v = verdicts.get(a.id) ?? []
      st.assets.push(a)
      if (v.includes("circled")) st.picked++
      if (v.length && v.every((x) => x === "reject")) st.rejected++
      if (inCut.has(a.id)) st.inCut++
      if (a.scores?.face !== undefined) st.faces.push(a.scores.face)
      if (a.scores?.voice !== undefined) st.voices.push(a.scores.voice)
      if (a.qa) st.qa[a.qa.verdict]++
      stats.set(id, st)
    }
  }
  const mean = (l: number[]) => (l.length ? l.reduce((s, x) => s + x, 0) / l.length : undefined)
  return [...stats.values()]
    .map(({ faces, voices, ...s }) => ({ ...s, face: mean(faces), voice: mean(voices) }))
    .sort((a, b) => MODELS.indexOf(a.model) - MODELS.indexOf(b.model))
}

/** The models that made an asset, in order, by name: "Kling 3.0 Pro + Index TTS 2 + sync lipsync-3". */
export const madeBy = (a?: Asset) => (a?.gen?.steps ?? []).map((s) => modelInfo(s.model)?.name ?? s.model).join(" + ")
