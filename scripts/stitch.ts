#!/usr/bin/env bun
// The agent's way in. Every command becomes named ops (lib/ops.ts), the same ones the UI posts.
//   bun run stitch show [shot]
//   bun run stitch log "text" [--kind run|done|info|warn]
//   bun run stitch asset add <id> --media image|video|audio --from <url|file> [--label ..] [--origin generated]
//                            [--model ..] [--prompt ..|--prompt-file f] [--inputs a,b] [--job ..] [--text ..]
//                            [--step model@provider:job ...] [--sidecar out.json]   (how it was made; a sidecar next to
//                            --from is read automatically; required for anything not real)
//   bun run stitch attribute <id> --step model@provider[:job] [--step ...] [--sidecar out.json]
//   bun run stitch models [--all]                            what each model made, picked, rejected and put in the cut
//   bun run stitch asset qa <id> pass|borderline|fail "note"
//   bun run stitch asset set <id> '<json patch>'
//   bun run stitch score <asset> [--face] [--voice]
//   bun run stitch take add <shot> <asset> [--keyframe] [--circle] [--note ..]
//   bun run stitch take circle|alt|reject|pending <shot> <asset> [--note ..]
//   bun run stitch card <shot> <field> "<text>"
//   bun run stitch shot set <shot> '<json patch>'      bun run stitch shot add '<json shot>' [--after id]
//   bun run stitch check <shot> <key> ok|fail|clear [--note ..] [--by ..]
//   bun run stitch op '<op json or array>'
//   bun run stitch build [--version v3.1] [--shots 2.1,2.2 --scope "Scene 2"]
//   bun run stitch plan <loc>                                print the floor plan: setups, marks, line checks
//   bun run stitch plan set <loc> <plan.json>                replace the plan (dimensions, items, marks, axes, setups)
//   bun run stitch plan upsert <loc> items|marks|axes|setups '<json>'     bun run stitch plan remove <loc> <list> <id>
//   bun run stitch plan plate <loc> <setup> <asset> [circle|alt|reject|pending] [--note ..]
//   bun run stitch voice set <voice.json> | voice cast <who> <voice> | voice pick <take>   stage 04 (STITCH_PROJECT=<film>)
//   bun run stitch greybox <loc> [setup ...]                 render the grey box (Blender) and attach each render
//   bun run stitch room <loc> [--builder greybox|lightbox]   export the room in 3D (GLB) for the Rooms view
//   bun run stitch fit <shot> [asset] [--file f.jpg]         do the faces land where the room's camera puts the marks?
// The process (any command takes --project <slug>; the original film is "ministry"):
//   bun run stitch gates                                     every stage: who does it, its gate, and what blocks it
//   bun run stitch gate <stage> approve|changes|reject|pending ["note"] [--by name]
//   bun run stitch feedback [--all]                          open notes on stages, concepts and beats: act on these
//   bun run stitch note <stage:id|beat:id|concept:id> "text" [--by name]     bun run stitch resolve <note-id>
//   bun run stitch concept pick <id|none> ["note"]           bun run stitch beats    (the beat sheet as text)
//   bun run stitch sheets                                    stage 02: every item, its candidates (model, provider) and pick
//   bun run stitch sheet add <item> <file|sidecar.json> --model <m> --provider <p> [--job id] [--cost usd] [--prompt-file f]
//        (a Leap sidecar next to the file fills model, job, cost and prompt; the image is copied into public/generated/<film>/)
//   bun run stitch sheet view <item> <view> <file> [--model <m> --provider <p>] [--job id] [--cost usd] [--prompt-file f]
//        (a sidecar next to the file, as scripts/fal.ts writes, fills model, provider, job, prompt and inputs)
//   bun run stitch sheet unview <item> <view> [view ...]    take views off a sheet (before a regenerated sheet goes on)
//   bun run stitch sheet scene <item> <file> --model <m> --provider <p>   (the character in the world, in the look)
//   bun run stitch space                                     stage 03: rooms, cameras (frame, beats), the camera script
//   bun run stitch space set <plan.json>                     replace the space plan ({ rooms, cuts }); frames are kept
//   bun run stitch space frame <room> <cam> <file>           a frame of the set from that camera (sidecar read as above)
//   bun run stitch sheet pick <item> <n|file|none>          bun run stitch sheet lock <item> <pass> <of> ["note"]
import { execFileSync } from "node:child_process"
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import path from "node:path"
import { CHECKS, type Asset, type CheckKey, type GenStep, type Media, type TakeVerdict } from "../lib/model"
import { parseStep, stepFromSidecar } from "../lib/models"
import type { Op } from "../lib/ops"
import { load, mutate } from "../lib/store"
import { convert, perform } from "../lib/perform"
import { latestCut, modelBoard, pick, planView, projectHead, shotRows } from "../lib/derive"
import type { PlanList } from "../lib/ops"
import { beatsOf, blockedBy, currentStage, openNotes, runtime, words, type Candidate, type GateStatus, type StageId } from "../lib/process"

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..")
process.chdir(root)

const argv = process.argv.slice(2)
const flags: Record<string, string | true> = {}
const pos: string[] = []
/** Every value of a repeatable flag (--step). */
const many: Record<string, string[]> = {}
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (a.startsWith("--")) {
    const next = argv[i + 1]
    if (next !== undefined && !next.startsWith("--")) (flags[a.slice(2)] = next), (many[a.slice(2)] ??= []).push(next), i++
    else flags[a.slice(2)] = true
  } else pos.push(a)
}
const flag = (k: string) => (typeof flags[k] === "string" ? (flags[k] as string) : undefined)
if (flag("project")) process.env.STITCH_PROJECT = flag("project")
const run = (ops: Op[]) => mutate(ops).then((p) => p)
const sh = (cmd: string, args: string[]) => execFileSync(cmd, args, { encoding: "utf8" })
const probe = (file: string) => {
  try { return Number(sh("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).trim()) || undefined } catch { return undefined }
}

/** The steps that made a file: its provider sidecar (`<from>.json`, or --sidecar), then each --step in order. */
function attributionFor(from: string | undefined): GenStep[] {
  const steps: GenStep[] = []
  const side = flag("sidecar") ?? (from && !/^https?:/.test(from) && existsSync(`${from}.json`) ? `${from}.json` : undefined)
  if (side) {
    const s = stepFromSidecar(JSON.parse(readFileSync(side, "utf8")))
    if (!s) throw new Error(`${side}: its model is not in lib/models.ts`)
    steps.push(s)
  }
  for (const t of many.step ?? []) steps.push(parseStep(t))
  return steps
}

async function importFile(id: string, from: string, media: Media): Promise<{ path: string; duration?: number }> {
  mkdirSync("public/generated", { recursive: true })
  const srcExt = (from.split("?")[0].match(/\.([a-z0-9]+)$/i)?.[1] ?? (media === "image" ? "png" : media === "video" ? "mp4" : "mp3")).toLowerCase()
  const tmp = `work/import-${id}.${srcExt}`
  mkdirSync("work", { recursive: true })
  if (/^https?:/.test(from)) sh("curl", ["-sfL", "-o", tmp, from])
  else copyFileSync(from, tmp)
  let ext = srcExt
  if (media === "image" && ext !== "jpg") {
    sh("ffmpeg", ["-v", "error", "-y", "-i", tmp, "-vf", "scale='min(2560,iw)':-2", "-q:v", "3", `public/generated/${id}.jpg`])
    ext = "jpg"
  } else copyFileSync(tmp, `public/generated/${id}.${ext}`)
  const file = `public/generated/${id}.${ext}`
  return { path: `/generated/${id}.${ext}`, duration: media === "image" || media === "model" ? undefined : probe(file) }
}

function score(asset: Asset, kinds: { face: boolean; voice: boolean }) {
  const file = path.join("public", asset.path)
  const py = "work/venv/bin/python"
  const out: Asset["scores"] = {}
  if (kinds.face && asset.media !== "audio") {
    const r = sh(py, ["scripts/face-score.py", file])
    const m = r.match(/mean ([0-9.]+)/)
    if (m) out.face = Number(m[1])
  }
  if (kinds.voice && asset.media !== "image") {
    const r = sh(py, ["scripts/voice-score.py", file])
    const m = r.match(/voice ([0-9.]+)/)
    if (m) out.voice = Number(m[1])
  }
  return out
}

async function show(shotId?: string) {
  const p = await load()
  const rows = shotRows(p)
  for (const r of rows) {
    if (shotId && r.shot.id !== shotId) continue
    const tk = pick(r.shot.takes)
    const f = r.take?.scores?.face
    const ok = `${r.checked.ok}/${r.checked.total}${r.checked.fail ? ` (${r.checked.fail} fail)` : ""}`
    console.log(`${r.shot.id.padEnd(10)} ${r.shot.name.slice(0, 28).padEnd(28)} ${r.shot.status.padEnd(8)} take=${(tk?.asset ?? "-").padEnd(16)} face=${f?.toFixed(2) ?? " -  "} checks=${ok}`)
    if (shotId) {
      for (const l of r.lines) console.log(`   ${l.mode.padEnd(6)} ${l.speaker?.name ?? l.who}: ${l.text}`)
      for (const i of r.issues) console.log(`   ${i.level === "fail" ? "FAIL" : "warn"} ${i.text}`)
      for (const [k, v] of Object.entries(r.shot.card)) console.log(`   card.${k}: ${v}`)
    }
  }
  const cut = latestCut(p)
  if (!shotId && cut) console.log(`\nlatest cut ${cut.version}: ${cut.duration.toFixed(1)} s (target ${p.runtimeTarget} s)`)
}

const GATE_WORD: Record<string, GateStatus> = { approve: "approved", approved: "approved", changes: "changes", reject: "rejected", rejected: "rejected", pending: "pending", reopen: "pending" }

async function processOf() {
  const p = await load()
  if (!p.process) throw new Error(`this film has no process (try --project <slug>)`)
  return p.process
}

async function gates() {
  const pr = await processOf()
  pr.stages.forEach((s, i) => {
    const block = blockedBy(pr, s.id)
    const st = s.skipped ? "skipped" : block && s.status === "pending" ? `locked by ${block.id}` : s.status
    console.log(`${String(i + 1).padStart(2, "0")} ${s.id.padEnd(12)} ${st.padEnd(20)} gate ${s.gate.padEnd(9)} doer ${s.doer}${s.by ? `  (${s.by}, ${s.at?.slice(0, 16)})` : ""}`)
  })
  const now = currentStage(pr)
  console.log(`\ncurrent stage: ${now ? now.id : "done"} · concept: ${pr.pick ?? "not picked"} · script v${pr.script.version} for ${pr.script.concept ?? "-"} · ${openNotes(pr).length} open notes`)
}

async function feedback(all: boolean) {
  const pr = await processOf()
  const list = all ? pr.notes : openNotes(pr)
  if (!list.length) return console.log("no open feedback")
  for (const n of list) console.log(`${n.id}  ${n.target.padEnd(14)} ${n.by} ${n.at.slice(0, 16)}${n.kind && n.kind !== "comment" ? ` [${n.kind}]` : ""}${n.resolved ? " (resolved)" : ""}\n    ${n.text}`)
}

async function beatSheet() {
  const pr = await processOf()
  console.log(`script v${pr.script.version} for concept ${pr.script.concept ?? "-"} · ${pr.script.beats.length} beats · ${runtime(pr.script.beats)} s · ${words(pr.script.beats)} words`)
  for (const b of pr.script.beats) {
    console.log(`\n${b.id.padStart(2)}  ${b.t0}-${b.t1}s  ${b.title}${b.mark ? `  [${b.mark}]` : ""}\n    ${b.picture}`)
    for (const l of b.lines) console.log(`    ${l.who.toUpperCase()}${l.how || l.vo ? ` (${[l.vo && "VO", l.how].filter(Boolean).join(", ")})` : ""}: ${l.text}`)
    if (b.sound) console.log(`    sound: ${b.sound}`)
    if (b.camera) console.log(`    camera: ${b.camera}`)
  }
}

async function sheets() {
  const pr = await processOf()
  for (const x of pr.sheets ?? []) {
    console.log(`${x.kind.padEnd(8)} ${x.id.padEnd(18)} ${x.pick ? `picked by ${x.pickedBy ?? "?"}` : `${x.candidates.length} candidates`}${x.views?.length ? ` · sheet ${x.views.length} views` : ""}${x.lock ? ` · lock ${x.lock.pass}/${x.lock.of}` : ""}${x.from ? `  (from ${x.from})` : ""}  ${x.name}`)
    for (const c of x.candidates) console.log(`    ${c.file === x.pick ? "*" : " "} ${c.file}  ${c.model} via ${c.provider}${c.job ? ` job ${c.job}` : ""}${c.cost !== undefined ? ` $${c.cost}` : ""}`)
  }
}

async function sheetAdd(id: string, src: string) {
  const film = process.env.STITCH_PROJECT || "ministry"
  const side = existsSync(src + ".json") ? JSON.parse(readFileSync(src + ".json", "utf8")) : {}
  const model = flag("model") ?? side.model
  const provider = flag("provider") ?? side.provider
  if (!model || !provider) throw new Error("every candidate needs --model and --provider (or a Leap sidecar)")
  const dir = path.join("public", "generated", film)
  mkdirSync(dir, { recursive: true })
  const pr = await processOf()
  const n = (pr.sheets?.find((x) => x.id === id)?.candidates.length ?? 0) + 1
  const dest = path.join(dir, `${id}-${n}${path.extname(src)}`)
  copyFileSync(src, dest)
  const prompt = flag("prompt-file") ? readFileSync(flag("prompt-file")!, "utf8") : (side.input?.prompt ?? side.prompt)
  const cost = flag("cost") ? Number(flag("cost")) : (side.cost_usd ?? side.usage?.cost_usd ?? side.cost)
  await run([{ op: "sheet.add", id, candidate: { file: path.relative("public", dest), model, provider, job: flag("job") ?? side.id ?? side.generation, prompt, cost: cost !== undefined ? Number(cost) : undefined, inputs: many.input, by: flag("by") ?? "claude", at: new Date().toISOString() } }])
  console.log(`${id}: ${path.relative("public", dest)} (${model} via ${provider})`)
}

// Readable names for model IDs that sidecars record (fal endpoints, Leap IDs). Unknown IDs are shown as they are.
const MODEL_NAME: Record<string, string> = {
  "google/nano-banana-2.1/edit": "Nano Banana 2.1 (edit)",
  "google/nano-banana-2.1": "Nano Banana 2.1",
  "openai/gpt-image-2.5-sunburst/edit": "GPT Image 2.5 Sunburst (edit)",
}

/** Copy a generated image into public/generated/<film>/<sub>/<name> and describe it as a candidate. A sidecar next to
 *  the file (scripts/fal.ts, Leap) fills model, provider, job, prompt and inputs; flags override it. Big PNGs (2K model
 *  output is ~7 MB) are stored as high-quality JPEG; the original stays where it was. */
function storeCandidate(src: string, sub: string, name: string, view?: string): Candidate {
  const film = process.env.STITCH_PROJECT || "ministry"
  const side = existsSync(src + ".json") ? JSON.parse(readFileSync(src + ".json", "utf8")) : {}
  const model = flag("model") ?? (side.model ? MODEL_NAME[side.model] ?? side.model : undefined)
  const provider = flag("provider") ?? side.provider
  if (!model || !provider) throw new Error("every image needs --model and --provider (or a sidecar)")
  const dir = path.join("public", "generated", film, sub)
  mkdirSync(dir, { recursive: true })
  const jpeg = path.extname(src).toLowerCase() === ".png" && statSync(src).size > 2_000_000
  const dest = path.join(dir, `${name}${jpeg ? ".jpg" : path.extname(src)}`)
  if (jpeg) execFileSync("ffmpeg", ["-v", "error", "-y", "-i", src, "-q:v", "2", dest])
  else copyFileSync(src, dest)
  const prompt = flag("prompt-file") ? readFileSync(flag("prompt-file")!, "utf8") : flag("prompt") ?? side.input?.prompt ?? side.prompt
  const inputs: string[] | undefined = many.input ?? side.input?.image_urls
  const cost = flag("cost") ?? side.cost_usd ?? side.usage?.cost_usd
  return { file: path.relative("public", dest), view, model, provider, job: flag("job") ?? side.request_id ?? side.id, prompt, cost: cost !== undefined ? Number(cost) : undefined, inputs, by: flag("by") ?? "claude", at: new Date().toISOString() }
}

async function sheetView(id: string, view: string, src: string, scene = false) {
  const candidate = storeCandidate(src, "sheets", `${id}--${view}`, view)
  await run([{ op: scene ? "sheet.scene" : "sheet.view", id, candidate }])
  console.log(`${id} ${view}: ${candidate.file} (${candidate.model} via ${candidate.provider})`)
}

async function space() {
  const pr = await processOf()
  const sp = pr.space
  if (!sp) return console.log("no space plan yet (stitch space set plan.json)")
  for (const r of sp.rooms) {
    console.log(`\n${r.id}  ${r.name}  [${r.look}]${r.sheet ? `  set: ${r.sheet}` : ""}\n  map: ${r.map}`)
    for (const c of r.cameras) console.log(`  ${c.id.padEnd(4)} ${c.size.padEnd(4)} ${String(c.lens).padStart(3)} mm  ${c.name}  beats ${beatsOf(pr, r.id, c.id).join(",") || "-"}${c.look ? ` [${c.look}]` : ""}  ${c.frame ? `frame ${c.frame.file} (${c.frame.model} via ${c.frame.provider})` : "no frame"}`)
  }
  console.log("\ncamera script")
  for (const c of sp.cuts) console.log(`  ${c.t0.toFixed(1).padStart(5)}-${c.t1.toFixed(1).padEnd(5)} ${c.room}/${c.cam}  ${c.what}`)
}

async function main() {
  const [cmd, sub, ...rest] = pos
  switch (cmd) {
    case "sheets":
      return sheets()
    case "space": {
      if (!sub) return space()
      if (sub === "set" && rest[0]) {
        await run([{ op: "space.set", space: JSON.parse(readFileSync(rest[0], "utf8")), by: flag("by") ?? "claude" }])
        return space()
      }
      if (sub === "frame" && rest.length >= 3) {
        const candidate = storeCandidate(rest[2], "space", `${rest[0]}--${rest[1]}`, rest[1])
        await run([{ op: "space.frame", room: rest[0], cam: rest[1], candidate }])
        return console.log(`${rest[0]} ${rest[1]}: ${candidate.file} (${candidate.model} via ${candidate.provider})`)
      }
      throw new Error("usage: stitch space | space set <plan.json> | space frame <room> <cam> <file>")
    }
    case "voice": {
      if (sub === "set" && rest[0]) {
        await run([{ op: "voice.set", voice: JSON.parse(readFileSync(rest[0], "utf8")), by: flag("by") ?? "claude" }])
        return console.log("voice set")
      }
      if (sub === "cast" && rest.length >= 2) return run([{ op: "voice.cast", who: rest[0], voice: rest[1], by: flag("by") ?? "claude" }])
      if (sub === "pick" && rest[0]) return run([{ op: "voice.pick", take: rest[0], by: flag("by") ?? "claude" }])
      if (sub === "perform" && rest.length >= 2) {
        const p = await perform({ slug: process.env.STITCH_PROJECT, n: Number(rest[0]), audio: readFileSync(rest[1]), ext: path.extname(rest[1]).slice(1), by: flag("by") ?? "Claudio" })
        return console.log(`${p.id} line ${p.n} (${p.who}): ${p.file}${p.converted ? ` -> ${p.converted.file}${p.converted.match !== undefined ? ` match ${p.converted.match.toFixed(2)}` : ""}` : ` not converted: ${p.error}`}`)
      }
      if (sub === "convert" && rest[0]) {
        const p = await convert(process.env.STITCH_PROJECT, rest[0])
        return console.log(p.converted ? `${p.id}: ${p.converted.file}${p.converted.match !== undefined ? ` match ${p.converted.match.toFixed(2)}` : ""}` : `${p.id} not converted: ${p.error}`)
      }
      if (sub === "keep" && rest.length >= 2) return run([{ op: "voice.keep", n: Number(rest[0]), id: rest[1] === "none" ? null : rest[1], by: flag("by") ?? "claude" }])
      if ((sub === "remove" || sub === "restore") && rest[0]) return run([{ op: "voice.remove", id: rest[0], removed: sub === "remove", by: flag("by") ?? "claude" }])
      if (sub === "takes") {
        // Every performed take by line; * marks the one picked for the line.
        const v = (await load()).process?.voice
        for (const p of (v?.performances ?? []).filter((x) => !x.removed).sort((a, b) => a.n - b.n || a.at.localeCompare(b.at)))
          console.log(`${v?.picks?.[p.n] === p.id ? "*" : " "} line ${String(p.n).padStart(2)} ${p.who} ${p.id} ${p.converted ? `${p.converted.file}${p.converted.match !== undefined ? ` match ${p.converted.match.toFixed(2)}` : ""}` : `(${p.error ?? "converting"})`}`)
        return
      }
      throw new Error("usage: stitch voice set <voice.json> | voice cast <who> <voice> | voice pick <take> | voice perform <line> <audio> | voice convert <performance> | voice takes | voice keep <line> <performance|none> | voice remove|restore <performance>")
    }
    case "sheet": {
      if (sub === "add" && rest.length >= 2) return sheetAdd(rest[0], rest[1])
      if (sub === "view" && rest.length >= 3) return sheetView(rest[0], rest[1], rest[2])
      if (sub === "scene" && rest.length >= 2) return sheetView(rest[0], "scene", rest[1], true)
      if (sub === "unview" && rest.length >= 2) {
        await run([{ op: "sheet.unview", id: rest[0], views: rest.slice(1) }])
        return sheets()
      }
      if (sub === "pick" && rest.length >= 2) {
        const pr = await processOf()
        const item = pr.sheets?.find((x) => x.id === rest[0])
        const file = rest[1] === "none" ? null : /^\d+$/.test(rest[1]) ? item?.candidates[Number(rest[1]) - 1]?.file ?? rest[1] : rest[1]
        await run([{ op: "sheet.pick", id: rest[0], file, by: flag("by") ?? "claude" }])
        return sheets()
      }
      if (sub === "lock" && rest.length >= 3) {
        await run([{ op: "sheet.lock", id: rest[0], pass: Number(rest[1]), of: Number(rest[2]), note: rest[3] }])
        return sheets()
      }
      throw new Error("usage: stitch sheet add|view|pick|lock ...")
    }
    case "gates":
      return gates()
    case "gate": {
      const status = GATE_WORD[rest[0] ?? ""]
      if (!sub || !status) throw new Error("usage: stitch gate <stage> approve|changes|reject|pending [\"note\"]")
      await run([{ op: "gate.set", stage: sub as StageId, status, note: rest[1], by: flag("by") ?? "claude" }])
      return gates()
    }
    case "feedback":
      return feedback(!!flags.all)
    case "beats":
      return beatSheet()
    case "note":
      await run([{ op: "note.add", target: sub, text: rest[0], by: flag("by") ?? "claude" }])
      return feedback(false)
    case "resolve":
      await run([{ op: "note.resolve", id: sub }])
      return feedback(false)
    case "concept": {
      if (sub !== "pick" || !rest[0]) throw new Error("usage: stitch concept pick <id|none> [\"note\"]")
      await run([{ op: "concept.pick", id: rest[0] === "none" ? null : rest[0], note: rest[1], by: flag("by") ?? "claude" }])
      return gates()
    }
    case "show":
      return show(sub)
    case "log":
      await run([{ op: "log", text: sub, kind: (flag("kind") as "run" | "done" | "info" | "warn" | undefined) ?? "info" }])
      return
    case "op": {
      const parsed = JSON.parse(sub)
      await run(Array.isArray(parsed) ? parsed : [parsed])
      return
    }
    case "asset": {
      if (sub === "add") {
        const [id] = rest
        const media = (flag("media") ?? "image") as Media
        const from = flag("from")
        if (!id || !from) throw new Error("asset add <id> --media .. --from <url|file>")
        const { path: p, duration } = await importFile(id, from, media)
        const inputs = flag("inputs")?.split(",").filter(Boolean)
        const steps = attributionFor(from)
        const origin = (flag("origin") as Asset["origin"]) ?? "generated"
        const asset: Asset = {
          id, media, path: p, label: flag("label") ?? id, origin, duration,
          ...(steps.length || flag("model") ? { gen: { model: flag("model") ?? "", prompt: flag("prompt") ?? (flag("prompt-file") ? readFileSync(flag("prompt-file")!, "utf8").trim() : undefined), inputs, job: flag("job") ?? steps.find((s) => s.job)?.job, steps } } : {}),
          ...(flag("text") ? { text: flag("text") } : {}),
        }
        await run([{ op: "asset.add", asset }])
        console.log(`added ${id} -> ${p}${duration ? ` (${duration.toFixed(2)} s)` : ""}${steps.length ? `; made by ${steps.map((s) => `${s.model}@${s.provider}${s.job ? `:${s.job}` : ""}`).join(" + ")}` : ""}`)
        return
      }
      if (sub === "qa") {
        const [id, verdict, note] = rest
        await run([{ op: "asset.update", id, patch: { qa: { verdict: verdict as "pass" | "borderline" | "fail", note: note ?? "" } } }])
        return
      }
      if (sub === "set") {
        const [id, json] = rest
        await run([{ op: "asset.update", id, patch: JSON.parse(json) }])
        return
      }
      throw new Error("asset add|qa|set")
    }
    case "models": {
      // What each model made and what we kept: the Models view, for agents.
      const p = await load()
      for (const s of modelBoard(p)) {
        if (s.model.kind === "local" && !flags.all) continue
        console.log(`${s.model.kind.padEnd(8)} ${s.model.name.padEnd(36)} made ${String(s.assets.length).padStart(3)}  picked ${String(s.picked).padStart(3)}  rejected ${String(s.rejected).padStart(3)}  in cut ${String(s.inCut).padStart(3)}  face ${s.face?.toFixed(2) ?? "  - "}  voice ${s.voice?.toFixed(2) ?? "  - "}  $${s.costUsd.toFixed(2).padStart(6)}  jobs ${s.recorded}/${s.steps}  on ${s.providers.join(",")}`)
      }
      return
    }
    case "attribute": {
      // Record or correct how an asset was made: stitch attribute <id> --step model@provider:job [--step ...] [--sidecar f.json]
      const steps = attributionFor(undefined)
      if (!sub || !steps.length) throw new Error("attribute <id> --step model@provider[:job] [--step ...] [--sidecar out.json]")
      await run([{ op: "asset.attribute", id: sub, steps }])
      console.log(`${sub}: ${steps.map((s) => `${s.model}@${s.provider}${s.job ? `:${s.job}` : ""}`).join(" + ")}`)
      return
    }
    case "score": {
      const p = await load()
      const a = p.assets.find((x) => x.id === sub)
      if (!a) throw new Error(`unknown asset ${sub}`)
      const both = !flags.face && !flags.voice
      const scores = score(a, { face: both || !!flags.face, voice: both ? false : !!flags.voice })
      await run([{ op: "asset.update", id: a.id, patch: { scores } }])
      console.log(sub, JSON.stringify(scores))
      return
    }
    case "take": {
      if (sub === "add") {
        const [shot, asset] = rest
        await run([{ op: "take.add", shot, asset, list: flags.keyframe ? "keyframes" : undefined, verdict: flags.circle ? "circled" : undefined, note: flag("note") }])
        return
      }
      const verdict = ({ circle: "circled", alt: "alt", reject: "reject", pending: "pending" } as Record<string, TakeVerdict>)[sub]
      if (!verdict) throw new Error("take add|circle|alt|reject|pending")
      const [shot, asset] = rest
      await run([{ op: "take.set", shot, asset, verdict, note: flag("note") }])
      return
    }
    case "card":
      await run([{ op: "shot.card", id: sub, field: rest[0] as never, value: rest[1] }])
      return
    case "shot": {
      if (sub === "set") return void (await run([{ op: "shot.update", id: rest[0], patch: JSON.parse(rest[1]) }]))
      if (sub === "add") return void (await run([{ op: "shot.add", shot: JSON.parse(rest[0]), after: flag("after") }]))
      if (sub === "move") return void (await run([{ op: "shot.move", id: rest[0], to: Number(rest[1]) }]))
      if (sub === "remove") return void (await run([{ op: "shot.remove", id: rest[0] }]))
      throw new Error("shot set|add|move|remove")
    }
    case "check": {
      const [key, state] = rest
      if (!CHECKS.some((c) => c.key === key)) throw new Error(`check key: ${CHECKS.map((c) => c.key).join(", ")}`)
      const ok = state === "ok" ? true : state === "fail" ? false : null
      await run([{ op: "check.set", shot: sub, key: key as CheckKey, ok, note: flag("note"), by: flag("by") }])
      return
    }
    case "plan": {
      const verdicts: Record<string, TakeVerdict> = { circle: "circled", alt: "alt", reject: "reject", pending: "pending" }
      if (sub === "set") return void (await run([{ op: "plan.set", location: rest[0], plan: JSON.parse(readFileSync(rest[1], "utf8")) }]))
      if (sub === "upsert") return void (await run([{ op: "plan.upsert", location: rest[0], list: rest[1] as keyof PlanList, value: JSON.parse(rest[2]) } as Op]))
      if (sub === "remove") return void (await run([{ op: "plan.remove", location: rest[0], list: rest[1] as keyof PlanList, id: rest[2] }]))
      if (sub === "plate") {
        const [loc, setup, asset, v] = rest
        return void (await run([{ op: "plan.plate", location: loc, setup, asset, verdict: v ? verdicts[v] : undefined, note: flag("note") }]))
      }
      const p = await load()
      const l = p.locations.find((x) => x.id === sub)
      const v = l && planView(l)
      if (!v) throw new Error(`no plan on ${sub}`)
      console.log(`${l!.name}: ${v.plan.width} x ${v.plan.depth} x ${v.plan.height} m, ${v.plan.items.length} items, ${v.plan.marks.length} marks`)
      for (const u of v.setups) {
        const frame = u.inFrame.map((m) => `${m.mark.id}@${m.x.toFixed(2)}`).join(" ")
        const plate = pick(u.plates ?? [])
        console.log(`  ${u.id.padEnd(3)} ${u.name.padEnd(32)} ${u.size.padEnd(4)} ${String(u.lens).padStart(3)}mm h${u.height} fov ${u.fov.toFixed(0)} ${u.beat ?? ""} ${u.axis ? `line ${u.axis}${u.side === 1 ? "+" : u.side === -1 ? "-" : "0"}` : ""}  [${frame}]  render=${u.render ?? "-"} plate=${plate?.asset ?? "-"}`)
      }
      for (const i of v.issues) console.log(`  ${i.level.toUpperCase()} ${i.text}`)
      return
    }
    case "greybox": {
      const p = await load()
      const l = p.locations.find((x) => x.id === sub)
      if (!l?.plan) throw new Error(`no plan on ${sub}`)
      const dir = `work/${l.id}/grey`
      mkdirSync(dir, { recursive: true })
      writeFileSync(`work/${l.id}/plan.json`, JSON.stringify(l.plan, null, 1))
      const ids = rest.length ? rest : l.plan.setups.map((u) => u.id)
      execFileSync("/Applications/Blender.app/Contents/MacOS/Blender", ["-b", "-P", "scripts/greybox.py", "--", `work/${l.id}/plan.json`, dir, ...ids], { stdio: "ignore" })
      const ops: Op[] = []
      for (const id of ids) {
        const u = l.plan.setups.find((x) => x.id === id)!
        const asset = `grey-${l.id}-${id}`
        const { path: ap } = await importFile(asset, `${dir}/${id}.png`, "image")
        const a: Asset = { id: asset, media: "image", path: ap, label: `Grey box ${id}: ${u.name}`, origin: "rendered", gen: { model: "blender/greybox", prompt: `${u.lens} mm, ${u.height} m, facing ${u.facing}${u.tilt ? `, tilt ${u.tilt}` : ""}`, steps: [{ model: "local/blender-greybox", provider: "local" }] } }
        ops.push(p.assets.some((x) => x.id === asset) ? { op: "asset.update", id: asset, patch: { path: ap, gen: a.gen, label: a.label } } : { op: "asset.add", asset: a })
        ops.push({ op: "plan.patch", location: l.id, list: "setups", id, patch: { render: asset } })
      }
      ops.push({ op: "log", text: `Grey box for ${l.name}: rendered ${ids.length} setups from the floor plan`, kind: "done" })
      await run(ops)
      console.log(`rendered ${ids.join(", ")}`)
      return
    }
    case "room": {
      // The room as one 3D scene, exported by the Blender script that renders this room's plates.
      const p = await load()
      const l = p.locations.find((x) => x.id === sub)
      if (!l?.plan) throw new Error(`no plan on ${sub}`)
      const builder = flag("builder") ?? "greybox"
      const dir = `work/${l.id}/room`
      mkdirSync(dir, { recursive: true })
      writeFileSync(`work/${l.id}/plan.json`, JSON.stringify(l.plan, null, 1))
      execFileSync("/Applications/Blender.app/Contents/MacOS/Blender", ["-b", "-P", `scripts/${builder}.py`, "--", `work/${l.id}/plan.json`, dir, "--glb", `${dir}/${l.id}.glb`, "--glb-only"], { stdio: "ignore" })
      const asset = `room-${l.id}`
      const { path: ap } = await importFile(asset, `${dir}/${l.id}.glb`, "model")
      const gen = { model: `blender/${builder} glb`, prompt: `${l.plan.width} x ${l.plan.depth} x ${l.plan.height} m, ${l.plan.items.length} items, ${l.plan.marks.length} marks, ${l.plan.setups.length} cameras`, steps: [{ model: `local/blender-${builder}`, provider: "local" as const }] }
      await run([
        p.assets.some((x) => x.id === asset) ? { op: "asset.update", id: asset, patch: { path: ap, gen } } : { op: "asset.add", asset: { id: asset, media: "model", path: ap, label: `${l.name} in 3D`, origin: "rendered", gen } },
        { op: "location.update", id: l.id, patch: { model: asset } },
        { op: "log", text: `${l.name}: 3D room exported (${gen.prompt}) for the Rooms view`, kind: "done" },
      ])
      console.log(`exported ${ap}`)
      return
    }
    case "fit": {
      // The room as the judge: every mark the shot's camera sees is projected into the frame (pinhole, the setup's lens,
      // height and tilt) and matched to the faces Apple Vision finds. A face more than a third too big or too small, or
      // off by more than 6% of the frame, means the frame was not made from this camera. Records the Room fit check.
      const p = await load()
      const shot = p.shots.find((s) => s.id === sub)
      if (!shot) throw new Error(`no shot ${sub}`)
      const plan = p.locations.find((l) => l.id === shot.location)?.plan
      const u = plan?.setups.find((x) => x.id === shot.setup)
      if (!plan || !u) throw new Error(`${sub} has no setup in its room's plan`)
      // --file checks a candidate frame before it is registered; nothing is recorded then.
      const candidate = flag("file")
      const asset = candidate ? ({ id: path.basename(candidate), media: "image", path: candidate } as Asset) : p.assets.find((a) => a.id === (rest[0] ?? pick(shot.keyframes ?? [])?.asset))
      if (!asset) throw new Error(`${sub}: no keyframe to fit (pass an asset id or --file)`)
      let file = candidate ?? path.join("public", asset.path)
      if (asset.media === "video") {
        file = `work/fit-${asset.id}.jpg`
        sh("ffmpeg", ["-v", "error", "-y", "-ss", String(typeof shot.edit.in === "number" ? shot.edit.in : 0.5), "-i", path.join("public", asset.path), "-frames:v", "1", "-q:v", "2", file])
      }
      const faces = (JSON.parse(execFileSync("swift", ["scripts/faces.swift", file], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })) as { x: number; y: number; w: number; h: number }[])
        .map((f) => ({ x: f.x + f.w / 2, y: f.y + f.h / 2, h: f.h }))
      const want = plan.marks
        .filter((m) => !m.beat || m.beat === u.beat)
        .map((m) => ({ m, e: projectHead(u, m) }))
        .filter((x): x is { m: (typeof plan.marks)[number]; e: NonNullable<ReturnType<typeof projectHead>> } => !!x.e)
        .sort((a, b) => a.e.depth - b.e.depth)
      const used = new Set<number>()
      const lines: string[] = []
      let ok = true
      for (const { m, e } of want) {
        let best = -1
        let bestD = Infinity
        faces.forEach((f, i) => {
          const d = Math.hypot(f.x - e.x, (f.y - e.y) * (9 / 16))
          if (!used.has(i) && d < bestD) [best, bestD] = [i, d]
        })
        if (best < 0 || bestD > 0.25) {
          lines.push(`${m.who}: no face near where the room puts it (x ${e.x.toFixed(2)}, y ${e.y.toFixed(2)}); turned away or missing`)
          continue
        }
        used.add(best)
        const f = faces[best]
        const r = f.h / e.h
        const good = r >= 0.75 && r <= 1.33 && bestD <= 0.06
        ok &&= good
        lines.push(`${good ? "ok  " : "FAIL"} ${m.who}: face ${(r * 100).toFixed(0)}% of the size the camera gives at ${e.depth.toFixed(1)} m, ${(bestD * 100).toFixed(0)}% of the frame off`)
      }
      for (const [i] of faces.entries()) if (!used.has(i)) lines.push(`extra face at x ${faces[i].x.toFixed(2)}, y ${faces[i].y.toFixed(2)}: nobody is on a mark there`)
      const verdict = want.length === 0 ? null : ok
      console.log(`${sub} ${asset.id} through ${u.id} (${u.lens} mm):\n${lines.map((l) => `  ${l}`).join("\n")}`)
      if (!candidate) await run([{ op: "check.set", shot: sub, key: "room", ok: verdict, note: `${asset.id}: ${lines.join("; ")}`, by: "fit" }])
      return
    }
    case "build": {
      const { build } = await import("./build")
      await build(flag("version"), { shots: flag("shots")?.split(",").filter(Boolean), scope: flag("scope") })
      return
    }
    default:
      console.log(readHelp())
  }
}

function readHelp() {
  return "commands: show, log, asset add|qa|set, attribute, models, score, take add|circle|alt|reject|pending, card, shot set|add|move|remove, check, op, plan [set|upsert|remove|plate], greybox, room, fit, build"
}

main().catch((e) => {
  console.error("error:", e.message)
  process.exit(1)
})

