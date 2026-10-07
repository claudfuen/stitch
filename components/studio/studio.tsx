"use client"

import { ReactFlowProvider } from "@xyflow/react"
import { Box, Clapperboard, History, LayoutList, Network, Play } from "lucide-react"
import dynamic from "next/dynamic"
import { useCallback, useMemo, useState } from "react"
import { assetUses, cutHistory, indexProject, shotRows, summary, type CutEntry, type CutHistory, type Index, type ShotRow, type Summary } from "@/lib/derive"
import type { Activity, Id, ProjectWithRev } from "@/lib/model"
import type { Op } from "@/lib/ops"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { ActivityView } from "./activity-view"
import { CanvasView } from "./canvas-view"
import { CutsView } from "./cuts-view"
import { MediaProvider, ago, fmt, stamp, useMedia, useNow } from "./media"
import { ShotsView } from "./shots-view"
import { useProject } from "./use-project"

// The 3D view loads three.js only in the browser, and only when Rooms is opened.
const RoomsView = dynamic(() => import("./rooms-view").then((m) => m.RoomsView), { ssr: false })

const VIEWS = [
  { id: "shots", label: "Shots", icon: LayoutList },
  { id: "cuts", label: "Cuts", icon: Clapperboard },
  { id: "activity", label: "Activity", icon: History },
  { id: "canvas", label: "Canvas", icon: Network },
  { id: "rooms", label: "Rooms", icon: Box },
] as const
type View = (typeof VIEWS)[number]["id"]
const isView = (v: unknown): v is View => VIEWS.some((x) => x.id === v)

const read = (k: string) => {
  try {
    return localStorage.getItem(k)
  } catch {
    return null
  }
}
const write = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v)
  } catch {}
}

export function Studio() {
  const { project: p, mtimes, op, error } = useProject()

  // Derived once per change of the slices each reads: an agent appending to the activity log changes none of them.
  /* eslint-disable react-hooks/exhaustive-deps */
  const ix = useMemo(() => p && indexProject(p), [p?.assets, p?.characters, p?.locations, p?.sections, p?.graphics])
  const rows = useMemo(() => p && ix && shotRows(p, ix), [ix, p?.shots, p?.cuts, p?.baselines])
  const sum = useMemo(() => p && rows && summary(p, rows), [rows, p?.cuts, p?.runtimeTarget])
  const uses = useMemo(() => (p ? assetUses(p) : new Map()), [p?.shots, p?.graphics, p?.characters, p?.locations, p?.cuts])
  const history = useMemo(() => p && ix && cutHistory(p, ix, mtimes), [ix, p?.cuts, mtimes])
  /* eslint-enable react-hooks/exhaustive-deps */

  if (!p || !ix || !rows || !sum || !history) return <div className="grid h-svh place-items-center text-sm text-muted-foreground">Loading project…</div>
  return (
    <MediaProvider mtimes={mtimes} uses={uses} assets={ix.assets} baselines={p.baselines}>
      <Shell p={p} ix={ix} rows={rows} sum={sum} history={history} mtimes={mtimes} op={op} error={error} />
    </MediaProvider>
  )
}

type ShellProps = {
  p: ProjectWithRev
  ix: Index
  rows: ShotRow[]
  sum: Summary
  history: CutHistory
  mtimes: Record<Id, number>
  op: (...o: Op[]) => Promise<void>
  error: string | null
}

function Shell({ p, ix, rows, sum, history, mtimes, op, error }: ShellProps) {
  const [view, setView] = useState<View>(() => {
    const v = read("stitch-view")
    return isView(v) ? v : "shots"
  })
  const [focus, setFocus] = useState<string | null>(null)
  const [cutId, setCutId] = useState<string | null>(null)
  // When Activity was last looked at: newer log entries count on its tab and sit above the "new" line in the view.
  const [seen, setSeen] = useState(() => Number(read("stitch-seen")) || Date.parse(p.activity.at(-1)?.t ?? "") || Date.now())
  const now = useNow()

  const choose = useCallback(
    (v: View) => {
      if (view === "activity" && v !== "activity") {
        const t = Date.now()
        setSeen(t)
        write("stitch-seen", String(t))
      }
      setView(v)
      write("stitch-view", v)
    },
    [view],
  )
  const openCut = useCallback((id: string) => (setCutId(id), choose("cuts")), [choose])
  const openCanvas = useCallback((node: string) => (setFocus(node), choose("canvas")), [choose])

  const unseen = view === "activity" ? 0 : p.activity.filter((a) => Date.parse(a.t) > seen).length

  return (
    <div className="flex h-svh w-svw flex-col">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b bg-card/40 px-3">
        <span className="hidden max-w-48 truncate text-sm font-semibold lg:block" title={p.logline}>{p.title}</span>
        <nav className="flex min-w-0 items-center gap-0.5 overflow-x-auto">
          {VIEWS.map(({ id, label, icon: Icon }) => (
            <Button key={id} size="sm" variant={view === id ? "secondary" : "ghost"} onClick={() => choose(id)} aria-current={view === id ? "page" : undefined} aria-label={label} title={label}>
              <Icon /> <span className="hidden lg:inline">{label}</span>
              {id === "activity" && unseen > 0 && <span className="rounded-full bg-sky-400 px-1.5 text-[10px] leading-4 font-semibold text-sky-950">{unseen}</span>}
            </Button>
          ))}
        </nav>
        <div className="ml-auto flex min-w-0 items-center gap-2">
          {error && <span className="truncate rounded-md bg-rose-500/20 px-2 py-1 text-xs text-rose-200">{error}</span>}
          <LivePill last={p.activity.at(-1)} now={now} onClick={() => choose("activity")} />
          {history.current && <CurrentCut entry={history.current} onOpen={() => openCut(history.current!.cut.id)} />}
        </div>
      </header>
      <main className="relative min-h-0 flex-1">
        {view === "shots" ? (
          <ShotsView project={p} rows={rows} sum={sum} current={history.current} op={op} onCanvas={openCanvas} onCut={openCut} />
        ) : view === "cuts" ? (
          <CutsView project={p} ix={ix} history={history} selected={cutId} onSelect={setCutId} />
        ) : view === "activity" ? (
          <ActivityView project={p} ix={ix} mtimes={mtimes} current={history.current} seen={seen} now={now} onCut={openCut} />
        ) : view === "rooms" ? (
          <RoomsView project={p} ix={ix} op={op} />
        ) : (
          <ReactFlowProvider>
            <CanvasView project={p} ix={ix} rows={rows} op={op} focus={focus} />
          </ReactFlowProvider>
        )}
      </main>
    </div>
  )
}

/** Whether the agents are working: the last thing they logged, and how long ago. */
function LivePill({ last, now, onClick }: { last?: Activity; now: number; onClick: () => void }) {
  if (!last) return null
  const t = Date.parse(last.t)
  const live = now - t < 10 * 60_000
  return (
    <button type="button" onClick={onClick} title={last.text} className="hidden items-center gap-2 rounded-md px-2 py-1 text-xs whitespace-nowrap text-muted-foreground hover:bg-muted lg:flex">
      <span className={cn("size-2 rounded-full", live ? (last.kind === "warn" ? "bg-rose-400" : "animate-pulse bg-emerald-400") : "bg-muted-foreground/50")} />
      {live ? "Working" : "Quiet"} · {ago(t, now)}
    </button>
  )
}

/** The film's current cut (the newest full cut, never a scene cut): play it, or open it among the other versions. */
function CurrentCut({ entry, onOpen }: { entry: CutEntry; onOpen: () => void }) {
  const { open } = useMedia()
  return (
    <div className="flex shrink-0 items-center overflow-hidden rounded-md border border-emerald-400/40 bg-emerald-400/10 text-xs whitespace-nowrap">
      <button type="button" onClick={() => entry.asset && open([entry.asset])} disabled={!entry.asset} className="flex items-center gap-1.5 bg-emerald-400 px-2.5 py-1.5 font-semibold text-emerald-950 hover:bg-emerald-300 disabled:opacity-50">
        <Play className="size-3.5 fill-current" /> Watch
      </button>
      <button type="button" onClick={onOpen} className="flex items-center gap-1.5 px-2.5 py-1.5 text-emerald-100 hover:bg-emerald-400/10" title="The newest full cut of the film. Open it among every version.">
        Current cut <b className="font-mono">{entry.cut.version}</b>
        <span className="hidden text-emerald-200/70 xl:inline">· {fmt(entry.cut.duration)}{entry.at ? ` · ${stamp(entry.at)}` : ""}</span>
      </button>
    </div>
  )
}
