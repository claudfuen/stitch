// Blind same-room panel: several vision models judge whether a candidate shows the same physical room as a real
// reference photo, one pair at a time, with no labels. Include a different room as a negative control.
//
//   bun run sameroom ref.jpg label=path [label=path ...] [--judges a,b,c] [--out work/sameroom.json]
//
// Prints the mean probability that each candidate is the same room as the reference, per judge and overall, plus the
// reasons each judge gave. A side signal for set continuity, never the verdict.
import { gateway } from "@ai-sdk/gateway"
import { generateText } from "ai"
import { spawnSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

;(globalThis as { AI_SDK_LOG_WARNINGS?: boolean }).AI_SDK_LOG_WARNINGS = false

const JUDGES = ["anthropic/claude-opus-5.5", "google/gemini-3.5-flash", "openai/gpt-5.5"]
const ASK = `Image 1 is a reference photograph of a room. Image 2 is another image, possibly from a different camera position or angle.

Decide whether Image 2 shows the same physical room as Image 1 (the same architecture, finishes, materials, fixtures and objects), even if the camera looks at a different wall. Ignore people and lighting differences.

Answer with JSON only: {"p_same": <0-100, your probability that it is the same room>, "reasons": [<up to 4 short, specific observations>]}`

function key() {
  if (process.env.AI_GATEWAY_API_KEY?.trim()) return
  const r = spawnSync("security", ["find-generic-password", "-s", "AI_GATEWAY_API_KEY", "-w"], { encoding: "utf8" })
  if (r.status !== 0 || !r.stdout.trim()) throw new Error("No AI Gateway key (env AI_GATEWAY_API_KEY or Keychain service AI_GATEWAY_API_KEY)")
  process.env.AI_GATEWAY_API_KEY = r.stdout.trim()
}

const part = (file: string) => ({ type: "file" as const, data: new Uint8Array(readFileSync(file)), mediaType: path.extname(file).toLowerCase() === ".png" ? "image/png" : "image/jpeg" })

async function judge(model: string, ref: string, file: string) {
  try {
    const r = await generateText({ model: gateway(model), messages: [{ role: "user", content: [part(ref), part(file), { type: "text", text: ASK }] }] })
    const json = JSON.parse(r.text.slice(r.text.indexOf("{"), r.text.lastIndexOf("}") + 1))
    return { judge: model, p: Number(json.p_same), reasons: (json.reasons ?? []).slice(0, 4) as string[] }
  } catch (e) {
    return { judge: model, p: null as number | null, reasons: [] as string[], error: String((e as Error).message ?? e).slice(0, 200) }
  }
}

async function main() {
  key()
  const argv = process.argv.slice(2)
  const flag = (n: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined }
  const judges = flag("judges")?.split(",") ?? JUDGES
  const ref = argv[0]
  const items = argv.slice(1).filter((a, i, all) => a.includes("=") && !all[i - 1]?.startsWith("--")).map((a) => { const [label, file] = a.split("="); return { label, file } })
  const jobs = items.flatMap((it) => judges.map((j) => ({ it, j })))
  const results = await Promise.all(jobs.map(async ({ it, j }) => ({ label: it.label, ...(await judge(j, ref, it.file)) })))
  const rows = items.map((it) => {
    const mine = results.filter((r) => r.label === it.label)
    const scored = mine.filter((r) => r.p !== null)
    const mean = scored.length ? Math.round(scored.reduce((s, r) => s + (r.p ?? 0), 0) / scored.length) : null
    return { label: it.label, file: it.file, mean, per: Object.fromEntries(mine.map((r) => [r.judge.split("/")[1], r.p])), reasons: mine.flatMap((r) => r.reasons.map((t) => `${r.judge.split("/")[1]}: ${t}`)) }
  })
  for (const r of rows.sort((a, b) => (b.mean ?? -1) - (a.mean ?? -1))) console.log(`${String(r.mean ?? "-").padStart(3)}  ${r.label}  ${JSON.stringify(r.per)}`)
  const out = flag("out")
  if (out) writeFileSync(out, JSON.stringify(rows, null, 2))
}

main()
