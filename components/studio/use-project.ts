"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import type { Id, ProjectWithRev } from "@/lib/model"
import type { Op } from "@/lib/ops"
import { share } from "./share"

/** The project, live: polls /api/project every second while the tab is visible and applies writes through the same
 *  named ops the CLI uses. Each answer is structurally shared with the last, so an agent appending to the activity log
 *  leaves every other slice (shots, assets, cuts, locations) the same object and the views that read them do no work. */
/** The film this tab is on: ?p=<slug> in the URL, or the original ("ministry"). */
export const projectSlug = () => (typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("p") ?? "")
const withSlug = (url: string) => {
  const slug = projectSlug()
  return slug ? `${url}${url.includes("?") ? "&" : "?"}p=${encodeURIComponent(slug)}` : url
}

export function useProject() {
  const [project, setProject] = useState<ProjectWithRev | null>(null)
  /** Each asset's file time (ms), from the server: places new media on the activity timeline and versions poster URLs. */
  const [mtimes, setMtimes] = useState<Record<Id, number>>({})
  const [error, setError] = useState<string | null>(null)
  const [missing, setMissing] = useState<string | null>(null)
  const rev = useRef(0)

  const pull = useCallback(async () => {
    try {
      const r = await fetch(withSlug(`/api/project?rev=${rev.current}`), { cache: "no-store" })
      const j = await r.json()
      // The film in ?p= is not on this machine (a deleted copy): say so instead of showing, or recording into, a stale one.
      if (r.status === 404 && j.missing) return setMissing(j.error ?? "This film is not on this machine")
      if (!r.ok) return
      setMissing(null)
      if (j.unchanged) return
      rev.current = j.rev
      const { mtimes: m, ...p } = j as ProjectWithRev & { mtimes: Record<Id, number> }
      setProject((prev) => share(prev, p))
      setMtimes((prev) => share(prev, m ?? {}))
    } catch {}
  }, [])

  useEffect(() => {
    pull()
    const t = setInterval(() => document.visibilityState === "visible" && pull(), 1000)
    const wake = () => document.visibilityState === "visible" && pull()
    document.addEventListener("visibilitychange", wake)
    return () => {
      clearInterval(t)
      document.removeEventListener("visibilitychange", wake)
    }
  }, [pull])

  const op = useCallback(
    async (...ops: Op[]) => {
      const r = await fetch(withSlug("/api/project"), { method: "POST", body: JSON.stringify({ ops }) })
      const j = await r.json()
      if (!r.ok) setError(j.error ?? "write failed")
      else setError(null)
      await pull()
    },
    [pull],
  )

  return { project, mtimes, op, error, missing }
}
