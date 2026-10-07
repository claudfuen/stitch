#!/usr/bin/env bun
// The frame loop for stage 03: make takes for every camera, judge them against the whole room, keep the best, fix
// what the judge names, and stop only when every frame passes (space, identity, look and realism all 8+, no
// high-severity finding).
//
//   bun run space-frames prep <film> <run> [room ...] [--cam C1,C2] [--layout colour|clay] [--models nb,sd] [--n 2]
//        builds each camera's reference board and writes <run>/jobs.json: one job per camera and model, with the
//        layout render as Image 1, the board as Image 2, and the prompt built from the room's box (set, legend, cast,
//        style), the camera's shot and the blocking computed from the 3D plan.
//   bun run space-frames fix <film> <run> <tag ...> [--from <run>]
//        one "change only" edit per failing take: Image 1 is the take, Image 2 its board, the prompt the judge's fixes.
//   bun run space-frames batches <run> --urls urls.json      the jobs as fal requests (8 per batch), local paths -> URLs
//   bun run space-frames fetch <run> <index>|<take>|<url> ...  download outputs with sidecars (provider, model, job)
//   bun run space-frames candidates <run>                     the downloaded takes as a judge input list
//   bun run space-frames pick <run>                           best take per camera from <run>/judge.json, and the gate
//
// fal is the route while Leap's photo hold blocks image inputs; the jobs are fal requests, run with the fal connector or
// `bun run fal batch`. Runs live in work/<film>/space/runs/<run>.
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { type Box, groundTruth } from "./space-judge"

type Setup = Box["setups"][number] & { shot?: string }
type Room = Box & { setups: Setup[]; set: string; style: string; legend: Record<string, string>; board: { room: string; cast: Record<string, string[]>; describe: Record<string, string> } }
type Job = { index: number; key: string; room: string; cam: string; model: "nb" | "sd" | "nb-fix"; endpoint: string; images: string[]; input: Record<string, unknown>; parent?: string }

const argv = process.argv.slice(2)
const flag = (k: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined }
const pos = argv.filter((a, i) => !a.startsWith("--") && !argv[i - 1]?.startsWith("--"))
const [cmd, ...rest] = pos

const ENDPOINT = { nb: "google/nano-banana-2.1/edit", sd: "bytedance/seedream/v5/pro/edit" } as const
const MODEL_NAME: Record<string, string> = { "google/nano-banana-2.1/edit": "Nano Banana 2.1 (edit)", "bytedance/seedream/v5/pro/edit": "Seedream 5.0 Pro (edit)" }
const SYSTEM = "You re-create planned film frames as real photographs. The layout image is binding: camera position, lens, framing and the place, size and facing of every person and object. The reference board is context about the room and the cast, so that this frame agrees with every other angle of the same room; never use it as a composition, and never draw its panels, labels or text. If a reference and the layout disagree about where something is, the layout wins."
const BOARD = "Image 2 is a reference board, not a scene: never copy its layout, its labels or its text. Use each labelled panel only for what its label says: MAP is a top-down plan of the whole room with this camera's view as the purple cone (where everything is and which way it faces); THE ROOM is the approved set (materials, colours and light); the named cast panels give faces and costumes; AUDIENCE gives the same crowd."
const runDir = (film: string, run: string) => `work/${film}/space/runs/${run}`

function room(film: string, id: string): Room {
  return JSON.parse(readFileSync(`data/space/${film}/${id}.json`, "utf8"))
}

/** The layout render for a camera: clay (grey blocks), colour (the set's colours) or detail (colours, real shapes and
 *  posed mannequins: rendered with greybox.py --detail). */
function layoutFile(film: string, roomId: string, cam: string, kind: string) {
  return `public/generated/${film}/space/${kind === "clay" ? "box" : `box-${kind}`}/${roomId}--${cam}.jpg`
}

function prompt(r: Room, s: Setup, layout: string) {
  const truth = groundTruth(r, s)
  const seen = Object.keys(r.board.describe).filter((who) => truth.some((t) => t.toLowerCase().startsWith(who) && !/NOT in frame|no one in frame/.test(t)))
  return [
    `Image 1 is a layout render of our ${r.set} from this exact camera. It fixes the camera, lens, framing and the position, size and facing of every person and object: keep its composition exactly and add nothing that is not in it. Keep every person and object exactly as large in the frame as in Image 1: do not crop in, move closer or enlarge anyone. Turn it into a real photograph.`,
    r.legend[layout],
    BOARD,
    `Blocking from the 3D plan, measured from this camera (across the frame: 0% is the left edge; up: 0% is the bottom edge): ${truth.join(" ")}`,
    s.shot ?? "",
    ...seen.map((w) => `${r.board.describe[w]}.`),
    r.style,
  ].join(" ")
}

function prep(film: string, run: string, rooms: string[]) {
  const dir = runDir(film, run)
  mkdirSync(dir, { recursive: true })
  const cams = flag("cam")?.split(",")
  const layout = flag("layout") ?? "colour"
  const models = (flag("models") ?? "nb,sd").split(",") as ("nb" | "sd")[]
  const n = Number(flag("n") ?? 2)
  const jobs: Job[] = []
  for (const id of rooms) {
    const r = room(film, id)
    for (const s of r.setups.filter((u) => !cams || cams.includes(u.id))) {
      const lay = layoutFile(film, id, s.id, layout)
      if (!existsSync(lay)) throw new Error(`no ${layout} layout for ${id}/${s.id}: ${lay}`)
      spawnSync("bun", ["scripts/space-board.ts", film, id, s.id], { stdio: "ignore" })
      const board = `work/${film}/space/boards/${id}-${s.id}.jpg`
      // Extra references for one camera (the audience's front rows for the reverse), each with what it is for.
      const extra = [...((s as Setup & { refs?: { file: string; text: string }[] }).refs ?? [])]
      // --cast-refs: each principal in frame also gets their approved face and costume at full size, as separate
      // images, not only as a small panel on the board. Identity held on Nano Banana with full-size references and
      // drifted once faces only reached the model through the board (round 5, Claudio's eye on Oct 7).
      if (flag("cast-refs") !== undefined || argv.includes("--cast-refs")) {
        const truth = groundTruth(r, s)
        for (const who of Object.keys(r.board.cast).filter((w) => w !== "audience" && truth.some((t) => t.toLowerCase().startsWith(w) && !/NOT in frame/.test(t)))) {
          const [face, body] = r.board.cast[who]
          const name = who[0].toUpperCase() + who.slice(1)
          extra.push({ file: `public/${face}`, text: `is ${name}'s approved face: keep exactly this face and hair.` })
          if (body) extra.push({ file: `public/${body}`, text: `is ${name}'s approved costume and build.` })
        }
      }
      const text = [prompt(r, s, layout), ...extra.map((x, i) => `Image ${3 + i} ${x.text}`)].join(" ")
      for (const m of models) {
        const input: Record<string, unknown> =
          m === "nb"
            ? { prompt: text, system_prompt: SYSTEM, thinking_level: "high", aspect_ratio: "16:9", resolution: "2K", num_images: n, output_format: "png" }
            : { prompt: `${SYSTEM} ${text}`.replace(/Image (\d)/g, "Figure $1"), image_size: { width: 2560, height: 1440 }, num_images: n, output_format: "png" }
        jobs.push({ index: jobs.length, key: `${s.id}-${m}`, room: id, cam: s.id, model: m, endpoint: ENDPOINT[m], images: [lay, board, ...extra.map((x) => x.file)], input })
      }
    }
  }
  writeFileSync(`${dir}/jobs.json`, JSON.stringify(jobs, null, 1))
  console.log(`${dir}/jobs.json: ${jobs.length} jobs (${layout} layouts, ${models.join("+")}, ${n} takes each)`)
  console.log("files to upload:", [...new Set(jobs.flatMap((j) => j.images))].join(" "))
}

/** One "change only" edit per failing take, from the judge's own fix instructions. Image 1 is the take itself. */
function fix(film: string, run: string, tags: string[]) {
  const from = flag("from") ?? run
  const judged = JSON.parse(readFileSync(`${runDir(film, from)}/judge.json`, "utf8")).results as { room: string; cam: string; tag: string; file: string; findings?: { what: string; fix: string; kind: string; severity: string }[] }[]
  const dir = runDir(film, run)
  mkdirSync(dir, { recursive: true })
  const prior = existsSync(`${dir}/jobs.json`) ? (JSON.parse(readFileSync(`${dir}/jobs.json`, "utf8")) as Job[]) : []
  const jobs: Job[] = [...prior]
  for (const tag of tags) {
    const j = judged.find((x) => x.tag === tag)
    if (!j) throw new Error(`no judged take ${tag} in ${from}`)
    const edits = (j.findings ?? []).filter((f) => f.kind === "model" && f.severity !== "low").map((f) => f.fix)
    if (!edits.length) { console.log(`${tag}: nothing to fix`); continue }
    const r = room(film, j.room)
    const s = r.setups.find((u) => u.id === j.cam)!
    const text = `Edit Image 1, a still from our ${r.set}. Change only these things: ${edits.map((e, i) => `(${i + 1}) ${e}`).join(" ")} Keep everything else exactly as it is: the camera, the framing, every other person, object, colour and the light. Image 2 is a reference board (not a scene, never copy its layout or labels): use its MAP for where things belong and its cast panels for faces and costumes. Blocking from the 3D plan for this camera: ${groundTruth(r, s).join(" ")} ${r.style}`
    const board = `work/${film}/space/boards/${j.room}-${j.cam}.jpg`
    jobs.push({ index: jobs.length, key: `${tag}-fix`, room: j.room, cam: j.cam, model: "nb-fix", endpoint: ENDPOINT.nb, images: [j.file, board], parent: j.file,
      input: { prompt: text, system_prompt: SYSTEM, thinking_level: "high", aspect_ratio: "16:9", resolution: "2K", num_images: 2, output_format: "png" } })
  }
  writeFileSync(`${dir}/jobs.json`, JSON.stringify(jobs, null, 1))
  console.log(`${dir}/jobs.json: ${jobs.length} jobs`)
}

function batches(film: string, run: string) {
  const dir = runDir(film, run)
  const urls = JSON.parse(readFileSync(flag("urls")!, "utf8")) as Record<string, string>
  const jobs = JSON.parse(readFileSync(`${dir}/jobs.json`, "utf8")) as Job[]
  const todo = jobs.filter((j) => !flag("only") || flag("only")!.split(",").includes(String(j.index)))
  const reqs = todo.map((j) => ({ index: j.index, endpoint_id: j.endpoint, input: { ...j.input, image_urls: j.images.map((f) => { if (!urls[f]) throw new Error(`no URL for ${f}`); return urls[f] }) } }))
  for (let i = 0; i < reqs.length; i += 8) writeFileSync(`${dir}/batch-${i / 8 + 1}.json`, JSON.stringify(reqs.slice(i, i + 8)))
  console.log(`${Math.ceil(reqs.length / 8)} batches in ${dir}`)
}

function fetchOut(film: string, run: string, items: string[]) {
  const dir = runDir(film, run)
  const jobs = JSON.parse(readFileSync(`${dir}/jobs.json`, "utf8")) as Job[]
  const requests = existsSync(`${dir}/requests.json`) ? (JSON.parse(readFileSync(`${dir}/requests.json`, "utf8")) as Record<string, string>) : {}
  mkdirSync(`${dir}/out`, { recursive: true })
  for (const it of items) {
    const [idx, take, url] = it.split("|")
    const j = jobs[Number(idx)]
    const out = `${dir}/out/${j.key}-${"abcd"[Number(take)]}.png`
    const r = spawnSync("curl", ["-s", "-f", "-o", out, url])
    if (r.status !== 0) throw new Error(`download failed ${url}`)
    const { image_urls: _u, ...input } = j.input as Record<string, unknown>
    writeFileSync(`${out}.json`, JSON.stringify({ provider: "fal", model: MODEL_NAME[j.endpoint], endpoint: j.endpoint, request_id: requests[idx], take: Number(take), url, inputs: j.images, parent: j.parent, input }, null, 1))
    console.log(out)
  }
}

function candidates(film: string, run: string) {
  const dir = runDir(film, run)
  const jobs = JSON.parse(readFileSync(`${dir}/jobs.json`, "utf8")) as Job[]
  const files = readdirSync(`${dir}/out`).filter((f) => f.endsWith(".png"))
  const list = files.map((f) => { const key = f.replace(/-[a-d]\.png$/, ""); const j = jobs.find((x) => x.key === key)!; return { room: j.room, cam: j.cam, file: `${dir}/out/${f}`, tag: f.replace(/\.png$/, "") } })
  writeFileSync(`${dir}/candidates.json`, JSON.stringify(list, null, 1))
  console.log(`${dir}/candidates.json: ${list.length} takes`)
}

type Judged = { room: string; cam: string; tag: string; file: string; verdict?: string; scores?: Record<string, number>; findings?: { severity: string; kind: string; area?: string; what: string }[]; error?: string }
const minScore = (r: Judged) => (r.scores ? Math.min(...Object.values(r.scores)) : -1)
const meanScore = (r: Judged) => (r.scores ? Object.values(r.scores).reduce((a, b) => a + b, 0) / Object.values(r.scores).length : -1)
const highs = (r: Judged) => (r.findings ?? []).filter((f) => f.severity === "high").length
const passes = (r: Judged) => !!r.scores && minScore(r) >= 8 && highs(r) === 0

function pick(film: string, run: string) {
  const dir = runDir(film, run)
  const all = (flag("with") ?? "").split(",").filter(Boolean).concat(run).flatMap((r) => (JSON.parse(readFileSync(`${runDir(film, r)}/judge.json`, "utf8")).results as Judged[]))
  const byCam = new Map<string, Judged[]>()
  for (const r of all.filter((x) => !x.error)) byCam.set(`${r.room}/${r.cam}`, [...(byCam.get(`${r.room}/${r.cam}`) ?? []), r])
  const best: Record<string, Judged> = {}
  for (const [k, rs] of [...byCam].sort()) {
    rs.sort((a, b) => Number(passes(b)) - Number(passes(a)) || highs(a) - highs(b) || minScore(b) - minScore(a) || meanScore(b) - meanScore(a))
    best[k] = rs[0]
    const r = rs[0]
    console.log(`${passes(r) ? "PASS" : "fail"}  ${k.padEnd(14)} ${r.tag.padEnd(14)} ${Object.entries(r.scores ?? {}).map(([a, v]) => `${a} ${v}`).join("  ")}  high ${highs(r)}   (${rs.length} takes, ${rs.filter(passes).length} pass)`)
  }
  writeFileSync(`${dir}/best.json`, JSON.stringify(best, null, 1))
  const n = Object.values(best).filter(passes).length
  console.log(`\n${n}/${Object.keys(best).length} cameras pass the gate`)
}

const [film, run, ...more] = rest
if (!cmd || !film || !run) throw new Error("usage: bun run space-frames prep|fix|batches|fetch|candidates|pick <film> <run> ...")
if (cmd === "prep") prep(film, run, more)
else if (cmd === "fix") fix(film, run, more)
else if (cmd === "batches") batches(film, run)
else if (cmd === "fetch") fetchOut(film, run, more)
else if (cmd === "candidates") candidates(film, run)
else if (cmd === "pick") pick(film, run)
else throw new Error(`unknown command ${cmd}`)
