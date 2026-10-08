import { extOf, performScene } from "@/lib/perform"
import type { SceneEvent } from "@/lib/process"

// POST /api/perform/scene?p=<film>   multipart: audio (the whole recording), who (the role performed), take (the read
//   whose lines played as cues), events (JSON SceneEvent[]: each line in recording time)
//   -> converts the recording in one pass, cuts and picks the performer's lines, builds a new read (lib/perform.ts).
export async function POST(req: Request) {
  const q = new URL(req.url).searchParams
  try {
    const form = await req.formData()
    const audio = form.get("audio")
    if (!(audio instanceof Blob) || audio.size < 1000) throw new Error("the recording is empty")
    const events = JSON.parse(String(form.get("events") ?? "[]")) as SceneEvent[]
    const r = await performScene({
      slug: q.get("p") ?? undefined,
      who: String(form.get("who") ?? ""),
      take: String(form.get("take") ?? ""),
      events,
      audio: new Uint8Array(await audio.arrayBuffer()),
      ext: extOf(audio.type),
      by: q.get("by") ?? "Claudio",
    })
    return Response.json(r)
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 })
  }
}
