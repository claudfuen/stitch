import { promises as fs } from "node:fs"
import path from "node:path"
import { load, mutate, projectRoot } from "@/lib/store"
import type { Op } from "@/lib/ops"
import type { Project } from "@/lib/model"

// GET /api/project?rev=<n>  -> the project and the file time of every asset (the activity timeline places new media
// by it), or { unchanged: true } when the client already has this revision. The board polls every second while
// agents work, so the unchanged answer comes from the file's mtime alone, without reading or parsing 450 KB.
export async function GET(req: Request) {
  const known = Number(new URL(req.url).searchParams.get("rev"))
  const st = await fs.stat(path.join(projectRoot(), "data", "project.json"))
  if (known && Math.abs(known - st.mtimeMs) < 0.5) return Response.json({ unchanged: true, rev: st.mtimeMs })
  const p = await load()
  return Response.json({ ...p, mtimes: await mtimes(p) })
}

async function mtimes(p: Project): Promise<Record<string, number>> {
  const pub = path.join(projectRoot(), "public")
  const out: Record<string, number> = {}
  await Promise.all(
    p.assets.map(async (a) => {
      const st = await fs.stat(path.join(pub, a.path)).catch(() => null)
      if (st) out[a.id] = Math.round(st.mtimeMs)
    }),
  )
  return out
}

// POST /api/project { ops: Op[] } -> applies the same named operations the CLI uses.
export async function POST(req: Request) {
  const { ops } = (await req.json()) as { ops: Op[] }
  try {
    const p = await mutate(ops)
    return Response.json({ rev: p.rev })
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 })
  }
}
