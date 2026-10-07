"use client"

// Activity: the work as it happens, newest first, in hours. What the agents log (jobs started, done, warnings), the
// files they make (batched by when they were written, with posters) and every cut as it renders. Everything after the
// last time you looked sits above a "new" line.

import { Clapperboard, Images } from "lucide-react"
import { useMemo, useState } from "react"
import { activityFeed, type CutEntry, type FeedItem, type Index } from "@/lib/derive"
import type { ActivityKind, Asset, Id, ProjectWithRev } from "@/lib/model"
import { cn } from "@/lib/utils"
import { Chip, Thumb, ago, fmt, stamp, useMedia } from "./media"

const FILTERS = [
  { id: "all", label: "Everything" },
  { id: "note", label: "Log" },
  { id: "media", label: "Files" },
  { id: "cut", label: "Cuts" },
  { id: "warn", label: "Warnings" },
] as const
type Filter = (typeof FILTERS)[number]["id"]

const DOT: Record<ActivityKind, string> = { run: "bg-amber-400", done: "bg-emerald-400", info: "bg-sky-400", warn: "bg-rose-400" }
const KIND: Record<ActivityKind, string> = { run: "started", done: "done", info: "note", warn: "warning" }

function hourLabel(t: number) {
  const d = new Date(t)
  const today = new Date()
  const yesterday = new Date(Date.now() - 86_400_000)
  const day = d.toDateString() === today.toDateString() ? "Today" : d.toDateString() === yesterday.toDateString() ? "Yesterday" : d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })
  return `${day}, ${d.toLocaleTimeString([], { hour: "numeric" })}`
}

export function ActivityView({ project: p, ix, mtimes, current, seen, now, onCut }: {
  project: ProjectWithRev
  ix: Index
  mtimes: Record<Id, number>
  current?: CutEntry
  seen: number
  now: number
  onCut: (id: string) => void
}) {
  const [filter, setFilter] = useState<Filter>("all")
  const feed = useMemo(() => activityFeed(p, ix, mtimes), [p, ix, mtimes])
  const items = feed.filter((f) => filter === "all" || (filter === "warn" ? f.kind === "note" && f.tone === "warn" : f.kind === filter))
  const fresh = feed.filter((f) => f.t > seen).length
  const last = feed[0]

  // Hours, newest first, with the "new" line before the first item you have already seen.
  const hours: { label: string; items: FeedItem[] }[] = []
  for (const f of items) {
    const label = hourLabel(f.t)
    if (hours.at(-1)?.label !== label) hours.push({ label, items: [] })
    hours.at(-1)!.items.push(f)
  }
  const firstSeen = items.findIndex((f) => f.t <= seen)
  const lineAt = firstSeen > 0 ? items[firstSeen] : undefined

  return (
    <div className="absolute inset-0 overflow-y-auto">
      <div className="mx-auto max-w-4xl px-5 pt-5 pb-16">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold">Work in progress</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {last ? <>Last update {ago(last.t, now)}{fresh > 0 && <> · <b className="text-sky-300">{fresh} new</b> since you last looked</>}</> : "Nothing logged yet."}
              {current && <> · current cut <b className="font-mono text-foreground">{current.cut.version}</b></>}
            </p>
          </div>
          <div className="flex gap-1">
            {FILTERS.map((f) => (
              <button key={f.id} type="button" onClick={() => setFilter(f.id)} className={cn("rounded-md px-2 py-1 text-xs", filter === f.id ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground")}>{f.label}</button>
            ))}
          </div>
        </div>

        {hours.map((h) => (
          <section key={h.label} className="mt-5">
            <h3 className="sticky top-0 z-10 -mx-1 bg-background/95 px-1 py-1.5 text-xs font-semibold text-muted-foreground backdrop-blur">{h.label}</h3>
            <ol className="ml-[4.25rem] border-l">
              {h.items.map((f) => (
                <li key={`${f.kind}:${f.t}:${f.kind === "note" ? f.text.slice(0, 40) : f.kind === "cut" ? f.cut.id : f.assets[0].id}`}>
                  {f === lineAt && (
                    <div className="relative -ml-[4.25rem] flex items-center gap-2 py-2 text-[11px] font-semibold text-sky-300">
                      <span className="w-14 text-right">new</span>
                      <span className="h-px flex-1 bg-sky-400/50" />
                      <span>above: since you last looked</span>
                    </div>
                  )}
                  <Row f={f} now={now} current={current} onCut={onCut} />
                </li>
              ))}
            </ol>
          </section>
        ))}
        {items.length === 0 && <p className="mt-10 text-center text-sm text-muted-foreground">Nothing here yet.</p>}
      </div>
    </div>
  )
}

function Row({ f, now, current, onCut }: { f: FeedItem; now: number; current?: CutEntry; onCut: (id: string) => void }) {
  const time = <span className="absolute -left-[4.25rem] w-14 pt-0.5 text-right font-mono text-[11px] text-muted-foreground" title={new Date(f.t).toLocaleString()}>{stamp(f.t).replace(/^.*, /, "")}</span>
  if (f.kind === "note") {
    const live = f.tone === "run" && now - f.t < 20 * 60_000
    return (
      <div className="relative py-2 pl-5">
        {time}
        <span className={cn("absolute top-3 -left-[4.5px] size-2 rounded-full ring-4 ring-background", DOT[f.tone], live && "animate-pulse")} />
        <div className="text-sm leading-relaxed">
          <span className={cn("mr-2 text-[11px] font-semibold tracking-wide uppercase", f.tone === "warn" ? "text-rose-300" : f.tone === "run" ? "text-amber-300" : f.tone === "done" ? "text-emerald-300" : "text-sky-300")}>{KIND[f.tone]}</span>
          {f.text}
        </div>
      </div>
    )
  }
  if (f.kind === "cut") {
    const isCurrent = current?.cut.id === f.cut.id
    return (
      <div className="relative py-2 pl-5">
        {time}
        <span className="absolute top-3 -left-[4.5px] size-2 rounded-full bg-emerald-400 ring-4 ring-background" />
        <div className="flex items-center gap-3">
          <Thumb asset={f.asset} w={320} className="aspect-video w-36 rounded-md" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Clapperboard className="size-4 text-emerald-300" />
              <span>{f.cut.scope ? `${f.cut.scope}: cut` : "Cut of the film"} <b className="font-mono">{f.cut.version}</b> rendered · {fmt(f.cut.duration)}</span>
              {isCurrent && <Chip tone="good">current</Chip>}
            </div>
            <button type="button" onClick={() => onCut(f.cut.id)} className="mt-1 text-xs text-sky-300 hover:underline">Open in Cuts</button>
          </div>
        </div>
      </div>
    )
  }
  return <Batch f={f} time={time} />
}

/** Files written within a few minutes of each other: what they are and what they are for, with posters. */
function Batch({ f, time }: { f: Extract<FeedItem, { kind: "media" }>; time: React.ReactNode }) {
  const { uses } = useMedia()
  const [all, setAll] = useState(false)
  const counts = (["video", "image", "audio", "model"] as const).map((m) => [m, f.assets.filter((a) => a.media === m).length] as const).filter(([, n]) => n)
  const words = { video: ["video", "videos"], image: ["image", "images"], audio: ["audio file", "audio files"], model: ["3D room", "3D rooms"] }
  const forWhat = [...new Set(f.assets.flatMap((a) => (uses.get(a.id) ?? []).map((u) => u.shot ?? (u.setup ? `${u.location} ${u.setup}` : u.location) ?? "").filter(Boolean)))]
  const picked = f.assets.filter((a) => uses.get(a.id)?.some((u) => u.picked)).length
  const visual: Asset[] = f.assets.filter((a) => a.media === "image" || a.media === "video")
  const show = all ? visual : visual.slice(0, 10)
  return (
    <div className="relative py-2 pl-5">
      {time}
      <span className="absolute top-3 -left-[4.5px] size-2 rounded-full bg-violet-400 ring-4 ring-background" />
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Images className="size-4 text-violet-300" />
        <span>{counts.map(([m, n]) => `${n} ${words[m][n === 1 ? 0 : 1]}`).join(", ")}</span>
        {forWhat.length > 0 && <span className="text-muted-foreground">for {forWhat.slice(0, 8).join(", ")}{forWhat.length > 8 ? ` and ${forWhat.length - 8} more` : ""}</span>}
        {picked > 0 && <Chip tone="good">{picked} picked</Chip>}
      </div>
      {show.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {show.map((a) => <Thumb key={a.id} asset={a} w={240} list={visual} className="aspect-video w-28 rounded" />)}
          {!all && visual.length > show.length && (
            <button type="button" onClick={() => setAll(true)} className="grid aspect-video w-28 place-items-center rounded bg-muted text-xs text-muted-foreground hover:text-foreground">+{visual.length - show.length} more</button>
          )}
        </div>
      )}
      {f.assets.length > visual.length && (
        <div className="mt-1.5 truncate text-xs text-muted-foreground">{f.assets.filter((a) => a.media !== "image" && a.media !== "video").map((a) => a.label).join(" · ")}</div>
      )}
    </div>
  )
}
