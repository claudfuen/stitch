// Server and CLI only. Stage 06: one continuous take per set. blockTake renders a take's blockout: the set's grey box
// (scripts/greybox.py, plain clay, posed mannequins) with one camera moving through the take's shots, whipping
// between them, and the locked read's audio for those seconds as its sound. The blockout is the driving video for
// the video model (Seedance 2.5 omni reference on Higgsfield); the take is later sliced at its whips.

import { execFile } from "node:child_process"
import { existsSync, promises as fs } from "node:fs"
import path from "node:path"
import { promisify } from "node:util"
import type { Id } from "./model"
import type { TakeSlice } from "./process"
import { load, mutate, projectRoot } from "./store"

const exec = promisify(execFile)
const env = { ...process.env, PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH ?? ""}` }
const BLENDER = "/Applications/Blender.app/Contents/MacOS/Blender"
const pub = (rel: string) => path.join(projectRoot(), "public", rel)
const filmOf = (slug?: string) => slug || process.env.STITCH_PROJECT || "ministry"

/** Where a take's files live, served by the app. */
export const takeDir = (slug: string | undefined, id: Id) => `generated/${filmOf(slug)}/takes/${id}`

/** Render a take's blockout (a few minutes for 30 s at 720p) and record it on the take. */
export async function blockTake(slug: string | undefined, id: Id, by = "claude") {
  const pr = (await load(slug)).process
  const take = pr?.takes?.find((t) => t.id === id)
  if (!take) throw new Error(`no take ${id}`)
  const read = pr?.voice?.takes.find((t) => t.id === take.read)
  if (!read) throw new Error(`no read ${take.read}`)
  const plan = path.join(projectRoot(), "data", "space", filmOf(slug), `${take.room}.json`)
  if (!existsSync(plan)) throw new Error(`no grey box plan for ${take.room}: run \`stitch greybox ${take.room}\` first`)
  const dir = takeDir(slug, id)
  await fs.mkdir(pub(dir), { recursive: true })
  const spec = pub(`${dir}/take.json`)
  // Workbench clay is rendered at 72 fps and blended three frames to one, so a whip smears like a real whip pan and a
  // hold stays sharp; the film look has EEVEE's own motion blur at 24 fps.
  const r = take.render ?? {}
  const oversample = r.look === "film" ? 1 : 3
  await fs.writeFile(spec, JSON.stringify({ fps: 24, oversample, whip: take.whip, size: [1280, 720], ...r, shots: take.shots, moves: take.moves ?? [] }, null, 1))
  const silent = pub(`${dir}/blockout-silent.mp4`)
  await exec(BLENDER, ["-b", "-P", path.join(projectRoot(), "scripts/greybox.py"), "--", plan, pub(dir), ...(r.clay === false ? [] : ["--clay"]), "--detail", "--anim", spec, silent], { env, maxBuffer: 1 << 26 })
  const out = `${dir}/blockout.mp4`
  await exec("ffmpeg", ["-v", "error", "-y", "-i", silent, "-ss", take.from.toFixed(3), "-t", (take.to - take.from).toFixed(3), "-i", pub(read.file), "-map", "0:v", "-map", "1:a", ...(oversample > 1 ? ["-vf", `tmix=frames=${oversample},fps=24`] : []), "-c:v", "libx264", "-crf", "18", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-shortest", pub(out)], { env })
  const { gens: _gens, ...rest } = take
  await mutate([{ op: "pixels.take", take: { ...rest, blockout: out }, by }], slug)
  return out
}

/** A finished generation: save it next to the take, put it beside its blockout in sync (blockout left, generation
 *  right, the read as the sound, so lip sync is judged against the real lines), and mark it done. */
export async function finishGen(slug: string | undefined, takeId: Id, genId: Id, url: string, by = "claude") {
  const pr = (await load(slug)).process
  const take = pr?.takes?.find((t) => t.id === takeId)
  const gen = take?.gens.find((g) => g.id === genId)
  if (!take || !gen) throw new Error(`no generation ${genId} on take ${takeId}`)
  const dir = takeDir(slug, takeId)
  const file = `${dir}/gen-${genId.slice(0, 8)}.mp4`
  const res = await fetch(url, { signal: AbortSignal.timeout(300_000) })
  if (!res.ok) throw new Error(`download ${res.status}: ${url}`)
  await fs.writeFile(pub(file), new Uint8Array(await res.arrayBuffer()))
  let compare: string | undefined
  if (take.blockout) {
    compare = `${dir}/compare-${genId.slice(0, 8)}.mp4`
    await exec("ffmpeg", ["-v", "error", "-y", "-i", pub(take.blockout), "-i", pub(file), "-filter_complex", "[0:v]scale=-2:480,setsar=1,fps=24[a];[1:v]scale=-2:480,setsar=1,fps=24[b];[a][b]hstack=inputs=2[v]", "-map", "[v]", "-map", "0:a", "-c:v", "libx264", "-crf", "20", "-preset", "veryfast", "-c:a", "aac", "-shortest", pub(compare)], { env })
  }
  await mutate([{ op: "pixels.gen", take: takeId, gen: { ...gen, status: "done", file, compare, error: undefined }, by }], slug)
  return { file, compare }
}

/** Cut the picked generation into its shots: each shot without the half-whips at its ends, every cut snapped to the
 *  nearest scene change ffmpeg finds in the generated video (within 0.4 s), in case the model drifted from the
 *  blockout's timing. Silent clips: the read is the sound in the cut. */
export async function sliceTake(slug: string | undefined, takeId: Id, by = "claude") {
  const pr = (await load(slug)).process
  const take = pr?.takes?.find((t) => t.id === takeId)
  const gen = take?.gens.find((g) => g.id === take.pick)
  if (!take || !gen?.file) throw new Error(`pick a finished generation of ${takeId} first`)
  const scan = await exec("ffmpeg", ["-hide_banner", "-nostats", "-i", pub(gen.file), "-vf", "scdet=threshold=8", "-f", "null", "-"], { env, maxBuffer: 1 << 24 })
  const cuts = [...scan.stderr.matchAll(/lavfi\.scd\.time:\s*([\d.]+)/g)].map((m) => Number(m[1]))
  const snap = (t: number) => cuts.reduce((best, c) => (Math.abs(c - t) < Math.abs(best - t) && Math.abs(c - t) <= 0.4 ? c : best), t)
  const dir = `${takeDir(slug, takeId)}/slices`
  await fs.mkdir(pub(dir), { recursive: true })
  const slices: TakeSlice[] = []
  const last = take.shots.length - 1
  for (const [k, s] of take.shots.entries()) {
    const a = k ? snap(s.t0) + take.whip / 2 : 0
    const b = k < last ? snap(s.t1) - take.whip / 2 : s.t1
    const file = `${dir}/${String(k + 1).padStart(2, "0")}-${s.cam}.mp4`
    await exec("ffmpeg", ["-v", "error", "-y", "-ss", a.toFixed(3), "-t", Math.max(0.2, b - a).toFixed(3), "-i", pub(gen.file), "-an", "-c:v", "libx264", "-crf", "18", "-preset", "veryfast", "-pix_fmt", "yuv420p", pub(file)], { env })
    slices.push({ cam: s.cam, t0: Math.round(a * 100) / 100, t1: Math.round(b * 100) / 100, file, ...(s.lines ? { lines: s.lines } : {}) })
  }
  const { gens: _g, ...rest } = take
  await mutate([{ op: "pixels.take", take: { ...rest, slices }, by }], slug)
  return { slices, cuts }
}
