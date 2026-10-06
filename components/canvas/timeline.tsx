"use client"

import { ChevronDown, ChevronUp } from "lucide-react"
import { useState } from "react"
import type { AppNode, GenNode, Story } from "@/lib/graph"
import { cn } from "@/lib/utils"

const laneStyle: Record<string, string> = {
  ui: "bg-amber-300/20 text-amber-200", stat: "bg-amber-300/20 text-amber-200", stamp: "bg-amber-300/20 text-amber-200",
  title: "bg-amber-300/20 text-amber-200", "end-card": "bg-amber-300/20 text-amber-200", transition: "bg-amber-300/20 text-amber-200", caption: "bg-amber-300/20 text-amber-200",
  vo: "bg-sky-400/20 text-sky-200", real: "bg-emerald-400/25 text-emerald-200", sfx: "bg-rose-400/20 text-rose-200", music: "bg-violet-400/15 text-violet-200",
}
const dot = { idle: "bg-muted-foreground/40", running: "bg-amber-400 animate-pulse", done: "bg-emerald-400" }

export function Timeline({ story, nodes, onFocus }: { story: Story; nodes: AppNode[]; onFocus: (scene: number) => void }) {
  const [open, setOpen] = useState(true)
  const status = (id: string) => (nodes.find((n) => n.id === id) as GenNode | undefined)?.data.status ?? "idle"
  const pct = (t: number) => `${(t / story.runtime) * 100}%`
  const ticks = Array.from({ length: story.runtime / 5 + 1 }, (_, i) => i * 5)

  return (
    <div className="border-t bg-card/95 backdrop-blur">
      <div className="flex items-center gap-3 px-4 py-2 text-xs">
        <span className="font-medium">{story.title}</span>
        <span className="font-mono text-muted-foreground">{story.runtime}s</span>
        <span className="hidden truncate text-muted-foreground md:block">{story.logline}</span>
        <button onClick={() => setOpen(!open)} className="ml-auto text-muted-foreground hover:text-foreground">{open ? <ChevronDown className="size-4" /> : <ChevronUp className="size-4" />}</button>
      </div>
      {open && (
        <div className="max-h-[42svh] overflow-y-auto px-4 pb-3">
          <div className="relative h-4 font-mono text-[10px] text-muted-foreground">
            {ticks.map((t) => <span key={t} className="absolute -translate-x-1/2" style={{ left: pct(t) }}>{t}s</span>)}
          </div>
          <div className="relative h-7">
            {story.sections.map((s) => (
              <div key={s.id} className="absolute inset-y-0 flex items-center overflow-hidden rounded-md px-2 text-[11px] font-semibold tracking-wide uppercase" style={{ left: pct(s.start), width: `calc(${pct(s.end - s.start)} - 4px)`, background: `${s.color}26`, color: s.color, borderTop: `2px solid ${s.color}` }}>
                {s.name}
              </div>
            ))}
          </div>
          <div className="relative mt-1.5 h-24">
            {story.beats.map((b) => {
              const color = story.sections.find((s) => s.id === b.section)?.color
              return (
                <button key={b.scene} onClick={() => onFocus(b.scene)} className={cn("absolute inset-y-0 flex flex-col rounded-md border bg-background/70 p-2 text-left transition hover:bg-background")} style={{ left: pct(b.start), width: `calc(${pct(b.end - b.start)} - 4px)`, borderColor: `${color}66` }}>
                  <div className="flex items-center gap-1.5 text-[11px] font-medium"><span className="font-mono" style={{ color }}>{b.scene}</span><span className="truncate">{b.name}</span></div>
                  <div className="mt-1 line-clamp-3 text-[11px] leading-snug text-muted-foreground">{b.vo}</div>
                  <div className="mt-auto flex items-center gap-2 text-[10px] text-muted-foreground">
                    <span className="flex items-center gap-1"><i className={cn("size-1.5 rounded-full", dot[status(`k${b.scene}`)])} />frame</span>
                    <span className="flex items-center gap-1"><i className={cn("size-1.5 rounded-full", dot[status(`v${b.scene}`)])} />video</span>
                  </div>
                </button>
              )
            })}
          </div>
          {story.tracks?.map((track) => {
            const rows = Math.max(...track.items.map((i) => i.row ?? 0)) + 1
            return (
              <div key={track.id} className="mt-1.5">
                <div className="mb-0.5 text-[10px] tracking-wide text-muted-foreground uppercase">{track.name}</div>
                <div className="relative" style={{ height: rows * 22 }}>
                  {track.items.map((i) => (
                    <div key={i.id} className={cn("absolute flex items-center overflow-hidden rounded px-1.5 text-[10px] whitespace-nowrap", laneStyle[i.kind] ?? "bg-muted text-muted-foreground")} style={{ left: pct(i.start), width: `calc(${pct(i.end - i.start)} - 2px)`, top: (i.row ?? 0) * 22, height: 19 }} title={i.label}>
                      {i.label}
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
          {story.open.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground"><span className="font-medium text-foreground">Open:</span>{story.open.map((q) => <span key={q}>{q}</span>)}</div>
          )}
        </div>
      )}
    </div>
  )
}
