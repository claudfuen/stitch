"use client"

import { Activity as Pulse, ChevronDown, ChevronUp, X } from "lucide-react"
import { useState } from "react"
import type { TimelineView } from "@/lib/derive"
import type { Activity, ProjectWithRev } from "@/lib/model"
import { cn } from "@/lib/utils"
import { Chip, fmt } from "./media"

const dot = { run: "bg-amber-400 animate-pulse", done: "bg-emerald-400", info: "bg-sky-400", warn: "bg-rose-400" }

export function ActivityPanel({ items }: { items: Activity[] }) {
  const [open, setOpen] = useState(true)
  const recent = items.slice(-14).reverse()
  const time = (t: string) => new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })
  return (
    <div className="pointer-events-auto absolute top-4 right-4 z-20 w-80 rounded-xl border bg-card/95 shadow-lg backdrop-blur">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 px-3 py-2 text-xs font-medium">
        <Pulse className="size-3.5 text-amber-400" /> Live activity
        <span className="ml-auto text-muted-foreground">{open ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}</span>
      </button>
      {open && (
        <ul className="max-h-72 space-y-1.5 overflow-y-auto border-t px-3 py-2">
          {recent.length === 0 && <li className="text-xs text-muted-foreground">Nothing yet.</li>}
          {recent.map((a, i) => (
            <li key={a.t + i} className={cn("flex gap-2 text-xs leading-snug", i > 0 && "text-muted-foreground")}>
              <i className={cn("mt-1 size-1.5 shrink-0 rounded-full", dot[a.kind ?? "info"])} />
              <span className="min-w-0 flex-1">{a.text}</span>
              <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{time(a.t)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function TimelinePanel({ tl, defaultOpen = true }: { tl?: TimelineView; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  if (!tl) return null
  const pct = (t: number) => `${(t / tl.duration) * 100}%`
  const ticks = Array.from({ length: Math.floor(tl.duration / 5) + 1 }, (_, i) => i * 5)
  const row = (children: React.ReactNode, h = 24) => <div className="relative" style={{ height: h }}>{children}</div>
  return (
    <div className="border-t bg-card/95 backdrop-blur">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-3 px-4 py-2 text-xs">
        <span className="font-medium">Timeline</span>
        <span className="font-mono text-muted-foreground">{tl.version} · {fmt(tl.duration)}</span>
        <span className="text-muted-foreground">what was actually rendered</span>
        <span className="ml-auto text-muted-foreground">{open ? <ChevronDown className="size-4" /> : <ChevronUp className="size-4" />}</span>
      </button>
      {open && (
        <div className="space-y-1.5 px-4 pb-3">
          {row(ticks.map((t) => <span key={t} className="absolute -translate-x-1/2 font-mono text-[10px] text-muted-foreground" style={{ left: pct(t) }}>{t}s</span>), 14)}
          {row(tl.shots.map((s) => (
            <div key={s.id} title={s.name} className="absolute inset-y-0 overflow-hidden rounded px-1.5 text-[11px] leading-6 whitespace-nowrap" style={{ left: pct(s.start), width: `calc(${pct(s.end - s.start)} - 2px)`, background: `${s.color}2e`, color: s.color, borderTop: `2px solid ${s.color}` }}>
              {s.id} {s.name}
            </div>
          )), 26)}
          {row(tl.lines.map((l, i) => (
            <div key={i} title={`${l.who}: ${l.text}`} className={cn("absolute inset-y-0 overflow-hidden rounded px-1.5 text-[11px] leading-6 whitespace-nowrap", l.mode === "laid" ? "bg-rose-400/20 text-rose-200" : l.mode === "native" ? "bg-sky-400/20 text-sky-200" : "bg-violet-400/15 text-violet-200")} style={{ left: pct(l.start), width: `calc(${pct(Math.max(0.3, l.end - l.start))} - 2px)` }}>
              {l.who}: {l.text}
            </div>
          )))}
          {row(tl.graphics.map((g, i) => (
            <div key={i} title={g.label} className="absolute inset-y-0 overflow-hidden rounded bg-amber-300/20 px-1.5 text-[11px] leading-6 whitespace-nowrap text-amber-200" style={{ left: pct(g.start), width: `calc(${pct(g.end - g.start)} - 2px)` }}>{g.label}</div>
          )))}
          <div className="flex gap-3 pt-1 text-[10px] text-muted-foreground">
            <span className="text-sky-300">■ spoken on camera</span><span className="text-rose-300">■ not lip-synced</span><span className="text-violet-300">■ voice-over</span><span className="text-amber-300">■ graphics</span>
          </div>
        </div>
      )}
    </div>
  )
}

export function FinalCutModal({ project: p, onClose }: { project: ProjectWithRev; onClose: () => void }) {
  const cuts = p.cuts.filter((c) => p.assets.some((a) => a.id === c.asset))
  const [i, setI] = useState(0)
  const cut = cuts[i]
  const asset = p.assets.find((a) => a.id === cut?.asset)
  if (!cut || !asset) return null
  return (
    <div className="absolute inset-0 z-50 grid place-items-center bg-black/80 p-6 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-5xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center gap-3 text-sm">
          <span className="rounded-md bg-emerald-400 px-2.5 py-1 text-xs font-extrabold tracking-widest text-emerald-950 uppercase">Final cut</span>
          <span className="font-mono text-emerald-300">{cut.version}</span>
          <span className="text-muted-foreground">{fmt(cut.duration)} · {cut.date}</span>
          <button onClick={onClose} className="ml-auto rounded-md p-1 text-muted-foreground hover:text-foreground"><X className="size-5" /></button>
        </div>
        <video key={asset.path} src={asset.path} controls autoPlay playsInline className="aspect-video w-full rounded-xl bg-black" />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {cuts.map((c, k) => (
            <button key={c.id} onClick={() => setI(k)} className={cn("rounded-md border px-3 py-1.5 text-xs", k === i ? "border-emerald-400 bg-emerald-400/15 text-emerald-200" : "text-muted-foreground hover:text-foreground")}>{c.version}<span className="ml-2 opacity-60">{fmt(c.duration)}</span></button>
          ))}
        </div>
        {(cut.notes.length > 0 || cut.audit?.issues?.length) && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {cut.notes.map((n) => <Chip key={n} tone="muted">{n}</Chip>)}
            {cut.audit?.issues?.map((n) => <Chip key={n} tone="warn">{n}</Chip>)}
          </div>
        )}
      </div>
    </div>
  )
}
