"use client"

// Process: one stage at a time. A plain stepper of the eight stages, then the stage's work in one readable column,
// then one decision bar: approve, request changes or reject, with a note. Comments sit on the beat they are about.
// Every action is a named op (lib/ops.ts), the same ones agents use from the CLI (`stitch gates`, `stitch feedback`).

import { ChevronDown, Lock } from "lucide-react"
import { useState } from "react"
import type { ProjectWithRev } from "@/lib/model"
import type { Op } from "@/lib/ops"
import { GATE_LABEL, blockedBy, currentStage, openNotes, runtime, words, type Beat, type Candidate, type Concept, type GateStatus, type Note, type Process, type SheetItem, type SheetKind, type Stage, type StageId } from "@/lib/process"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { projectSlug } from "./use-project"

const ME = "Claudio"
type Props = { project: ProjectWithRev; op: (...o: Op[]) => Promise<void> }
type State = GateStatus | "skipped" | "locked"

const tc = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`
const when = (iso: string) => new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })

const stateOf = (pr: Process, s: Stage): State => (s.skipped ? "skipped" : blockedBy(pr, s.id) && s.status === "pending" ? "locked" : s.status)
const dot: Record<State, string> = {
  pending: "bg-amber-500",
  approved: "bg-emerald-500",
  changes: "bg-sky-500",
  rejected: "bg-rose-500",
  skipped: "bg-muted-foreground/40",
  locked: "bg-muted-foreground/40",
}
const label = (st: State) => (st === "skipped" ? "Skipped" : st === "locked" ? "Locked" : GATE_LABEL[st])

export function ProcessView({ project: p, op }: Props) {
  const pr = p.process!
  const [sel, setSel] = useState<StageId>(() => currentStage(pr)?.id ?? "script")
  const stage = pr.stages.find((s) => s.id === sel)!
  return (
    <div className="flex h-full flex-col">
      <Stepper pr={pr} sel={sel} onSelect={setSel} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-6 pt-10 pb-12">{sel === "script" ? <ScriptStage pr={pr} op={op} /> : sel === "sheets" && !blockedBy(pr, "sheets") ? <SheetsStage pr={pr} stage={stage} op={op} /> : <OtherStage pr={pr} stage={stage} op={op} />}</div>
      </div>
      <DecisionBar pr={pr} stage={stage} op={op} />
    </div>
  )
}

function Stepper({ pr, sel, onSelect }: { pr: Process; sel: StageId; onSelect: (s: StageId) => void }) {
  return (
    <nav aria-label="Stages" className="flex shrink-0 items-center gap-1 overflow-x-auto border-b px-4 py-2">
      {pr.stages.map((s, i) => {
        const st = stateOf(pr, s)
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => onSelect(s.id)}
            aria-current={sel === s.id ? "step" : undefined}
            title={`${s.name}: ${label(st)}`}
            className={cn("flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm whitespace-nowrap", sel === s.id ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:text-foreground")}
          >
            <span className="font-mono text-xs">{String(i + 1).padStart(2, "0")}</span>
            {s.name}
            {st === "locked" ? <Lock className="size-3" /> : <span className={cn("size-1.5 rounded-full", dot[st])} />}
          </button>
        )
      })}
    </nav>
  )
}

function Eyebrow({ pr, stage }: { pr: Process; stage: Stage }) {
  const i = pr.stages.indexOf(stage)
  return <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Stage {i + 1} of {pr.stages.length}</p>
}

function ScriptStage({ pr, op }: { pr: Process; op: Props["op"] }) {
  const picked = pr.concepts.find((c) => c.id === pr.pick)
  const beats = picked && pr.script.concept === picked.id ? pr.script.beats : []
  const stageNotes = pr.notes.filter((n) => n.target === "stage:script" || n.target.startsWith("concept:"))
  return (
    <article className="space-y-10">
      <header className="space-y-2">
        <Eyebrow pr={pr} stage={pr.stages[0]} />
        <h1 className="text-3xl font-semibold tracking-tight">{picked ? picked.title : "Pick a concept"}</h1>
        <p className="text-[15px] leading-relaxed text-muted-foreground">{picked ? picked.logline : "Three ways to make this film. Pick one, then read its script and decide."}</p>
        {picked && (
          <p className="text-sm text-muted-foreground">
            Concept {picked.id}
            {beats.length > 0 && <> · {beats.length} beats · {tc(runtime(beats))} · {words(beats)} words · draft {pr.script.version}</>}
            {" · "}
            <button type="button" className="underline underline-offset-2 hover:text-foreground" onClick={() => op({ op: "concept.pick", id: null, by: ME })}>
              change concept
            </button>
            {beats.length > 0 && (
              <>
                {" · "}
                <a href={`/api/script-pdf${projectSlug() ? `?p=${encodeURIComponent(projectSlug())}` : ""}`} className="underline underline-offset-2 hover:text-foreground">
                  download PDF
                </a>
              </>
            )}
          </p>
        )}
      </header>

      {picked && beats.length > 0 && pr.cast?.length ? <CastList pr={pr} /> : null}

      {!picked ? (
        <div className="space-y-4">
          {pr.concepts.map((c) => (
            <ConceptOption key={c.id} c={c} onPick={() => op({ op: "concept.pick", id: c.id, by: ME }, ...(c.hasScript ? [] : [{ op: "note.add" as const, target: "stage:script", text: `Write the beat sheet for concept ${c.id}, ${c.title}.`, by: ME }]))} />
          ))}
        </div>
      ) : beats.length ? (
        <ol className="space-y-8">
          {beats.map((b) => (
            <BeatBlock key={b.id} b={b} notes={pr.notes.filter((n) => n.target === `beat:${b.id}`)} op={op} />
          ))}
        </ol>
      ) : (
        <p className="text-[15px] text-muted-foreground">The script for this concept is being written. It appears here when it is ready for you.</p>
      )}

      {stageNotes.length > 0 && (
        <section className="space-y-3 border-t pt-6">
          <h2 className="text-sm font-medium">Notes on the script</h2>
          {stageNotes.map((n) => (
            <NoteLine key={n.id} n={n} op={op} />
          ))}
        </section>
      )}
    </article>
  )
}

function CastList({ pr }: { pr: Process }) {
  return (
    <section className="space-y-4">
      <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Cast</h2>
      <dl className="space-y-4">
        {pr.cast!.map((c) => (
          <div key={c.id} className="grid grid-cols-[3.5rem_minmax(0,1fr)] gap-x-4">
            <span />
            <div className="space-y-1">
              <dt className="text-xs font-semibold tracking-wider uppercase">{c.name}</dt>
              <dd className="text-[15px] leading-relaxed">{c.who}</dd>
              <dd className="text-sm text-muted-foreground">
                {c.playedBy} · {c.voice}
                {c.states && c.states.length > 1 && <> · {c.states.length} looks: {c.states.join("; ").toLowerCase()}</>}
              </dd>
            </div>
          </div>
        ))}
      </dl>
    </section>
  )
}

function ConceptOption({ c, onPick }: { c: Concept; onPick: () => void }) {
  const [more, setMore] = useState(false)
  return (
    <section className="space-y-3 rounded-lg border p-5">
      <div className="flex items-baseline gap-3">
        <span className="font-mono text-xs text-muted-foreground">{c.id}</span>
        <h2 className="text-lg font-semibold">{c.title}</h2>
      </div>
      <p className="text-[15px] leading-relaxed">{c.logline}</p>
      <p className="text-[15px] leading-relaxed text-muted-foreground">{c.best}</p>
      {more && (
        <div className="space-y-2 text-sm leading-relaxed text-muted-foreground">
          <p>{c.pitch}</p>
          <p><span className="text-foreground">Ends on</span> {c.button}</p>
          <p><span className="text-foreground">Why</span> {c.why}</p>
          <p><span className="text-foreground">Risk</span> {c.risk}</p>
        </div>
      )}
      <div className="flex items-center gap-4 pt-1">
        <Button size="sm" onClick={onPick}>Pick {c.id}</Button>
        <button type="button" onClick={() => setMore((m) => !m)} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          {more ? "Less" : "More"} <ChevronDown className={cn("size-3.5 transition-transform", more && "rotate-180")} />
        </button>
        {!c.hasScript && <span className="text-sm text-muted-foreground">Script not written yet</span>}
      </div>
    </section>
  )
}

function BeatBlock({ b, notes, op }: { b: Beat; notes: Note[]; op: Props["op"] }) {
  const [writing, setWriting] = useState(false)
  const [text, setText] = useState("")
  const send = async () => {
    if (!text.trim()) return
    await op({ op: "note.add", target: `beat:${b.id}`, text, by: ME })
    setText("")
    setWriting(false)
  }
  return (
    <li className="group grid grid-cols-[3.5rem_minmax(0,1fr)] gap-x-4">
      <span className="pt-0.5 font-mono text-xs text-muted-foreground">{tc(b.t0)}</span>
      <div className="space-y-2">
        <div className="flex items-baseline gap-3">
          <h3 className="font-semibold">{b.title}</h3>
          <button type="button" onClick={() => setWriting((w) => !w)} className="ml-auto text-xs text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground focus-visible:opacity-100">
            Comment
          </button>
        </div>
        <p className="text-[15px] leading-relaxed">{b.picture}</p>
        {b.lines.map((l, j) => (
          <p key={j} className="pl-6 text-[15px] leading-relaxed">
            <span className="text-xs font-semibold tracking-wider uppercase">{l.who}</span>
            {(l.how || l.vo) && <span className="text-sm text-muted-foreground"> ({[l.vo && "V.O.", l.how].filter(Boolean).join(", ")})</span>}
            <br />
            {l.text}
          </p>
        ))}
        {(b.sound || b.camera) && <p className="text-sm text-muted-foreground">{[b.sound, b.camera].filter(Boolean).join(" · ")}</p>}
        {notes.map((n) => (
          <NoteLine key={n.id} n={n} op={op} />
        ))}
        {writing && (
          <div className="space-y-2 pt-1">
            <Textarea autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="What should change here?" onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === "Enter" && send()} />
            <div className="flex gap-2">
              <Button size="sm" onClick={send} disabled={!text.trim()}>Add comment</Button>
              <Button size="sm" variant="ghost" onClick={() => setWriting(false)}>Cancel</Button>
            </div>
          </div>
        )}
      </div>
    </li>
  )
}

function NoteLine({ n, op }: { n: Note; op: Props["op"] }) {
  return (
    <div className={cn("flex items-start gap-3 rounded-md border-l-2 border-amber-500/60 bg-muted/50 px-3 py-2 text-sm", n.resolved && "border-transparent opacity-50")}>
      <p className="min-w-0 flex-1 leading-relaxed">
        {n.text}
        <span className="text-muted-foreground"> · {n.by}, {when(n.at)}{n.kind && n.kind !== "comment" ? ` · ${GATE_LABEL[n.kind]}` : ""}</span>
      </p>
      <button type="button" onClick={() => op({ op: "note.resolve", id: n.id, resolved: !n.resolved })} className="shrink-0 text-xs text-muted-foreground hover:text-foreground">
        {n.resolved ? "Reopen" : "Resolve"}
      </button>
    </div>
  )
}

function OtherStage({ pr, stage, op }: { pr: Process; stage: Stage; op: Props["op"] }) {
  const block = blockedBy(pr, stage.id)
  return (
    <article className="space-y-8">
      <header className="space-y-2">
        <Eyebrow pr={pr} stage={stage} />
        <h1 className="text-3xl font-semibold tracking-tight">{stage.name}</h1>
        <p className="text-[15px] leading-relaxed text-muted-foreground">{stage.about}</p>
      </header>
      {block && <p className="text-[15px]">Opens after {block.name.toLowerCase()} is approved.</p>}
      <StageSettings stage={stage} op={op} />
    </article>
  )
}

function DecisionBar({ pr, stage, op }: { pr: Process; stage: Stage; op: Props["op"] }) {
  const [text, setText] = useState("")
  const st = stateOf(pr, stage)
  const open = openNotes(pr).length
  const reviewable =
    stage.id === "script" ? !!pr.pick && pr.script.concept === pr.pick && pr.script.beats.length > 0 : stage.id === "sheets" ? !!pr.sheets?.length && pr.sheets.every((x) => x.pick) : true
  const decide = async (status: GateStatus) => {
    await op({ op: "gate.set", stage: stage.id, status, note: text, by: ME })
    setText("")
  }
  if (st === "locked" || st === "skipped") return null
  return (
    <footer className="shrink-0 border-t bg-background">
      <div className="mx-auto flex max-w-3xl flex-col gap-3 px-6 py-4 sm:flex-row sm:items-center">
        <div className="flex shrink-0 items-center gap-2 text-sm whitespace-nowrap">
          <span className={cn("size-2 rounded-full", dot[st])} />
          <span>{st === "pending" ? (reviewable ? "Your decision" : "Nothing to review yet") : label(st)}</span>
          {open > 0 && <span className="text-muted-foreground">· {open} open</span>}
        </div>
        {st === "pending" && reviewable ? (
          <>
            <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Note for the next draft" className="min-h-9 flex-1 py-1.5" rows={1} />
            <div className="flex shrink-0 gap-2">
              <Button size="sm" variant="ghost" onClick={() => decide("rejected")}>Reject</Button>
              <Button size="sm" variant="secondary" onClick={() => decide("changes")} disabled={!text.trim()} title={text.trim() ? undefined : "Write what should change"}>Request changes</Button>
              <Button size="sm" onClick={() => decide("approved")}>Approve</Button>
            </div>
          </>
        ) : st !== "pending" ? (
          <p className="flex-1 text-sm text-muted-foreground">
            {stage.by}, {stage.at && when(stage.at)} ·{" "}
            <button type="button" className="underline underline-offset-2 hover:text-foreground" onClick={() => op({ op: "gate.set", stage: stage.id, status: "pending", by: ME })}>
              reopen
            </button>
          </p>
        ) : null}
      </div>
    </footer>
  )
}

const DOERS = [
  { value: "agent", label: "Agent" },
  { value: "person", label: "Person" },
  { value: "both", label: "Agent and person" },
]
const GATES = [
  { value: "required", label: "Required" },
  { value: "advisory", label: "Advisory" },
]

function Choice({ value, items, onChange }: { value: string; items: { value: string; label: string }[]; onChange: (v: string) => void }) {
  return (
    <Select items={items} value={value} onValueChange={(v) => v && onChange(v as string)}>
      <SelectTrigger size="sm">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {items.map((i) => (
          <SelectItem key={i.value} value={i.value}>
            {i.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function StageSettings({ stage, op }: { stage: Stage; op: Props["op"] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-t pt-6 text-sm text-muted-foreground">
      <div className="flex items-center gap-2">
        Done by
        <Choice value={stage.doer} items={DOERS} onChange={(v) => op({ op: "stage.update", stage: stage.id, patch: { doer: v as Stage["doer"] } })} />
      </div>
      <div className="flex items-center gap-2">
        Gate
        <Choice value={stage.gate} items={GATES} onChange={(v) => op({ op: "stage.update", stage: stage.id, patch: { gate: v as Stage["gate"] } })} />
      </div>
      <label className="flex items-center gap-2">
        <Checkbox checked={!!stage.skipped} onCheckedChange={(c) => op({ op: "stage.update", stage: stage.id, patch: { skipped: !!c } })} />
        Skip for this film
      </label>
    </div>
  )
}

const KINDS: { kind: SheetKind; title: string; about: string }[] = [
  { kind: "look", title: "Look", about: "The picture's texture and colour, shot for shot." },
  { kind: "cast", title: "Cast", about: "One image per look of each character. Second looks are made from your pick of the first." },
  { kind: "location", title: "Sets", about: "Each place, empty, from the angle the film mostly sees it." },
  { kind: "prop", title: "Props", about: "Objects that have to match from shot to shot." },
]

const thumb = (file: string, w = 640) => `/api/thumb?src=${encodeURIComponent("/" + file)}&w=${w}`

function SheetsStage({ pr, stage, op }: { pr: Process; stage: Stage; op: Props["op"] }) {
  const items = pr.sheets ?? []
  const picked = items.filter((x) => x.pick).length
  return (
    <article className="space-y-10">
      <header className="space-y-2">
        <Eyebrow pr={pr} stage={stage} />
        <h1 className="text-3xl font-semibold tracking-tight">Look and sheets</h1>
        <p className="text-[15px] leading-relaxed text-muted-foreground">Lock how every character, place and prop looks before any video. Pick one image per row; open an image to see it full size. Each one says which model and provider made it.</p>
        <p className="text-sm text-muted-foreground">{picked} of {items.length} picked</p>
      </header>
      {KINDS.map(({ kind, title, about }) => {
        const list = items.filter((x) => x.kind === kind)
        if (!list.length) return null
        return (
          <section key={kind} className="space-y-6">
            <div className="space-y-1 border-b pb-2">
              <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{title}</h2>
              <p className="text-sm text-muted-foreground">{about}</p>
            </div>
            {list.map((x) => (
              <SheetRow key={x.id} item={x} items={items} notes={pr.notes.filter((n) => n.target === `sheet:${x.id}`)} op={op} />
            ))}
          </section>
        )
      })}
      <StageSettings stage={stage} op={op} />
    </article>
  )
}

function SheetRow({ item, items, notes, op }: { item: SheetItem; items: SheetItem[]; notes: Note[]; op: Props["op"] }) {
  const [writing, setWriting] = useState(false)
  const [text, setText] = useState("")
  const parent = item.from ? items.find((x) => x.id === item.from) : undefined
  const send = async () => {
    if (!text.trim()) return
    await op({ op: "note.add", target: `sheet:${item.id}`, text, by: ME })
    setText("")
    setWriting(false)
  }
  return (
    <div className="space-y-3">
      <div className="flex items-baseline gap-3">
        <h3 className="font-semibold">{item.name}</h3>
        {item.pick && <span className="text-xs text-emerald-700 dark:text-emerald-300">Picked</span>}
        <button type="button" onClick={() => setWriting((w) => !w)} className="ml-auto text-xs text-muted-foreground hover:text-foreground">
          Comment
        </button>
      </div>
      <p className="text-sm leading-relaxed text-muted-foreground">{item.brief}</p>
      {item.candidates.length ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {item.candidates.map((c) => (
            <CandidateTile key={c.file} c={c} picked={item.pick === c.file} onPick={() => op({ op: "sheet.pick", id: item.id, file: item.pick === c.file ? null : c.file, by: ME })} />
          ))}
        </div>
      ) : (
        <p className="rounded-md border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
          {parent && !parent.pick ? `Made from your pick for ${parent.name}. Pick that first.` : "Candidates are being made."}
        </p>
      )}
      {notes.map((n) => (
        <NoteLine key={n.id} n={n} op={op} />
      ))}
      {writing && (
        <div className="space-y-2">
          <Textarea autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="What should change? You can name a model to try." onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === "Enter" && send()} />
          <div className="flex gap-2">
            <Button size="sm" onClick={send} disabled={!text.trim()}>Add comment</Button>
            <Button size="sm" variant="ghost" onClick={() => setWriting(false)}>Cancel</Button>
          </div>
        </div>
      )}
    </div>
  )
}

function CandidateTile({ c, picked, onPick }: { c: Candidate; picked: boolean; onPick: () => void }) {
  return (
    <figure className="space-y-1.5">
      <a href={"/" + c.file} target="_blank" rel="noreferrer" className={cn("block overflow-hidden rounded-md border bg-muted", picked && "ring-2 ring-emerald-500 ring-offset-2 ring-offset-background")}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={thumb(c.file)} alt="" loading="lazy" className="aspect-[4/3] w-full object-cover" />
      </a>
      <figcaption className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={[c.model, c.provider, c.job, c.cost !== undefined ? `$${c.cost.toFixed(3)}` : null].filter(Boolean).join(" · ")}>
          {c.model} · {c.provider}
        </span>
        <Button size="xs" variant={picked ? "secondary" : "outline"} onClick={onPick}>
          {picked ? "Picked" : "Pick"}
        </Button>
      </figcaption>
    </figure>
  )
}
