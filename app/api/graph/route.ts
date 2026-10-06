import { promises as fs } from "node:fs"
import path from "node:path"

export const dynamic = "force-dynamic"

const FILE = path.join(process.cwd(), "data", "graph.json")
const EXAMPLE = path.join(process.cwd(), "data", "graph.example.json")

// data/graph.json is your working board and is gitignored. First run copies the example.
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

// The browser owns nodes and edges; everything else in the file (story) is preserved.
export async function PUT(req: Request) {
  const { nodes, edges } = await req.json()
  const { rev: _rev, ...current } = await read()
  await fs.writeFile(FILE, JSON.stringify({ ...current, nodes, edges }, null, 2))
  const { rev } = await read()
  return Response.json({ rev })
}
