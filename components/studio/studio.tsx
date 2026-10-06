"use client"

import { ReactFlowProvider } from "@xyflow/react"
import { Box, LayoutGrid, Network, Play } from "lucide-react"
import dynamic from "next/dynamic"
import { useEffect, useMemo, useState } from "react"
import { indexProject, shotRows, summary, timeline } from "@/lib/derive"
import { Button } from "@/components/ui/button"
import { CanvasView } from "./canvas-view"
import { ActivityPanel, FinalCutModal, TimelinePanel } from "./panels"
import { ShotsView } from "./shots-view"
import { useProject } from "./use-project"

// The 3D view loads three.js only in the browser, and only when Rooms is opened.
const RoomsView = dynamic(() => import("./rooms-view").then((m) => m.RoomsView), { ssr: false })

type View = "shots" | "canvas" | "rooms"

export function Studio() {
  const { project, op, error } = useProject()
  const [view, setView] = useState<View>("shots")
  const [watching, setWatching] = useState(false)
  const [focus, setFocus] = useState<string | null>(null)

  useEffect(() => {
    try {
      const v = localStorage.getItem("stitch-view")
      if (v === "shots" || v === "canvas" || v === "rooms") setView(v)
    } catch {}
  }, [])
  const choose = (v: View) => {
    setView(v)
    try { localStorage.setItem("stitch-view", v) } catch {}
  }

  // Every view renders from these, computed once per project revision.
  const d = useMemo(() => {
    if (!project) return null
    const ix = indexProject(project)
    const rows = shotRows(project, ix)
    return { ix, rows, sum: summary(project, rows), tl: timeline(project, ix) }
  }, [project])

  if (!project || !d) return <div className="grid h-svh place-items-center text-sm text-muted-foreground">Loading project…</div>

  return (
    <div className="flex h-svh w-svw flex-col">
      <div className="relative min-h-0 flex-1">
        {view === "shots" ? (
          <ShotsView project={project} ix={d.ix} rows={d.rows} sum={d.sum} op={op} onWatch={() => setWatching(true)} onFocus={(id) => { setFocus(id); choose("canvas") }} />
        ) : view === "rooms" ? (
          <RoomsView project={project} ix={d.ix} />
        ) : (
          <div className="absolute inset-0">
            <ReactFlowProvider>
              <CanvasView project={project} ix={d.ix} rows={d.rows} op={op} focus={focus} />
            </ReactFlowProvider>
          </div>
        )}
        <div className="pointer-events-none absolute top-4 left-4 z-20 flex items-center gap-2">
          <div className="pointer-events-auto flex gap-1 rounded-xl border bg-card p-1 shadow-lg">
            <Button size="sm" variant={view === "shots" ? "secondary" : "ghost"} onClick={() => choose("shots")}><LayoutGrid /> Shots</Button>
            <Button size="sm" variant={view === "canvas" ? "secondary" : "ghost"} onClick={() => choose("canvas")}><Network /> Canvas</Button>
            <Button size="sm" variant={view === "rooms" ? "secondary" : "ghost"} onClick={() => choose("rooms")}><Box /> Rooms</Button>
          </div>
          {project.cuts[0] && (
            <Button size="sm" className="pointer-events-auto bg-emerald-400 text-emerald-950 hover:bg-emerald-300" onClick={() => setWatching(true)}><Play /> Watch final cut</Button>
          )}
          {error && <span className="pointer-events-auto rounded-md bg-rose-500/20 px-2 py-1 text-xs text-rose-200">{error}</span>}
        </div>
        <ActivityPanel items={project.activity} />
        {watching && <FinalCutModal project={project} onClose={() => setWatching(false)} />}
      </div>
      <TimelinePanel key={view} tl={d.tl} defaultOpen={view === "canvas"} />
    </div>
  )
}
