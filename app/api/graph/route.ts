import { promises as fs } from "node:fs"
import path from "node:path"

export const dynamic = "force-dynamic"

const FILE = path.join(process.cwd(), "data", "graph.json")
const EXAMPLE = path.join(process.cwd(), "data", "graph.example.json")

// data/graph.json is the working board. First run copies the example.
async function ensure() {
  try {
    await fs.access(FILE)
  } catch {
    await fs.copyFile(EXAMPLE, FILE)
  }
}

async function read() {
  await ensure()
  const [raw, stat] = await Promise.all([fs.readFile(FILE, "utf8"), fs.stat(FILE)])
  return { ...JSON.parse(raw), rev: stat.mtimeMs }
}

export async function GET() {
  return Response.json(await read())
}

// The browser owns nodes and edges; everything else in the file (story, activity) is preserved.
// A write based on a stale revision is refused, so the browser can never overwrite an agent's edit.
export async function PUT(req: Request) {
  const { nodes, edges, baseRev } = await req.json()
  const { rev: current, ...rest } = await read()
  if (typeof baseRev === "number" && Math.abs(current - baseRev) > 0.5) {
    return Response.json({ conflict: true, rev: current }, { status: 409 })
  }
  const tmp = FILE + ".tmp"
  await fs.writeFile(tmp, JSON.stringify({ ...rest, nodes, edges }, null, 2))
  await fs.rename(tmp, FILE)
  const { rev } = await read()
  return Response.json({ rev })
}
