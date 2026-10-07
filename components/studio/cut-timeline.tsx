"use client"

// A cut as it was rendered: its shots (coloured by section), lines and graphics on one time axis. Shots that changed
// from the version before carry a mark; clicking a shot seeks the player to it.

import type { CutChange, TimelineView } from "@/lib/derive"
import type { Id } from "@/lib/model"
import { cn } from "@/lib/utils"

export function CutTimeline({ tl, changes, at, onSeek }: { tl: TimelineView; changes?: Map<Id, CutChange["change"]>; at?: number; onSeek?: (t: number) => void }) {
  const pct = (t: number) => `${(t / tl.duration) * 100}%`
  const step = tl.duration > 40 ? 10 : 5
  const ticks = Array.from({ length: Math.floor(tl.duration / step) + 1 }, (_, i) => i * step)
  return (
    <div className="relative space-y-1.5 select-none">
      <div className="relative h-3.5">
        {ticks.map((t) => <span key={t} className="absolute -translate-x-1/2 font-mono text-[10px] text-muted-foreground" style={{ left: pct(t) }}>{t}s</span>)}
      </div>
      <div className="relative h-8">
        {tl.shots.map((s) => {
          const change = changes?.get(s.id)
          return (
            <button key={s.id} type="button" onClick={() => onSeek?.(s.start + 0.01)} title={`${s.id} ${s.name}${change ? ` (${change})` : ""}`}
              className="absolute inset-y-0 overflow-hidden rounded px-1.5 text-left text-[11px] leading-8 whitespace-nowrap hover:brightness-125"
              style={{ left: pct(s.start), width: `calc(${pct(s.end - s.start)} - 2px)`, background: `${s.color}2e`, color: s.color, borderTop: `2px solid ${s.color}` }}>
              {change && <span className="mr-1 inline-block size-1.5 rounded-full bg-sky-300 align-middle" />}
              {s.id}
            </button>
          )
        })}
      </div>
      <div className="relative h-6">
        {tl.lines.map((l, i) => (
          <div key={i} title={`${l.who}: ${l.text}`} className={cn("absolute inset-y-0 overflow-hidden rounded px-1.5 text-[11px] leading-6 whitespace-nowrap", l.mode === "laid" ? "bg-rose-400/20 text-rose-200" : l.mode === "native" ? "bg-sky-400/20 text-sky-200" : "bg-violet-400/15 text-violet-200")}
            style={{ left: pct(l.start), width: `calc(${pct(Math.max(0.3, l.end - l.start))} - 2px)` }}>
            {l.who}: {l.text}
          </div>
        ))}
      </div>
      {tl.graphics.length > 0 && (
        <div className="relative h-6">
          {tl.graphics.map((g, i) => (
            <div key={i} title={g.label} className="absolute inset-y-0 overflow-hidden rounded bg-amber-300/20 px-1.5 text-[11px] leading-6 whitespace-nowrap text-amber-200" style={{ left: pct(g.start), width: `calc(${pct(g.end - g.start)} - 2px)` }}>{g.label}</div>
          ))}
        </div>
      )}
      {at !== undefined && <div className="pointer-events-none absolute top-3.5 bottom-0 w-px bg-white/80" style={{ left: pct(Math.min(at, tl.duration)) }} />}
      <div className="flex flex-wrap gap-3 pt-1 text-[11px] text-muted-foreground">
        <span className="text-sky-300">■ spoken on camera</span><span className="text-rose-300">■ not lip-synced</span><span className="text-violet-300">■ voice-over</span><span className="text-amber-300">■ graphics</span>
        {changes && changes.size > 0 && <span><span className="mr-1 inline-block size-1.5 rounded-full bg-sky-300 align-middle" />changed from the version before</span>}
      </div>
    </div>
  )
}
