"use client"

import { Activity as Pulse, ChevronDown, ChevronUp } from "lucide-react"
import { useState } from "react"
import type { Activity } from "@/lib/graph"
import { cn } from "@/lib/utils"

const dot = { run: "bg-amber-400 animate-pulse", done: "bg-emerald-400", info: "bg-sky-400", warn: "bg-rose-400" }

export function ActivityPanel({ items }: { items: Activity[] }) {
  const [open, setOpen] = useState(true)
  const recent = items.slice(-12).reverse()
  const time = (t: string) => new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })
  return (
    <div className="pointer-events-auto absolute top-4 right-4 z-10 w-80 rounded-xl border bg-card/95 shadow-lg backdrop-blur">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 px-3 py-2 text-xs font-medium">
        <Pulse className="size-3.5 text-amber-400" /> Live activity
        <span className="ml-auto text-muted-foreground">{open ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}</span>
      </button>
      {open && (
        <ul className="max-h-64 space-y-1.5 overflow-y-auto border-t px-3 py-2">
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
