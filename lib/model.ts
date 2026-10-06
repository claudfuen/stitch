// The production, as one typed document (data/project.json).
// Every view (Shots, Canvas, Timeline, Final cut) and the renderer derive from this.
// All writes go through named operations in lib/ops.ts, shared by the UI and the CLI.

export type Id = string

export type Verdict = "pass" | "borderline" | "fail"
export type TakeVerdict = "circled" | "alt" | "reject" | "pending"
export type ActivityKind = "run" | "done" | "info" | "warn"

export const CHECKS = [
  { key: "performance", label: "Performance", hint: "Reads true to the character. Deadpan means a still face with alive eyes, no mugging." },
  { key: "lipsync", label: "Lip-sync", hint: "Every visible speaking mouth matches its words. Audio laid over a silent clip fails." },
  { key: "warmup", label: "No warm-up", hint: "The cut starts after the model starts moving. No frozen head frames." },
  { key: "continuity", label: "Continuity", hint: "Hands, props, eyeline and light direction match the neighbouring shots." },
  { key: "grade", label: "Grade", hint: "Matches the location look and the real footage." },
  { key: "cut", label: "Cut point", hint: "Cuts on action or dialogue. No jump cut between identical framings." },
  { key: "sound", label: "Sound", hint: "Room tone continuous, the voice sits in the room, perspective matches the picture." },
  { key: "graphics", label: "Graphics", hint: "Every text and graphic agrees with the picture and the line it plays under." },
  { key: "artifacts", label: "No AI tells", hint: "Hands, teeth, eyes, text, morphs, flicker." },
] as const
export type CheckKey = (typeof CHECKS)[number]["key"]
export type Check = { ok: boolean | null; note?: string; by?: string; at?: string }

export const CARD_FIELDS = [
  { key: "framing", label: "Framing and lens" },
  { key: "blocking", label: "Blocking and eyeline" },
  { key: "performance", label: "Performance" },
  { key: "continuity", label: "Continuity" },
  { key: "sound", label: "Sound" },
  { key: "cut", label: "Cut in and out" },
] as const
export type CardKey = (typeof CARD_FIELDS)[number]["key"]
export type ShotCard = Partial<Record<CardKey, string>>

export type Media = "image" | "video" | "audio"
export type Origin = "real" | "generated" | "rendered" | "recorded"

export type Asset = {
  id: Id
  media: Media
  /** Served path under public/ ("/generated/x.mp4", "/audio/sfx/x.mp3"). The file is public + path. */
  path: string
  label: string
  origin: Origin
  gen?: { model: string; prompt?: string; inputs?: Id[]; job?: string; provider?: string }
  scores?: { face?: number; voice?: number; lufs?: number }
  qa?: { verdict: Verdict; note: string }
  /** For dialogue audio: the words. */
  text?: string
  duration?: number
}

export type Voice = { engine: string; voiceId?: string; ref?: Id; note?: string }
export type Character = {
  id: Id
  name: string
  role: "lead" | "supporting" | "voice"
  /** Real footage stills: the identity ground truth. */
  anchors: Id[]
  /** Generated sheets: wardrobe and angles, never identity evidence. */
  sheets: Id[]
  voice?: Voice
  note?: string
}

export type Look = {
  /** One line of intent: what this place says about the story. */
  concept?: string
  /** Visual references by style (directors, photographers, eras), never specific frames to copy. */
  references?: string
  /** Objects that tell the story and must recur, so the set is the same in every shot. */
  storyProps?: string[]
  /** Clichés this place must avoid. */
  never?: string[]
  palette: string[]
  light: string
  lens: string
  contrast: string
  grain: string
  note?: string
}
export type Location = {
  id: Id
  name: string
  /** Style frames that set the look for every keyframe shot here. */
  style: Id[]
  /** Images the post grade is matched to. Real footage where it exists. */
  gradeRef: Id[]
  ambience?: Id
  /** Recorded room impulse response (convolved into voices laid into this space). Path on this machine, not in the repo. */
  room?: string
  /** Prop references for objects that recur in this location. */
  props?: Id[]
  look: Look
}

export type Section = { id: Id; name: string; color: string; purpose: string }

export type Take = { asset: Id; verdict: TakeVerdict; note?: string }
/** native: spoken inside the clip. laid: audio laid over an on-camera speaker (lip-sync risk). vo: speaker off screen. */
export type LineMode = "native" | "laid" | "vo"
export type Line = { who: Id; text: string; mode: LineMode; audio?: Id; at?: number; tempo?: number; gain?: number }
export type Cue = { asset: Id; at: number; gain?: number }
export type GraphicUse = { graphic: Id; at: number; dur: number }
export type ShotEdit = {
  /** Head trim in seconds, or "auto" (skip the model warm-up, keep 0.25 s before speech). */
  in?: number | "auto"
  /** Tail: seconds, "speech" (0.45 s after the last word) or "end". */
  out?: number | "speech" | "end"
  /** J-cut: this shot's own audio starts this many seconds before its picture. */
  lead?: number
  /** Punch-in scale (1.15 = 15% tighter), to motivate a cut between takes with the same framing. */
  punch?: number
}
export type ShotStatus = "planned" | "shooting" | "review" | "approved"

export type Shot = {
  id: Id
  name: string
  section: Id
  location?: Id
  characters: Id[]
  status: ShotStatus
  card: ShotCard
  prompt?: { keyframe?: string; motion?: string }
  keyframes: Take[]
  takes: Take[]
  /** Title or end cards: a rendered graphic instead of a take. */
  card_graphic?: { graphic: Id; dur: number }
  lines: Line[]
  graphics: GraphicUse[]
  sfx: Cue[]
  edit: ShotEdit
  checks: Partial<Record<CheckKey, Check>>
  note?: string
}

export type Graphic = { id: Id; comp: string; label: string; preview?: Id; note?: string }

export type CutLine = { who: Id; text: string; start: number; end: number; mode: LineMode }
export type CutShot = {
  shot: Id
  start: number
  dur: number
  in: number
  asset: Id | null
  lines: CutLine[]
  graphics: { graphic: Id; start: number; end: number }[]
}
export type Cut = {
  id: Id
  version: string
  date: string
  asset: Id
  duration: number
  timeline: CutShot[]
  notes: string[]
  audit?: { lufs?: number; truePeak?: number; issues?: string[] }
}

export type Activity = { t: string; text: string; kind?: ActivityKind }

export type Project = {
  title: string
  logline: string
  runtimeTarget: number
  baselines: { face: number; faceTarget: number; voice: number }
  sections: Section[]
  characters: Character[]
  locations: Location[]
  assets: Asset[]
  graphics: Graphic[]
  shots: Shot[]
  cuts: Cut[]
  open: string[]
  activity: Activity[]
  ui: { positions: Record<Id, { x: number; y: number }> }
}

export type ProjectWithRev = Project & { rev: number }
