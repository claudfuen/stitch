import { load, mutate } from "@/lib/store"
import type { Op } from "@/lib/ops"

export const dynamic = "force-dynamic"

// GET /api/project?rev=<n>  -> the project, or { unchanged: true } when the client already has this revision.
export async function GET(req: Request) {
  const p = await load()
  const known = Number(new URL(req.url).searchParams.get("rev"))
  if (known && Math.abs(known - p.rev) < 0.5) return Response.json({ unchanged: true, rev: p.rev })
  return Response.json(p)
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
