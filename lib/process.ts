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

/** Stage 02: everything that must look the same in every shot, locked before any video. Each item collects candidate
 *  images and a person picks one. Every candidate records the model and provider that made it (or that it is real). */
export type SheetKind = "look" | "cast" | "location" | "prop"
export type Candidate = { file: string; model: string; provider: string; job?: string; prompt?: string; cost?: number; inputs?: string[]; by: string; at: string; view?: string }
export type SheetItem = {
  id: Id
  kind: SheetKind
  name: string
  brief: string
  /** Made from another item's picked image (a second look of the same person), so it waits for that pick. */
  from?: Id
  candidates: Candidate[]
  /** The picked candidate's file. */
  pick?: string
  pickedBy?: string
  /** The character inside the world, in the film's look: what a person reviews (the sheet is what the models use). */
  scene?: Candidate
  /** The full sheet made from the pick: separate images per view (front, profile, full body, expressions). */
  views?: Candidate[]
  /** Lock test: in how many of `of` new scenes the sheet still gave a recognisably identical person. Locked at 10/10. */
  lock?: { pass: number; of: number; note?: string }
}

/** Stage 03: where everyone is and where the cameras go, so cuts keep screen direction and the video model never has
 *  to invent the room. Per room: a written space map (it goes into every prompt), and 2-4 cameras, each one frame of the
 *  approved set seen from that angle with the cast on their marks. The first camera is the wide master that loads the
 *  layout. Across the film, a camera script says which camera is on screen at each second. No 3D unless blocking is
 *  hard (research note 2026-10-07-sota-ai-film-vs-stitch). */
export type FilmLook = "colour" | "before"
export type Camera = {
  /** The tag prompts recall it by ("C3"). */
  id: Id
  name: string
  /** Shot size: EWS, WS, MWS, MS, MCU, CU, INS. */
  size: string
  lens: number
  /** Where the camera stands and what it sees. */
  from: string
  /** The story or comedy reason for the angle. */
  why: string
  /** What is behind the camera, so no model builds a reverse wall or moves a sign. */
  behind?: string
  /** Overrides the room's look (the auditor's colour testimonial in the black-and-white audit room). */
  look?: FilmLook
  /** The grey-box render from this camera (rooms with hard blocking only): it fixes framing, positions and screen
   *  direction, and is Image 1 when the frame is made. Built from data/space/<film>/<room>.json by scripts/greybox.py. */
  layout?: string
  frame?: Candidate
}
export type Room = { id: Id; name: string; sheet?: Id; look: FilmLook; map: string; cameras: Camera[] }
export type CameraCut = { t0: number; t1: number; room: Id; cam: Id; what: string }
export type Space = { rooms: Room[]; cuts: CameraCut[] }

/** Stage 04. Each role gets a voice picked from auditions; then the whole film is read in one take, so every line
 *  answers the one before it. Lines are cut from the take with their times; Henrick's are converted to his real voice. */
/** One voice reading a role's own lines. `source`: a stock voice, one from the ElevenLabs Voice Library, one made by
 *  Voice Design from the role's brief, a clone of the real person, or a conversion to their real recording. `match` is
 *  the speaker similarity to the real person's recording (real roles only). */
export type Audition = { voice: string; file: string; model: string; provider: string; job?: string; at: string; source?: "stock" | "library" | "designed" | "clone" | "converted"; about?: string; voiceId?: string; match?: number }
export type VoiceRole = { who: Id; voice?: string; real?: boolean; auditions: Audition[]; note?: string }
export type VoiceLine = { n: number; beat: Id; who: Id; text: string; start: number; end: number; file: string; match?: number }
export type VoiceTake = { id: Id; file: string; model: string; provider: string; job?: string; cast: Record<string, string>; duration: number; lines: VoiceLine[]; note?: string; at: string }
/** A performance converted to the role's voice by speech-to-speech: the timing, melody and accent stay the performer's,
 *  the timbre becomes the role's. `match` as on Audition. */
export type Conversion = { file: string; model: string; provider: string; voice: string; voiceId: string; job?: string; match?: number; at: string }
/** A line a person performed into the app's recorder, saved as recorded (`file`), then converted to the role's voice.
 *  `n` and `text` are the line's in the read; `error` says why there is no conversion yet. */
export type Performance = { id: Id; n: number; who: Id; text: string; file: string; duration?: number; by: string; at: string; converted?: Conversion; error?: string }
export type Voice = { roles: VoiceRole[]; takes: VoiceTake[]; pick?: Id; performances?: Performance[] }

/** Which beats each camera is used in, from the camera script (the one source of truth for it). */
export const beatsOf = (pr: Process, room: Id, cam: Id) =>
  [...new Set((pr.space?.cuts ?? []).filter((c) => c.room === room && c.cam === cam).map((c) => pr.script.beats.find((b) => c.t0 >= b.t0 && c.t0 < b.t1)?.id).filter((x): x is Id => !!x))]

/** Who is in the film, as the script introduces them. Their look is locked later, at the sheets stage. */
export type CastMember = { id: Id; name: string; who: string; playedBy: string; voice: string; states?: string[] }

export type Process = {
  stages: Stage[]
  concepts: Concept[]
  cast?: CastMember[]
  sheets?: SheetItem[]
  space?: Space
  voice?: Voice
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
