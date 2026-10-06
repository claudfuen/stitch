#!/usr/bin/env bun
// The agent's way in. Every command becomes named ops (lib/ops.ts), the same ones the UI posts.
//   bun run stitch show [shot]
//   bun run stitch log "text" [--kind run|done|info|warn]
//   bun run stitch asset add <id> --media image|video|audio --from <url|file> [--label ..] [--origin generated]
//                            [--model ..] [--prompt ..|--prompt-file f] [--inputs a,b] [--job ..] [--text ..]
//   bun run stitch asset qa <id> pass|borderline|fail "note"
//   bun run stitch asset set <id> '<json patch>'
//   bun run stitch score <asset> [--face] [--voice]
//   bun run stitch take add <shot> <asset> [--keyframe] [--circle] [--note ..]
//   bun run stitch take circle|alt|reject|pending <shot> <asset> [--note ..]
//   bun run stitch card <shot> <field> "<text>"
//   bun run stitch shot set <shot> '<json patch>'      bun run stitch shot add '<json shot>' [--after id]
//   bun run stitch check <shot> <key> ok|fail|clear [--note ..] [--by ..]
//   bun run stitch op '<op json or array>'
//   bun run stitch build [--version v3.1] [--shots 2.1,2.2 --scope "Scene 2"]
//   bun run stitch plan <loc>                                print the floor plan: setups, marks, line checks
//   bun run stitch plan set <loc> <plan.json>                replace the plan (dimensions, items, marks, axes, setups)
//   bun run stitch plan upsert <loc> items|marks|axes|setups '<json>'     bun run stitch plan remove <loc> <list> <id>
//   bun run stitch plan plate <loc> <setup> <asset> [circle|alt|reject|pending] [--note ..]
//   bun run stitch greybox <loc> [setup ...]                 render the grey box (Blender) and attach each render
//   bun run stitch room <loc> [--builder greybox|lightbox]   export the room in 3D (GLB) for the Rooms view
import { execFileSync } from "node:child_process"
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { CHECKS, type Asset, type CheckKey, type Media, type TakeVerdict } from "../lib/model"
import type { Op } from "../lib/ops"
import { load, mutate } from "../lib/store"
import { latestCut, pick, planView, shotRows } from "../lib/derive"
import type { PlanList } from "../lib/ops"

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..")
process.chdir(root)

const argv = process.argv.slice(2)
const flags: Record<string, string | true> = {}
const pos: string[] = []
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (a.startsWith("--")) {
    const next = argv[i + 1]
    if (next !== undefined && !next.startsWith("--")) (flags[a.slice(2)] = next), i++
    else flags[a.slice(2)] = true
  } else pos.push(a)
}
const flag = (k: string) => (typeof flags[k] === "string" ? (flags[k] as string) : undefined)
const run = (ops: Op[]) => mutate(ops).then((p) => p)
const sh = (cmd: string, args: string[]) => execFileSync(cmd, args, { encoding: "utf8" })
const probe = (file: string) => {
  try { return Number(sh("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).trim()) || undefined } catch { return undefined }
}

async function importFile(id: string, from: string, media: Media): Promise<{ path: string; duration?: number }> {
  mkdirSync("public/generated", { recursive: true })
  const srcExt = (from.split("?")[0].match(/\.([a-z0-9]+)$/i)?.[1] ?? (media === "image" ? "png" : media === "video" ? "mp4" : "mp3")).toLowerCase()
  const tmp = `work/import-${id}.${srcExt}`
  mkdirSync("work", { recursive: true })
  if (/^https?:/.test(from)) sh("curl", ["-sfL", "-o", tmp, from])
  else copyFileSync(from, tmp)
  let ext = srcExt
  if (media === "image" && ext !== "jpg") {
    sh("ffmpeg", ["-v", "error", "-y", "-i", tmp, "-vf", "scale='min(2560,iw)':-2", "-q:v", "3", `public/generated/${id}.jpg`])
    ext = "jpg"
  } else copyFileSync(tmp, `public/generated/${id}.${ext}`)
  const file = `public/generated/${id}.${ext}`
  return { path: `/generated/${id}.${ext}`, duration: media === "image" || media === "model" ? undefined : probe(file) }
}

function score(asset: Asset, kinds: { face: boolean; voice: boolean }) {
  const file = path.join("public", asset.path)
  const py = "work/venv/bin/python"
  const out: Asset["scores"] = {}
  if (kinds.face && asset.media !== "audio") {
    const r = sh(py, ["scripts/face-score.py", file])
    const m = r.match(/mean ([0-9.]+)/)
    if (m) out.face = Number(m[1])
  }
  if (kinds.voice && asset.media !== "image") {
    const r = sh(py, ["scripts/voice-score.py", file])
    const m = r.match(/voice ([0-9.]+)/)
    if (m) out.voice = Number(m[1])
  }
  return out
}

async function show(shotId?: string) {
  const p = await load()
  const rows = shotRows(p)
  for (const r of rows) {
    if (shotId && r.shot.id !== shotId) continue
    const tk = pick(r.shot.takes)
    const f = r.take?.scores?.face
    const ok = `${r.checked.ok}/${r.checked.total}${r.checked.fail ? ` (${r.checked.fail} fail)` : ""}`
    console.log(`${r.shot.id.padEnd(10)} ${r.shot.name.slice(0, 28).padEnd(28)} ${r.shot.status.padEnd(8)} take=${(tk?.asset ?? "-").padEnd(16)} face=${f?.toFixed(2) ?? " -  "} checks=${ok}`)
    if (shotId) {
      for (const l of r.lines) console.log(`   ${l.mode.padEnd(6)} ${l.speaker?.name ?? l.who}: ${l.text}`)
      for (const i of r.issues) console.log(`   ${i.level === "fail" ? "FAIL" : "warn"} ${i.text}`)
      for (const [k, v] of Object.entries(r.shot.card)) console.log(`   card.${k}: ${v}`)
    }
  }
  const cut = latestCut(p)
  if (!shotId && cut) console.log(`\nlatest cut ${cut.version}: ${cut.duration.toFixed(1)} s (target ${p.runtimeTarget} s)`)
}

async function main() {
  const [cmd, sub, ...rest] = pos
  switch (cmd) {
    case "show":
      return show(sub)
    case "log":
      await run([{ op: "log", text: sub, kind: (flag("kind") as "run" | "done" | "info" | "warn" | undefined) ?? "info" }])
      return
    case "op": {
      const parsed = JSON.parse(sub)
      await run(Array.isArray(parsed) ? parsed : [parsed])
      return
    }
    case "asset": {
      if (sub === "add") {
        const [id] = rest
        const media = (flag("media") ?? "image") as Media
        const from = flag("from")
        if (!id || !from) throw new Error("asset add <id> --media .. --from <url|file>")
        const { path: p, duration } = await importFile(id, from, media)
        const inputs = flag("inputs")?.split(",").filter(Boolean)
        const asset: Asset = {
          id, media, path: p, label: flag("label") ?? id, origin: (flag("origin") as Asset["origin"]) ?? "generated", duration,
          ...(flag("model") ? { gen: { model: flag("model")!, prompt: flag("prompt") ?? (flag("prompt-file") ? readFileSync(flag("prompt-file")!, "utf8").trim() : undefined), inputs, job: flag("job") } } : {}),
          ...(flag("text") ? { text: flag("text") } : {}),
        }
        await run([{ op: "asset.add", asset }])
        console.log(`added ${id} -> ${p}${duration ? ` (${duration.toFixed(2)} s)` : ""}`)
        return
      }
      if (sub === "qa") {
        const [id, verdict, note] = rest
        await run([{ op: "asset.update", id, patch: { qa: { verdict: verdict as "pass" | "borderline" | "fail", note: note ?? "" } } }])
        return
      }
      if (sub === "set") {
        const [id, json] = rest
        await run([{ op: "asset.update", id, patch: JSON.parse(json) }])
        return
      }
      throw new Error("asset add|qa|set")
    }
    case "score": {
      const p = await load()
      const a = p.assets.find((x) => x.id === sub)
      if (!a) throw new Error(`unknown asset ${sub}`)
      const both = !flags.face && !flags.voice
      const scores = score(a, { face: both || !!flags.face, voice: both ? false : !!flags.voice })
      await run([{ op: "asset.update", id: a.id, patch: { scores } }])
      console.log(sub, JSON.stringify(scores))
      return
    }
    case "take": {
      if (sub === "add") {
        const [shot, asset] = rest
        await run([{ op: "take.add", shot, asset, list: flags.keyframe ? "keyframes" : undefined, verdict: flags.circle ? "circled" : undefined, note: flag("note") }])
        return
      }
      const verdict = ({ circle: "circled", alt: "alt", reject: "reject", pending: "pending" } as Record<string, TakeVerdict>)[sub]
      if (!verdict) throw new Error("take add|circle|alt|reject|pending")
      const [shot, asset] = rest
      await run([{ op: "take.set", shot, asset, verdict, note: flag("note") }])
      return
    }
    case "card":
      await run([{ op: "shot.card", id: sub, field: rest[0] as never, value: rest[1] }])
      return
    case "shot": {
      if (sub === "set") return void (await run([{ op: "shot.update", id: rest[0], patch: JSON.parse(rest[1]) }]))
      if (sub === "add") return void (await run([{ op: "shot.add", shot: JSON.parse(rest[0]), after: flag("after") }]))
      if (sub === "move") return void (await run([{ op: "shot.move", id: rest[0], to: Number(rest[1]) }]))
      if (sub === "remove") return void (await run([{ op: "shot.remove", id: rest[0] }]))
      throw new Error("shot set|add|move|remove")
    }
    case "check": {
      const [key, state] = rest
      if (!CHECKS.some((c) => c.key === key)) throw new Error(`check key: ${CHECKS.map((c) => c.key).join(", ")}`)
      const ok = state === "ok" ? true : state === "fail" ? false : null
      await run([{ op: "check.set", shot: sub, key: key as CheckKey, ok, note: flag("note"), by: flag("by") }])
      return
    }
    case "plan": {
      const verdicts: Record<string, TakeVerdict> = { circle: "circled", alt: "alt", reject: "reject", pending: "pending" }
      if (sub === "set") return void (await run([{ op: "plan.set", location: rest[0], plan: JSON.parse(readFileSync(rest[1], "utf8")) }]))
      if (sub === "upsert") return void (await run([{ op: "plan.upsert", location: rest[0], list: rest[1] as keyof PlanList, value: JSON.parse(rest[2]) } as Op]))
      if (sub === "remove") return void (await run([{ op: "plan.remove", location: rest[0], list: rest[1] as keyof PlanList, id: rest[2] }]))
      if (sub === "plate") {
        const [loc, setup, asset, v] = rest
        return void (await run([{ op: "plan.plate", location: loc, setup, asset, verdict: v ? verdicts[v] : undefined, note: flag("note") }]))
      }
      const p = await load()
      const l = p.locations.find((x) => x.id === sub)
      const v = l && planView(l)
      if (!v) throw new Error(`no plan on ${sub}`)
      console.log(`${l!.name}: ${v.plan.width} x ${v.plan.depth} x ${v.plan.height} m, ${v.plan.items.length} items, ${v.plan.marks.length} marks`)
      for (const u of v.setups) {
        const frame = u.inFrame.map((m) => `${m.mark.id}@${m.x.toFixed(2)}`).join(" ")
        const plate = pick(u.plates ?? [])
        console.log(`  ${u.id.padEnd(3)} ${u.name.padEnd(32)} ${u.size.padEnd(4)} ${String(u.lens).padStart(3)}mm h${u.height} fov ${u.fov.toFixed(0)} ${u.beat ?? ""} ${u.axis ? `line ${u.axis}${u.side === 1 ? "+" : u.side === -1 ? "-" : "0"}` : ""}  [${frame}]  render=${u.render ?? "-"} plate=${plate?.asset ?? "-"}`)
      }
      for (const i of v.issues) console.log(`  ${i.level.toUpperCase()} ${i.text}`)
      return
    }
    case "greybox": {
      const p = await load()
      const l = p.locations.find((x) => x.id === sub)
      if (!l?.plan) throw new Error(`no plan on ${sub}`)
      const dir = `work/${l.id}/grey`
      mkdirSync(dir, { recursive: true })
      writeFileSync(`work/${l.id}/plan.json`, JSON.stringify(l.plan, null, 1))
      const ids = rest.length ? rest : l.plan.setups.map((u) => u.id)
      execFileSync("/Applications/Blender.app/Contents/MacOS/Blender", ["-b", "-P", "scripts/greybox.py", "--", `work/${l.id}/plan.json`, dir, ...ids], { stdio: "ignore" })
      const ops: Op[] = []
      for (const id of ids) {
        const u = l.plan.setups.find((x) => x.id === id)!
        const asset = `grey-${l.id}-${id}`
        const { path: ap } = await importFile(asset, `${dir}/${id}.png`, "image")
        const a: Asset = { id: asset, media: "image", path: ap, label: `Grey box ${id}: ${u.name}`, origin: "rendered", gen: { model: "blender/greybox", prompt: `${u.lens} mm, ${u.height} m, facing ${u.facing}${u.tilt ? `, tilt ${u.tilt}` : ""}` } }
        ops.push(p.assets.some((x) => x.id === asset) ? { op: "asset.update", id: asset, patch: { path: ap, gen: a.gen, label: a.label } } : { op: "asset.add", asset: a })
        ops.push({ op: "plan.patch", location: l.id, list: "setups", id, patch: { render: asset } })
      }
      ops.push({ op: "log", text: `Grey box for ${l.name}: rendered ${ids.length} setups from the floor plan`, kind: "done" })
      await run(ops)
      console.log(`rendered ${ids.join(", ")}`)
      return
    }
    case "room": {
      // The room as one 3D scene, exported by the Blender script that renders this room's plates.
      const p = await load()
      const l = p.locations.find((x) => x.id === sub)
      if (!l?.plan) throw new Error(`no plan on ${sub}`)
      const builder = flag("builder") ?? "greybox"
      const dir = `work/${l.id}/room`
      mkdirSync(dir, { recursive: true })
      writeFileSync(`work/${l.id}/plan.json`, JSON.stringify(l.plan, null, 1))
      execFileSync("/Applications/Blender.app/Contents/MacOS/Blender", ["-b", "-P", `scripts/${builder}.py`, "--", `work/${l.id}/plan.json`, dir, "--glb", `${dir}/${l.id}.glb`, "--glb-only"], { stdio: "ignore" })
      const asset = `room-${l.id}`
      const { path: ap } = await importFile(asset, `${dir}/${l.id}.glb`, "model")
      const gen = { model: `blender/${builder} glb`, prompt: `${l.plan.width} x ${l.plan.depth} x ${l.plan.height} m, ${l.plan.items.length} items, ${l.plan.marks.length} marks, ${l.plan.setups.length} cameras` }
      await run([
        p.assets.some((x) => x.id === asset) ? { op: "asset.update", id: asset, patch: { path: ap, gen } } : { op: "asset.add", asset: { id: asset, media: "model", path: ap, label: `${l.name} in 3D`, origin: "rendered", gen } },
        { op: "location.update", id: l.id, patch: { model: asset } },
        { op: "log", text: `${l.name}: 3D room exported (${gen.prompt}) for the Rooms view`, kind: "done" },
      ])
      console.log(`exported ${ap}`)
      return
    }
    case "build": {
      const { build } = await import("./build")
      await build(flag("version"), { shots: flag("shots")?.split(",").filter(Boolean), scope: flag("scope") })
      return
    }
    default:
      console.log(readHelp())
  }
}

function readHelp() {
  return "commands: show, log, asset add|qa|set, score, take add|circle|alt|reject|pending, card, shot set|add|move|remove, check, op, plan [set|upsert|remove|plate], greybox, room, build"
}

main().catch((e) => {
  console.error("error:", e.message)
  process.exit(1)
})

