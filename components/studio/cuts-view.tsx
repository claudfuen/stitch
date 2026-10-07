"use client"

// Cuts: every version of the film and of each scene, newest first. The newest full cut is the current cut of the film,
// and every older version says what replaced it. Select one to watch it with its timeline and what changed from the
// version before.

import { useMemo, useRef, useState } from "react"
import { cutTimeline, type CutEntry, type CutHistory, type Index } from "@/lib/derive"
import type { ProjectWithRev } from "@/lib/model"
import { cn } from "@/lib/utils"
import { CutTimeline } from "./cut-timeline"
import { Chip, fmt, posterUrl, stamp, useMedia } from "./media"

/** A scene cut's own version ("study-s1-v4" is v4 of its scene); full cuts keep their name. */
const short = (e: CutEntry) => (e.cut.scope ? (/-(v[\w.]+)$/.exec(e.cut.version)?.[1] ?? e.cut.version) : e.cut.version)

export function CutsView({ project, ix, history, selected, onSelect }: { project: ProjectWithRev; ix: Index; history: CutHistory; selected: string | null; onSelect: (id: string) => void }) {
  const groups = [{ scope: "", entries: history.full }, ...history.scenes]
  const entry = groups.flatMap((g) => g.entries).find((e) => e.cut.id === selected) ?? history.current ?? groups.flatMap((g) => g.entries)[0]
  const group = groups.find((g) => entry && g.entries.includes(entry))
  const newer = entry && group ? group.entries[group.entries.indexOf(entry) - 1] : undefined

  return (
    <div className="absolute inset-0 flex">
      <aside className="w-72 shrink-0 overflow-y-auto border-r p-3">
        {groups.map((g) => (
          <section key={g.scope || "film"} className="mb-4">
            <h3 className="mb-1 px-2 text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">{g.scope || "Full film"}</h3>
            {g.entries.map((e) => (
              <button key={e.cut.id} type="button" onClick={() => onSelect(e.cut.id)}
                className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs", e === entry ? "bg-muted" : "hover:bg-muted/50", !e.current && "text-muted-foreground")}>
                <span className={cn("font-mono text-sm", e.current && "font-semibold text-foreground")}>{short(e)}</span>
                {e.current && <Chip tone="good">{g.scope ? "latest" : "current"}</Chip>}
                <span className="ml-auto font-mono">{fmt(e.cut.duration)}</span>
                <span className="w-16 text-right">{e.at ? stamp(e.at) : e.cut.date}</span>
              </button>
            ))}
          </section>
        ))}
      </aside>
      <main className="min-w-0 flex-1 overflow-y-auto">
        {entry ? <CutDetail key={entry.cut.id} project={project} ix={ix} entry={entry} newer={newer} onSelect={onSelect} /> : <div className="p-10 text-sm text-muted-foreground">No cuts yet.</div>}
      </main>
    </div>
  )
}

function CutDetail({ project, ix, entry, newer, onSelect }: { project: ProjectWithRev; ix: Index; entry: CutEntry; newer?: CutEntry; onSelect: (id: string) => void }) {
  const { mtimes } = useMedia()
  const video = useRef<HTMLVideoElement>(null)
  const [at, setAt] = useState(0)
  const { cut, asset } = entry
  const tl = useMemo(() => cutTimeline(project, cut, ix), [project, cut, ix])
  const changes = useMemo(() => new Map(entry.changes.map((c) => [c.shot, c.change])), [entry])
  const seek = (t: number) => {
    const v = video.current
    if (!v) return
    v.currentTime = t
    v.play().catch(() => {})
  }
  return (
    <div className="mx-auto max-w-5xl p-5">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="font-mono text-xl font-semibold">{cut.version}</h2>
        {entry.current ? (
          <Chip tone="good">{cut.scope ? "Latest version of this scene" : "Current cut of the film"}</Chip>
        ) : (
          newer && <button type="button" onClick={() => onSelect(newer.cut.id)}><Chip tone="warn">Replaced by {newer.cut.version}</Chip></button>
        )}
        <span className="text-sm text-muted-foreground">
          {cut.scope ?? "Full film"} · {fmt(cut.duration)} · {entry.at ? `made ${stamp(entry.at)}` : cut.date}
        </span>
      </div>

      {asset ? (
        <video ref={video} key={asset.id} src={asset.path} poster={posterUrl(asset, 1280, mtimes)} controls preload="metadata" playsInline
          onTimeUpdate={(e) => setAt(e.currentTarget.currentTime)} className="mt-4 aspect-video w-full rounded-lg bg-black" />
      ) : (
        <div className="mt-4 grid aspect-video w-full place-items-center rounded-lg bg-muted text-sm text-muted-foreground">The render for this cut is missing.</div>
      )}

      <div className="mt-4 rounded-lg border p-3">
        <CutTimeline tl={tl} changes={changes} at={at} onSeek={seek} />
      </div>

      <div className="mt-5 grid gap-5 md:grid-cols-2">
        <section>
          <h3 className="mb-2 text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">{entry.prev ? `Changed from ${entry.prev.version}` : "First version"}</h3>
          {entry.prev && entry.changes.length === 0 && <p className="text-sm text-muted-foreground">Same shots, takes, timing and lines as {entry.prev.version}.</p>}
          <div className="flex flex-wrap gap-1.5">
            {entry.changes.map((c) => <Chip key={c.shot} tone={c.change === "removed" ? "bad" : c.change === "added" || c.change === "new take" ? "good" : "muted"}>{c.shot} {c.change}</Chip>)}
          </div>
        </section>
        {(cut.notes.length > 0 || cut.audit) && (
          <section>
            <h3 className="mb-2 text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">Notes and audit</h3>
            <ul className="space-y-1 text-sm">{cut.notes.map((n) => <li key={n}>{n}</li>)}</ul>
            {cut.audit && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {cut.audit.lufs !== undefined && <Chip tone={Math.abs(cut.audit.lufs + 14) <= 1.5 ? "good" : "warn"}>{cut.audit.lufs.toFixed(1)} LUFS</Chip>}
                {cut.audit.truePeak !== undefined && <Chip tone={cut.audit.truePeak <= -1 ? "good" : "warn"}>peak {cut.audit.truePeak.toFixed(1)} dBTP</Chip>}
                {cut.audit.issues?.map((i) => <Chip key={i} tone="warn">{i}</Chip>)}
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  )
}
