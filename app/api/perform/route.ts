import { convert, perform } from "@/lib/perform"

// POST /api/perform?p=<film>&n=<line>   body: the recorded audio, in whatever format the browser records
//   -> saves it as that line's performance and converts it to the role's voice (lib/perform.ts). Answers when the
//      conversion is done; the take itself shows on the board as soon as it is saved.
// POST /api/perform?p=<film>&convert=<id>   -> converts a saved performance again.
export async function POST(req: Request) {
  const q = new URL(req.url).searchParams
  const slug = q.get("p") ?? undefined
  try {
    const again = q.get("convert")
    if (again) return Response.json(await convert(slug, again))
    const n = Number(q.get("n"))
    if (!Number.isInteger(n) || n < 1) throw new Error("which line? ?n=<line number>")
    const type = req.headers.get("content-type") ?? ""
    const ext = type.includes("mp4") || type.includes("aac") ? "m4a" : type.includes("ogg") ? "ogg" : type.includes("wav") ? "wav" : "webm"
    const audio = new Uint8Array(await req.arrayBuffer())
    if (audio.byteLength < 1000) throw new Error("the recording is empty")
    return Response.json(await perform({ slug, n, audio, ext, by: q.get("by") ?? "Claudio" }))
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 })
  }
}
