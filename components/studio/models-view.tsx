"use client"

// Models: every asset records the models that made it (lib/models.ts ids, provider, job). Per model: what it made,
// how much of it was picked or rejected, what the current cut plays or was made from, its scores and its cost.
// Open a model to see what it made, picked first.

import { ChevronDown, ChevronRight } from "lucide-react"
import { Fragment, useState } from "react"
import type { ModelStat } from "@/lib/derive"
import type { ModelKind } from "@/lib/models"
import { cn } from "@/lib/utils"
import { Chip, Thumb } from "./media"

const KINDS: { kind: ModelKind; label: string }[] = [
  { kind: "video", label: "Video" },
  { kind: "image", label: "Stills" },
  { kind: "voice", label: "Voice" },
  { kind: "lipsync", label: "Lip-sync" },
  { kind: "sfx", label: "Sound" },
  { kind: "finish", label: "Finishing" },
  { kind: "local", label: "Our own steps" },
]
const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)}%` : "-")

export function ModelsView({ board, picked }: { board: ModelStat[]; picked: Set<string> }) {
  const [open, setOpen] = useState<string | null>(null)
  const steps = board.filter((s) => s.model.kind !== "local").reduce((n, s) => n + s.steps, 0)
  const recorded = board.filter((s) => s.model.kind !== "local").reduce((n, s) => n + s.recorded, 0)
  return (
    <div className="absolute inset-0 overflow-y-auto">
      <div className="mx-auto max-w-6xl px-5 pt-5 pb-16">
        <h2 className="text-lg font-semibold">Models</h2>
        <p className="mt-0.5 max-w-3xl text-sm text-muted-foreground">
          What each model made and what we kept. Picked means circled as a take, keyframe or plate; in the cut means the
          current cut plays it or was made from it. {recorded} of {steps} provider steps carry a job id; the rest were read
          from older labels.
        </p>
        {KINDS.map(({ kind, label }) => {
          const rows = board.filter((s) => s.model.kind === kind)
          if (!rows.length) return null
          return (
            <section key={kind} className="mt-6">
              <h3 className="mb-2 text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">{label}</h3>
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-medium">Model</th>
                      <th className="px-3 py-2 font-medium">Ran on</th>
                      <th className="px-3 py-2 text-right font-medium">Made</th>
                      <th className="px-3 py-2 text-right font-medium">Picked</th>
                      <th className="px-3 py-2 text-right font-medium">Rejected</th>
                      <th className="px-3 py-2 text-right font-medium">In the cut</th>
                      <th className="px-3 py-2 text-right font-medium">Face</th>
                      <th className="px-3 py-2 text-right font-medium">Voice</th>
                      <th className="px-3 py-2 text-right font-medium">Cost</th>
                      <th className="px-3 py-2 text-right font-medium">With job id</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((s) => {
                      const on = open === s.model.id
                      const list = [...s.assets].sort((a, b) => Number(picked.has(b.id)) - Number(picked.has(a.id)))
                      const visual = list.filter((a) => a.media === "image" || a.media === "video")
                      return (
                        <Fragment key={s.model.id}>
                          <tr onClick={() => setOpen(on ? null : s.model.id)} className={cn("cursor-pointer border-t hover:bg-muted/30", on && "bg-muted/30")}>
                            <td className="px-3 py-2">
                              <div className="flex items-center gap-1.5 font-medium">
                                {on ? <ChevronDown className="size-3.5 shrink-0" /> : <ChevronRight className="size-3.5 shrink-0" />}
                                {s.model.name}
                              </div>
                              <div className="ml-5 font-mono text-[11px] text-muted-foreground">{s.model.id}</div>
                            </td>
                            <td className="px-3 py-2 text-xs text-muted-foreground">{s.providers.join(", ")}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{s.assets.length}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{s.picked} <span className="text-xs text-muted-foreground">{pct(s.picked, s.assets.length)}</span></td>
                            <td className="px-3 py-2 text-right tabular-nums">{s.rejected || "-"}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{s.inCut ? <Chip tone="good">{s.inCut}</Chip> : "-"}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{s.face?.toFixed(2) ?? "-"}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{s.voice?.toFixed(2) ?? "-"}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{s.costUsd ? `$${s.costUsd.toFixed(2)}` : "-"}</td>
                            <td className="px-3 py-2 text-right text-xs tabular-nums text-muted-foreground">{s.model.kind === "local" ? "local" : pct(s.recorded, s.steps)}</td>
                          </tr>
                          {on && (
                            <tr className="border-t bg-muted/10">
                              <td colSpan={10} className="px-3 py-3">
                                {visual.length > 0 ? (
                                  <div className="flex flex-wrap gap-1.5">
                                    {visual.slice(0, 60).map((a) => (
                                      <div key={a.id} className={cn("rounded p-0.5", picked.has(a.id) && "ring-1 ring-emerald-400/70")} title={a.label}>
                                        <Thumb asset={a} w={240} list={visual} className="aspect-video w-28" />
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <div className="text-xs text-muted-foreground">{list.map((a) => a.label).join(" · ")}</div>
                                )}
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}
