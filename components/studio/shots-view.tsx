"use client"

// Shots: the film in order, one compact line per shot (its picked take, whether the current cut shows it, issues and
// checks), grouped into scenes. Everything else about a shot (takes, keyframes, lines, graphics, checklist, card) lives
// in the detail pane of the one you select, so the list stays light however many takes pile up.

import { useParam } from "./url-state"
import { ChevronDown, ChevronRight, Network, Search, X } from "lucide-react"
import { memo, useMemo, useState } from "react"
import { CARD_FIELDS, type Asset, type CardKey, type Check, type ProjectWithRev, type ShotStatus } from "@/lib/model"
import { madeBy, type CutEntry, type ShotRow, type Summary } from "@/lib/derive"
import type { Op } from "@/lib/ops"
import { cn } from "@/lib/utils"
import { AudioButton, Chip, FaceChip, ModeChip, TakeChip, Thumb, VerdictChip, VoiceChip, fmt, posterUrl, useMedia } from "./media"

type Props = {
  project: ProjectWithRev
  rows: ShotRow[]
  sum: Summary
  current?: CutEntry
  op: (...o: Op[]) => Promise<void>
  onCanvas: (nodeId: string) => void
  onCut: (cutId: string) => void
}

const STATUSES: ShotStatus[] = ["planned", "shooting", "review", "approved"]
const whoTone: Record<string, string> = { henrick: "text-sky-300", founder: "text-amber-200", clerk: "text-rose-200", narrator: "text-violet-300" }
const shown = (r: ShotRow) => (r.shot.card_graphic ? r.graphics[0]?.preview : r.take)
const assets = (list: { asset?: Asset }[]) => list.map((x) => x.asset).filter((a): a is Asset => !!a)

export function ShotsView({ project: p, rows, sum, current, op, onCanvas, onCut }: Props) {
  // The open shot lives in the URL (?shot=2.4). Below the lg breakpoint the detail covers the list, so a phone
  // starts on the list unless the link names a shot.
  const [shotParam, setShotParam] = useParam("shot")
  const selected = shotParam && rows.some((r) => r.shot.id === shotParam) ? shotParam : typeof window !== "undefined" && window.matchMedia("(max-width: 1023px)").matches ? null : (rows[0]?.shot.id ?? null)
  const [scene, setScene] = useState<string>("")
  const [issuesOnly, setIssuesOnly] = useState(false)
  const [query, setQuery] = useState("")

  const select = (id: string | null) => setShotParam(id)

  const q = query.trim().toLowerCase()
  // Film order, in runs of the same section.
  const groups = useMemo(() => {
    const visible = rows.filter(
      (r) => (!scene || r.shot.section === scene) && (!issuesOnly || r.issues.length > 0) && (!q || `${r.shot.id} ${r.shot.name} ${r.location?.name ?? ""} ${r.lines.map((l) => l.text).join(" ")}`.toLowerCase().includes(q)),
    )
    const out: { key: string; section?: ShotRow["section"]; rows: ShotRow[] }[] = []
    for (const r of visible) {
      const last = out[out.length - 1]
      if (last && last.section?.id === r.section?.id) last.rows.push(r)
      else out.push({ key: `${r.section?.id}:${r.shot.id}`, section: r.section, rows: [r] })
    }
    return out
  }, [rows, scene, issuesOnly, q])
  const row = rows.find((r) => r.shot.id === selected)
  const sections = p.sections.filter((s) => rows.some((r) => r.shot.section === s.id))

  return (
    <div className="absolute inset-0 flex">
      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="sticky top-0 z-10 border-b bg-background/95 px-5 py-2.5 backdrop-blur">
          <div className="flex flex-wrap items-center gap-2">
            <Chip tone={sum.runtime && sum.runtime <= sum.target + 3 ? "good" : "warn"} title="Runtime of the current cut against the target">{current ? `${current.cut.version} runs ${sum.runtime ? fmt(sum.runtime) : "-"}` : "no cut yet"} / {sum.target}s</Chip>
            <Chip tone={sum.approved === sum.shots ? "good" : "muted"}>{sum.approved}/{sum.shots} approved</Chip>
            <Chip tone={sum.laidLines ? "bad" : "good"}>{sum.laidLines} lines not lip-synced</Chip>
            <Chip tone={sum.issues ? "warn" : "good"}>{sum.issues} issues</Chip>
            <div className="ml-auto flex items-center gap-1.5">
              <label className="flex items-center gap-1.5 rounded-md border bg-background px-2 py-1">
                <Search className="size-3.5 text-muted-foreground" />
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a shot or line" className="w-40 bg-transparent text-xs outline-none placeholder:text-muted-foreground" />
              </label>
              <button type="button" onClick={() => setIssuesOnly(!issuesOnly)} className={cn("rounded-md border px-2 py-1 text-xs", issuesOnly ? "border-amber-400/50 bg-amber-400/10 text-amber-200" : "text-muted-foreground hover:text-foreground")}>Issues only</button>
            </div>
          </div>
          <div className="mt-2 flex flex-wrap gap-1">
            <SceneTab on={!scene} onClick={() => setScene("")}>All scenes</SceneTab>
            {sections.map((s) => (
              <SceneTab key={s.id} on={scene === s.id} onClick={() => setScene(scene === s.id ? "" : s.id)} color={s.color}>{s.name}</SceneTab>
            ))}
          </div>
        </div>

        <div className="px-5 pt-3 pb-12">
          {p.open.length > 0 && (
            <Fold title="Open decisions" count={p.open.length} tone="text-amber-300">
              <ul className="space-y-1 pb-2 text-sm">{p.open.map((o) => <li key={o}>{o}</li>)}</ul>
            </Fold>
          )}
          <Fold title="Cast and look" count={p.characters.length + p.locations.length}>
            <Bible p={p} />
          </Fold>

          {groups.length === 0 && <div className="py-10 text-center text-sm text-muted-foreground">No shots match.</div>}
          {groups.map((g) => (
            <section key={g.key} className="mt-4">
              <div className="mb-1 flex items-baseline gap-2 px-2">
                <span className="size-2 shrink-0 rounded-full" style={{ background: g.section?.color }} />
                <h3 className="text-sm font-semibold">{g.section?.name ?? "No section"}</h3>
                <span className="min-w-0 truncate text-xs text-muted-foreground">{g.section?.purpose}</span>
              </div>
              <div className="space-y-0.5">
                {g.rows.map((r) => <ShotLine key={r.shot.id} r={r} version={current?.cut.version} on={r.shot.id === selected} onSelect={select} />)}
              </div>
            </section>
          ))}
        </div>
      </div>

      {row && (
        <aside className="absolute inset-0 z-20 overflow-y-auto bg-background lg:static lg:z-auto lg:w-[min(46%,640px)] lg:shrink-0 lg:border-l lg:bg-card/30">
          <ShotDetail key={row.shot.id} r={row} p={p} version={current?.cut.version} op={op} onClose={() => select(null)} onCanvas={onCanvas} onCut={() => current && onCut(current.cut.id)} />
        </aside>
      )}
    </div>
  )
}

function SceneTab({ on, onClick, color, children }: { on: boolean; onClick: () => void; color?: string; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={cn("flex items-center gap-1.5 rounded-md px-2 py-1 text-xs", on ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground")}>
      {color && <span className="size-2 rounded-full" style={{ background: color }} />}
      {children}
    </button>
  )
}

function Fold({ title, count, tone, children }: { title: string; count: number; tone?: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <section className="mb-1 rounded-lg border">
      <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs">
        {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        <span className={cn("font-semibold", tone)}>{title}</span>
        <span className="text-muted-foreground">{count}</span>
      </button>
      {open && <div className="border-t px-3 pt-2">{children}</div>}
    </section>
  )
}

/** Whether the current cut shows this shot's picked take. */
function CutState({ r, version }: { r: ShotRow; version?: string }) {
  if (!version) return null
  if (r.cutState === "in") return <Chip tone="good" title={`In the current cut ${version} at ${fmt(r.timing!.start)}`}>in {version} · {fmt(r.timing!.start)}</Chip>
  if (r.cutState === "older") return <Chip tone="warn" title={`The current cut ${version} still has an earlier take of this shot`}>{version} has an older take</Chip>
  return <Chip tone="muted" title={`Not in the current cut ${version}`}>not in {version}</Chip>
}

const ShotLine = memo(function ShotLine({ r, version, on, onSelect }: { r: ShotRow; version?: string; on: boolean; onSelect: (id: string) => void }) {
  const color = r.section?.color ?? "#64748b"
  const fails = r.issues.filter((i) => i.level === "fail").length
  return (
    <div role="button" tabIndex={0} onClick={() => onSelect(r.shot.id)} onKeyDown={(e) => e.key === "Enter" && onSelect(r.shot.id)}
      className={cn("flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 outline-none focus-visible:ring-2 focus-visible:ring-ring", on ? "bg-muted ring-1 ring-border" : "hover:bg-muted/40")}>
      <Thumb asset={shown(r)} w={240} list={r.shot.card_graphic ? undefined : assets(r.takes)} className="aspect-video w-24" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-sm font-semibold" style={{ color }}>{r.shot.id}</span>
          <span className="truncate text-sm font-medium">{r.shot.name}</span>
        </div>
        <div className="mt-0.5 truncate text-xs text-muted-foreground">
          {r.location?.name ?? (r.shot.card_graphic ? "Title card" : "No location")}
          {r.setup && ` · ${r.setup.id} ${r.setup.size} ${r.setup.lens} mm`}
          {r.lines.length > 0 && ` · ${r.lines.length} line${r.lines.length > 1 ? "s" : ""}`}
        </div>
      </div>
      <div className="hidden shrink-0 items-center gap-1.5 md:flex">
        <CutState r={r} version={version} />
        {r.issues.length > 0 && <Chip tone={fails ? "bad" : "warn"} title={r.issues.map((i) => i.text).join("\n")}>{r.issues.length} issue{r.issues.length > 1 ? "s" : ""}</Chip>}
      </div>
      <div className="hidden w-24 shrink-0 text-right text-xs text-muted-foreground xl:block">
        {r.takes.length} take{r.takes.length === 1 ? "" : "s"} · {r.checked.ok}/{r.checked.total}
      </div>
    </div>
  )
})

function ShotDetail({ r, p, version, op, onClose, onCanvas, onCut }: { r: ShotRow; p: ProjectWithRev; version?: string; op: Props["op"]; onClose: () => void; onCanvas: Props["onCanvas"]; onCut: () => void }) {
  const color = r.section?.color ?? "#64748b"
  const b = p.baselines
  const main = shown(r)
  const pickIt = (asset: string) => op({ op: "take.set", shot: r.shot.id, asset, verdict: "circled" })
  return (
    <div className="space-y-5 p-5">
      <div>
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-lg font-semibold" style={{ color }}>{r.shot.id}</span>
              <h2 className="truncate text-base font-semibold">{r.shot.name}</h2>
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              <span style={{ color }}>{r.section?.name}</span>
              {r.location && ` · ${r.location.name}`}
              {r.setup && ` · camera ${r.setup.id}, ${r.setup.name}, ${r.setup.size} ${r.setup.lens} mm`}
            </div>
          </div>
          <select value={r.shot.status} onChange={(e) => op({ op: "shot.update", id: r.shot.id, patch: { status: e.target.value as ShotStatus } })} className="rounded-md border bg-background px-2 py-1 text-xs" aria-label="Status">
            {STATUSES.map((s) => <option key={s}>{s}</option>)}
          </select>
          <button type="button" onClick={() => onCanvas(r.take ? `asset:${r.take.id}` : `shot:${r.shot.id}`)} title="Show on the canvas" className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"><Network className="size-4" /></button>
          <button type="button" onClick={onClose} title="Close" className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground lg:hidden"><X className="size-4" /></button>
        </div>
      </div>

      <div>
        <Player asset={main} />
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {version && <button type="button" onClick={onCut}><CutState r={r} version={version} /></button>}
          <VerdictChip verdict={main?.qa?.verdict} note={main?.qa?.note} />
          <FaceChip value={main?.scores?.face} target={b.faceTarget} baseline={b.face} />
          <VoiceChip value={main?.scores?.voice} baseline={b.voice} />
          {madeBy(main) && <Chip tone="muted" title="The models that made this take, in order">{madeBy(main)}</Chip>}
        </div>
        {main?.qa?.note && <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{main.qa.note}</p>}
        {r.issues.length > 0 && (
          <ul className="mt-2 space-y-1">
            {r.issues.map((i, k) => <li key={k} className={cn("text-xs leading-snug", i.level === "fail" ? "text-rose-300" : "text-amber-300")}>{i.level === "fail" ? "✗" : "!"} {i.text}</li>)}
          </ul>
        )}
      </div>

      {!r.shot.card_graphic && <Takes title="Takes" items={r.takes} onPick={pickIt} faceTarget={b.faceTarget} faceBase={b.face} />}
      <Takes title="Keyframes" items={r.keyframeTakes} onPick={pickIt} faceTarget={b.faceTarget} faceBase={b.face} />

      {r.lines.length > 0 && (
        <Block title="Dialogue">
          <div className="space-y-2.5">
            {r.lines.map((l, i) => (
              <div key={i}>
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm leading-snug">
                  <span className={cn("font-semibold", whoTone[l.who])}>{l.speaker?.name ?? l.who}</span>
                  <span className="min-w-0">{l.text}</span>
                  <ModeChip mode={l.mode} />
                </div>
                {l.audioAsset && <AudioButton asset={l.audioAsset} className="mt-1 max-w-sm" />}
              </div>
            ))}
          </div>
        </Block>
      )}

      {r.graphics.length > 0 && (
        <Block title="Graphics">
          <div className="grid grid-cols-2 gap-2">
            {r.graphics.map((g, i) => (
              <div key={i}>
                <Thumb asset={g.preview} w={480} className="aspect-video w-full" />
                <div className="mt-1 text-xs text-muted-foreground">{g.g?.label} · at {fmt(g.at)} for {fmt(g.dur)}</div>
              </div>
            ))}
          </div>
        </Block>
      )}

      <Block title={`Checklist ${r.checked.ok}/${r.checked.total}`}>
        <div className="flex flex-wrap gap-1.5">
          {r.checks.map((c) => (
            <button key={c.key} type="button" title={`${c.hint}${c.check?.note ? `\n\n${c.check.note}` : ""}${c.check?.by ? `\n(${c.check.by})` : ""}`}
              onClick={() => op({ op: "check.set", shot: r.shot.id, key: c.key, ok: next(c.check), by: "claudio" })}
              className={cn("rounded-md border px-2 py-1 text-xs", c.check?.ok === true ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-300" : c.check?.ok === false ? "border-rose-400/40 bg-rose-400/10 text-rose-300" : "text-muted-foreground hover:text-foreground")}>
              {c.check?.ok === true ? "✓ " : c.check?.ok === false ? "✗ " : ""}{c.label}
            </button>
          ))}
        </div>
      </Block>

      <Block title="Shot card">
        <div className="grid gap-3 sm:grid-cols-2">
          {CARD_FIELDS.map((f) => <CardField key={f.key} shot={r.shot.id} field={f.key} label={f.label} value={r.shot.card[f.key] ?? ""} op={op} />)}
        </div>
      </Block>
    </div>
  )
}

/** The picked take, playable in place: a poster until you press play, so selecting a shot loads no video. */
function Player({ asset }: { asset?: Asset }) {
  const { mtimes } = useMedia()
  if (!asset) return <div className="grid aspect-video w-full place-items-center rounded-lg bg-muted text-sm text-muted-foreground">No take yet</div>
  if (asset.media === "video")
    return <video key={asset.id} src={asset.path} poster={posterUrl(asset, 1280, mtimes)} controls preload="none" playsInline className="aspect-video w-full rounded-lg bg-black" />
  return <Thumb asset={asset} w={1280} className="aspect-video w-full rounded-lg" fit="contain" />
}

function Takes({ title, items, onPick, faceTarget, faceBase }: { title: string; items: ShotRow["takes"]; onPick: (asset: string) => void; faceTarget: number; faceBase: number }) {
  if (items.length === 0) return null
  const list = assets(items)
  return (
    <Block title={`${title} ${items.length}`}>
      <div className="grid grid-cols-3 gap-2">
        {items.map(({ take, asset }) => (
          <div key={take.asset} className={cn("rounded-md border p-1", take.verdict === "circled" ? "border-emerald-400/60" : take.verdict === "reject" && "opacity-60")}>
            <Thumb asset={asset} w={320} list={list} className="aspect-video w-full" />
            <div className="mt-1 flex items-center gap-1">
              <TakeChip verdict={take.verdict} />
              <FaceChip value={asset?.scores?.face} target={faceTarget} baseline={faceBase} />
              {take.verdict !== "circled" && <button type="button" onClick={() => onPick(take.asset)} className="ml-auto rounded px-1 text-[11px] text-sky-300 hover:bg-sky-400/10">Pick</button>}
            </div>
            {take.note && <div className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-muted-foreground" title={take.note}>{take.note}</div>}
          </div>
        ))}
      </div>
    </Block>
  )
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">{title}</h3>
      {children}
    </section>
  )
}

const next = (c?: Check): boolean | null => (c?.ok === undefined || c.ok === null ? true : c.ok === true ? false : null)

function CardField({ shot, field, label, value, op }: { shot: string; field: CardKey; label: string; value: string; op: Props["op"] }) {
  const [v, setV] = useState(value)
  // A new value from the project (another agent's edit) replaces the draft.
  const [base, setBase] = useState(value)
  if (base !== value) {
    setBase(value)
    setV(value)
  }
  return (
    <label className="block">
      <div className="mb-1 text-[11px] font-medium text-muted-foreground">{label}</div>
      <textarea value={v} onChange={(e) => setV(e.target.value)} onBlur={() => v !== value && op({ op: "shot.card", id: shot, field, value: v })}
        placeholder="Not specified" rows={3} className="w-full resize-y rounded-md border bg-background/60 px-2 py-1.5 text-xs leading-snug outline-none focus:border-sky-400/60" />
    </label>
  )
}

/** The cast (real anchors and sheets, voice) and each location's look, for reference while reviewing. */
function Bible({ p }: { p: ProjectWithRev }) {
  const { assets: all } = useMedia()
  const get = (ids: string[]) => ids.map((id) => all.get(id)).filter((a): a is Asset => !!a)
  return (
    <div className="grid gap-4 pb-3 xl:grid-cols-2">
      <div className="space-y-3">
        {p.characters.map((c) => {
          const refs = get([...c.anchors, ...c.sheets])
          return (
            <div key={c.id} className="flex gap-3">
              <div className="w-24 shrink-0">
                <div className={cn("text-sm font-semibold", whoTone[c.id])}>{c.name}</div>
                <div className="text-[11px] text-muted-foreground">{c.role}</div>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap gap-1.5">{refs.slice(0, 8).map((a) => <Thumb key={a.id} asset={a} w={160} list={refs} className="size-12" />)}</div>
                <div className="mt-1 text-[11px] text-muted-foreground">Voice: {c.voice?.engine}{c.voice?.voiceId ? ` · ${c.voice.voiceId.replace(/^higgsfield:/, "Higgsfield clone ")}` : ""}{c.voice?.note ? ` · ${c.voice.note}` : ""}</div>
              </div>
            </div>
          )
        })}
      </div>
      <div className="space-y-3">
        {p.locations.map((l) => {
          const refs = get([...l.style, ...l.gradeRef])
          return (
            <div key={l.id} className="flex gap-3">
              <div className="w-28 shrink-0">
                <div className="text-sm font-semibold">{l.name}</div>
                <div className="mt-1 flex gap-1">{l.look.palette.map((c) => <span key={c} className="size-4 rounded-sm border" style={{ background: c }} title={c} />)}</div>
              </div>
              <div className="min-w-0 flex-1 text-[11px] leading-snug text-muted-foreground">
                {l.look.concept && <div className="mb-1 text-xs text-foreground">{l.look.concept}</div>}
                {l.look.never && <div><b className="text-rose-300">Never</b> {l.look.never.join(", ")}</div>}
                <div><b className="text-foreground">Light</b> {l.look.light}. <b className="text-foreground">Lens</b> {l.look.lens}.</div>
                {refs.length > 0 && <div className="mt-1.5 flex flex-wrap gap-1.5">{refs.map((a) => <Thumb key={a.id} asset={a} w={160} list={refs} className="h-10 w-16" />)}</div>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
