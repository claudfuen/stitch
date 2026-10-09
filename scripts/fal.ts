#!/usr/bin/env bun
// Run fal.ai models from a jobs file: the route when Leap cannot take an input (for example its photo hold) or does
// not carry a model. Local reference images are sent inline as data URIs, so nothing needs uploading first.
//
//   bun run fal batch jobs.json [--concurrency 6]
//        jobs: [{ endpoint: "google/nano-banana-2.1/edit", input: {...}, refs?: [local paths -> input.image_urls],
//                 videos?: [-> input.video_urls], audios?: [-> input.audio_urls], out }]
//        Videos and audio go up to fal storage first; a video model's output (and its draft_id) is saved the same way.
//        files?: { field: local path } uploads single-file fields (sync-3 lipsync: video_url, audio_url).
//   bun run fal result <endpoint> <request_id> --out file.png      fetch a job submitted elsewhere (the fal connector)
//
// Every output gets a sidecar <out>.json: { provider: "fal", model, request_id, input (refs as paths) }.
// The key comes from FAL_KEY or the macOS Keychain (service FAL_KEY) and is never printed.
import { spawnSync } from "node:child_process"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

type Job = { endpoint: string; input: Record<string, unknown>; refs?: string[]; videos?: string[]; audios?: string[]; files?: Record<string, string>; out: string }

function key(): string {
  if (process.env.FAL_KEY?.trim()) return process.env.FAL_KEY.trim()
  const r = spawnSync("security", ["find-generic-password", "-s", "FAL_KEY", "-w"], { encoding: "utf8" })
  if (r.status !== 0 || !r.stdout.trim()) throw new Error("No fal key (env FAL_KEY or Keychain service FAL_KEY)")
  return (process.env.FAL_KEY = r.stdout.trim())
}

const MIME: Record<string, string> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" }
const dataUri = (file: string) => `data:${MIME[path.extname(file).toLowerCase()] ?? "image/png"};base64,${readFileSync(file).toString("base64")}`

async function fal(url: string, init: RequestInit = {}) {
  const res = await fetch(url, { ...init, headers: { authorization: `Key ${key()}`, "content-type": "application/json", ...init.headers }, signal: AbortSignal.timeout(120_000) })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`fal ${res.status} ${url}: ${JSON.stringify(body).slice(0, 400)}`)
  return body
}

/** Put a local file in fal storage and return its URL (for media too big to send inline). */
async function upload(file: string): Promise<string> {
  const type = { ".mp4": "video/mp4", ".mov": "video/quicktime", ".mp3": "audio/mpeg", ".wav": "audio/wav" }[path.extname(file).toLowerCase()] ?? MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream"
  const init = await fal("https://rest.alpha.fal.ai/storage/upload/initiate?storage_type=fal-cdn-v3", { method: "POST", body: JSON.stringify({ file_name: path.basename(file), content_type: type }) })
  const put = await fetch(init.upload_url, { method: "PUT", headers: { "content-type": type }, body: readFileSync(file), signal: AbortSignal.timeout(300_000) })
  if (!put.ok) throw new Error(`fal upload ${put.status} for ${file}`)
  return init.file_url
}

async function result(endpoint: string, id: string) {
  const base = `https://queue.fal.run/${endpoint.split("/").slice(0, 2).join("/")}/requests/${id}`
  for (let i = 0; i < 1200; i++) {
    const st = await fal(`${base}/status`)
    if (st.status === "COMPLETED") return fal(base)
    if (st.status === "FAILED" || st.error) throw new Error(`fal job ${id} failed: ${JSON.stringify(st).slice(0, 300)}`)
    await new Promise((r) => setTimeout(r, 2000))
  }
  throw new Error(`fal job ${id} timed out`)
}

async function save(out: string, endpoint: string, id: string, input: Record<string, unknown>, res: { images?: { url: string }[]; video?: { url: string }; draft_id?: string | null; seed?: number }) {
  const images = res.images ?? (res.video ? [res.video] : [])
  if (!images.length) throw new Error(`fal job ${id}: no images`)
  mkdirSync(path.dirname(out), { recursive: true })
  const base = out.slice(0, out.length - path.extname(out).length)
  const files: string[] = []
  for (const [i, im] of images.entries()) {
    const file = images.length === 1 ? out : `${base}-${i + 1}${path.extname(out)}`
    writeFileSync(file, new Uint8Array(await (await fetch(im.url)).arrayBuffer()))
    writeFileSync(`${file}.json`, JSON.stringify({ provider: "fal", model: endpoint, request_id: id, ...(res.draft_id ? { draft_id: res.draft_id } : {}), ...(res.seed !== undefined ? { seed: res.seed } : {}), input }, null, 1))
    files.push(file)
  }
  return files
}

async function run(job: Job) {
  const t0 = Date.now()
  const input = {
    ...job.input,
    ...(job.refs?.length ? { image_urls: job.refs.map(dataUri) } : {}),
    ...(job.videos?.length ? { video_urls: await Promise.all(job.videos.map(upload)) } : {}),
    ...(job.audios?.length ? { audio_urls: await Promise.all(job.audios.map(upload)) } : {}),
    ...Object.fromEntries(await Promise.all(Object.entries(job.files ?? {}).map(async ([k, f]) => [k, await upload(f)]))),
  }
  const sub = await fal(`https://queue.fal.run/${job.endpoint}`, { method: "POST", body: JSON.stringify(input) })
  const res = await result(job.endpoint, sub.request_id)
  const files = await save(job.out, job.endpoint, sub.request_id, { ...job.input, ...(job.refs ? { image_urls: job.refs } : {}), ...(job.videos ? { video_urls: job.videos } : {}), ...(job.audios ? { audio_urls: job.audios } : {}), ...job.files }, res)
  console.log(`ok ${job.endpoint} -> ${files.join(", ")} (${Math.round((Date.now() - t0) / 1000)} s, ${sub.request_id})`)
}

const [cmd, ...rest] = process.argv.slice(2)
const flag = (k: string) => { const i = rest.indexOf(`--${k}`); return i >= 0 ? rest[i + 1] : undefined }
if (cmd === "batch") {
  const jobs = JSON.parse(readFileSync(rest[0], "utf8")) as Job[]
  const n = Number(flag("concurrency") ?? 6)
  let next = 0, failed = 0
  await Promise.all(Array.from({ length: n }, async () => {
    while (next < jobs.length) {
      const job = jobs[next++]
      try { await run(job) } catch (e) { failed++; console.log(JSON.stringify({ out: job.out, error: (e as Error).message })) }
    }
  }))
  if (failed) process.exit(1)
  process.exit(0)
} else if (cmd === "result") {
  const [endpoint, id] = rest
  const out = flag("out")
  if (!endpoint || !id || !out) throw new Error("usage: fal result <endpoint> <request_id> --out file.png")
  console.log((await save(out, endpoint, id, {}, await result(endpoint, id))).join("\n"))
} else {
  console.log("usage: bun run fal batch jobs.json [--concurrency 6] | bun run fal result <endpoint> <request_id> --out f.png")
}
