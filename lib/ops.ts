// Named operations: the only way the project changes. The UI posts them to /api/project,
// the CLI (scripts/stitch.ts) applies the same functions. Pure: (project, op) -> project.

import type {
  ActivityKind, Asset, Axis, CardKey, Character, CheckKey, Cut, Graphic, Id, Location, Mark, Plan, PlanItem, Project, Section,
  Setup, Shot, Take, TakeVerdict,
} from "./model"

/** The editable lists on a floor plan, and the element type each holds. */
export type PlanList = { items: PlanItem; marks: Mark; axes: Axis; setups: Setup }

export type Op =
  | { op: "log"; text: string; kind?: ActivityKind }
  | { op: "asset.add"; asset: Asset }
  | { op: "asset.update"; id: Id; patch: Partial<Omit<Asset, "id">> }
  | { op: "take.add"; shot: Id; asset: Id; list?: "keyframes" | "takes"; verdict?: TakeVerdict; note?: string }
  | { op: "take.set"; shot: Id; asset: Id; verdict: TakeVerdict; note?: string }
  | { op: "shot.add"; shot: Shot; after?: Id }
  | { op: "shot.update"; id: Id; patch: Partial<Omit<Shot, "id">> }
  | { op: "shot.card"; id: Id; field: CardKey; value: string }
  | { op: "shot.move"; id: Id; to: number }
  | { op: "shot.remove"; id: Id }
  | { op: "check.set"; shot: Id; key: CheckKey; ok: boolean | null; note?: string; by?: string }
  | { op: "cut.add"; cut: Cut }
  | { op: "cut.update"; id: Id; patch: Partial<Omit<Cut, "id">> }
  | { op: "cut.remove"; id: Id }
  | { op: "asset.remove"; id: Id }
  | { op: "position.set"; node: Id; x: number; y: number }
  | { op: "character.upsert"; character: Character }
  | { op: "location.upsert"; location: Location }
  | { op: "location.update"; id: Id; patch: Partial<Omit<Location, "id">> }
  | { op: "plan.set"; location: Id; plan: Plan }
  | { op: "plan.resize"; location: Id; width: number; depth: number; height: number }
  | { [K in keyof PlanList]: { op: "plan.upsert"; location: Id; list: K; value: PlanList[K] } }[keyof PlanList]
  | { op: "plan.patch"; location: Id; list: keyof PlanList; id: Id; patch: Record<string, unknown> }
  | { op: "plan.remove"; location: Id; list: keyof PlanList; id: Id }
  | { op: "plan.plate"; location: Id; setup: Id; asset: Id; verdict?: TakeVerdict; note?: string }
  | { op: "character.update"; id: Id; patch: Partial<Omit<Character, "id">> }
  | { op: "graphic.upsert"; graphic: Graphic }
  | { op: "section.upsert"; section: Section }
  | { op: "open.set"; open: string[] }
  | { op: "project.update"; patch: Partial<Pick<Project, "title" | "logline" | "runtimeTarget" | "baselines">> }

const now = () => new Date().toISOString()

function need<T>(x: T | undefined, what: string): T {
  if (x === undefined) throw new Error(`unknown ${what}`)
  return x
}

function mapShot(p: Project, id: Id, f: (s: Shot) => Shot): Project {
  need(p.shots.find((s) => s.id === id), `shot ${id}`)
  return { ...p, shots: p.shots.map((s) => (s.id === id ? f(s) : s)) }
}

function mapPlan(p: Project, loc: Id, f: (plan: Plan) => Plan): Project {
  const l = need(p.locations.find((x) => x.id === loc), `location ${loc}`)
  const plan = need(l.plan, `plan on ${loc}`)
  return { ...p, locations: p.locations.map((x) => (x.id === loc ? { ...x, plan: f(plan) } : x)) }
}

function upsert<T extends { id: Id }>(list: T[], item: T): T[] {
  return list.some((x) => x.id === item.id) ? list.map((x) => (x.id === item.id ? item : x)) : [...list, item]
}

/** Circling a take demotes any other circled take in the same list to "alt". */
function circle(list: Take[], asset: Id, verdict: TakeVerdict, note?: string): Take[] {
  return list.map((t) => {
    if (t.asset === asset) return { ...t, verdict, note: note ?? t.note }
    if (verdict === "circled" && t.verdict === "circled") return { ...t, verdict: "alt" as const }
    return t
  })
}

function setVerdict(s: Shot, asset: Id, verdict: TakeVerdict, note?: string): Shot {
  const inKey = s.keyframes.some((t) => t.asset === asset) ? "keyframes" : s.takes.some((t) => t.asset === asset) ? "takes" : null
  if (!inKey) throw new Error(`asset ${asset} is not a take of shot ${s.id}`)
  return { ...s, [inKey]: circle(s[inKey], asset, verdict, note) }
}

export function applyOp(p: Project, o: Op): Project {
  switch (o.op) {
    case "log":
      return { ...p, activity: [...p.activity, { t: now(), text: o.text, kind: o.kind ?? "info" }].slice(-80) }
    case "asset.add":
      if (p.assets.some((a) => a.id === o.asset.id)) throw new Error(`asset ${o.asset.id} exists`)
      return { ...p, assets: [...p.assets, o.asset] }
    case "asset.update":
      need(p.assets.find((a) => a.id === o.id), `asset ${o.id}`)
      return { ...p, assets: p.assets.map((a) => (a.id === o.id ? { ...a, ...o.patch, scores: { ...a.scores, ...o.patch.scores } } : a)) }
    case "take.add": {
      need(p.assets.find((a) => a.id === o.asset), `asset ${o.asset}`)
      const list = o.list ?? (p.assets.find((a) => a.id === o.asset)!.media === "image" ? "keyframes" : "takes")
      return mapShot(p, o.shot, (s) => {
        if (s[list].some((t) => t.asset === o.asset)) return s
        const added = { ...s, [list]: [...s[list], { asset: o.asset, verdict: "pending" as TakeVerdict, note: o.note }] }
        return o.verdict ? setVerdict(added, o.asset, o.verdict, o.note) : added
      })
    }
    case "take.set":
      return mapShot(p, o.shot, (s) => setVerdict(s, o.asset, o.verdict, o.note))
    case "shot.add": {
      if (p.shots.some((s) => s.id === o.shot.id)) throw new Error(`shot ${o.shot.id} exists`)
      const i = o.after ? p.shots.findIndex((s) => s.id === o.after) + 1 : p.shots.length
      return { ...p, shots: [...p.shots.slice(0, i), o.shot, ...p.shots.slice(i)] }
    }
    case "shot.update":
      return mapShot(p, o.id, (s) => ({ ...s, ...o.patch }))
    case "shot.card":
      return mapShot(p, o.id, (s) => ({ ...s, card: { ...s.card, [o.field]: o.value } }))
    case "shot.move": {
      const s = need(p.shots.find((x) => x.id === o.id), `shot ${o.id}`)
      const rest = p.shots.filter((x) => x.id !== o.id)
      const to = Math.max(0, Math.min(rest.length, o.to))
      return { ...p, shots: [...rest.slice(0, to), s, ...rest.slice(to)] }
    }
    case "shot.remove":
      need(p.shots.find((x) => x.id === o.id), `shot ${o.id}`)
      return { ...p, shots: p.shots.filter((x) => x.id !== o.id) }
    case "check.set":
      return mapShot(p, o.shot, (s) => ({ ...s, checks: { ...s.checks, [o.key]: { ok: o.ok, note: o.note, by: o.by ?? "claude", at: now() } } }))
    case "cut.add":
      return { ...p, cuts: [o.cut, ...p.cuts.filter((c) => c.id !== o.cut.id)] }
    case "cut.update":
      need(p.cuts.find((c) => c.id === o.id), `cut ${o.id}`)
      return { ...p, cuts: p.cuts.map((c) => (c.id === o.id ? { ...c, ...o.patch } : c)) }
    case "cut.remove":
      need(p.cuts.find((c) => c.id === o.id), `cut ${o.id}`)
      return { ...p, cuts: p.cuts.filter((c) => c.id !== o.id) }
    case "asset.remove": {
      need(p.assets.find((a) => a.id === o.id), `asset ${o.id}`)
      const used =
        p.shots.some((s) => [...s.keyframes, ...s.takes].some((t) => t.asset === o.id) || s.lines.some((l) => l.audio === o.id) || s.sfx.some((c) => c.asset === o.id)) ||
        p.characters.some((c) => c.anchors.includes(o.id) || c.sheets.includes(o.id) || c.voice?.ref === o.id) ||
        p.locations.some((l) => l.style.includes(o.id) || l.gradeRef.includes(o.id) || l.props?.includes(o.id) || l.ambience === o.id || l.plan?.setups.some((u) => u.render === o.id || u.plates?.some((t) => t.asset === o.id))) ||
        p.graphics.some((g) => g.preview === o.id) ||
        p.cuts.some((c) => c.asset === o.id) ||
        p.assets.some((a) => a.gen?.inputs?.includes(o.id))
      if (used) throw new Error(`asset ${o.id} is still referenced`)
      return { ...p, assets: p.assets.filter((a) => a.id !== o.id) }
    }
    case "position.set":
      return { ...p, ui: { ...p.ui, positions: { ...p.ui.positions, [o.node]: { x: Math.round(o.x), y: Math.round(o.y) } } } }
    case "character.upsert":
      return { ...p, characters: upsert(p.characters, o.character) }
    case "location.upsert":
      return { ...p, locations: upsert(p.locations, o.location) }
    case "location.update":
      need(p.locations.find((l) => l.id === o.id), `location ${o.id}`)
      return { ...p, locations: p.locations.map((l) => (l.id === o.id ? { ...l, ...o.patch } : l)) }
    case "plan.set":
      need(p.locations.find((l) => l.id === o.location), `location ${o.location}`)
      return { ...p, locations: p.locations.map((l) => (l.id === o.location ? { ...l, plan: o.plan } : l)) }
    case "plan.resize":
      return mapPlan(p, o.location, (plan) => ({ ...plan, width: o.width, depth: o.depth, height: o.height }))
    case "plan.upsert":
      return mapPlan(p, o.location, (plan) => ({ ...plan, [o.list]: upsert(plan[o.list] as { id: Id }[], o.value) }))
    case "plan.patch":
      return mapPlan(p, o.location, (plan) => {
        const list = plan[o.list] as { id: Id }[]
        need(list.find((x) => x.id === o.id), `${o.list} ${o.id}`)
        return { ...plan, [o.list]: list.map((x) => (x.id === o.id ? { ...x, ...o.patch } : x)) }
      })
    case "plan.remove":
      return mapPlan(p, o.location, (plan) => {
        const list = plan[o.list] as { id: Id }[]
        need(list.find((x) => x.id === o.id), `${o.list} ${o.id}`)
        if (o.list === "setups" && p.shots.some((s) => s.location === o.location && s.setup === o.id)) throw new Error(`setup ${o.id} is used by a shot`)
        return { ...plan, [o.list]: list.filter((x) => x.id !== o.id) }
      })
    case "plan.plate": {
      need(p.assets.find((a) => a.id === o.asset), `asset ${o.asset}`)
      return mapPlan(p, o.location, (plan) => {
        need(plan.setups.find((u) => u.id === o.setup), `setup ${o.setup}`)
        const setups = plan.setups.map((u) => {
          if (u.id !== o.setup) return u
          const list = u.plates ?? []
          const added = list.some((t) => t.asset === o.asset) ? list : [...list, { asset: o.asset, verdict: "pending" as TakeVerdict, note: o.note }]
          return { ...u, plates: o.verdict ? circle(added, o.asset, o.verdict, o.note) : added }
        })
        return { ...plan, setups }
      })
    }
    case "character.update":
      need(p.characters.find((c) => c.id === o.id), `character ${o.id}`)
      return { ...p, characters: p.characters.map((c) => (c.id === o.id ? { ...c, ...o.patch } : c)) }
    case "graphic.upsert":
      return { ...p, graphics: upsert(p.graphics, o.graphic) }
    case "section.upsert":
      return { ...p, sections: upsert(p.sections, o.section) }
    case "open.set":
      return { ...p, open: o.open }
    case "project.update":
      return { ...p, ...o.patch }
  }
}

export function applyOps(p: Project, ops: Op[]): Project {
  return ops.reduce(applyOp, p)
}
