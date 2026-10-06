// Blind realism panel: several vision models judge each still, one at a time, with no labels or file names.
// Include real frames as controls so the scores can be read against them.
//
//   bun run realism label=path [label=path ...] [--judges a,b,c] [--out work/realism.json]
//
// Prints the mean probability that each image is a real photograph, per judge and overall, plus the tells
// each judge named. A side signal for the stills gate, never the verdict: Claudio's eye and blind human pairs win.
import { gateway } from "@ai-sdk/gateway"
import { generateText } from "ai"
import { spawnSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

;(globalThis as { AI_SDK_LOG_WARNINGS?: boolean }).AI_SDK_LOG_WARNINGS = false

const JUDGES = ["anthropic/claude-opus-5.5", "google/gemini-3.5-flash", "openai/gpt-5.5"]
const ASK = `You are a photo forensics examiner. Decide whether this image is an unedited photograph or a frame from real camera footage, or whether it was generated or heavily edited by an AI image model.

Look at light sources and shadows, skin and fabric texture, depth of field, lens behaviour, grain and noise, reflections, perspective, props and staging.

Answer with JSON only: {"p_real": <0-100, your probability that it is a real photograph>, "tells": [<up to 5 short, specific things you see that point either way>]}`

function key() {
  if (process.env.AI_GATEWAY_API_KEY?.trim()) return
  const r = spawnSync("security", ["find-generic-password", "-s", "AI_GATEWAY_API_KEY", "-w"], { encoding: "utf8" })
  if (r.status !== 0 || !r.stdout.trim()) throw new Error("No AI Gateway key (env AI_GATEWAY_API_KEY or Keychain service AI_GATEWAY_API_KEY)")
  process.env.AI_GATEWAY_API_KEY = r.stdout.trim()
}

type Verdict = { judge: string; p_real: number | null; tells: string[]; error?: string }

async function judge(model: string, file: string): Promise<Verdict> {
  try {
    const ext = path.extname(file).toLowerCase()
    const r = await generateText({
      model: gateway(model),
      messages: [{ role: "user", content: [{ type: "file", data: new Uint8Array(readFileSync(file)), mediaType: ext === ".png" ? "image/png" : "image/jpeg" }, { type: "text", text: ASK }] }],
    })
    const json = JSON.parse(r.text.slice(r.text.indexOf("{"), r.text.lastIndexOf("}") + 1))
    return { judge: model, p_real: Number(json.p_real), tells: (json.tells ?? []).slice(0, 5) }
  } catch (e) {
    return { judge: model, p_real: null, tells: [], error: String((e as Error).message ?? e).slice(0, 200) }
  }
}

async function main() {
  key()
  const argv = process.argv.slice(2)
  const flag = (n: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined }
  const judges = flag("judges")?.split(",") ?? JUDGES
  const items = argv.filter((a, i) => a.includes("=") && !argv[i - 1]?.startsWith("--")).map((a) => { const [label, file] = a.split("="); return { label, file } })
  // Shuffle so no judge sees the images in a meaningful order.
  const jobs = items.flatMap((it) => judges.map((j) => ({ it, j }))).sort(() => Math.random() - 0.5)
  const results = await Promise.all(jobs.map(async ({ it, j }) => ({ label: it.label, ...(await judge(j, it.file)) })))
  const rows = items.map((it) => {
    const mine = results.filter((r) => r.label === it.label)
    const scored = mine.filter((r) => r.p_real !== null)
    const mean = scored.length ? Math.round(scored.reduce((s, r) => s + (r.p_real ?? 0), 0) / scored.length) : null
    return { label: it.label, file: it.file, mean, per: Object.fromEntries(mine.map((r) => [r.judge.split("/")[1], r.p_real ?? r.error ?? null])), tells: mine.flatMap((r) => r.tells.map((t) => `${r.judge.split("/")[1]}: ${t}`)) }
  })
  for (const r of rows.sort((a, b) => (b.mean ?? -1) - (a.mean ?? -1))) console.log(`${String(r.mean ?? "-").padStart(3)}  ${r.label}  ${JSON.stringify(r.per)}`)
  const out = flag("out")
  if (out) writeFileSync(out, JSON.stringify(rows, null, 2))
}

main()
