// Generate stills with any image model on the Vercel AI Gateway, with reference images.
//
//   bun run imagine --model bfl/flux-3-image --prompt-file brief.txt [--ref a.jpg --ref b.jpg]
//                   [--aspect 16:9 | --size 2048x1152] [--n 1] [--seed 7] [--opt '{"bfl":{"raw":true}}'] --out work/x.jpg
//   bun run imagine --batch jobs.json [--concurrency 6]     jobs: [{ model, prompt | promptFile, refs?, aspect?, size?, n?, seed?, opt?, out }]
//
// Google image models are language models with image output, so they go through generateText; every other
// image model goes through generateImage. The gateway key comes from AI_GATEWAY_API_KEY or the macOS Keychain
// (service AI_GATEWAY_API_KEY) and is never printed. Register keepers with `stitch asset add`.
import { gateway } from "@ai-sdk/gateway"
import { generateImage, generateText } from "ai"
import { spawnSync } from "node:child_process"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

;(globalThis as { AI_SDK_LOG_WARNINGS?: boolean }).AI_SDK_LOG_WARNINGS = false

type Job = {
  model: string
  prompt?: string
  promptFile?: string
  refs?: string[]
  aspect?: `${number}:${number}`
  size?: `${number}x${number}`
  n?: number
  seed?: number
  opt?: Record<string, Record<string, unknown>>
  out: string
}

function key() {
  if (process.env.AI_GATEWAY_API_KEY?.trim()) return
  const r = spawnSync("security", ["find-generic-password", "-s", "AI_GATEWAY_API_KEY", "-w"], { encoding: "utf8" })
  if (r.status !== 0 || !r.stdout.trim()) throw new Error("No AI Gateway key (env AI_GATEWAY_API_KEY or Keychain service AI_GATEWAY_API_KEY)")
  process.env.AI_GATEWAY_API_KEY = r.stdout.trim()
}

const MIME: Record<string, string> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" }
const EXT: Record<string, string> = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp" }

function outPaths(out: string, mediaType: string, count: number) {
  const ext = EXT[mediaType] ?? path.extname(out)
  const base = out.slice(0, out.length - path.extname(out).length)
  return Array.from({ length: count }, (_, i) => (count === 1 ? `${base}${ext}` : `${base}-${i + 1}${ext}`))
}

async function run(job: Job) {
  const t0 = Date.now()
  const text = job.prompt ?? readFileSync(job.promptFile!, "utf8").trim()
  const refs = (job.refs ?? []).map((f) => ({ data: new Uint8Array(readFileSync(f)), mediaType: MIME[path.extname(f).toLowerCase()] ?? "image/jpeg" }))
  mkdirSync(path.dirname(job.out), { recursive: true })
  let files: { bytes: Uint8Array; mediaType: string }[]

  if (job.model.startsWith("google/")) {
    const r = await generateText({
      model: gateway(job.model),
      messages: [{ role: "user", content: [...refs.map((r) => ({ type: "file" as const, data: r.data, mediaType: r.mediaType })), { type: "text" as const, text }] }],
      providerOptions: { google: { responseModalities: ["TEXT", "IMAGE"], imageConfig: { aspectRatio: job.aspect ?? "16:9", imageSize: "2K" } }, ...job.opt } as never,
    })
    files = r.files.filter((f) => f.mediaType.startsWith("image/")).map((f) => ({ bytes: f.uint8Array, mediaType: f.mediaType }))
    if (!files.length) throw new Error(`no image returned${r.text ? `: ${r.text.slice(0, 300)}` : ""}`)
  } else {
    const r = await generateImage({
      model: gateway.imageModel(job.model),
      prompt: refs.length ? { images: refs.map((r) => r.data), text } : text,
      ...(job.size ? { size: job.size } : { aspectRatio: job.aspect ?? "16:9" }),
      n: job.n ?? 1,
      seed: job.seed,
      providerOptions: job.opt as never,
    })
    files = r.images.map((im) => ({ bytes: im.uint8Array, mediaType: im.mediaType ?? "image/png" }))
  }

  const paths = outPaths(job.out, files[0].mediaType, files.length)
  files.forEach((f, i) => writeFileSync(paths[i], f.bytes))
  writeFileSync(`${job.out}.json`, JSON.stringify({ model: job.model, prompt: text, refs: job.refs ?? [], aspect: job.aspect, size: job.size, seed: job.seed, opt: job.opt, files: paths }, null, 2))
  return { model: job.model, files: paths, seconds: Math.round((Date.now() - t0) / 100) / 10 }
}

function args(argv: string[]) {
  const o: Record<string, string[]> = {}
  for (let i = 0; i < argv.length; i++) if (argv[i].startsWith("--")) (o[argv[i].slice(2)] ??= []).push(argv[i + 1]?.startsWith("--") || argv[i + 1] === undefined ? "true" : argv[++i])
  return o
}

async function main() {
  key()
  const a = args(process.argv.slice(2))
  const jobs: Job[] = a.batch
    ? JSON.parse(readFileSync(a.batch[0], "utf8"))
    : [{ model: a.model?.[0], prompt: a.prompt?.[0], promptFile: a["prompt-file"]?.[0], refs: a.ref, aspect: a.aspect?.[0] as Job["aspect"], size: a.size?.[0] as Job["size"], n: a.n ? Number(a.n[0]) : undefined, seed: a.seed ? Number(a.seed[0]) : undefined, opt: a.opt ? JSON.parse(a.opt[0]) : undefined, out: a.out?.[0] } as Job]
  for (const j of jobs) if (!j.model || !j.out || !(j.prompt || j.promptFile)) throw new Error("each job needs model, out, and prompt or promptFile")
  const limit = Number(a.concurrency?.[0] ?? 6)
  const queue = [...jobs]
  let failed = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, jobs.length) }, async () => {
      for (let j = queue.shift(); j; j = queue.shift()) {
        try {
          console.log(JSON.stringify(await run(j)))
        } catch (e) {
          failed++
          console.log(JSON.stringify({ model: j.model, out: j.out, error: String((e as Error).message ?? e).slice(0, 500) }))
        }
      }
    }),
  )
  if (failed) process.exitCode = 1
}

main()
