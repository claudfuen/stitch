// Server and CLI only. Reads and writes data/project.json with a lock and an atomic rename,
// so the UI and agents can both apply ops without losing each other's writes.

import { promises as fs } from "node:fs"
import path from "node:path"
import type { Project, ProjectWithRev } from "./model"
import { applyOps, type Op } from "./ops"

export const projectRoot = () => process.env.STITCH_ROOT ?? process.cwd()
const file = () => path.join(projectRoot(), "data", "project.json")
const lockFile = () => file() + ".lock"

export async function load(): Promise<ProjectWithRev> {
  const [raw, stat] = await Promise.all([fs.readFile(file(), "utf8"), fs.stat(file())])
  return { ...(JSON.parse(raw) as Project), rev: stat.mtimeMs }
}

async function withLock<T>(f: () => Promise<T>): Promise<T> {
  for (let i = 0; i < 100; i++) {
    try {
      const h = await fs.open(lockFile(), "wx")
      await h.close()
      try {
        return await f()
      } finally {
        await fs.rm(lockFile(), { force: true })
      }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e
      const st = await fs.stat(lockFile()).catch(() => null)
      if (st && Date.now() - st.mtimeMs > 5000) await fs.rm(lockFile(), { force: true })
      await new Promise((r) => setTimeout(r, 40))
    }
  }
  throw new Error("project.json is locked")
}

export async function save(p: Project): Promise<void> {
  const { rev: _rev, ...clean } = p as ProjectWithRev
  const tmp = file() + ".tmp"
  await fs.writeFile(tmp, JSON.stringify(clean, null, 2))
  await fs.rename(tmp, file())
}

export async function mutate(ops: Op[]): Promise<ProjectWithRev> {
  return withLock(async () => {
    const current = await load()
    await save(applyOps(current, ops))
    return load()
  })
}
