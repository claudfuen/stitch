// One-time migration: the old canvas graph + cut manifest -> data/project.json (faithful to cut v3).
// Changes after this point go through ops, so the activity log shows them.
import { readFileSync, writeFileSync } from "node:fs"
import type { Asset, Character, Check, CheckKey, Cut, Graphic, Line, Location, Project, Section, Shot, Take } from "../lib/model"

const legacy = JSON.parse(readFileSync("work/legacy/graph.json", "utf8"))
const A: Asset[] = []
const add = (a: Asset) => (A.push(a), a.id)
const img = (id: string, path: string, label: string, origin: Asset["origin"], extra: Partial<Asset> = {}) => add({ id, media: "image", path, label, origin, ...extra })
const vid = (id: string, label: string, model: string, inputs: string[], face?: number, voice?: number, qa?: Asset["qa"]) =>
  add({ id, media: "video", path: `/generated/${id}.mp4`, label, origin: "generated", gen: { model, inputs }, scores: { face, voice }, qa })
const gen = (model: string, inputs: string[] = [], prompt?: string) => ({ gen: { model, inputs, prompt } })

// Real anchors: frames of Henrick's real Comp AI study footage.
const REAL: [string, string, string][] = [
  ["hen-real-37", "real-37.3", "Three-quarter right, gesturing"],
  ["hen-real-38", "real-38.3", "Three-quarter right, seated"],
  ["hen-real-49", "real-49.4", "Side-on, seated"],
  ["hen-real-53", "real-53.5", "Close-up, eyes and glasses"],
  ["hen-real-54", "real-54.5", "Close-up, angled"],
  ["hen-real-56", "real-56.4", "Front, medium"],
]
for (const [id, f, label] of REAL) img(id, `/characters/henrick/real/${f}.jpg`, label, "real")
const realAll = REAL.map((r) => r[0])

const GI = "gpt_image_2_5"
img("hen-sheet", "/generated/hen-sheet2.jpg", "Turnaround sheet (real refs only, 4K)", "generated", { ...gen(GI, realAll), scores: { face: 0.71 } })
img("hen-faces", "/generated/hen-faces2.jpg", "Face grid, 9 angles", "generated", { ...gen(GI, realAll), scores: { face: 0.74 } })
img("hen-poses", "/generated/hen-poses-b23dcd.jpg", "Full-body poses", "generated", gen(GI, ["hen-sheet", "hen-real-37", "hen-real-56"]))
img("founder-sheet", "/generated/ref-founder-e6c025.jpg", "Founder sheet (original character)", "generated", gen(GI))
img("clerk-sheet", "/generated/ref-clerk-7f519b.jpg", "Clerk sheet (original character)", "generated", gen(GI))

// Keyframes.
const kf = (id: string, file: string, label: string, inputs: string[], face?: number) =>
  img(id, `/generated/${file}.jpg`, label, "generated", { ...gen(GI, inputs), scores: { face } })
kf("k1-c7e01b", "k1-c7e01b", "Two-shot, study", ["hen-sheet", "founder-sheet"], 0.6)
kf("k1-9729b5", "k1-9729b5", "Two-shot, study (sheet only)", ["hen-sheet"])
kf("hen-cu2-5dc6a6", "hen-cu2-5dc6a6", "Henrick close-up, edit of real still", ["hen-real-53"], 0.82)
kf("hen-cu-c08f9e", "hen-cu-c08f9e", "Henrick close-up, from sheet", ["hen-sheet", "hen-real-37", "hen-real-49", "hen-real-56"], 0.67)
kf("k2-b1c03f", "k2-b1c03f", "Waiting hall, edit of real still", ["hen-real-56", "founder-sheet"], 0.7)
kf("k2-f2b22d", "k2-f2b22d", "Waiting hall, from sheets", ["hen-sheet", "founder-sheet"], 0.63)
kf("k2-0ffd5b", "k2-0ffd5b", "Waiting hall, sheet only", ["hen-sheet"])
kf("k3-ad4425", "k3-ad4425", "Counter, clerk straight-on", ["clerk-sheet", "founder-sheet", "hen-sheet"])
kf("k3-ff0889", "k3-ff0889", "Counter, clerk three-quarter", ["hen-sheet", "founder-sheet", "clerk-sheet"])
kf("k3-88032e", "k3-88032e", "Counter, clerk from behind", ["hen-sheet", "founder-sheet", "clerk-sheet"])
kf("k4-392e0b", "k4-392e0b", "Eleven years, edit of real still", ["hen-real-56", "founder-sheet"], 0.77)
kf("k4-17c017", "k4-17c017", "Eleven years, from sheets", ["hen-sheet", "founder-sheet"], 0.58)
kf("k4-b7536a", "k4-b7536a", "Eleven years, sheet only", ["hen-sheet"])
kf("k5-9d532d", "k5-9d532d", "Office, founder relieved", ["founder-sheet"])
kf("k6-edit-a", "k6_edit_a", "Green glow close-up, edit of real still", ["hen-real-53"], 0.77)
kf("kb6-5bef70", "kb6-5bef70", "Green glow close-up, edit of real still (B)", ["hen-real-53"], 0.78)
kf("k6-1a2339", "k6-1a2339", "Green glow close-up, from sheet", ["hen-sheet"], 0.5)
kf("kb6-061d2f", "kb6-061d2f", "Green glow close-up, sheet + stills", ["hen-sheet", "hen-real-37", "hen-real-49", "hen-real-56"])
kf("k7-edit-a", "k7_edit_a", "Binder in the bin, edit of real still", ["hen-real-56"], 0.75)
kf("k7-27b9e4", "k7-27b9e4", "Binder in the bin, edit of real still (B)", ["hen-real-56"], 0.76)
kf("k7-5cda9e", "k7-5cda9e", "Binder in the bin, from sheet", ["hen-sheet"], 0.36)
kf("kb7-36c2bb", "kb7-36c2bb", "Binder in the bin, sheet + stills", ["hen-sheet", "hen-real-37", "hen-real-49", "hen-real-56"])

// Voice reference: Henrick's four real isolated lines.
add({ id: "voice-henrick", media: "audio", path: "/audio/voice/henrick-reference.mp3", label: "Henrick voice reference (4 real lines)", origin: "real" })

// Video takes.
const K = "Kling 3.0 pro, first frame, silent"
const S = "Seedance 2.5 omni_reference 1080p, voice ref"
const VREF = "voice-henrick"
vid("v1-4d8d86", "Two-shot, founder pleads", K, ["k1-c7e01b"], 0.5, undefined, { verdict: "borderline", note: "Founder's line is laid over a silent clip" })
vid("s1b-friday", "\"Friday.\"", S, ["hen-cu2-5dc6a6", "hen-real-53", "hen-real-56", "hen-real-37", VREF], 0.82, 0.71, { verdict: "pass", note: "Words exact, face at the real-footage ceiling" })
vid("s1b-europe", "\"In Europe, we would begin by weeping.\"", S, ["hen-cu2-5dc6a6", "hen-real-53", "hen-real-56", "hen-real-37", VREF], 0.81, 0.85, { verdict: "pass", note: "Words exact" })
add({ id: "hen-cu-402202", media: "video", path: "/generated/hen-cu-402202.mp4", label: "Seedance 480p draft, two lines", origin: "generated", gen: { model: "Seedance 2.5 draft 480p", inputs: ["hen-cu-c08f9e", "hen-sheet", "hen-real-37", VREF] }, scores: { face: 0.67, voice: 0.86 }, qa: { verdict: "fail", note: "Dropped 'Friday', freezes in the pauses" } })
vid("v2-2c5729", "Waiting hall, ticket", K, ["k2-f2b22d"], 0.63, undefined, { verdict: "borderline", note: "Built from the older keyframe; both lines laid" })
vid("v3-e0a898", "Counter, clerk straight-on (10 s)", K, ["k3-ad4425"], undefined, undefined, { verdict: "borderline", note: "Clerk's mouth barely moves under her lines" })
vid("v4-093885", "Eleven years, light sweeps", K, ["k4-17c017"], 0.57, undefined, { verdict: "borderline", note: "Built from the older keyframe" })
vid("v5-dd11a9", "Office, relieved grin", K, ["k5-9d532d"], undefined, undefined, { verdict: "pass", note: "Clean" })
vid("s6-line", "\"In Europe, we would call this impossible.\"", S, ["k6-edit-a", "hen-real-53", "hen-real-56", VREF], 0.77, 0.85, { verdict: "pass", note: "Words exact" })
vid("v6-3a28e5", "Green glow close-up, wipes glasses", K, ["kb6-061d2f"], 0.59, undefined, { verdict: "borderline", note: "One-frame glasses warp at 3.95 s" })
vid("s6-good", "\"It is good.\"", S, ["kb6-5bef70", "hen-real-53", "hen-real-56", VREF], 0.78, 0.7, { verdict: "pass", note: "Words exact" })
vid("s7-statement", "\"I have prepared a statement.\"", S, ["k7-edit-a", "hen-real-56", "hen-real-53", VREF], 0.77, 0.81, { verdict: "pass", note: "Words exact" })
vid("v7-ec0bce", "Binder in the bin", K, [], 0.46, undefined, { verdict: "borderline", note: "Face small in frame" })

// Dialogue audio.
const dlg = (stem: string, text: string, label: string, voice?: number) =>
  add({ id: `dlg-${stem}`, media: "audio", path: `/audio/dialogue/${stem}`, label, origin: "generated", text, scores: { voice } })
dlg("f_friday.mp3", "Henrick, I need SOC 2 by Friday.", "Founder (ElevenLabs Chris)")
dlg("f_number.mp3", "What number are they on?", "Founder (ElevenLabs Chris)")
dlg("f_portal.mp3", "Is there a portal?", "Founder (ElevenLabs Chris)")
dlg("f_done.mp3", "It's done?", "Founder (ElevenLabs Chris)")
dlg("c_form.mp3", "To apply for the form, you must first complete the form.", "Clerk (ElevenLabs Alice)")
dlg("c_fax.mp3", "There is a fax.", "Clerk (ElevenLabs Alice)")
dlg("n_comp.mp3", "Comp AI. SOC 2, without the Ministry.", "Narrator (ElevenLabs Sarah)")
for (const [f, t, v] of [["seventeen", "Seventeen.", 0.81], ["doingwell", "You are doing very well.", 0.76], ["itisgood", "It is good.", 0.83], ["statement", "I have prepared a statement.", 0.77], ["weeping", "In Europe, we would begin by weeping.", 0.85], ["ministry", "First, the Ministry.", 0.8], ["friday", "Friday.", 0.69]] as const)
  dlg(`henrick_indextts2_h_${f}.wav`, t, "Henrick (Index TTS 2 clone)", v)

// Sound.
const sfx = (stem: string, label: string) => add({ id: `sfx-${stem}`, media: "audio", path: `/audio/sfx/${stem}.mp3`, label, origin: "generated", gen: { model: "ElevenLabs SFX v2 (placeholder)" } })
for (const [s, l] of [["ding", "Ticket ding"], ["stamp", "Rubber stamp"], ["book", "Book closing"], ["timelapse", "Time-lapse whoosh"], ["phone", "Phone buzz and chime"], ["ui", "UI ticks"], ["cloth", "Pocket square rustle"], ["binder", "Binder into bin"], ["fax", "Fax handshake"], ["endhit", "End-card hit"]]) sfx(s, l)
sfx("amb_study", "Study room tone")
sfx("amb_hall", "Ministry hall room tone")
sfx("amb_office", "Office room tone")

// Graphics (Remotion compositions) and their previews.
const G: Graphic[] = []
for (const [comp, label] of [["MinistrySign", "Ministry sign lower third"], ["TicketDisplay", "Ticket LED panel"], ["FormStamp", "Form 27-B card"], ["CalendarFlip", "Eleven years later"], ["DashboardScore", "Dashboard score card"], ["CaptionImpossible", "Caption: impossible"], ["CaptionGood", "Caption: it is good"], ["EndCard", "End card"]]) {
  add({ id: `gfx-${comp}`, media: "video", path: `/generated/motion/${comp}.webm`, label, origin: "rendered" })
  G.push({ id: comp, comp, label, preview: `gfx-${comp}` })
}

// Cuts.
add({ id: "cut-v2", media: "video", path: "/generated/rough-cut-v2.mp4", label: "Rough cut v2 (silent)", origin: "rendered" })
add({ id: "cut-v3", media: "video", path: "/generated/final-cut-v3.mp4", label: "Final cut v3", origin: "rendered", scores: { lufs: -13.8 } })

const characters: Character[] = [
  { id: "henrick", name: "Henrick", role: "lead", anchors: realAll, sheets: ["hen-sheet", "hen-faces", "hen-poses"], voice: { engine: "Seedance native with voice reference", voiceId: "higgsfield:6a1cb9d8-eb8b-4c14-ae84-ed9a0988e8ce", ref: VREF, note: "Seedance native 0.70-0.86; Index TTS 2 0.76-0.85" } },
  { id: "founder", name: "Founder", role: "supporting", anchors: [], sheets: ["founder-sheet"], voice: { engine: "ElevenLabs v3 preset", voiceId: "Chris", note: "Stock voice, one take, never auditioned" } },
  { id: "clerk", name: "Clerk", role: "supporting", anchors: [], sheets: ["clerk-sheet"], voice: { engine: "ElevenLabs v3 preset", voiceId: "Alice", note: "Stock voice, one take, never auditioned" } },
  { id: "narrator", name: "Narrator", role: "voice", anchors: [], sheets: [], voice: { engine: "ElevenLabs v3 preset", voiceId: "Sarah", note: "Says 'Comp AI' as 'cop AI'" } },
]

const locations: Location[] = [
  { id: "study", name: "Henrick's study", style: [], gradeRef: ["hen-real-49", "hen-real-53", "hen-real-56"], ambience: "sfx-amb_study",
    look: { palette: ["#2a1810", "#5a3520", "#c08a4e", "#1d2a3a"], light: "Warm practical lamps, soft key from camera left, dark falloff", lens: "50 to 85 mm, shallow depth of field, eye-level", contrast: "Low-key, rich blacks", grain: "Fine 35 mm grain", note: "Anchor look: Henrick's real Comp AI videos" } },
  { id: "hall", name: "Ministry waiting hall", style: [], gradeRef: [], ambience: "sfx-amb_hall",
    look: { palette: ["#8d9690", "#5c6660", "#c9d1c8", "#3a403c"], light: "Flat overhead fluorescent, cold green-grey", lens: "Wide, locked-off, symmetrical", contrast: "Flat, lifted shadows", grain: "Fine grain", note: "Bureaucratic, still, Wes Anderson symmetry" } },
  { id: "office", name: "Founder's office", style: [], gradeRef: [], ambience: "sfx-amb_office",
    look: { palette: ["#f2efe8", "#cfd8cf", "#3f8f6a", "#2b2b2b"], light: "Bright morning daylight", lens: "35 to 50 mm, handheld", contrast: "Soft, airy", grain: "Minimal" } },
]

const sections: Section[] = [
  { id: "hook", name: "Hook", color: "#f59e0b", purpose: "Henrick makes 'Friday' sound like a diagnosis." },
  { id: "ministry", name: "The Ministry", color: "#f43f5e", purpose: "Escalate the absurdity: queue, form, fax, eleven years." },
  { id: "turn", name: "Turn", color: "#38bdf8", purpose: "Hard contrast: bright, calm, done." },
  { id: "payoff", name: "Payoff", color: "#34d399", purpose: "Henrick has to say it." },
  { id: "cta", name: "Call to action", color: "#a78bfa", purpose: "The binder goes in the bin. One line, one logo." },
]

const T = (asset: string, verdict: Take["verdict"] = "alt", note?: string): Take => ({ asset, verdict, note })
const fail = (note: string): Check => ({ ok: false, note, by: "claude", at: new Date().toISOString() })
const ok = (note?: string): Check => ({ ok: true, note, by: "claude", at: new Date().toISOString() })
const shot = (s: Partial<Shot> & Pick<Shot, "id" | "name" | "section">): Shot => ({
  characters: [], status: "review", card: {}, keyframes: [], takes: [], lines: [], graphics: [], sfx: [], edit: { in: "auto" }, checks: {}, ...s,
})
const laid = (who: string, audio: string, at: number, text: string): Line => ({ who, mode: "laid", audio: `dlg-${audio}`, at, text })
const native = (text: string): Line => ({ who: "henrick", mode: "native", text })
const checks = (c: Partial<Record<CheckKey, Check>>) => c

const shots: Shot[] = [
  shot({ id: "1a", name: "The request", section: "hook", location: "study", characters: ["henrick", "founder"],
    keyframes: [T("k1-c7e01b", "circled"), T("k1-9729b5")], takes: [T("v1-4d8d86", "circled")],
    lines: [laid("founder", "f_friday.mp3", 0.45, "Henrick, I need SOC 2 by Friday.")], sfx: [{ asset: "sfx-book", at: 1.5, gain: -8 }],
    checks: checks({ lipsync: fail("Founder's line laid over a silent clip"), cut: fail("3 s of dead air before 'Friday.'"), grade: fail("Warmer and brighter than the close-ups") }) }),
  shot({ id: "1b-friday", name: "\"Friday.\"", section: "hook", location: "study", characters: ["henrick"],
    keyframes: [T("hen-cu2-5dc6a6", "circled"), T("hen-cu-c08f9e")], takes: [T("s1b-friday", "circled"), T("hen-cu-402202", "reject", "480p draft dropped 'Friday'")],
    lines: [native("Friday.")], edit: { in: "auto", out: "speech" },
    checks: checks({ lipsync: ok(), warmup: fail("Freezes 0.5 s before he speaks (5.4 to 5.9 s)") }) }),
  shot({ id: "1b-europe", name: "Begin by weeping", section: "hook", location: "study", characters: ["henrick"],
    keyframes: [T("hen-cu2-5dc6a6", "circled")], takes: [T("s1b-europe", "circled")],
    lines: [native("In Europe, we would begin by weeping.")], edit: { in: "auto", out: "speech" },
    checks: checks({ lipsync: ok(), cut: fail("Jump cut from 'Friday.' on identical framing") }) }),
  shot({ id: "2", name: "The Ministry", section: "ministry", location: "hall", characters: ["henrick", "founder"],
    keyframes: [T("k2-b1c03f", "circled"), T("k2-f2b22d"), T("k2-0ffd5b")], takes: [T("v2-2c5729", "circled", "Built from the older keyframe")],
    lines: [laid("founder", "f_number.mp3", 0.9, "What number are they on?"), laid("henrick", "henrick_indextts2_h_seventeen.wav", 3.4, "Seventeen.")],
    sfx: [{ asset: "sfx-ding", at: 3.0, gain: -6 }], graphics: [{ graphic: "MinistrySign", at: 0.3, dur: 2.0 }, { graphic: "TicketDisplay", at: 0.8, dur: 4.0 }],
    checks: checks({ lipsync: fail("'Seventeen.' plays over a closed mouth"), graphics: fail("Plate LED shows B074 behind the 0000017 panel; the panel ticks to 18 before 'Seventeen.'") }) }),
  shot({ id: "3", name: "Form 27-B", section: "ministry", location: "hall", characters: ["clerk", "founder", "henrick"],
    keyframes: [T("k3-ad4425", "circled"), T("k3-ff0889"), T("k3-88032e")], takes: [T("v3-e0a898", "circled")],
    lines: [laid("clerk", "c_form.mp3", 0.4, "To apply for the form, you must first complete the form."), { who: "founder", mode: "vo", audio: "dlg-f_portal.mp3", at: 4.5, text: "Is there a portal?" }, laid("clerk", "c_fax.mp3", 6.6, "There is a fax.")],
    sfx: [{ asset: "sfx-stamp", at: 9.0, gain: -4 }], graphics: [{ graphic: "FormStamp", at: 6.6, dur: 3.4 }],
    checks: checks({ lipsync: fail("Clerk's lines laid over a near-closed mouth"), graphics: fail("Form card arrives on 'There is a fax', 6 s after the form line") }) }),
  shot({ id: "4", name: "Eleven years", section: "ministry", location: "hall", characters: ["henrick", "founder"],
    keyframes: [T("k4-392e0b", "circled"), T("k4-17c017"), T("k4-b7536a")], takes: [T("v4-093885", "circled", "Built from the older keyframe")],
    lines: [laid("henrick", "henrick_indextts2_h_doingwell.wav", 1.4, "You are doing very well.")],
    sfx: [{ asset: "sfx-timelapse", at: 0.2, gain: -10 }], graphics: [{ graphic: "CalendarFlip", at: 0.5, dur: 4.0 }],
    checks: checks({ lipsync: fail("Line plays over a closed mouth"), grade: fail("Blue cast against the rest of the hall") }) }),
  shot({ id: "5", name: "Comp AI", section: "turn", location: "office", characters: ["founder"],
    keyframes: [T("k5-9d532d", "circled")], takes: [T("v5-dd11a9", "circled")],
    lines: [laid("founder", "f_done.mp3", 0.9, "It's done?"), { who: "narrator", mode: "vo", audio: "dlg-n_comp.mp3", at: 2.1, tempo: 1.12, text: "Comp AI. SOC 2, without the Ministry." }],
    sfx: [{ asset: "sfx-phone", at: 0.1, gain: -8 }, { asset: "sfx-ui", at: 0.15, gain: -12 }, { asset: "sfx-stamp", at: 4.0, gain: -8 }], graphics: [{ graphic: "DashboardScore", at: 0.0, dur: 5.0 }],
    checks: checks({ lipsync: fail("'It's done?' laid over a silent clip"), sound: fail("Narrator says 'Comp AI' as 'cop AI'"), graphics: fail("Floating web-app card, not on the laptop screen") }) }),
  shot({ id: "6a", name: "Impossible", section: "payoff", location: "study", characters: ["henrick"],
    keyframes: [T("k6-edit-a", "circled"), T("kb6-5bef70"), T("k6-1a2339"), T("kb6-061d2f")], takes: [T("s6-line", "circled"), T("v6-3a28e5")],
    lines: [native("In Europe, we would call this impossible.")], graphics: [{ graphic: "CaptionImpossible", at: 0, dur: 6 }], edit: { in: "auto", out: "speech" },
    checks: checks({ lipsync: ok() }) }),
  shot({ id: "6b", name: "It is good", section: "payoff", location: "study", characters: ["henrick"],
    keyframes: [T("kb6-5bef70", "circled")], takes: [T("s6-good", "circled")],
    lines: [native("It is good.")], graphics: [{ graphic: "CaptionGood", at: 0, dur: 4 }], edit: { in: "auto", out: "speech" },
    checks: checks({ lipsync: ok() }) }),
  shot({ id: "7", name: "The statement", section: "cta", location: "study", characters: ["henrick"],
    keyframes: [T("k7-edit-a", "circled"), T("k7-27b9e4"), T("k7-5cda9e"), T("kb7-36c2bb")], takes: [T("s7-statement", "circled"), T("v7-ec0bce")],
    lines: [native("I have prepared a statement.")], edit: { in: "auto", out: "speech" },
    checks: checks({ lipsync: ok() }) }),
  shot({ id: "end", name: "End card", section: "cta", card_graphic: { graphic: "EndCard", dur: 3 }, sfx: [{ asset: "sfx-endhit", at: 0.1, gain: -8 }],
    checks: checks({ graphics: fail("Placeholder green circle, not the Comp AI logo; 0.2 s black flash before it") }) }),
]

const v3: Cut = {
  id: "v3", version: "v3", date: "2026-10-06", asset: "cut-v3", duration: 51.35,
  notes: ["Timeline reconstructed from the v3 cue sheet."],
  audit: { lufs: -13.8, truePeak: -1.4, issues: ["8 lines not lip-synced", "3 s dead air in the hook", "4 px black bars on Kling shots", "0.2 s black flash", "96 kHz audio"] },
  timeline: [
    { shot: "1a", start: 0, dur: 5.04, in: 0, asset: "v1-4d8d86", lines: [{ who: "founder", text: "Henrick, I need SOC 2 by Friday.", start: 0.45, end: 2.95, mode: "laid" }], graphics: [] },
    { shot: "1b-friday", start: 5.04, dur: 1.94, in: 0, asset: "s1b-friday", lines: [{ who: "henrick", text: "Friday.", start: 5.99, end: 6.54, mode: "native" }], graphics: [] },
    { shot: "1b-europe", start: 6.98, dur: 4.83, in: 0, asset: "s1b-europe", lines: [{ who: "henrick", text: "In Europe, we would begin by weeping.", start: 7.83, end: 11.43, mode: "native" }], graphics: [] },
    { shot: "2", start: 11.81, dur: 5.04, in: 0, asset: "v2-2c5729", lines: [{ who: "founder", text: "What number are they on?", start: 12.71, end: 14.2, mode: "laid" }, { who: "henrick", text: "Seventeen.", start: 15.21, end: 16.33, mode: "laid" }], graphics: [{ graphic: "MinistrySign", start: 12.11, end: 14.11 }, { graphic: "TicketDisplay", start: 12.61, end: 16.61 }] },
    { shot: "3", start: 16.85, dur: 10.04, in: 0, asset: "v3-e0a898", lines: [{ who: "clerk", text: "To apply for the form, you must first complete the form.", start: 17.25, end: 20.8, mode: "laid" }, { who: "founder", text: "Is there a portal?", start: 21.35, end: 23.15, mode: "vo" }, { who: "clerk", text: "There is a fax.", start: 23.45, end: 25.9, mode: "laid" }], graphics: [{ graphic: "FormStamp", start: 23.45, end: 26.85 }] },
    { shot: "4", start: 26.89, dur: 5.04, in: 0, asset: "v4-093885", lines: [{ who: "henrick", text: "You are doing very well.", start: 28.29, end: 30.74, mode: "laid" }], graphics: [{ graphic: "CalendarFlip", start: 27.39, end: 31.39 }] },
    { shot: "5", start: 31.93, dur: 5.04, in: 0, asset: "v5-dd11a9", lines: [{ who: "founder", text: "It's done?", start: 32.83, end: 34.13, mode: "laid" }, { who: "narrator", text: "Comp AI. SOC 2, without the Ministry.", start: 34.03, end: 36.92, mode: "vo" }], graphics: [{ graphic: "DashboardScore", start: 31.93, end: 36.97 }] },
    { shot: "6a", start: 36.97, dur: 6.05, in: 0, asset: "s6-line", lines: [{ who: "henrick", text: "In Europe, we would call this impossible.", start: 36.97, end: 40.6, mode: "native" }], graphics: [{ graphic: "CaptionImpossible", start: 36.97, end: 42.97 }] },
    { shot: "6b", start: 43.02, dur: 2.02, in: 0, asset: "s6-good", lines: [{ who: "henrick", text: "It is good.", start: 43.82, end: 44.9, mode: "native" }], graphics: [{ graphic: "CaptionGood", start: 43.02, end: 45.04 }] },
    { shot: "7", start: 45.04, dur: 3.31, in: 0, asset: "s7-statement", lines: [{ who: "henrick", text: "I have prepared a statement.", start: 45.3, end: 47.9, mode: "native" }], graphics: [] },
    { shot: "end", start: 48.35, dur: 3.0, in: 0, asset: null, lines: [], graphics: [{ graphic: "EndCard", start: 48.35, end: 51.35 }] },
  ],
}
const v2: Cut = { id: "v2", version: "v2", date: "2026-10-06", asset: "cut-v2", duration: 37.75, notes: ["Silent rough cut with motion graphics."], timeline: [] }

const project: Project = {
  title: "The Ministry",
  logline: "Henrick takes a founder to get SOC 2 the European way. It takes eleven years. Then Comp AI does it, and Henrick has to say the word.",
  runtimeTarget: 35,
  baselines: { face: 0.82, faceTarget: 0.75, voice: 0.71 },
  sections, characters, locations, assets: A, graphics: G, shots, cuts: [v3, v2],
  open: [
    "Credits: Higgsfield has 12.15 left. Top up, or name the fal account to use (the connected one is Leap).",
    "Restructure: Henrick narrates over silent cutaways; cut the narrator; one lip-synced clerk line.",
    "Voices: audition 3 to 4 voices per supporting character for Claudio to pick.",
  ],
  activity: (legacy.activity ?? []).slice(-40),
  ui: { positions: {} },
}
writeFileSync("data/project.json", JSON.stringify(project, null, 2))
console.log("project.json:", project.assets.length, "assets,", project.shots.length, "shots,", project.cuts.length, "cuts")
