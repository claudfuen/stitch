// Plan conformance: does a plate show what the floor plan says this camera sees, and nothing it says the camera cannot see?
// Questions come from the camera's visibility report (lightbox.py --ids): each visible piece in its third of the frame,
// each salient piece that is out of shot or behind the camera (must be absent), the side the daylight comes from, and
// which way each person looks. Several vision models answer blind; the score is the share of answers that match the plan.
// This replaces the same-room judge as the set-continuity check: that one rewarded copying a wall's anchors onto the wrong wall.
//
//   bun run conform <setup.vis.json> label=image.jpg [label=image.jpg ...] [--people] [--judges a,b,c] [--out work/conform.json]
import { gateway } from "@ai-sdk/gateway"
import { generateText } from "ai"
import { spawnSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

;(globalThis as { AI_SDK_LOG_WARNINGS?: boolean }).AI_SDK_LOG_WARNINGS = false

const JUDGES = ["anthropic/claude-opus-5.5", "google/gemini-3.5-flash", "openai/gpt-5.5"]
type Vis = {
  visible: { id: string; label: string; kind: string; share: number; where: string; box: [number, number, number, number] }[]
  edges: { id: string; label: string; kind: string }[]
  behind: { id: string; label: string; kind: string }[]
  lights: { id: string; type: string; side: string }[]
  eyelines: { mark: string; who: string; looks: string }[]
}
type Q = { q: string; expect: string; accept?: string[]; kind: "present" | "absent" | "light" | "eyeline" }

function key() {
  if (process.env.AI_GATEWAY_API_KEY?.trim()) return
  const r = spawnSync("security", ["find-generic-password", "-s", "AI_GATEWAY_API_KEY", "-w"], { encoding: "utf8" })
  if (r.status !== 0 || !r.stdout.trim()) throw new Error("No AI Gateway key (env AI_GATEWAY_API_KEY or Keychain service AI_GATEWAY_API_KEY)")
  process.env.AI_GATEWAY_API_KEY = r.stdout.trim()
}

/** A plain name a judge can look for: the label before its first comma, colon or bracket, without which wall it is on. */
const plain = (label: string) =>
  label.split(/[,:(]/)[0].replace(/\b(in|on|against) the (right|left|back|front) wall\b/gi, "").replace(/\s+/g, " ").trim().toLowerCase()
const third = (where: string) => (where.startsWith("far left") || where.startsWith("left") ? "left" : where.startsWith("centre") ? "middle" : "right")
const SALIENT = /window|door|guitar|sketch|cabinet|lamp|bookcase|sconce|bulb|chair|table/i
// Kinds of thing a judge cannot tell apart by name ("the left wall's sketches" and "the charcoal wall's sketches" are both
// framed sketches): an absent-question is skipped when something of the same kind is in the picture.
const NOUN = /window|door|guitar|sketch|cabinet|lamp|bookcase|sconce|bulb|chair|table/i
/** The thirds a judge may fairly name for a box: its centre's third, and the neighbour when the centre is near a boundary. */
function thirds(box: [number, number, number, number]) {
  const cx = (box[0] + box[2]) / 2
  const names = ["left", "middle", "right"]
  const i = Math.min(2, Math.floor(cx * 3))
  const ok = new Set([names[i]])
  if (cx - i / 3 < 0.07 && i > 0) ok.add(names[i - 1])
  if ((i + 1) / 3 - cx < 0.07 && i < 2) ok.add(names[i + 1])
  return [...ok]
}

function questions(v: Vis, people: boolean): Q[] {
  const qs: Q[] = []
  const seen = new Set<string>()
  for (const x of v.visible) {
    if (x.kind === "wall" || x.kind === "person" || x.share < 0.002 || !SALIENT.test(x.label)) continue
    const n = plain(x.label)
    if (seen.has(n)) continue
    seen.add(n)
    const ok = thirds(x.box)
    qs.push({ q: `Where is ${/^(a|an|the|two|henrick's)\b/.test(n) ? n : `a ${n}`}? Answer one of: left, middle, right (thirds of the frame), or none if it is not in the picture.`, expect: ok[0], accept: ok, kind: "present" })
  }
  const shown = new Set(v.visible.filter((x) => x.kind !== "wall" && x.share >= 0.0005).flatMap((x) => x.label.match(new RegExp(NOUN, "gi")) ?? []).map((w) => w.toLowerCase()))
  for (const x of [...v.edges, ...v.behind]) {
    if (x.kind === "wall" || x.kind === "person" || !SALIENT.test(x.label)) continue
    const n = plain(x.label)
    const noun = (x.label.match(NOUN)?.[0] ?? "").toLowerCase()
    if (seen.has(n) || /chair|table/i.test(n) || (noun && shown.has(noun))) continue
    seen.add(n)
    qs.push({ q: `Does the picture show ${/^(a|an|the|two)\b/.test(n) ? n : `a ${n}`} anywhere?`, expect: "no", kind: "absent" })
  }
  const window = v.visible.find((x) => x.kind === "window")
  const k = v.lights.find((l) => l.type === "area")
  const side = window ? third(window.where) : k?.side.includes("left") ? "left" : k?.side.includes("right") ? "right" : k?.side.includes("behind") ? "behind the camera" : undefined
  if (side && side !== "middle")
    qs.push({ q: "Where does the main daylight come from? Answer one of: left, right, behind the camera, facing the camera, above.", expect: side, kind: "light" })
  if (people)
    for (const e of v.eyelines) {
      const who = e.who === "henrick" ? "the older man with silver hair" : e.who === "founder" ? "the young man in the grey hoodie" : e.who
      const expect = e.looks.includes("left") ? "left" : e.looks.includes("right") ? "right" : e.looks.includes("toward camera") ? "toward the camera" : "away"
      qs.push({ q: `Which way does ${who} look? Answer one of: left, right, toward the camera, away. (If he is seen from behind, answer away.)`, expect, kind: "eyeline" })
    }
  return qs
}

const part = (file: string) => ({ type: "file" as const, data: new Uint8Array(readFileSync(file)), mediaType: path.extname(file).toLowerCase() === ".png" ? "image/png" : "image/jpeg" })

async function judge(model: string, file: string, qs: Q[]) {
  const ask = `Answer each question about this picture only from what you can see. "Left", "middle" and "right" mean thirds of the frame as you look at it.
${qs.map((q, i) => `${i + 1}. ${q.q}`).join("\n")}
Answer with JSON only: {"answers": ["...", ...]} with one short answer per question, in order (yes/no, or one of the listed options).`
  try {
    const r = await generateText({ model: gateway(model), messages: [{ role: "user", content: [part(file), { type: "text", text: ask }] }] })
    const json = JSON.parse(r.text.slice(r.text.indexOf("{"), r.text.lastIndexOf("}") + 1))
    return { judge: model, answers: (json.answers as string[]).map((a) => String(a).toLowerCase().trim()) }
  } catch (e) {
    return { judge: model, answers: null as string[] | null, error: String((e as Error).message ?? e).slice(0, 200) }
  }
}

const match = (a: string, q: Q) => (q.accept ?? [q.expect]).some((e) => (e === "behind the camera" ? a.includes("behind") : e === "toward the camera" ? a.includes("camera") && !a.includes("away") : a.startsWith(e)))

async function main() {
  key()
  const argv = process.argv.slice(2)
  const flag = (n: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined }
  const judges = flag("judges")?.split(",") ?? JUDGES
  const vis: Vis = JSON.parse(readFileSync(argv[0], "utf8"))
  const qs = questions(vis, argv.includes("--people"))
  const values = new Set(["--judges", "--out"].map((f) => (argv.includes(f) ? argv[argv.indexOf(f) + 1] : "")))
  const items = argv.slice(1).filter((a) => a.includes("=") && !a.startsWith("--") && !values.has(a)).map((a) => { const [label, file] = a.split("="); return { label, file } })
  const rows = await Promise.all(items.map(async (it) => {
    const res = await Promise.all(judges.map((j) => judge(j, it.file, qs)))
    const per = res.map((r) => ({ judge: r.judge.split("/")[1], score: r.answers ? Math.round((100 * qs.filter((q, i) => match(r.answers![i] ?? "", q)).length) / qs.length) : null, answers: r.answers }))
    const scored = per.filter((p) => p.score !== null)
    const misses = qs.map((q, i) => ({ q: q.q, expect: q.expect, wrong: per.filter((p) => p.answers && !match(p.answers[i] ?? "", q)).map((p) => `${p.judge}:${p.answers![i]}`) })).filter((m) => m.wrong.length >= Math.ceil(scored.length / 2))
    return { label: it.label, file: it.file, score: scored.length ? Math.round(scored.reduce((s, p) => s + (p.score ?? 0), 0) / scored.length) : null, per: Object.fromEntries(per.map((p) => [p.judge, p.score])), misses }
  }))
  console.log(`${qs.length} questions: ${qs.map((q) => `${q.kind}:${(q.accept ?? [q.expect]).join("/")}`).join(" ")}`)
  for (const r of rows) {
    console.log(`${String(r.score ?? "-").padStart(3)}  ${r.label}  ${JSON.stringify(r.per)}`)
    for (const m of r.misses) console.log(`       miss: ${m.q} (plan: ${m.expect}; ${m.wrong.join(", ")})`)
  }
  const out = flag("out")
  if (out) writeFileSync(out, JSON.stringify({ questions: qs, rows }, null, 2))
}

main()
