// Derived views. Computed once from the project; every component renders these, never re-derives.

import {
  CHECKS, type Asset, type Character, type Check, type CheckKey, type Cut, type CutShot, type Graphic, type GraphicUse,
  type Id, type Line, type Location, type Mark, type Plan, type Project, type Section, type Setup, type Shot, type Take,
} from "./model"

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
  issues: Issue[]
}

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
      timing: cut?.timeline.find((t) => t.shot === shot.id),
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
  if (!cut) return undefined
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
