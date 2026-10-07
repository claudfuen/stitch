#!/usr/bin/env bun
// Spec lint: checks a room's words against its approved pictures before any frame is generated.
//
//   bun run space-lint <film> <room> [<room> ...] [--judges a,b] [--out file.json]
//
// Every prompt for a room is built from text in data/space/<film>/<room>.json (the layout legend, the cast
// descriptions, the style, each camera's shot). That text is written by hand, and when it disagrees with an approved
// reference (the room plate, a cast sheet, a prop) the generator splits the difference and the judge, which looks at
// the references, fails every take. Round 4 lost all 16 takes that way: the prompt said the button's lettering sat on
// a black base and Brock had a golden tan, while the approved pictures show lettering on the dome and a deep bronze
// tan. This asks two models, each with every reference image, to list each statement the pictures contradict, so the
// words are fixed once, before the money is spent.
import { gateway } from "@ai-sdk/gateway"
import { generateText } from "ai"
import { spawnSync } from "node:child_process"
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

;(globalThis as { AI_SDK_LOG_WARNINGS?: boolean }).AI_SDK_LOG_WARNINGS = false
const argv = process.argv.slice(2)
const flag = (k: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined }
const pos = argv.filter((a, i) => !a.startsWith("--") && !argv[i - 1]?.startsWith("--"))
const [film, ...rooms] = pos
const JUDGES = (flag("judges") ?? "anthropic/claude-opus-5.5,openai/gpt-6-astra").split(",")

type Room = { set: string; style: string; legend: Record<string, string>; setups: { id: string; shot?: string }[]; board: { room: string; cast: Record<string, string[]>; describe: Record<string, string>; props?: string[] } }
type Finding = { quote: string; reference: string; shows: string; rewrite: string; severity: "high" | "medium" | "low" }

function key() {
  if (process.env.AI_GATEWAY_API_KEY?.trim()) return
  const r = spawnSync("security", ["find-generic-password", "-s", "AI_GATEWAY_API_KEY", "-w"], { encoding: "utf8" })
  if (r.status !== 0 || !r.stdout.trim()) throw new Error("No AI Gateway key")
  process.env.AI_GATEWAY_API_KEY = r.stdout.trim()
}
function media(rel: string) {
  let file = path.join("public", rel)
  if (statSync(file).size > 4_500_000) {
    const small = path.join(tmpdir(), `lint-${path.basename(file).replace(/\.\w+$/, "")}.jpg`)
    spawnSync("ffmpeg", ["-v", "error", "-y", "-i", file, "-vf", "scale='min(2048,iw)':-2", "-q:v", "3", small])
    file = small
  }
  return { type: "file" as const, data: new Uint8Array(readFileSync(file)), mediaType: file.endsWith(".png") ? "image/png" : "image/jpeg" }
}

async function lint(model: string, r: Room) {
  const refs: { label: string; file: string }[] = [
    { label: "THE ROOM: the approved set", file: r.board.room },
    ...Object.entries(r.board.cast).flatMap(([who, files]) => files.map((f) => ({ label: `${who.toUpperCase()}: approved face and costume`, file: f }))),
    ...(r.board.props ?? []).map((f) => ({ label: "PROPS AND SIGNS: the approved designs", file: f })),
  ].filter((x) => existsSync(path.join("public", x.file)))
  const text = [
    `LEGEND (how the layout render's colours map to real things): ${r.legend.colour}`,
    ...Object.entries(r.board.describe).map(([who, d]) => `CAST ${who}: ${d}`),
    `STYLE: ${r.style}`,
    ...r.setups.map((s) => `SHOT ${s.id}: ${s.shot ?? ""}`),
  ].join("\n")
  const content = [
    ...refs.flatMap((x, i) => [{ type: "text" as const, text: `Reference ${i + 1}: ${x.label}` }, media(x.file)]),
    { type: "text" as const, text: `These references are approved and canonical for our ${r.set}. Below is the text our image prompts are built from. List every statement in the text that a reference contradicts: a colour, material, shape, lettering, layout of a sign or prop, a person's face, hair, skin, glasses or costume. Only real contradictions with what a reference clearly shows; ignore things the references do not show, and ignore staging (who stands where), which the plan owns. Where a PROPS AND SIGNS reference shows a prop, it overrides the version of that prop seen in THE ROOM.\n\n${text}\n\nAnswer with JSON only: {"findings": [{"quote": "<the exact words in the text>", "reference": "<which reference>", "shows": "<what the reference actually shows>", "rewrite": "<replacement words that match the reference>", "severity": "high" | "medium" | "low"}]}. High means a viewer comparing the frame with the reference would see a different person or prop.` },
  ]
  const res = await generateText({ model: gateway(model), messages: [{ role: "user", content }] })
  return (JSON.parse(res.text.slice(res.text.indexOf("{"), res.text.lastIndexOf("}") + 1)) as { findings: Finding[] }).findings
}

key()
const out: Record<string, unknown> = {}
for (const id of rooms) {
  const r = JSON.parse(readFileSync(`data/space/${film}/${id}.json`, "utf8")) as Room
  const verdicts = await Promise.all(JUDGES.map(async (m) => { try { return { model: m, findings: await lint(m, r) } } catch (e) { return { model: m, error: String((e as Error).message).slice(0, 200), findings: [] as Finding[] } } }))
  out[id] = verdicts
  console.log(`\n${id}`)
  for (const v of verdicts) for (const f of v.findings) console.log(`  [${f.severity} · ${v.model.split("/")[1]}] "${f.quote}"\n      ${f.reference}: ${f.shows}\n      -> ${f.rewrite}`)
}
writeFileSync(flag("out") ?? `work/${film}/space/lint.json`, JSON.stringify({ judges: JUDGES, at: new Date().toISOString(), rooms: out }, null, 1))
