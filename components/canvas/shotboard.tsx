"use client"

import { Play } from "lucide-react"
import type { AppNode, Edge, GenNode, MotionNode, Shot, Story } from "@/lib/graph"
import { cn } from "@/lib/utils"

const sectionColor = (story: Story, id: string) => story.sections.find((s) => s.id === id)?.color ?? "#64748b"
const verdictCls = { pass: "bg-emerald-400/15 text-emerald-300", borderline: "bg-amber-400/15 text-amber-300", fail: "bg-rose-400/15 text-rose-300" }
const whoCls: Record<string, string> = { Henrick: "text-sky-300", Founder: "text-amber-200", Clerk: "text-rose-200", Narrator: "text-violet-300" }
const kindTag: Record<string, string> = { real: "real recording", clone: "cloned", preset: "ElevenLabs", seedance: "Seedance voice ref" }

export function ShotBoard({ story, nodes, onFocus, onWatch }: { story: Story; nodes: AppNode[]; edges: Edge[]; onFocus: (id: string) => void; onWatch: () => void }) {
  const by = (id: string) => nodes.find((n) => n.id === id)
  const gen = (id: string) => by(id) as GenNode | undefined
  const shots = story.shots ?? []
  const m = story.metrics
  const fin = nodes.find((n) => n.type === "final")
  const faceChip = (f?: number) =>
    f == null || !m ? null : (
      <span className={cn("rounded px-1.5 py-0.5 font-mono text-[10px]", f >= m.faceTarget ? "bg-emerald-400/15 text-emerald-300" : f >= 0.6 ? "bg-amber-400/15 text-amber-300" : "bg-rose-400/15 text-rose-300")} title={`ArcFace similarity to real Henrick. Real vs real: ${m.faceBaseline}. Target: ${m.faceTarget}.`}>face {f.toFixed(2)}</span>
    )

  return (
    <div className="absolute inset-0 overflow-auto bg-background">
      <div className="mx-auto max-w-[1500px] px-6 pt-20 pb-10">
        <div className="mb-5 flex flex-wrap items-center gap-4">
          <div>
            <div className="text-2xl font-semibold tracking-tight">{story.title}</div>
            <div className="mt-1 max-w-3xl text-sm text-muted-foreground">{story.logline}</div>
          </div>
          {fin && (
            <button onClick={onWatch} className="ml-auto flex items-center gap-2 rounded-xl bg-emerald-400 px-4 py-2.5 text-sm font-bold text-emerald-950 hover:bg-emerald-300">
              <Play className="size-4" /> Watch final cut <span className="font-mono text-xs opacity-70">{(fin.data as { version: string }).version}</span>
            </button>
          )}
        </div>
        {m && (
          <div className="mb-5 flex flex-wrap gap-x-6 gap-y-1 rounded-lg border bg-card px-4 py-2 text-xs text-muted-foreground">
            <span>Face match: real vs real <b className="text-foreground">{m.faceBaseline}</b>, target <b className="text-foreground">{m.faceTarget}</b></span>
            <span>Voice match: real vs real <b className="text-foreground">{m.voiceBaseline}</b></span>
            <span>Green means at target, amber within reach, red needs work. QA verdicts come from the frame-by-frame audit card.</span>
          </div>
        )}
        <div className="grid grid-cols-[170px_150px_230px_300px_minmax(260px,1fr)_190px] gap-x-3 px-1 pb-2 text-[10px] tracking-widest text-muted-foreground uppercase">
          <div>Shot</div><div>References</div><div>Keyframe</div><div>Clip</div><div>Dialogue and voice</div><div>Graphics</div>
        </div>
        <div className="space-y-3">
          {shots.map((s: Shot) => {
            const color = sectionColor(story, s.section)
            const kf = gen(s.keyframe), cl = gen(s.clip)
            return (
              <div key={s.id} className="grid grid-cols-[170px_150px_230px_300px_minmax(260px,1fr)_190px] gap-x-3 rounded-xl border bg-card p-3" style={{ borderLeft: `4px solid ${color}` }}>
                <div>
                  <div className="flex items-baseline gap-2"><span className="font-mono text-xl font-semibold" style={{ color }}>{s.id}</span><span className="text-[11px] text-muted-foreground">{s.time}</span></div>
                  <div className="mt-0.5 text-sm font-medium">{s.name}</div>
                  <div className="mt-1 text-[10px] tracking-wide uppercase" style={{ color }}>{s.section}</div>
                  {s.note && <div className="mt-2 text-[11px] leading-snug text-muted-foreground">{s.note}</div>}
                </div>
                <div className="flex flex-wrap content-start gap-1.5">
                  {s.refs.map((r) => { const n = by(r); const u = (n?.data as { url?: string } | undefined)?.url; return (
                    <button key={r} onClick={() => onFocus(r)} className="size-12 overflow-hidden rounded-md border bg-muted" title={(n?.data as { title?: string })?.title}>
                      {u && /* eslint-disable-next-line @next/next/no-img-element */ <img src={u} alt="" className="size-full object-cover" />}
                    </button>) })}
                </div>
                <button onClick={() => onFocus(s.keyframe)} className="text-left">
                  <div className="aspect-video overflow-hidden rounded-md border bg-muted">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {kf?.data.url ? <img src={kf.data.url} alt="" className="size-full object-cover" /> : <div className="grid size-full place-items-center text-[11px] text-muted-foreground">{kf?.data.status === "running" ? "generating…" : "not generated"}</div>}
                  </div>
                  <div className="mt-1.5 flex items-center gap-1.5">{faceChip(kf?.data.face)}{s.alts && s.alts.length > 0 && <span className="text-[10px] text-muted-foreground">+{s.alts.length} variants</span>}</div>
                </button>
                <div>
                  <div className="aspect-video overflow-hidden rounded-md border bg-muted">
                    {cl?.data.video ? <video src={cl.data.video} poster={cl.data.url} controls muted loop playsInline preload="metadata" className="size-full object-cover" /> : <div className="grid size-full place-items-center text-[11px] text-muted-foreground">{cl?.data.status === "running" ? "rendering…" : "no clip yet"}</div>}
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    {cl?.data.qa && <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium uppercase", verdictCls[cl.data.qa.verdict])}>{cl.data.qa.verdict}</span>}
                    {faceChip(cl?.data.face)}
                    <button onClick={() => onFocus(s.clip)} className="ml-auto text-[10px] text-muted-foreground underline-offset-2 hover:underline">open</button>
                  </div>
                  {cl?.data.qa && <div className="mt-1 text-[11px] leading-snug text-muted-foreground">{cl.data.qa.note}</div>}
                </div>
                <div className="space-y-1.5">
                  {s.lines.map((l, i) => (
                    <div key={i} className="text-[13px] leading-snug">
                      <span className={cn("font-semibold", whoCls[l.who] ?? "")}>{l.who}</span>
                      <span className="text-muted-foreground"> · </span>
                      <span>{l.text}</span>
                      {l.kind && <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{kindTag[l.kind]}</span>}
                    </div>
                  ))}
                </div>
                <div className="space-y-2">
                  {(s.graphics ?? []).map((g) => { const n = by(g) as MotionNode | undefined; if (!n) return null; return (
                    <button key={g} onClick={() => onFocus(g)} className="block w-full text-left">
                      {n.data.video && <video src={n.data.video} autoPlay loop muted playsInline className="aspect-video w-full rounded border bg-[#0b0d0f]" />}
                      <div className="mt-0.5 text-[11px] leading-tight text-muted-foreground">{n.data.title}</div>
                    </button>) })}
                  {(s.graphics ?? []).length === 0 && <div className="text-[11px] text-muted-foreground">none</div>}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
