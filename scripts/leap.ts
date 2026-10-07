#!/usr/bin/env bun
// Generate images, video and audio through the Leap API (api.tryleap.ai), the default route for every model Leap
// carries. Local files are uploaded once (cached by content hash) and passed by file ID.
//
//   bun run leap credits | models [query] | schema <model>
//   bun run leap run --model google/nano-banana-pro --prompt-file brief.txt [--image a.jpg ...] [--field first_frame=a.jpg]
//                    [--input '{"aspect_ratio":"16:9","settings":{"resolution":"2K"}}'] [--quote] --out work/x.png
//   bun run leap batch jobs.json [--concurrency 6] [--quote]
//        jobs: [{ model, prompt | promptFile, images?: [path], files?: { field: path }, input?: {...}, out }]
//
// Every output gets a sidecar <out>.json (model, input, generation id, cost). Register keepers with
// `stitch asset add --model <model> --prompt-file <brief> --inputs ..`. The key comes from LEAP_API_KEY or the macOS
// Keychain (service LEAP_API_KEY) and is never printed.
import { createHash, randomUUID } from "node:crypto"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

const API = "https://api.tryleap.ai"
const FINAL = ["succeeded", "failed", "canceled"]
const CACHE = "work/leap/files.json"

type Job = {
  model: string
  prompt?: string
  promptFile?: string
  images?: string[]
  files?: Record<string, string>
  input?: Record<string, unknown>
  out: string
}

function key(): string {
  if (process.env.LEAP_API_KEY?.trim()) return process.env.LEAP_API_KEY.trim()
  const r = spawnSync("security", ["find-generic-password", "-s", "LEAP_API_KEY", "-w"], { encoding: "utf8" })
  if (r.status !== 0 || !r.stdout.trim()) throw new Error("No Leap key (env LEAP_API_KEY or Keychain service LEAP_API_KEY)")
  return (process.env.LEAP_API_KEY = r.stdout.trim())
}

// Every request has a deadline: with none, one stalled connection hung whole batches for half an hour while Leap itself
// answered in a third of a second. A stalled or dropped request is retried (a generation keeps its idempotency key, and
// a long-poll that times out just polls again).
async function leap(p: string, init: RequestInit & { raw?: boolean; timeoutMs?: number } = {}) {
  for (let attempt = 0; ; attempt++) {
    let res: Response
    let text: string
    const t0 = Date.now()
    if (process.env.LEAP_DEBUG) console.error(`-> ${init.method ?? "GET"} ${p}`)
    try {
      res = await fetch(`${API}${p}`, {
        ...init,
        signal: AbortSignal.timeout(init.timeoutMs ?? 120_000),
        headers: { "x-api-key": key(), ...(init.raw ? {} : { "content-type": "application/json" }), ...init.headers },
      })
      text = await res.text()
      if (process.env.LEAP_DEBUG) console.error(`<- ${res.status} ${p} ${Date.now() - t0} ms`)
    } catch (err) {
      if (attempt < 4) {
        console.error(`leap ${p}: ${(err as Error).name} (${(err as Error).message}), retrying`)
        await new Promise((r) => setTimeout(r, 2 ** attempt * 1000))
        continue
      }
      throw err
    }
    // A 429 that is a policy hold (the workspace's photo checks are paused), not a rate, never clears by waiting.
    const hold = res.status === 429 && /blocked|can't check|cannot check/i.test(text)
    if ((res.status === 429 || res.status >= 500) && !hold && attempt < 6) {
      // Say so: a silent retry-after on a concurrency cap looked like a hang for half an hour.
      const wait = Math.min(60, Number(res.headers.get("retry-after") ?? 2 ** attempt))
      console.error(`leap ${res.status} ${p}: ${text.slice(0, 160)}; retrying in ${wait} s`)
      await new Promise((r) => setTimeout(r, wait * 1000))
      continue
    }
    let body: any
    try { body = JSON.parse(text) } catch { throw new Error(`Leap ${res.status} ${p}: not JSON: ${text.slice(0, 160)}`) }
    if (!res.ok) {
      const e = body.error ?? {}
      throw new Error(`Leap ${res.status} ${e.type}/${e.code}: ${e.message}${e.param ? ` (${e.param})` : ""} [${e.request_id ?? res.headers.get("x-request-id")}]`)
    }
    return body
  }
}

const MIME: Record<string, string> = {
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp",
  ".mp3": "audio/mpeg", ".wav": "audio/wav", ".m4a": "audio/mp4", ".mp4": "video/mp4", ".mov": "video/quicktime",
}

/** Upload a local file once; later calls with the same bytes reuse the file ID. */
async function upload(file: string): Promise<string> {
  const bytes = readFileSync(file)
  const hash = createHash("sha256").update(bytes).digest("hex")
  const cache: Record<string, string> = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, "utf8")) : {}
  if (cache[hash]) return cache[hash]
  const type = MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream"
  let r: { id: string }
  if (type.startsWith("image/")) {  // images go to /v1/files; keep them under ~5 MB (a 5.7 MB PNG came back as a non-JSON error)
    r = await leap("/v1/files", { method: "POST", raw: true, body: bytes, headers: { "content-type": type, "x-filename": path.basename(file) } })
  } else {
    // Video and sound: start an upload, PUT the bytes to the signed URL, then complete it.
    const u = await leap("/v1/uploads", { method: "POST", body: JSON.stringify({ filename: path.basename(file), content_type: type, bytes: bytes.length }) })
    const put = await fetch(u.upload_url, { method: u.upload_method ?? "PUT", headers: { ...(u.upload_headers ?? {}), "content-type": type }, body: bytes, signal: AbortSignal.timeout(300_000) })
    if (!put.ok) throw new Error(`upload ${file}: ${put.status} ${(await put.text()).slice(0, 160)}`)
    r = await leap(`/v1/uploads/${u.id}/complete`, { method: "POST", body: JSON.stringify({ filename: path.basename(file) }) })
  }
  const fresh: Record<string, string> = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, "utf8")) : {}
  fresh[hash] = r.id
  mkdirSync(path.dirname(CACHE), { recursive: true })
  writeFileSync(CACHE, JSON.stringify(fresh, null, 1))
  return r.id
}

async function buildInput(job: Job) {
  const input: Record<string, unknown> = { ...job.input }
  const prompt = job.prompt ?? (job.promptFile ? readFileSync(job.promptFile, "utf8").trim() : undefined)
  if (prompt) input.prompt = prompt
  if (job.images?.length) input.images = await Promise.all(job.images.map(upload))
  for (const [field, file] of Object.entries(job.files ?? {})) input[field] = await upload(file)
  return input
}

const EXT: Record<string, string> = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "video/mp4": ".mp4", "audio/mpeg": ".mp3", "audio/wav": ".wav" }

async function run(job: Job, quoteOnly = false) {
  const t0 = Date.now()
  const input = await buildInput(job)
  if (quoteOnly) {
    const q = await leap("/v1/quotes", { method: "POST", body: JSON.stringify({ model: job.model, input }) })
    console.log(`quote ${job.model} -> ${job.out}: $${q.cost_usd}`)
    return Number(q.cost_usd)
  }
  let g = await leap("/v1/generations", {
    method: "POST",
    headers: { "idempotency-key": randomUUID(), prefer: "wait=60" },
    body: JSON.stringify({ model: job.model, input }),
  })
  while (!FINAL.includes(g.status)) g = await leap(`/v1/generations/${g.id}`, { headers: { prefer: "wait=60" } })
  if (g.status !== "succeeded") throw new Error(`${job.model} -> ${job.out}: ${g.status} ${g.error?.message ?? ""} [${g.id}]`)
  mkdirSync(path.dirname(job.out), { recursive: true })
  const base = job.out.slice(0, job.out.length - path.extname(job.out).length)
  const outs: string[] = []
  for (const [i, o] of (g.output as { url: string; content_type?: string }[]).entries()) {
    const ext = EXT[o.content_type ?? ""] ?? path.extname(job.out)
    const file = g.output.length === 1 ? `${base}${ext}` : `${base}-${i + 1}${ext}`
    const res = await fetch(o.url, { signal: AbortSignal.timeout(300_000) })
    if (!res.ok) throw new Error(`download ${o.url}: ${res.status}`)
    writeFileSync(file, new Uint8Array(await res.arrayBuffer()))
    writeFileSync(`${file}.json`, JSON.stringify({ provider: "leap", model: job.model, generation: g.id, cost_usd: g.usage?.cost_usd, sources: { promptFile: job.promptFile, images: job.images, files: job.files }, input }, null, 1))
    outs.push(file)
  }
  console.log(`ok ${job.model} -> ${outs.join(", ")} ($${g.usage?.cost_usd ?? "?"}, ${((Date.now() - t0) / 1000).toFixed(0)} s, ${g.id})`)
  return Number(g.usage?.cost_usd ?? 0)
}

async function pool<T>(items: T[], n: number, f: (x: T) => Promise<number>) {
  let i = 0
  let total = 0
  const errors: string[] = []
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const item = items[i++]
        try { const cost = await f(item); total += cost } catch (e) { errors.push((e as Error).message); console.error(`FAIL ${(e as Error).message}`) }
      }
    }),
  )
  return { total, errors }
}

const argv = process.argv.slice(2)
const multi: Record<string, string[]> = {}
const pos: string[] = []
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (a.startsWith("--")) {
    const next = argv[i + 1]
    const v = next !== undefined && !next.startsWith("--") ? (i++, next) : "true"
    ;(multi[a.slice(2)] ??= []).push(v)
  } else pos.push(a)
}
const flag = (k: string) => multi[k]?.[0]

async function main() {
  const [cmd, arg] = pos
  if (cmd === "credits") return console.log(await leap("/v1/credits"))
  if (cmd === "models") {
    const r = await leap("/v1/models")
    for (const m of r.data ?? r) if (!arg || m.id.includes(arg)) console.log(`${m.id.padEnd(44)} ${m.modality.padEnd(6)} ${m.tasks.join(",").padEnd(36)} ${m.status} $${m.pricing?.usd}/${m.pricing?.unit}`)
    return
  }
  if (cmd === "schema") {
    const m = await leap(`/v1/models/${arg}`)
    return console.log(JSON.stringify({ pricing: m.pricing, input_schema: m.input_schema }, null, 1))
  }
  const quote = !!flag("quote")
  if (cmd === "run") {
    const files: Record<string, string> = {}
    for (const f of multi.field ?? []) {
      const [k, v] = f.split("=")
      files[k] = v
    }
    const job: Job = {
      model: flag("model")!, prompt: flag("prompt"), promptFile: flag("prompt-file"), images: multi.image, files,
      input: flag("input") ? JSON.parse(flag("input")!) : undefined, out: flag("out")!,
    }
    if (!job.model || !job.out) throw new Error("run --model <id> --out <file> [--prompt-file f] [--image a.jpg] [--field k=file] [--input json]")
    await run(job, quote)
    return
  }
  if (cmd === "batch") {
    const jobs: Job[] = JSON.parse(readFileSync(arg, "utf8"))
    const { total, errors } = await pool(jobs, Number(flag("concurrency") ?? 6), (j) => run(j, quote))
    console.log(`${quote ? "quoted" : "spent"} $${total.toFixed(2)} on ${jobs.length - errors.length}/${jobs.length} jobs`)
    if (errors.length) process.exit(1)
    return
  }
  console.log("commands: credits, models [query], schema <model>, run, batch <jobs.json>")
}

process.chdir(path.resolve(path.dirname(new URL(import.meta.url).pathname), ".."))
main().catch((e) => {
  console.error("error:", e.message)
  process.exit(1)
})
