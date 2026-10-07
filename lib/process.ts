// The production process: eight stages from script to finish, each with a gate a person approves.
// Who does a stage (an agent, a person or both) is set per project and never hard-coded. A required gate blocks
// every later stage until it is approved (or the stage is skipped); an advisory gate shows its status but blocks
// nothing. Pure helpers only: the ops in lib/ops.ts call these, so the UI and the CLI behave the same.

import type { Id } from "./model"

export type StageId = "script" | "sheets" | "space" | "voice" | "performance" | "pixels" | "cut" | "finish"
export type GateStatus = "pending" | "approved" | "changes" | "rejected"
export type Doer = "agent" | "person" | "both"
export type GateMode = "required" | "advisory"

export type Stage = {
  id: StageId
  name: string
  about: string
  doer: Doer
  gate: GateMode
  status: GateStatus
  skipped?: boolean
  by?: string
  at?: string
}

/** A note on anything in the process: a stage, a concept or a beat. Agents read the open ones and act on them. */
export type Note = { id: Id; target: string; text: string; by: string; at: string; resolved?: boolean; kind?: GateStatus | "comment" }

export type Concept = { id: Id; title: string; logline: string; pitch: string; best: string; button: string; why: string; risk: string; hasScript?: boolean }

export type ScriptLine = { who: string; text: string; how?: string; vo?: boolean }
export type BeatMark = "ok" | "flag"
export type Beat = {
  id: Id
  title: string
  t0: number
  t1: number
  picture: string
  lines: ScriptLine[]
  sound?: string
  camera?: string
  mark?: BeatMark
}

/** Who is in the film, as the script introduces them. Their look is locked later, at the sheets stage. */
export type CastMember = { id: Id; name: string; who: string; playedBy: string; voice: string; states?: string[] }

export type Process = {
  stages: Stage[]
  concepts: Concept[]
  cast?: CastMember[]
  pick?: Id
  /** The beat sheet for the picked concept. Bumped each time an agent rewrites it, which reopens the script gate. */
  script: { version: number; concept?: Id; beats: Beat[] }
  notes: Note[]
}

export const STAGES: { id: StageId; name: string; about: string; doer: Doer; gate: GateMode }[] = [
  { id: "script", name: "Script and beats", about: "A beat sheet first, with a joke in every beat. LLMs draft the prompts, a few at a time.", doer: "both", gate: "required" },
  { id: "sheets", name: "Look and sheets", about: "Image models make stills; faces, wardrobe and rooms are locked before any video. Real photos beat generated ones.", doer: "both", gate: "required" },
  { id: "space", name: "Space and camera", about: "Real plates or one master image per room. 3D only for hard blocking.", doer: "both", gate: "advisory" },
  { id: "voice", name: "Voice", about: "Recorded first, as a performance. Speech-to-speech if the character needs another voice.", doer: "both", gate: "required" },
  { id: "performance", name: "Body and face", about: "An actor on camera, an actor's take transferred, or generated from the sheets.", doer: "both", gate: "advisory" },
  { id: "pixels", name: "Pixels", about: "Seedance, Kling, Veo. 5 to 64 generations per kept shot.", doer: "agent", gate: "advisory" },
  { id: "cut", name: "Pick and cut", about: "Rough assemblies early. Throw out pretty takes that break the character.", doer: "both", gate: "required" },
  { id: "finish", name: "Finish and score", about: "Cleanup, grade, grain. Music, foley, room tone.", doer: "both", gate: "required" },
]

export const newProcess = (): Process => ({
  stages: STAGES.map((s) => ({ ...s, status: "pending" })),
  concepts: [],
  script: { version: 1, beats: [] },
  notes: [],
})

/** The earliest required, unskipped, unapproved stage before this one, if any: the gate that blocks it. */
export function blockedBy(pr: Process, id: StageId): Stage | undefined {
  for (const s of pr.stages) {
    if (s.id === id) return undefined
    if (s.gate === "required" && !s.skipped && s.status !== "approved") return s
  }
  return undefined
}

/** The stage the film is on: the first one not approved and not skipped. */
export const currentStage = (pr: Process) => pr.stages.find((s) => !s.skipped && s.status !== "approved")

export const runtime = (beats: Beat[]) => (beats.length ? Math.max(...beats.map((b) => b.t1)) - Math.min(...beats.map((b) => b.t0)) : 0)
export const words = (beats: Beat[]) => beats.reduce((n, b) => n + b.lines.reduce((m, l) => m + l.text.split(/\s+/).filter(Boolean).length, 0), 0)

export const openNotes = (pr: Process) => pr.notes.filter((n) => !n.resolved)

export const GATE_LABEL: Record<GateStatus, string> = { pending: "Waiting for review", approved: "Approved", changes: "Changes requested", rejected: "Rejected" }
