#!/usr/bin/env bun
// Run Higgsfield API models from a jobs file through the official SDK (subscribe polls until each request settles):
// the route for Seedance 2.5 reference-to-video with faces, which fal refuses. HF_CREDENTIALS ("key-id:key-secret")
// comes from .env.local (Bun loads it, Git ignores it) and is never printed. References are URLs.
//
//   bun scripts/higgsfield.ts batch jobs.json
//        jobs: [{ model: "bytedance/seedance-2.5/reference-to-video", input: {...}, out: "public/.../gen.mp4" }]
//
// Each request id is written to <out>.pending.json the moment it is submitted, so a slow job can be picked up again
// (`resume <out>`), and the poll waits up to 30 min. Every output gets a sidecar <out>.json { provider: "higgsfield",
// model, request_id, input }, and a line on stdout: {"out", "request_id", "url"} when it completed, {"out", "status" |
// "error"} when it did not.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { config, higgsfield } from "@higgsfield/client/v2"

type Job = { model: string; input: Record<string, unknown>; out: string }

if (!process.env.HF_CREDENTIALS) throw new Error("HF_CREDENTIALS is not set (.env.local)")
config({ credentials: process.env.HF_CREDENTIALS, maxPollTime: 1_800_000 })

type Status = { status: string; request_id: string; video?: { url: string } }
async function poll(id: string): Promise<Status> {
  for (const t0 = Date.now(); Date.now() - t0 < 1_800_000; ) {
    const r = await fetch(`https://api.higgsfield.ai/requests/${id}/status`, { headers: { authorization: `Key ${process.env.HF_CREDENTIALS}` }, signal: AbortSignal.timeout(60_000) }).catch(() => null)
    const s = r?.ok ? ((await r.json()) as Status) : null
    if (s && ["completed", "failed", "nsfw", "canceled", "cancelled"].includes(s.status)) return s
    await new Promise((ok) => setTimeout(ok, 5000))
  }
  throw new Error(`request ${id} still running after 30 min: resume it later`)
}

async function run(job: Job, resumeId?: string) {
  const t0 = Date.now()
  let id = resumeId
  if (!id) {
    const sub = await higgsfield.subscribe(job.model, { input: job.input, withPolling: false })
    id = sub.request_id
    mkdirSync(path.dirname(job.out), { recursive: true })
    writeFileSync(`${job.out}.pending.json`, JSON.stringify({ model: job.model, request_id: id, input: job.input }, null, 1))
  }
  const res = await poll(id)
  if (res.status !== "completed" || !res.video?.url) {
    // failed, nsfw (moderated) or no video: never a success
    console.log(JSON.stringify({ out: job.out, request_id: res.request_id, status: res.status }))
    return false
  }
  mkdirSync(path.dirname(job.out), { recursive: true })
  writeFileSync(job.out, new Uint8Array(await (await fetch(res.video.url)).arrayBuffer()))
  writeFileSync(`${job.out}.json`, JSON.stringify({ provider: "higgsfield", model: job.model, request_id: res.request_id, url: res.video.url, input: job.input }, null, 1))
  if (existsSync(`${job.out}.pending.json`)) rmSync(`${job.out}.pending.json`)
  console.log(JSON.stringify({ out: job.out, request_id: res.request_id, url: res.video.url, secs: Math.round((Date.now() - t0) / 1000) }))
  return true
}

const [cmd, file] = process.argv.slice(2)
if (cmd === "resume" && file) {
  const p = JSON.parse(readFileSync(`${file}.pending.json`, "utf8"))
  process.exit((await run({ model: p.model, input: p.input, out: file }, p.request_id)) ? 0 : 1)
}
if (cmd !== "batch" || !file) {
  console.log("usage: bun scripts/higgsfield.ts batch jobs.json | resume <out.mp4>")
  process.exit(1)
}
const jobs = JSON.parse(readFileSync(file, "utf8")) as Job[]
const ok = await Promise.all(jobs.map((j) => run(j).catch((e) => (console.log(JSON.stringify({ out: j.out, error: (e as Error).message.slice(0, 300) })), false))))
process.exit(ok.every(Boolean) ? 0 : 1)
