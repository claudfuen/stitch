#!/usr/bin/env bun
// Cohesion judge: the second gate for stage 03 frames, after the whole-room space judge.
//
//   bun run space-cohesion <film> --frames candidates.json [--picks picks.json] [--out file.json]
//        candidates: [{ room, cam, file, tag }]; picks: { "<room>/<cam>": file } (the other angles to hold it against)
//
// The space judge checks a frame against its own layout. It can pass a frame that matches the plan and still looks
// wrong to a person: a man floating mid-lunge, a pose nobody could hold, a room that reads as a different shoot from
// the next cut. This judge asks only that, with the frame beside the other chosen angles of the same room. Two models
// answer independently (Opus 5.5 and GPT-6 Astra, both through the AI Gateway) and a frame passes only when both give
// plausibility and cohesion 8 or more with no high-severity finding.
import { gateway } from "@ai-sdk/gateway"
import { generateText } from "ai"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { type Box, groundTruth, shoot } from "./space-judge"

;(globalThis as { AI_SDK_LOG_WARNINGS?: boolean }).AI_SDK_LOG_WARNINGS = false
const argv = process.argv.slice(2)
const flag = (k: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined }
const film = argv[0]
const JUDGES = (flag("judges") ?? "anthropic/claude-opus-5.5,openai/gpt-6-astra").split(",")
type Cand = { room: string; cam: string; file: string; tag: string }
const cands = JSON.parse(readFileSync(flag("frames")!, "utf8")) as Cand[]
type SpaceRoom = { id: string; name: string; look: string; map: string; cameras: { id: string; name: string; from: string; why: string; look?: string }[] }
const SPACE = JSON.parse(readFileSync(`data/projects/${film}.json`, "utf8")).process.space as { rooms: SpaceRoom[] }
const LOOKS: Record<string, string> = { colour: "1994 colour infomercial on Betacam", before: "the infomercial's black-and-white 'before' (deliberately monochrome, high contrast, vignetted)" }
/** What is deliberate for this camera, so the judge does not count the script's own choices as continuity errors. */
function intent(c: { room: string; cam: string }) {
  const r = SPACE.rooms.find((x) => x.id === c.room)
  const k = r?.cameras.find((x) => x.id === c.cam)
  if (!r || !k) return ""
  const look = k.look ?? r.look
  let truth = ""
  try {
    const box = JSON.parse(readFileSync(`data/space/${film}/${c.room}.json`, "utf8")) as Box
    const s = box.setups.find((u) => u.id === c.cam)
    if (s) truth = `\nWho and what this camera sees, computed from the 3D plan (0% is the left edge): ${groundTruth(box, s).join(" ")}`
  } catch {}
  return `Room: ${r.name}. The room's rules: ${r.map}\nCamera ${k.id} "${k.name}": ${k.from} Purpose: ${k.why}\nThis camera's look: ${LOOKS[look] ?? look}${k.look && k.look !== r.look ? " (different from the rest of the room on purpose)" : ""}. Other angles of this room: ${r.cameras.filter((x) => x.id !== k.id).map((x) => `${x.id} ${LOOKS[x.look ?? r.look] ?? x.look ?? r.look}`).join("; ")}.\nThese are deliberate. Do not report them as errors; report anything that breaks them.${truth}\nThe stills are ungraded on purpose: the film's grade (Betacam softness, chroma, grain) is applied afterwards, so do not mark down clean digital texture.`
}
const picks = flag("picks") ? (JSON.parse(readFileSync(flag("picks")!, "utf8")) as Record<string, string>) : {}

function key() {
  if (process.env.AI_GATEWAY_API_KEY?.trim()) return
  const r = spawnSync("security", ["find-generic-password", "-s", "AI_GATEWAY_API_KEY", "-w"], { encoding: "utf8" })
  if (r.status !== 0 || !r.stdout.trim()) throw new Error("No AI Gateway key")
  process.env.AI_GATEWAY_API_KEY = r.stdout.trim()
}
function media(f: string) {
  let file = f
  if (statSync(f).size > 4_500_000) {
    file = path.join(tmpdir(), `cohesion-${path.basename(f).replace(/\.\w+$/, "")}.jpg`)
    spawnSync("ffmpeg", ["-v", "error", "-y", "-i", f, "-vf", "scale='min(2560,iw)':-2", "-q:v", "3", file])
  }
  return { type: "file" as const, data: new Uint8Array(readFileSync(file)), mediaType: file.endsWith(".png") ? "image/png" : "image/jpeg" }
}

/** The other chosen angles of the same room, side by side and labelled, so the frame is judged as one cut of many. */
function contact(c: Cand, dir: string) {
  const others = Object.entries(picks).filter(([k]) => k.startsWith(`${c.room}/`) && k !== `${c.room}/${c.cam}`)
  if (!others.length) return undefined
  const cells = others.map(([k, f]) => `<figure style="margin:0"><img src="file://${path.resolve(f)}" style="width:440px;display:block"/><figcaption style="color:#e5e7eb;font:600 16px Arial">${k.split("/")[1]}</figcaption></figure>`).join("")
  const html = `<!doctype html><html><body style="margin:0;background:#0b1020;padding:10px;width:1360px"><div style="color:#fff;font:700 20px Arial;margin-bottom:8px">Other angles of the same room in this film</div><div style="display:flex;flex-wrap:wrap;gap:10px">${cells}</div></body></html>`
  const png = `${dir}/${c.room}-${c.tag}-angles.png`
  shoot(html, png, `1380,${Math.ceil(others.length / 3) * 290 + 60}`)
  return png
}

const ASK = (c: Cand, hasAngles: boolean, hasBoard: boolean) => `You are the stills editor on a live-action 1994 infomercial parody. ${hasBoard ? "Image 1 is the approved reference board for this room: THE ROOM (the approved set), PROPS AND SIGNS (the approved designs) and the cast panels (approved faces and costumes). It is canonical. " : ""}${hasAngles ? `Image ${hasBoard ? 2 : 1} shows other angles chosen for this room so far (they can be wrong too: where they disagree with the board, the board wins). ` : ""}Image ${1 + Number(hasBoard) + Number(hasAngles)} is a candidate still for camera ${c.cam}. It will be the first frame of a video shot, so it must look like a real photograph from a real shoot.

${intent(c)}

Judge two things, 0 to 10 each:
- plausibility: would a viewer believe this photograph? Look hard for anything unreasonable: a body in a pose nobody could hold or that defies gravity (floating, mid-air with no momentum, a lunge with no support), wrong anatomy (hands, fingers, limbs, necks, extra or missing parts), people or objects at impossible sizes against each other, perspective or geometry that cannot exist, melted or duplicated objects, garbled text, faces that read as rendered rather than photographed, anything uncanny.
- cohesion: does it read as the same shoot as the approved references${hasAngles ? " and the other angles" : ""}? Same set and set dressing, same colours and light, the same people in the same costumes, props and signs of exactly the approved design (shape, size, lettering), the same period and photographic texture, so that cutting between them would not jump. Name the reference a mismatch breaks.

Answer with JSON only:
{"plausibility": n, "cohesion": n, "findings": [{"what": "<specific problem>", "where": "<where in the frame>", "severity": "high" | "medium" | "low", "fix": "<the one change that fixes it>"}]}
A high-severity finding is anything a viewer would notice as wrong on first viewing.`

async function judge(model: string, c: Cand, angles?: string) {
  const board = `work/${film}/space/boards/${c.room}-${c.cam}.jpg`
  const hasBoard = existsSync(board)
  const r = await generateText({ model: gateway(model), messages: [{ role: "user", content: [...(hasBoard ? [media(board)] : []), ...(angles ? [media(angles)] : []), media(c.file), { type: "text", text: ASK(c, !!angles, hasBoard) }] }] })
  return JSON.parse(r.text.slice(r.text.indexOf("{"), r.text.lastIndexOf("}") + 1)) as { plausibility: number; cohesion: number; findings: { what: string; severity: string; fix: string }[] }
}

async function main() {
  key()
  const dir = path.join(path.dirname(flag("frames")!), "cohesion")
  mkdirSync(dir, { recursive: true })
  const out: Record<string, unknown>[] = []
  for (let i = 0; i < cands.length; i += 4) {
    await Promise.all(cands.slice(i, i + 4).map(async (c) => {
      const angles = contact(c, dir)
      const verdicts = await Promise.all(JUDGES.map(async (m) => { try { return { model: m, ...(await judge(m, c, angles)) } } catch (e) { return { model: m, error: String((e as Error).message).slice(0, 200) } } }))
      const ok = verdicts.every((v) => !("error" in v) && v.plausibility >= 8 && v.cohesion >= 8 && !v.findings.some((f) => f.severity === "high"))
      out.push({ ...c, pass: ok, verdicts })
      console.log(`${ok ? "PASS" : "fail"}  ${c.room}/${c.tag}  ${verdicts.map((v) => ("error" in v ? `${v.model}: ERROR` : `${v.model.split("/")[1]} p${v.plausibility} c${v.cohesion}`)).join("  ")}`)
      for (const v of verdicts) if (!("error" in v)) for (const f of v.findings.filter((f) => f.severity !== "low")) console.log(`    [${f.severity} · ${v.model.split("/")[1]}] ${f.what.slice(0, 200)}`)
    }))
  }
  writeFileSync(flag("out") ?? path.join(path.dirname(flag("frames")!), "cohesion.json"), JSON.stringify({ judges: JUDGES, at: new Date().toISOString(), results: out }, null, 1))
}
await main()
