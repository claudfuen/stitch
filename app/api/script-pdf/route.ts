import { execFile } from "node:child_process"
import { promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import { load } from "@/lib/store"

const run = promisify(execFile)
const CHROME = ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium"]

// GET /api/script-pdf?p=<slug>[&doc=look] -> the film's script (/print) or look book (/print/look) as a PDF download,
// printed by headless Chrome.
export async function GET(req: Request) {
  const url = new URL(req.url)
  const slug = url.searchParams.get("p") ?? ""
  const look = url.searchParams.get("doc") === "look"
  const project = await load(slug || undefined)
  const chrome = (await Promise.all(CHROME.map(async (c) => ((await fs.stat(c).catch(() => null)) ? c : null)))).find(Boolean)
  if (!chrome) return Response.json({ error: "Google Chrome is needed to make the PDF" }, { status: 500 })

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "stitch-pdf-"))
  const out = path.join(dir, "script.pdf")
  try {
    await run(chrome, ["--headless=new", "--disable-gpu", "--no-first-run", `--user-data-dir=${dir}`, "--no-pdf-header-footer", `--virtual-time-budget=${look ? 20000 : 5000}`, `--print-to-pdf=${out}`, `${url.origin}/print${look ? "/look" : ""}${slug ? `?p=${encodeURIComponent(slug)}` : ""}`], { timeout: 60_000 })
    const pdf = await fs.readFile(out)
    const name = `${(project.process?.concepts.find((c) => c.id === project.process?.script.concept)?.title ?? project.title).replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "")}${look ? "-look-book" : `-script-draft-${project.process?.script.version ?? 1}`}.pdf`
    return new Response(pdf, { headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="${name}"` } })
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
}
