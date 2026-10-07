// GET /api/thumb?src=/generated/x.mp4&w=320[&v=<mtime>] -> a small WebP poster of an image or a video.
// Every image and video the board lists is drawn from these, never at full size: the canvas used to decode about a
// gigabyte of 2560 px stills and keep 33 HD videos open at once, which crashed the tab. Images are resized with sharp;
// a video gets one frame (1 s in, or its first frame when shorter) from ffmpeg. Posters are cached on disk by file,
// mtime and width, so each is made once.

import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import { promises as fs } from "node:fs"
import path from "node:path"
import { promisify } from "node:util"
import { projectRoot } from "@/lib/store"

const run = promisify(execFile)
const WIDTHS = [160, 320, 640, 1280]
const VIDEO = /\.(mp4|mov|m4v|webm)$/i
const IMAGE = /\.(jpe?g|png|webp|avif|gif)$/i

// A cold board asks for a hundred posters at once; make four at a time, and each one only once.
let busy = 0
const waiting: (() => void)[] = []
async function slot<T>(f: () => Promise<T>): Promise<T> {
  while (busy >= 4) await new Promise<void>((r) => waiting.push(r))
  busy++
  try {
    return await f()
  } finally {
    busy--
    waiting.shift()?.()
  }
}
const making = new Map<string, Promise<Buffer>>()

async function frame(file: string, at: number, w: number): Promise<Buffer> {
  const { stdout } = await run(
    "ffmpeg",
    ["-v", "error", "-ss", String(at), "-i", file, "-frames:v", "1", "-vf", `scale='min(iw,${w})':-2`, "-f", "image2pipe", "-c:v", "png", "-"],
    { encoding: "buffer", maxBuffer: 32 << 20 },
  )
  if (!stdout.length) throw new Error("no frame")
  return stdout
}

async function make(file: string, w: number, out: string): Promise<Buffer> {
  const input = VIDEO.test(file) ? await frame(file, 1, w).catch(() => frame(file, 0, w)) : await fs.readFile(file)
  // Loaded at run time: under Bun, Turbopack's external alias for sharp does not resolve.
  const { default: sharp } = await import(/* turbopackIgnore: true */ /* webpackIgnore: true */ "sharp")
  const body = await sharp(input).rotate().resize({ width: w, withoutEnlargement: true }).webp({ quality: 74 }).toBuffer()
  await fs.mkdir(path.dirname(out), { recursive: true })
  await fs.writeFile(out, body)
  return body
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const pub = path.join(projectRoot(), "public")
  const file = path.join(pub, url.searchParams.get("src") ?? "")
  if (!file.startsWith(pub + path.sep) || !(VIDEO.test(file) || IMAGE.test(file))) return new Response("not an image or video under public/", { status: 400 })
  const want = Number(url.searchParams.get("w")) || 320
  const w = WIDTHS.find((x) => x >= want) ?? WIDTHS[WIDTHS.length - 1]
  const st = await fs.stat(file).catch(() => null)
  if (!st) return new Response("not found", { status: 404 })

  const key = createHash("sha1").update(`${file}:${st.mtimeMs}:${w}`).digest("hex").slice(0, 24)
  const out = path.join(projectRoot(), ".cache", "thumbs", `${key}.webp`)
  let body: Buffer | null = await fs.readFile(out).catch(() => null)
  if (!body) {
    let job = making.get(key)
    if (!job) {
      job = slot(() => make(file, w, out)).finally(() => making.delete(key))
      making.set(key, job)
    }
    const made = await job.then((b) => ({ b }), (e: Error) => ({ e }))
    if ("e" in made) return new Response(`could not make a poster: ${made.e.message}`, { status: 500 })
    body = made.b
  }
  // A versioned URL (v = the file's mtime) never changes content, so the browser can keep it for good.
  const cache = url.searchParams.get("v") ? "public, max-age=31536000, immutable" : "public, max-age=60"
  return new Response(new Uint8Array(body), { headers: { "content-type": "image/webp", "cache-control": cache } })
}
