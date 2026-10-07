// Server and CLI only. Reads and writes data/project.json with a lock and an atomic rename,
// so the UI and agents can both apply ops without losing each other's writes.

import { promises as fs } from "node:fs"
import path from "node:path"
import type { Project, ProjectWithRev } from "./model"
import { applyOps, type Op } from "./ops"

export const projectRoot = () => process.env.STITCH_ROOT ?? process.cwd()

/** Which film: "ministry" (the original, data/project.json) or a slug under data/projects/. Defaults to $STITCH_PROJECT. */
export function projectFile(slug = process.env.STITCH_PROJECT): string {
  if (!slug || slug === "ministry") return path.join(projectRoot(), "data", "project.json")
  if (!/^[a-z0-9-]+$/.test(slug)) throw new Error(`bad project ${slug}`)
  return path.join(projectRoot(), "data", "projects", `${slug}.json`)
}

/** Every film on this machine, for the project switcher. */
export async function listProjects(): Promise<{ slug: string; title: string }[]> {
  const dir = path.join(projectRoot(), "data", "projects")
  const slugs = ["ministry", ...(await fs.readdir(dir).catch(() => [])).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5))]
  return Promise.all(slugs.map(async (slug) => ({ slug, title: ((JSON.parse(await fs.readFile(projectFile(slug), "utf8")) as Project).title) ?? slug })))
}

export async function load(slug?: string): Promise<ProjectWithRev> {
  const f = projectFile(slug)
  const [raw, stat] = await Promise.all([fs.readFile(f, "utf8"), fs.stat(f)])
  return { ...(JSON.parse(raw) as Project), rev: stat.mtimeMs }
}

async function withLock<T>(file: string, f: () => Promise<T>): Promise<T> {
  const lockFile = file + ".lock"
  for (let i = 0; i < 100; i++) {
    try {
      const h = await fs.open(lockFile, "wx")
      await h.close()
      try {
        return await f()
      } finally {
        await fs.rm(lockFile, { force: true })
      }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e
      const st = await fs.stat(lockFile).catch(() => null)
      if (st && Date.now() - st.mtimeMs > 5000) await fs.rm(lockFile, { force: true })
      await new Promise((r) => setTimeout(r, 40))
    }
  }
  throw new Error("project.json is locked")
}

export async function save(p: Project, slug?: string): Promise<void> {
  const { rev: _rev, ...clean } = p as ProjectWithRev
  const f = projectFile(slug)
  const tmp = f + ".tmp"
  await fs.writeFile(tmp, JSON.stringify(clean, null, 2))
  await fs.rename(tmp, f)
}

export async function mutate(ops: Op[], slug?: string): Promise<ProjectWithRev> {
  return withLock(projectFile(slug), async () => {
    const current = await load(slug)
    await save(applyOps(current, ops), slug)
    return load(slug)
  })
}
