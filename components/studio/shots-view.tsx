"use client"

import { Play } from "lucide-react"
import { useEffect, useState } from "react"
import { CARD_FIELDS, type CardKey, type Check, type ProjectWithRev, type ShotStatus } from "@/lib/model"
import type { Index, ShotRow, Summary } from "@/lib/derive"
import type { Op } from "@/lib/ops"
import { cn } from "@/lib/utils"
import { Chip, FaceChip, ModeChip, TakeChip, Thumb, VerdictChip, VoiceChip, fmt } from "./media"

type Props = { project: ProjectWithRev; ix: Index; rows: ShotRow[]; sum: Summary; op: (...o: Op[]) => Promise<void>; onWatch: () => void; onFocus: (nodeId: string) => void }

const STATUSES: ShotStatus[] = ["planned", "shooting", "review", "approved"]
const whoTone: Record<string, string> = { henrick: "text-sky-300", founder: "text-amber-200", clerk: "text-rose-200", narrator: "text-violet-300" }

export function ShotsView({ project: p, ix, rows, sum, op, onWatch, onFocus }: Props) {
  return (
    <div className="absolute inset-0 overflow-auto bg-background">
      <div className="mx-auto max-w-[1560px] px-6 pt-20 pb-24">
        <header className="flex flex-wrap items-start gap-6">
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-semibold tracking-tight">{p.title}</h1>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{p.logline}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Chip tone={sum.runtime && sum.runtime <= sum.target + 3 ? "good" : "warn"}>runtime {sum.runtime ? fmt(sum.runtime) : "-"} / target {sum.target}s</Chip>
              <Chip tone={sum.approved === sum.shots ? "good" : "muted"}>{sum.approved}/{sum.shots} shots approved</Chip>
              <Chip tone={sum.laidLines ? "bad" : "good"}>{sum.laidLines} lines not lip-synced</Chip>
              <Chip tone={sum.issues ? "warn" : "good"}>{sum.issues} open issues</Chip>
            </div>
          </div>
          {p.cuts[0] && (
            <button onClick={onWatch} className="flex items-center gap-2 rounded-xl bg-emerald-400 px-4 py-2.5 text-sm font-bold text-emerald-950 hover:bg-emerald-300">
              <Play className="size-4" /> Watch final cut <span className="font-mono text-xs opacity-70">{p.cuts[0].version}</span>
            </button>
          )}
        </header>

        {p.open.length > 0 && (
          <section className="mt-5 rounded-lg border border-amber-400/30 bg-amber-400/5 px-4 py-3">
            <div className="text-[11px] font-semibold tracking-widest text-amber-300 uppercase">Open decisions</div>
            <ul className="mt-1.5 space-y-1 text-sm">{p.open.map((o) => <li key={o}>{o}</li>)}</ul>
          </section>
        )}

        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          <section className="rounded-xl border bg-card p-4">
            <div className="text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">Cast</div>
            <div className="mt-3 space-y-3">
              {p.characters.map((c) => (
                <div key={c.id} className="flex gap-3">
                  <div className="w-24 shrink-0">
                    <div className={cn("text-sm font-semibold", whoTone[c.id])}>{c.name}</div>
                    <div className="text-[11px] text-muted-foreground">{c.role}</div>
                  </div>
                  <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
                    {[...c.anchors.slice(0, 4), ...c.sheets.slice(0, 2)].map((a) => (
                      <button key={a} onClick={() => onFocus(`asset:${a}`)} title={ix.assets.get(a)?.label}><Thumb asset={ix.assets.get(a)} className="size-12 rounded" /></button>
                    ))}
                    <div className="min-w-0 basis-full text-[11px] text-muted-foreground">
                      Voice: {c.voice?.engine}{c.voice?.voiceId ? ` · ${c.voice.voiceId.replace(/^higgsfield:/, "Higgsfield clone ")}` : ""}{c.voice?.note ? ` · ${c.voice.note}` : ""}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
          <section className="rounded-xl border bg-card p-4">
            <div className="text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">Look bible</div>
            <div className="mt-3 space-y-3">
              {p.locations.map((l) => (
                <div key={l.id} className="flex gap-3">
                  <div className="w-28 shrink-0">
                    <div className="text-sm font-semibold">{l.name}</div>
                    <div className="mt-1 flex gap-1">{l.look.palette.map((c) => <span key={c} className="size-4 rounded-sm border" style={{ background: c }} title={c} />)}</div>
                  </div>
                  <div className="min-w-0 flex-1 text-[11px] leading-snug text-muted-foreground">
                    {l.look.concept && <div className="mb-1 text-[12px] text-foreground">{l.look.concept}</div>}
                    {l.look.references && <div><b className="text-foreground">References</b> {l.look.references}</div>}
                    {l.look.storyProps && <div><b className="text-foreground">Story props</b> {l.look.storyProps.join(", ")}</div>}
                    {l.look.never && <div><b className="text-rose-300">Never</b> {l.look.never.join(", ")}</div>}
                    <div><b className="text-foreground">Light</b> {l.look.light}. <b className="text-foreground">Lens</b> {l.look.lens}.</div>
                    <div><b className="text-foreground">Contrast</b> {l.look.contrast}. <b className="text-foreground">Grain</b> {l.look.grain}.</div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      {l.style.length === 0 && <Chip tone="warn">no set plate yet</Chip>}
                      {l.style.map((a) => <Thumb key={a} asset={ix.assets.get(a)} className="h-10 w-16 rounded" />)}
                      {l.gradeRef.length > 0 && <span className="ml-1">grade matched to</span>}
                      {l.gradeRef.map((a) => <Thumb key={a} asset={ix.assets.get(a)} className="h-10 w-16 rounded" />)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>

        <div className="mt-6 space-y-3">
          {rows.map((r) => <ShotCardRow key={r.shot.id} r={r} p={p} op={op} onFocus={onFocus} />)}
        </div>
      </div>
    </div>
  )
}

function ShotCardRow({ r, p, op, onFocus }: { r: ShotRow; p: ProjectWithRev; op: Props["op"]; onFocus: Props["onFocus"] }) {
  const color = r.section?.color ?? "#64748b"
  const b = p.baselines
  return (
    <article className="rounded-xl border bg-card" style={{ borderLeft: `4px solid ${color}` }}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-2.5">
        <span className="font-mono text-lg font-semibold" style={{ color }}>{r.shot.id}</span>
        <span className="text-sm font-medium">{r.shot.name}</span>
        <span className="text-[11px] tracking-wide uppercase" style={{ color }}>{r.section?.name}</span>
        {r.location && <span className="text-[11px] text-muted-foreground">{r.location.name}</span>}
        {r.timing && <span className="font-mono text-[11px] text-muted-foreground">{fmt(r.timing.start)} to {fmt(r.timing.start + r.timing.dur)} in {p.cuts[0]?.version}</span>}
        <select value={r.shot.status} onChange={(e) => op({ op: "shot.update", id: r.shot.id, patch: { status: e.target.value as ShotStatus } })} className="ml-auto rounded-md border bg-background px-2 py-1 text-xs">
          {STATUSES.map((s) => <option key={s}>{s}</option>)}
        </select>
      </div>

      <div className="grid gap-4 p-4 xl:grid-cols-[220px_340px_minmax(0,1fr)_200px]">
        <div>
          <Label>Keyframe</Label>
          <button onClick={() => r.keyframe && onFocus(`asset:${r.keyframe.id}`)} className="block w-full">
            <Thumb asset={r.keyframe ?? (r.shot.card_graphic ? undefined : undefined)} className="aspect-video w-full rounded-md" />
          </button>
          <div className="mt-1.5 flex flex-wrap gap-1.5"><FaceChip value={r.keyframe?.scores?.face} target={b.faceTarget} baseline={b.face} /></div>
          <Alts items={r.keyframeTakes} onPick={(a) => op({ op: "take.set", shot: r.shot.id, asset: a, verdict: "circled" })} />
        </div>
        <div>
          <Label>Take</Label>
          {r.shot.card_graphic ? (
            <Thumb asset={r.graphics[0]?.preview ?? undefined} className="aspect-video w-full rounded-md" autoPlay />
          ) : (
            <Thumb asset={r.take} className="aspect-video w-full rounded-md" controls />
          )}
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <VerdictChip verdict={r.take?.qa?.verdict} note={r.take?.qa?.note} />
            <FaceChip value={r.take?.scores?.face} target={b.faceTarget} baseline={b.face} />
            <VoiceChip value={r.take?.scores?.voice} baseline={b.voice} />
            {r.take?.gen?.model && <Chip tone="muted">{r.take.gen.model.split(",")[0]}</Chip>}
          </div>
          {r.take?.qa?.note && <div className="mt-1 text-[11px] leading-snug text-muted-foreground">{r.take.qa.note}</div>}
          <Alts items={r.takes} onPick={(a) => op({ op: "take.set", shot: r.shot.id, asset: a, verdict: "circled" })} />
        </div>
        <div className="min-w-0">
          <Label>Dialogue</Label>
          {r.lines.length === 0 && <div className="text-sm text-muted-foreground">No lines</div>}
          <div className="space-y-2">
            {r.lines.map((l, i) => (
              <div key={i}>
                <div className="flex flex-wrap items-center gap-2 text-sm leading-snug">
                  <span className={cn("font-semibold", whoTone[l.who])}>{l.speaker?.name ?? l.who}</span>
                  <span className="min-w-0">{l.text}</span>
                  <ModeChip mode={l.mode} />
                </div>
                {l.audioAsset && <audio src={l.audioAsset.path} controls preload="none" className="mt-1 h-7 w-full max-w-sm" />}
              </div>
            ))}
          </div>
          {r.issues.length > 0 && (
            <div className="mt-3 space-y-1">
              {r.issues.map((i, k) => <div key={k} className={cn("text-[12px] leading-snug", i.level === "fail" ? "text-rose-300" : "text-amber-300")}>{i.level === "fail" ? "✗" : "!"} {i.text}</div>)}
            </div>
          )}
        </div>
        <div>
          <Label>Graphics</Label>
          {r.graphics.length === 0 && <div className="text-sm text-muted-foreground">None</div>}
          <div className="space-y-2">
            {r.graphics.map((g, i) => (
              <div key={i}>
                <Thumb asset={g.preview} className="aspect-video w-full rounded border" autoPlay />
                <div className="mt-0.5 text-[11px] leading-tight text-muted-foreground">{g.g?.label} · at {fmt(g.at)} for {fmt(g.dur)}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-3 border-t px-4 py-3 md:grid-cols-3 xl:grid-cols-6">
        {CARD_FIELDS.map((f) => <CardField key={f.key} shot={r.shot.id} field={f.key} label={f.label} value={r.shot.card[f.key] ?? ""} op={op} />)}
      </div>

      <div className="flex flex-wrap items-center gap-1.5 border-t px-4 py-2.5">
        <span className="mr-1 text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">Checklist {r.checked.ok}/{r.checked.total}</span>
        {r.checks.map((c) => (
          <button key={c.key} title={`${c.hint}${c.check?.note ? `\n\n${c.check.note}` : ""}${c.check?.by ? `\n(${c.check.by})` : ""}`}
            onClick={() => op({ op: "check.set", shot: r.shot.id, key: c.key, ok: next(c.check), by: "claudio" })}
            className={cn("rounded-md border px-2 py-1 text-[11px]", c.check?.ok === true ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-300" : c.check?.ok === false ? "border-rose-400/40 bg-rose-400/10 text-rose-300" : "text-muted-foreground")}>
            {c.check?.ok === true ? "✓ " : c.check?.ok === false ? "✗ " : ""}{c.label}
          </button>
        ))}
      </div>
    </article>
  )
}

const next = (c?: Check): boolean | null => (c?.ok === undefined || c.ok === null ? true : c.ok === true ? false : null)

function Label({ children }: { children: React.ReactNode }) {
  return <div className="mb-1.5 text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">{children}</div>
}

function Alts({ items, onPick }: { items: ShotRow["takes"]; onPick: (asset: string) => void }) {
  if (items.length <= 1) return null
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {items.map(({ take, asset }) => (
        <button key={take.asset} onClick={() => take.verdict !== "circled" && onPick(take.asset)} title={`${asset?.label ?? take.asset}${take.note ? `: ${take.note}` : ""}`}
          className={cn("relative overflow-hidden rounded border", take.verdict === "circled" ? "border-emerald-400" : take.verdict === "reject" ? "border-rose-400/50 opacity-50" : "border-border opacity-80 hover:opacity-100")}>
          <Thumb asset={asset} className="h-9 w-16" />
          <span className="absolute right-0 bottom-0"><TakeChip verdict={take.verdict} /></span>
        </button>
      ))}
    </div>
  )
}

function CardField({ shot, field, label, value, op }: { shot: string; field: CardKey; label: string; value: string; op: Props["op"] }) {
  const [v, setV] = useState(value)
  useEffect(() => setV(value), [value])
  return (
    <label className="block">
      <div className="mb-1 text-[11px] font-semibold tracking-wide text-muted-foreground">{label}</div>
      <textarea value={v} onChange={(e) => setV(e.target.value)} onBlur={() => v !== value && op({ op: "shot.card", id: shot, field, value: v })}
        placeholder="Not specified" rows={3} className="w-full resize-y rounded-md border bg-background/60 px-2 py-1.5 text-[12px] leading-snug outline-none focus:border-sky-400/60" />
    </label>
  )
}
