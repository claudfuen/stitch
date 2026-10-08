// Named operations: the only way the project changes. The UI posts them to /api/project,
// the CLI (scripts/stitch.ts) applies the same functions. Pure: (project, op) -> project.

import type {
  ActivityKind, Asset, Axis, CardKey, Character, CheckKey, Cut, GenStep, Graphic, Id, Location, Mark, Plan, PlanItem, Project,
  Section, Setup, Shot, Take, TakeVerdict,
} from "./model"
import { checkSteps, modelInfo } from "./models"
import { blockedBy, newProcess, type Beat, type BeatMark, type Candidate, type CastMember, type Concept, type SheetItem, type Doer, type GateMode, type GateStatus, type Generation, type Performance, type Process, type Scene, type SetTake, type Space, type StageId, type Voice, type VoiceTake } from "./process"

/** The editable lists on a floor plan, and the element type each holds. */
export type PlanList = { items: PlanItem; marks: Mark; axes: Axis; setups: Setup }

export type Op =
  | { op: "log"; text: string; kind?: ActivityKind }
  | { op: "asset.add"; asset: Asset }
  | { op: "asset.update"; id: Id; patch: Partial<Omit<Asset, "id">> }
  /** Record how an asset was made: its generation steps in order (models from lib/models.ts). Replaces earlier steps. */
  | { op: "asset.attribute"; id: Id; steps: GenStep[] }
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
  // The stage-gated process (lib/process.ts). `by` is who acted: a person's name, or an agent's.
  /** Set a stage's gate. Refused while an earlier required gate is open. A note is kept with the decision. */
  | { op: "gate.set"; stage: StageId; status: GateStatus; note?: string; by?: string }
  | { op: "stage.update"; stage: StageId; patch: { doer?: Doer; gate?: GateMode; skipped?: boolean } }
  /** Pick a concept (or clear the pick with null). The script gate reopens. */
  | { op: "concept.pick"; id: Id | null; note?: string; by?: string }
  | { op: "concept.upsert"; concept: Concept }
  /** Replace the cast list the script introduces (who they are, who plays them, how they sound). */
  | { op: "cast.set"; cast: CastMember[] }
  /** Stage 02 items: add or replace one, add a candidate image (model and provider required), pick one or clear. */
  | { op: "sheet.upsert"; item: Omit<SheetItem, "candidates"> & { candidates?: Candidate[] } }
  | { op: "sheet.add"; id: Id; candidate: Candidate }
  | { op: "sheet.pick"; id: Id; file: string | null; by?: string }
  /** Add one view to the item's full sheet (model and provider required). */
  | { op: "sheet.view"; id: Id; candidate: Candidate }
  /** Take views off the item's sheet (a regenerated sheet replaces the old one). */
  | { op: "sheet.unview"; id: Id; views: string[] }
  /** Stage 03: the rooms, their cameras and space maps, and the camera script. Replaces the plan; frames already made
   *  for a camera that keeps its room and id stay on it. */
  | { op: "space.set"; space: Space; by?: string }
  /** A frame of the set from one camera, with the cast on their marks (model and provider required). */
  | { op: "space.frame"; room: Id; cam: Id; candidate: Candidate }
  | { op: "voice.set"; voice: Voice; by?: string }
  | { op: "voice.cast"; who: Id; voice: string; by?: string }
  | { op: "voice.pick"; take: Id; by?: string }
  /** A line performed into the recorder, or its conversion to the role's voice: adds or replaces it by id. */
  | { op: "voice.perform"; performance: Performance; by?: string }
  /** The take to use for a line (a performance id), or none (null). One per line. */
  | { op: "voice.keep"; n: number; id: Id | null; by?: string }
  /** Hide a take from the list (its files stay on disk), or bring it back with removed: false. */
  | { op: "voice.remove"; id: Id; removed?: boolean; by?: string }
  /** A scene-mode recording (its lines arrive as voice.perform). Adds or replaces it by id. */
  | { op: "voice.scene"; scene: Scene; by?: string }
  /** A read built from performed takes: adds or replaces it by id, and makes it the picked read when `pick`. */
  | { op: "voice.read"; take: VoiceTake; pick?: boolean; by?: string }
  /** Stage 06: a set's take (its shots and blockout). Adds or replaces it by id; generations and the pick are kept
   *  unless given. */
  | { op: "pixels.take"; take: Omit<SetTake, "gens"> & { gens?: Generation[] }; by?: string }
  /** A generation of a take (running, done or failed): adds or replaces it by id. */
  | { op: "pixels.gen"; take: Id; gen: Generation; by?: string }
  /** The generation to slice the take from, or none. */
  | { op: "pixels.pick"; take: Id; gen: Id | null; by?: string }
  | { op: "sheet.lock"; id: Id; pass: number; of: number; note?: string }
  | { op: "sheet.scene"; id: Id; candidate: Candidate }
  /** Replace the beat sheet (an agent's rewrite). Bumps the version and reopens the script gate. */
  | { op: "script.set"; beats: Beat[]; concept?: Id; by?: string; note?: string }
  | { op: "beat.mark"; id: Id; mark: BeatMark | null; by?: string }
  /** A note on a stage ("stage:script"), a concept ("concept:A") or a beat ("beat:7"). */
  | { op: "note.add"; target: string; text: string; by?: string }
  | { op: "note.resolve"; id: Id; resolved?: boolean }

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
/** A display label for steps that came without one: "Kling 3.0 Pro (leap) + sync lipsync-3 (leap)". */
const stepLabel = (steps: GenStep[] = []) => steps.map((s) => `${modelInfo(s.model)?.name ?? s.model} (${s.provider})`).join(" + ")

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
    case "asset.add": {
      if (p.assets.some((a) => a.id === o.asset.id)) throw new Error(`asset ${o.asset.id} exists`)
      // Attribution: anything that is not a real photo or recording says which models made it.
      const bad = o.asset.origin === "real" || o.asset.origin === "recorded" ? undefined : checkSteps(o.asset.gen?.steps)
      if (bad) throw new Error(`asset ${o.asset.id}: ${bad}. Pass its steps (stitch asset add --step model@provider:job, or a sidecar next to --from)`)
      const gen = o.asset.gen && { ...o.asset.gen, model: o.asset.gen.model || stepLabel(o.asset.gen.steps) }
      return { ...p, assets: [...p.assets, gen ? { ...o.asset, gen } : o.asset] }
    }
    case "asset.update": {
      const cur = need(p.assets.find((a) => a.id === o.id), `asset ${o.id}`)
      // gen merges, so a patch that sets a prompt or label keeps the recorded steps.
      const gen = o.patch.gen && { ...cur.gen, ...o.patch.gen }
      const bad = gen?.steps && checkSteps(gen.steps)
      if (bad) throw new Error(`asset ${o.id}: ${bad}`)
      // A null in the patch removes that field.
      return { ...p, assets: p.assets.map((a) => (a.id === o.id ? (Object.fromEntries(Object.entries({ ...a, ...o.patch, ...(gen ? { gen } : {}), scores: { ...a.scores, ...o.patch.scores } }).filter(([, v]) => v !== null)) as Asset) : a)) }
    }
    case "asset.attribute": {
      const cur = need(p.assets.find((a) => a.id === o.id), `asset ${o.id}`)
      const bad = checkSteps(o.steps)
      if (bad) throw new Error(`asset ${o.id}: ${bad}`)
      const gen = { ...cur.gen, model: cur.gen?.model || stepLabel(o.steps), steps: o.steps }
      return { ...p, assets: p.assets.map((a) => (a.id === o.id ? { ...a, gen } : a)) }
    }
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
    case "gate.set":
    case "stage.update":
    case "concept.pick":
    case "concept.upsert":
    case "cast.set":
    case "sheet.upsert":
    case "sheet.add":
    case "sheet.pick":
    case "sheet.view":
    case "sheet.unview":
    case "space.set":
    case "space.frame":
    case "voice.set":
    case "voice.cast":
    case "voice.pick":
    case "voice.perform":
    case "voice.keep":
    case "voice.remove":
    case "voice.scene":
    case "voice.read":
    case "pixels.take":
    case "pixels.gen":
    case "pixels.pick":
    case "sheet.lock":
    case "sheet.scene":
    case "script.set":
    case "beat.mark":
    case "note.add":
    case "note.resolve":
    {
      const process = applyProcessOp(p.process ?? newProcess(), o)
      const said = o.op === "gate.set" ? `${process.stages.find((x) => x.id === o.stage)?.name}: ${o.status}${o.note ? ` - ${o.note}` : ""}` : o.op === "concept.pick" ? `Concept picked: ${o.id ?? "none"}` : o.op === "script.set" ? `Beat sheet v${process.script.version} written` : o.op === "note.add" ? `Note on ${o.target}: ${o.text}` : o.op === "sheet.pick" ? `Picked for ${o.id}: ${o.file ?? "none"}` : o.op === "sheet.add" ? `Candidate for ${o.id}: ${o.candidate.file} (${o.candidate.model} via ${o.candidate.provider})` : o.op === "space.set" ? `Space and camera: ${o.space.rooms.length} rooms, ${o.space.rooms.reduce((n, r) => n + r.cameras.length, 0)} cameras, ${o.space.cuts.length} cuts` : o.op === "space.frame" ? `Frame for ${o.room} ${o.cam} (${o.candidate.model} via ${o.candidate.provider})` : o.op === "voice.set" ? `Voice: ${o.voice.roles.length} roles, ${o.voice.takes.length} ${o.voice.takes.length === 1 ? "take" : "takes"}` : o.op === "voice.cast" ? `Voice for ${o.who}: ${o.voice}` : o.op === "voice.pick" ? `Voice take picked: ${o.take}` : o.op === "voice.perform" ? performed(o.performance) : o.op === "voice.keep" ? (o.id ? `Line ${o.n}: take ${o.id} picked` : `Line ${o.n}: no take picked`) : o.op === "voice.remove" ? `Take ${o.id} ${o.removed === false ? "restored" : "removed"}` : o.op === "voice.scene" ? `Scene performed by ${o.scene.by} as ${o.scene.who === "all" ? "every part" : o.scene.who}: ${o.scene.events.filter((e) => e.kind === "mine").length} lines` : o.op === "voice.read" ? `Read ${o.take.id} built: ${o.take.lines.length} lines, ${Math.round(o.take.duration)} s` : o.op === "pixels.take" ? `Take ${o.take.name}: ${o.take.shots.length} shots, ${Math.round(o.take.to - o.take.from)} s${o.take.blockout ? ", blockout rendered" : ""}` : o.op === "pixels.gen" ? `Take ${o.take}: ${o.gen.model} ${o.gen.status}${o.gen.error ? ` (${o.gen.error})` : ""}` : o.op === "pixels.pick" ? `Take ${o.take}: generation ${o.gen ?? "none"} picked` : null
      const activity = said ? [...p.activity, { t: now(), text: `${("by" in o && o.by) || "claude"} · ${said}`, kind: "info" as const }].slice(-80) : p.activity
      return { ...p, process, activity }
    }
  }
}

type ProcessOp = Extract<Op, { op: "gate.set" | "stage.update" | "concept.pick" | "concept.upsert" | "cast.set" | "sheet.upsert" | "sheet.add" | "sheet.pick" | "sheet.view" | "sheet.unview" | "space.set" | "space.frame" | "voice.set" | "voice.cast" | "voice.pick" | "voice.perform" | "voice.keep" | "voice.remove" | "voice.scene" | "voice.read" | "pixels.take" | "pixels.gen" | "pixels.pick" | "sheet.lock" | "sheet.scene" | "script.set" | "beat.mark" | "note.add" | "note.resolve" }>

let seq = 0
const noteId = () => `n${Date.now().toString(36)}${(seq++).toString(36)}`

const performed = (p: Performance) =>
  p.converted ? `Line ${p.n} (${p.who}) converted to ${p.converted.voice}${p.converted.match !== undefined ? `, match ${p.converted.match.toFixed(2)}` : ""}` : p.error ? `Line ${p.n} (${p.who}) not converted: ${p.error}` : `Line ${p.n} (${p.who}) performed by ${p.by}`

function addNote(pr: Process, target: string, text: string | undefined, by: string, kind: GateStatus | "comment" = "comment"): Process {
  if (!text?.trim()) return pr
  return { ...pr, notes: [...pr.notes, { id: noteId(), target, text: text.trim(), by, at: now(), kind }] }
}

function setStage(pr: Process, id: StageId, patch: Partial<Process["stages"][number]>): Process {
  need(pr.stages.find((s) => s.id === id), `stage ${id}`)
  return { ...pr, stages: pr.stages.map((s) => (s.id === id ? { ...s, ...patch } : s)) }
}

function applyProcessOp(pr: Process, o: ProcessOp): Process {
  const by = ("by" in o && o.by) || "claude"
  switch (o.op) {
    case "gate.set": {
      const block = blockedBy(pr, o.stage)
      if (block && o.status !== "pending") throw new Error(`"${block.name}" must be approved first`)
      if (o.stage === "script" && o.status === "approved" && !pr.script.beats.length) throw new Error("there is no beat sheet to approve yet")
      const next = setStage(pr, o.stage, { status: o.status, by, at: now() })
      return addNote(next, `stage:${o.stage}`, o.note, by, o.status)
    }
    case "stage.update":
      return setStage(pr, o.stage, o.patch)
    case "concept.pick": {
      if (o.id !== null) need(pr.concepts.find((c) => c.id === o.id), `concept ${o.id}`)
      const next = setStage({ ...pr, pick: o.id ?? undefined }, "script", { status: "pending", by, at: now() })
      return addNote(next, `concept:${o.id ?? "none"}`, o.note, by)
    }
    case "concept.upsert":
      return { ...pr, concepts: pr.concepts.some((c) => c.id === o.concept.id) ? pr.concepts.map((c) => (c.id === o.concept.id ? o.concept : c)) : [...pr.concepts, o.concept] }
    case "cast.set":
      return { ...pr, cast: o.cast }
    case "sheet.upsert": {
      const list = pr.sheets ?? []
      const old = list.find((x) => x.id === o.item.id)
      const item = { ...old, ...o.item, candidates: o.item.candidates ?? old?.candidates ?? [] }
      return { ...pr, sheets: old ? list.map((x) => (x.id === item.id ? item : x)) : [...list, item] }
    }
    case "sheet.add": {
      if (!o.candidate.model || !o.candidate.provider) throw new Error("a candidate needs its model and provider")
      const list = pr.sheets ?? []
      need(list.find((x) => x.id === o.id), `sheet ${o.id}`)
      return { ...pr, sheets: list.map((x) => (x.id === o.id ? { ...x, candidates: [...x.candidates.filter((c) => c.file !== o.candidate.file), o.candidate] } : x)) }
    }
    case "sheet.pick": {
      const list = pr.sheets ?? []
      const item = need(list.find((x) => x.id === o.id), `sheet ${o.id}`)
      if (o.file !== null) need(item.candidates.find((c) => c.file === o.file), `candidate ${o.file}`)
      return { ...pr, sheets: list.map((x) => (x.id === o.id ? { ...x, pick: o.file ?? undefined, pickedBy: o.file ? (o.by ?? "claude") : undefined } : x)) }
    }
    case "sheet.view": {
      if (!o.candidate.model || !o.candidate.provider) throw new Error("a view needs its model and provider")
      const list = pr.sheets ?? []
      need(list.find((x) => x.id === o.id), `sheet ${o.id}`)
      return { ...pr, sheets: list.map((x) => (x.id === o.id ? { ...x, views: [...(x.views ?? []).filter((v) => v.view !== o.candidate.view), o.candidate] } : x)) }
    }
    case "sheet.unview": {
      const list = pr.sheets ?? []
      need(list.find((x) => x.id === o.id), `sheet ${o.id}`)
      return { ...pr, sheets: list.map((x) => (x.id === o.id ? { ...x, views: (x.views ?? []).filter((v) => !o.views.includes(v.view ?? "")) } : x)) }
    }
    case "space.set": {
      const old = pr.space?.rooms ?? []
      const rooms = o.space.rooms.map((r) => ({ ...r, cameras: r.cameras.map((c) => ({ ...c, frame: c.frame ?? old.find((x) => x.id === r.id)?.cameras.find((x) => x.id === c.id)?.frame })) }))
      return { ...pr, space: { rooms, cuts: [...o.space.cuts].sort((a, b) => a.t0 - b.t0) } }
    }
    case "space.frame": {
      if (!o.candidate.model || !o.candidate.provider) throw new Error("a frame needs its model and provider")
      const rooms = pr.space?.rooms ?? []
      need(rooms.find((r) => r.id === o.room)?.cameras.find((c) => c.id === o.cam), `camera ${o.room}/${o.cam}`)
      return { ...pr, space: { ...pr.space!, rooms: rooms.map((r) => (r.id === o.room ? { ...r, cameras: r.cameras.map((c) => (c.id === o.cam ? { ...c, frame: o.candidate } : c)) } : r)) } }
    }
    case "voice.set": {
      // Keep a person's picks when an agent rewrites the proposal, as long as the voice they picked is still auditioned.
      const old = pr.voice
      const kept = (r: Voice["roles"][number]) => { const v = old?.roles.find((x) => x.who === r.who)?.voice; return v && r.auditions.some((a) => a.voice === v) ? v : undefined }
      const roles = o.voice.roles.map((r) => ({ ...r, voice: r.voice ?? kept(r) }))
      return { ...pr, voice: { roles, takes: o.voice.takes, pick: o.voice.pick ?? old?.pick, performances: o.voice.performances ?? old?.performances, picks: o.voice.picks ?? old?.picks, scenes: o.voice.scenes ?? old?.scenes } }
    }
    case "voice.scene": {
      const v = need(pr.voice, "voice")
      const list = v.scenes ?? []
      return { ...pr, voice: { ...v, scenes: list.some((x) => x.id === o.scene.id) ? list.map((x) => (x.id === o.scene.id ? o.scene : x)) : [...list, o.scene] } }
    }
    case "pixels.take": {
      const list = pr.takes ?? []
      const old = list.find((t) => t.id === o.take.id)
      const next: SetTake = { ...o.take, gens: o.take.gens ?? old?.gens ?? [], pick: o.take.pick ?? old?.pick }
      return { ...pr, takes: old ? list.map((t) => (t.id === o.take.id ? next : t)) : [...list, next] }
    }
    case "pixels.gen": {
      const t = need(pr.takes?.find((x) => x.id === o.take), `take ${o.take}`)
      const gens = t.gens.some((g) => g.id === o.gen.id) ? t.gens.map((g) => (g.id === o.gen.id ? o.gen : g)) : [...t.gens, o.gen]
      return { ...pr, takes: pr.takes!.map((x) => (x.id === o.take ? { ...x, gens } : x)) }
    }
    case "pixels.pick": {
      const t = need(pr.takes?.find((x) => x.id === o.take), `take ${o.take}`)
      if (o.gen) need(t.gens.find((g) => g.id === o.gen && g.status === "done"), `finished generation ${o.gen}`)
      return { ...pr, takes: pr.takes!.map((x) => (x.id === o.take ? { ...x, pick: o.gen ?? undefined } : x)) }
    }
    case "voice.read": {
      const v = need(pr.voice, "voice")
      const takes = v.takes.some((t) => t.id === o.take.id) ? v.takes.map((t) => (t.id === o.take.id ? o.take : t)) : [...v.takes, o.take]
      return { ...pr, voice: { ...v, takes, pick: o.pick ? o.take.id : v.pick } }
    }
    case "voice.perform": {
      const v = need(pr.voice, "voice")
      const list = v.performances ?? []
      const has = list.some((x) => x.id === o.performance.id)
      // A conversion finishing after the take was removed must not bring it back.
      return { ...pr, voice: { ...v, performances: has ? list.map((x) => (x.id === o.performance.id ? { ...o.performance, removed: x.removed } : x)) : [...list, o.performance] } }
    }
    case "voice.keep": {
      const v = need(pr.voice, "voice")
      if (o.id) need(v.performances?.find((x) => x.id === o.id && x.n === o.n && !x.removed), `take ${o.id} on line ${o.n}`)
      const picks = { ...v.picks }
      if (o.id) picks[o.n] = o.id
      else delete picks[o.n]
      return { ...pr, voice: { ...v, picks } }
    }
    case "voice.remove": {
      const v = need(pr.voice, "voice")
      const p = need(v.performances?.find((x) => x.id === o.id), `take ${o.id}`)
      const removed = o.removed ?? true
      const picks = { ...v.picks }
      // Removing the picked take falls back to the newest take left on the line, so the read keeps a performance.
      if (removed && picks[p.n] === p.id) {
        const next = (v.performances ?? []).filter((x) => x.n === p.n && x.id !== p.id && !x.removed && x.converted).sort((a, b) => b.at.localeCompare(a.at))[0]
        if (next) picks[p.n] = next.id
        else delete picks[p.n]
      }
      return { ...pr, voice: { ...v, picks, performances: (v.performances ?? []).map((x) => (x.id === o.id ? { ...x, removed: removed || undefined } : x)) } }
    }
    case "voice.cast": {
      const v = need(pr.voice, "voice")
      need(v.roles.find((r) => r.who === o.who), `role ${o.who}`)
      return { ...pr, voice: { ...v, roles: v.roles.map((r) => (r.who === o.who ? { ...r, voice: o.voice } : r)) } }
    }
    case "voice.pick": {
      const v = need(pr.voice, "voice")
      need(v.takes.find((t) => t.id === o.take), `take ${o.take}`)
      return { ...pr, voice: { ...v, pick: o.take } }
    }
    case "sheet.scene": {
      if (!o.candidate.model || !o.candidate.provider) throw new Error("a scene needs its model and provider")
      const list = pr.sheets ?? []
      need(list.find((x) => x.id === o.id), `sheet ${o.id}`)
      return { ...pr, sheets: list.map((x) => (x.id === o.id ? { ...x, scene: o.candidate } : x)) }
    }
    case "sheet.lock": {
      const list = pr.sheets ?? []
      need(list.find((x) => x.id === o.id), `sheet ${o.id}`)
      return { ...pr, sheets: list.map((x) => (x.id === o.id ? { ...x, lock: { pass: o.pass, of: o.of, note: o.note } } : x)) }
    }
    case "script.set": {
      const next = setStage({ ...pr, script: { version: pr.script.version + 1, concept: o.concept ?? pr.script.concept ?? pr.pick, beats: o.beats } }, "script", { status: "pending", by, at: now() })
      return addNote(next, "stage:script", o.note, by)
    }
    case "beat.mark":
      need(pr.script.beats.find((b) => b.id === o.id), `beat ${o.id}`)
      return { ...pr, script: { ...pr.script, beats: pr.script.beats.map((b) => (b.id === o.id ? { ...b, mark: o.mark ?? undefined } : b)) } }
    case "note.add":
      return addNote(pr, o.target, o.text, by)
    case "note.resolve":
      need(pr.notes.find((n) => n.id === o.id), `note ${o.id}`)
      return { ...pr, notes: pr.notes.map((n) => (n.id === o.id ? { ...n, resolved: o.resolved ?? true } : n)) }
  }
}

export function applyOps(p: Project, ops: Op[]): Project {
  return ops.reduce(applyOp, p)
}
