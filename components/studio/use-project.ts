"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import type { ProjectWithRev } from "@/lib/model"
import type { Op } from "@/lib/ops"

/** The project, live: polls /api/project and applies writes through the same named ops the CLI uses. */
export function useProject() {
  const [project, setProject] = useState<ProjectWithRev | null>(null)
  const [error, setError] = useState<string | null>(null)
  const rev = useRef(0)

  const pull = useCallback(async () => {
    try {
      const r = await fetch(`/api/project?rev=${rev.current}`, { cache: "no-store" })
      const j = await r.json()
      if (j.unchanged) return
      rev.current = j.rev
      setProject(j)
    } catch {}
  }, [])

  useEffect(() => {
    pull()
    const t = setInterval(pull, 1000)
    return () => clearInterval(t)
  }, [pull])

  const op = useCallback(
    async (...ops: Op[]) => {
      const r = await fetch("/api/project", { method: "POST", body: JSON.stringify({ ops }) })
      const j = await r.json()
      if (!r.ok) setError(j.error ?? "write failed")
      else setError(null)
      await pull()
    },
    [pull],
  )

  return { project, op, error }
}
