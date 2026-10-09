#!/usr/bin/env bun
// Run Higgsfield API models from a jobs file through the official SDK (subscribe polls until each request settles):
// the route for Seedance 2.5 reference-to-video with faces, which fal refuses. HF_CREDENTIALS ("key-id:key-secret")
// comes from .env.local (Bun loads it, Git ignores it) and is never printed. References are URLs.
//
//   bun scripts/higgsfield.ts batch jobs.json
//        jobs: [{ model: "bytedance/seedance-2.5/reference-to-video", input: {...}, out: "public/.../gen.mp4" }]
//
// Every output gets a sidecar <out>.json { provider: "higgsfield", model, request_id, input }, and a line on stdout:
// {"out", "request_id", "url"} when it completed, {"out", "status" | "error"} when it did not.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { config, higgsfield } from "@higgsfield/client/v2"

type Job = { model: string; input: Record<string, unknown>; out: string }

if (!process.env.HF_CREDENTIALS) throw new Error("HF_CREDENTIALS is not set (.env.local)")
config({ credentials: process.env.HF_CREDENTIALS })

async function run(job: Job) {
  const t0 = Date.now()
  const res = await higgsfield.subscribe(job.model, { input: job.input, withPolling: true })
  if (res.status !== "completed" || !res.video?.url) {
    // failed, nsfw (moderated) or no video: never a success
    console.log(JSON.stringify({ out: job.out, request_id: res.request_id, status: res.status }))
    return false
  }
  mkdirSync(path.dirname(job.out), { recursive: true })
  writeFileSync(job.out, new Uint8Array(await (await fetch(res.video.url)).arrayBuffer()))
  writeFileSync(`${job.out}.json`, JSON.stringify({ provider: "higgsfield", model: job.model, request_id: res.request_id, url: res.video.url, input: job.input }, null, 1))
  console.log(JSON.stringify({ out: job.out, request_id: res.request_id, url: res.video.url, secs: Math.round((Date.now() - t0) / 1000) }))
  return true
}

const [cmd, file] = process.argv.slice(2)
if (cmd !== "batch" || !file) {
  console.log("usage: bun scripts/higgsfield.ts batch jobs.json")
  process.exit(1)
}
const jobs = JSON.parse(readFileSync(file, "utf8")) as Job[]
const ok = await Promise.all(jobs.map((j) => run(j).catch((e) => (console.log(JSON.stringify({ out: j.out, error: (e as Error).message.slice(0, 300) })), false))))
process.exit(ok.every(Boolean) ? 0 : 1)
