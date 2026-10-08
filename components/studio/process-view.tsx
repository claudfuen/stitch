"use client"

// Process: one stage at a time. A plain stepper of the eight stages, then the stage's work in one readable column,
// then one decision bar: approve, request changes or reject, with a note. Comments sit on the beat they are about.
// Every action is a named op (lib/ops.ts), the same ones agents use from the CLI (`stitch gates`, `stitch feedback`).

import { Check, ChevronDown, ChevronLeft, ChevronRight, LoaderCircle, Lock, Mic, Play, RotateCcw, Square, Trash2 } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import type { ProjectWithRev } from "@/lib/model"
import type { Op } from "@/lib/ops"
import { GATE_LABEL, beatsOf, blockedBy, currentStage, openNotes, runtime, words, type Audition, type Beat, type Camera, type Candidate, type Concept, type GateStatus, type Note, type Process, type Room, type SheetItem, type SheetKind, type SetTake, type Stage, type StageId, type VoiceLine, type VoiceTake } from "@/lib/process"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { useRecorder } from "./recorder"
import { SceneRecorder } from "./scene-recorder"
import { projectSlug } from "./use-project"
import { setParams, useParam, useScrollToHash } from "./url-state"

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
  // The open stage lives in the URL (?stage=voice), and every section has an anchor (#voice:cast), so a refresh or
  // a pasted link opens the same place.
  const [stageParam, setStage] = useParam("stage")
  const sel: StageId = pr.stages.some((s) => s.id === stageParam) ? (stageParam as StageId) : (currentStage(pr)?.id ?? "script")
  const setSel = (id: StageId) => setStage(id)
  const stage = pr.stages.find((s) => s.id === sel)!
  useScrollToHash(sel)
  return (
    <div className="flex h-full flex-col">
      <Stepper pr={pr} sel={sel} onSelect={setSel} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-6 pt-10 pb-12">{sel === "script" ? <ScriptStage pr={pr} op={op} /> : sel === "sheets" && !blockedBy(pr, "sheets") ? <SheetsStage pr={pr} stage={stage} op={op} /> : sel === "space" && !blockedBy(pr, "space") && pr.space ? <SpaceStage pr={pr} stage={stage} op={op} /> : sel === "voice" && !blockedBy(pr, "voice") ? <VoiceStage pr={pr} stage={stage} op={op} /> : sel === "pixels" && pr.takes?.length ? <PixelsStage pr={pr} stage={stage} op={op} /> : <OtherStage pr={pr} stage={stage} op={op} />}</div>
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
    stage.id === "script" ? !!pr.pick && pr.script.concept === pr.pick && pr.script.beats.length > 0 : stage.id === "sheets" ? !!pr.sheets?.length && pr.sheets.filter((x) => !x.from).every((x) => x.pick) : stage.id === "space" ? !!pr.space?.rooms.length : stage.id === "voice" ? !!pr.voice?.takes.length : false
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

const thumb = (file: string, w = 640, v?: string) => `/api/thumb?src=${encodeURIComponent("/" + file)}&w=${w}${v ? `&v=${encodeURIComponent(v)}` : ""}`
const chosen = (x: SheetItem) => x.candidates.find((c) => c.file === x.pick)

/** Stage 02 is one proposal for how the whole film looks: the art direction, the world in that look, and the cast
 *  inside the world (with the reference sheet the video models will use). React to the whole; alternatives fold away. */
function SheetsStage({ pr, stage, op }: { pr: Process; stage: Stage; op: Props["op"] }) {
  const items = pr.sheets ?? []
  const of = (k: SheetKind) => items.filter((x) => x.kind === k && !x.from)
  const world = [...of("location"), ...of("prop"), ...items.filter((x) => x.id === "audience")]
  const cast = of("cast").filter((x) => x.id !== "audience")
  const later = items.filter((x) => x.from)
  return (
    <article className="space-y-12">
      <header className="space-y-2">
        <Eyebrow pr={pr} stage={stage} />
        <h1 className="text-3xl font-semibold tracking-tight">Look and sheets</h1>
        <p className="text-[15px] leading-relaxed text-muted-foreground">One proposal for how the whole film looks. React to the whole: approve it, or say what feels off. Comment on anything specific, and name a model if you want one tried.</p>
        <p className="text-sm text-muted-foreground">
          <a href={`/api/script-pdf?doc=look${projectSlug() ? `&p=${encodeURIComponent(projectSlug())}` : ""}`} className="underline underline-offset-2 hover:text-foreground">download look book (PDF)</a>
        </p>
      </header>

      <ProposalSection title="1. Art direction" about="Two looks: the 1994 infomercial in colour, and its black-and-white &lsquo;before&rsquo; footage. Everything below matches these." target="sheets:direction" pr={pr} op={op}>
        <div className="grid gap-3 sm:grid-cols-2">
          {of("look").map((x) => <Still key={x.id} item={x} c={chosen(x)} />)}
        </div>
      </ProposalSection>

      <ProposalSection title="2. The world" about="Every set and prop, made by one model and run through the same film grade, so they read as one show." target="sheets:world" pr={pr} op={op}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {world.map((x) => <Still key={x.id} item={x} c={chosen(x)} small />)}
        </div>
      </ProposalSection>

      <ProposalSection title="3. The cast" about="Each character inside the film, in its look. Under each, the reference sheet the video models will use: same face from every angle, in costume, with the expressions the script needs." target="sheets:cast" pr={pr} op={op}>
        <div className="space-y-10">
          {cast.map((x) => <CastBlock key={x.id} item={x} />)}
        </div>
        {later.length > 0 && <p className="text-sm text-muted-foreground">Made after you approve these faces: {later.map((x) => x.name).join(", ")}.</p>}
      </ProposalSection>

      <StageSettings stage={stage} op={op} />
    </article>
  )
}

/** One part of a proposal with its own comment thread. `target` is the note target ("sheets:world", "space:studio"). */
function ProposalSection({ title, about, target, pr, op, children }: { title: string; about: string; target: string; pr: Process; op: Props["op"]; children: React.ReactNode }) {
  const [writing, setWriting] = useState(false)
  const [text, setText] = useState("")
  const notes = pr.notes.filter((n) => n.target === target)
  const send = async () => {
    if (!text.trim()) return
    await op({ op: "note.add", target, text, by: ME })
    setText("")
    setWriting(false)
  }
  return (
    <section id={target} className="scroll-mt-6 space-y-4">
      <div className="flex items-baseline gap-3 border-b pb-2">
        <h2 className="text-lg font-semibold">
          <a href={`#${target}`} className="hover:underline" title="Link to this section">{title}</a>
        </h2>
        <button type="button" onClick={() => setWriting((w) => !w)} className="ml-auto text-sm text-muted-foreground hover:text-foreground">Comment</button>
      </div>
      <p className="text-sm leading-relaxed text-muted-foreground" dangerouslySetInnerHTML={{ __html: about }} />
      {children}
      {notes.map((n) => <NoteLine key={n.id} n={n} op={op} />)}
      {writing && (
        <div className="space-y-2">
          <Textarea autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="What feels off? You can name a model to try." onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === "Enter" && send()} />
          <div className="flex gap-2">
            <Button size="sm" onClick={send} disabled={!text.trim()}>Add comment</Button>
            <Button size="sm" variant="ghost" onClick={() => setWriting(false)}>Cancel</Button>
          </div>
        </div>
      )}
    </section>
  )
}

const caption = (c?: Candidate) => (c ? `${c.model} · ${c.provider}` : "")

function Still({ item, c, small }: { item: SheetItem; c?: Candidate; small?: boolean }) {
  return (
    <figure className="space-y-1.5">
      {c ? (
        <a href={`/${c.file}?v=${encodeURIComponent(c.at)}`} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-md border bg-muted">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={thumb(c.file, small ? 640 : 1280, c.at)} alt={item.name} loading="lazy" className="aspect-video w-full object-cover" />
        </a>
      ) : (
        <div className="grid aspect-video place-items-center rounded-md border border-dashed text-sm text-muted-foreground">Being made</div>
      )}
      <figcaption className="text-sm">
        {item.name}
        <span className="block truncate text-xs text-muted-foreground" title={[c?.model, c?.provider, c?.job].filter(Boolean).join(" · ")}>{caption(c)}</span>
      </figcaption>
    </figure>
  )
}

function CastBlock({ item }: { item: SheetItem }) {
  const face = chosen(item)
  const hero = item.scene ?? face
  const refs = item.views?.length ? item.views : face ? [face] : []
  return (
    <div className="space-y-3">
      <div className="flex items-baseline gap-3">
        <h3 className="text-base font-semibold">{item.name}</h3>
        {item.pickedBy && item.pickedBy !== ME && <span className="text-xs text-muted-foreground">face picked by {item.pickedBy}</span>}
      </div>
      <p className="text-sm leading-relaxed text-muted-foreground">{item.brief}</p>
      {hero ? (
        <a href={`/${hero.file}?v=${encodeURIComponent(hero.at)}`} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-md border bg-muted">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={thumb(hero.file, 1280, hero.at)} alt={item.name} loading="lazy" className="aspect-video w-full object-cover" />
        </a>
      ) : (
        <div className="grid aspect-video place-items-center rounded-md border border-dashed text-sm text-muted-foreground">Being made</div>
      )}
      <p className="text-xs text-muted-foreground">{item.scene ? `In the film: ${caption(item.scene)}` : face ? `Face: ${caption(face)}` : ""}</p>
      {refs.length > 1 && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Reference sheet · {refs.length} views · {caption(refs[0])}</p>
          <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-7">
            {refs.map((v) => (
              <a key={v.file} href={`/${v.file}?v=${encodeURIComponent(v.at)}`} target="_blank" rel="noreferrer" title={v.view} className="block overflow-hidden rounded border bg-muted">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={thumb(v.file, 320, v.at)} alt={v.view ?? ""} loading="lazy" className="aspect-square w-full object-cover object-top" />
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}


const LOOK_LABEL = { colour: "1994 colour", before: "Black-and-white 'before'" } as const

/** Stage 03 is one proposal for where everyone stands and where every camera goes. Per room: each camera as a frame of
 *  the approved set with the cast on their marks (the wide master first, it loads the layout), and the space map that
 *  goes into every prompt. Then the camera script: which camera is on screen at each second of the film. */
function SpaceStage({ pr, stage, op }: { pr: Process; stage: Stage; op: Props["op"] }) {
  const sp = pr.space!
  const cams = sp.rooms.reduce((n, r) => n + r.cameras.length, 0)
  const framed = sp.rooms.reduce((n, r) => n + r.cameras.filter((c) => c.frame).length, 0)
  return (
    <article className="space-y-12">
      <header className="space-y-2">
        <Eyebrow pr={pr} stage={stage} />
        <h1 className="text-3xl font-semibold tracking-tight">Space and camera</h1>
        <p className="text-[15px] leading-relaxed text-muted-foreground">Where everyone stands and where every camera goes, room by room. In each room the cameras stay on one side of the action, so a cut never flips who is on the left. React to the whole, or comment on a room.</p>
        <p className="text-sm text-muted-foreground">
          {sp.rooms.length} rooms · {cams} cameras · {sp.cuts.length} cuts{framed < cams && <> · {framed} of {cams} frames made</>}
        </p>
      </header>

      {sp.rooms.map((r) => <RoomBlock key={r.id} pr={pr} room={r} op={op} />)}

      <ProposalSection title="Camera script" about="Which camera is on screen at each second. Timings follow the script for now; they move to the recorded lines once the voices are in." target="space:script" pr={pr} op={op}>
        <CameraScript pr={pr} />
      </ProposalSection>

      <StageSettings stage={stage} op={op} />
    </article>
  )
}

function RoomBlock({ pr, room, op }: { pr: Process; room: Room; op: Props["op"] }) {
  const set = pr.sheets?.find((x) => x.id === room.sheet)
  const plate = set ? chosen(set) : undefined
  return (
    <ProposalSection title={room.name} about={`${LOOK_LABEL[room.look]} · ${room.cameras.length} ${room.cameras.length === 1 ? "camera" : "cameras"}`} target={`space:${room.id}`} pr={pr} op={op}>
      <div className="grid gap-x-3 gap-y-6 sm:grid-cols-2">
        {room.cameras.map((c, i) => (
          <CameraCard key={c.id} pr={pr} room={room} cam={c} plate={plate} wide={i === 0} />
        ))}
      </div>
      <div className="space-y-1 rounded-md bg-muted/50 px-4 py-3">
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Space map</p>
        <p className="text-sm leading-relaxed">{room.map}</p>
      </div>
    </ProposalSection>
  )
}

function CameraCard({ pr, room, cam, plate, wide }: { pr: Process; room: Room; cam: Camera; plate?: Candidate; wide?: boolean }) {
  const f = cam.frame
  const beats = beatsOf(pr, room.id, cam.id)
  return (
    <figure className={cn("space-y-2", wide && "sm:col-span-2")}>
      {f ? (
        <a href={`/${f.file}?v=${encodeURIComponent(f.at)}`} target="_blank" rel="noreferrer" className="relative block overflow-hidden rounded-md border bg-muted">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={thumb(f.file, wide ? 1280 : 800, f.at)} alt={`${cam.id} ${cam.name}`} loading="lazy" className="aspect-video w-full object-cover" />
          {cam.layout && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={thumb(cam.layout, 320, f.at)} alt="Grey-box layout from this camera" title="Grey-box layout: framing, positions and screen direction come from this" className="absolute right-2 bottom-2 aspect-video w-1/5 rounded border border-white/70 object-cover shadow" />
          )}
        </a>
      ) : plate ? (
        <div className="relative overflow-hidden rounded-md border bg-muted">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={thumb(plate.file, 640, plate.at)} alt="" loading="lazy" className="aspect-video w-full object-cover opacity-30 grayscale" />
          <span className="absolute inset-0 grid place-items-center text-sm text-muted-foreground">Frame being made</span>
        </div>
      ) : (
        <div className="grid aspect-video place-items-center rounded-md border border-dashed text-sm text-muted-foreground">Frame being made</div>
      )}
      <figcaption className="space-y-1">
        <p className="flex items-baseline gap-2 text-sm">
          <span className="font-mono text-xs font-semibold">{cam.id}</span>
          <span className="font-medium">{cam.name}</span>
          <span className="ml-auto shrink-0 text-xs text-muted-foreground">{cam.size} · {cam.lens} mm{beats.length > 0 && <> · beat {beats.join(", ")}</>}</span>
        </p>
        {cam.look && cam.look !== room.look && <p className="text-xs font-medium">In {LOOK_LABEL[cam.look].toLowerCase()}, unlike the rest of this room: on purpose.</p>}
        <p className="text-sm leading-relaxed text-muted-foreground">{cam.why}</p>
        {cam.behind && <p className="text-xs text-muted-foreground">Behind camera: {cam.behind}</p>}
        {f && <p className="truncate text-xs text-muted-foreground" title={[f.model, f.provider, f.job].filter(Boolean).join(" · ")}>{caption(f)}</p>}
      </figcaption>
    </figure>
  )
}

function CameraScript({ pr }: { pr: Process }) {
  const sp = pr.space!
  const cam = (room: string, id: string) => sp.rooms.find((r) => r.id === room)?.cameras.find((c) => c.id === id)
  return (
    <ol className="space-y-5">
      {pr.script.beats.map((b) => {
        const cuts = sp.cuts.filter((c) => c.t0 >= b.t0 && c.t0 < b.t1)
        return (
          <li key={b.id} className="grid grid-cols-[3.5rem_minmax(0,1fr)] gap-x-4">
            <span className="pt-0.5 font-mono text-xs text-muted-foreground">{tc(b.t0)}</span>
            <div className="space-y-2">
              <h3 className="text-sm font-semibold">{b.title}</h3>
              {cuts.length === 0 ? (
                <p className="text-sm text-muted-foreground">No camera: an edit graphic.</p>
              ) : (
                cuts.map((c) => {
                  const k = cam(c.room, c.cam)
                  return (
                    <div key={`${c.t0}-${c.cam}`} className="flex items-start gap-3">
                      {k?.frame ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={thumb(k.frame.file, 240, k.frame.at)} alt="" loading="lazy" className="aspect-video w-24 shrink-0 rounded border object-cover" />
                      ) : (
                        <div className="aspect-video w-24 shrink-0 rounded border border-dashed" />
                      )}
                      <p className="min-w-0 text-sm leading-relaxed">
                        <span className="font-mono text-xs text-muted-foreground">{c.t0.toFixed(1)}-{c.t1.toFixed(1)} s</span>{" "}
                        <span className="font-mono text-xs font-semibold">{c.cam}</span> {k?.name}
                        <span className="block text-muted-foreground">{c.what}</span>
                      </p>
                    </div>
                  )
                })
              )}
            </div>
          </li>
        )
      })}
    </ol>
  )
}

const SOURCE: Record<NonNullable<Audition["source"]>, string> = { stock: "Stock voice", library: "Voice Library", designed: "Designed from the brief", clone: "Clone of his real voice", converted: "Stand-in converted to his real voice" }

/** Stage 04: who sounds like what, then the whole film read in one take. Every line is performed before any picture
 *  is made, so the pictures follow the acting. Casting picks are ops (voice.cast), the same ones agents use. */
function VoiceStage({ pr, stage, op }: { pr: Process; stage: Stage; op: Props["op"] }) {
  const v = pr.voice
  const take = v ? (v.takes.find((t) => t.id === v.pick) ?? v.takes.at(-1)) : undefined
  const planned = pr.script.beats.at(-1)?.t1 ?? 0
  const name = (who: string) => pr.cast?.find((c) => c.id === who)?.name ?? who
  const speech = (beat: string) => (take?.lines ?? []).filter((l) => l.beat === beat).reduce((n, l) => n + (l.end - l.start), 0)
  /** Roles whose other auditions are showing; a cast role shows only its pick until opened. */
  const [openRoles, setOpenRoles] = useState<Record<string, boolean>>({})
  return (
    <article className="space-y-12">
      <header className="space-y-4">
        <div className="space-y-2">
          <Eyebrow pr={pr} stage={stage} />
          <h1 className="text-3xl font-semibold tracking-tight">Voice</h1>
          <p className="text-[15px] leading-relaxed text-muted-foreground">Every line is performed before any picture is made, so the pictures follow the acting. The whole film is read in one take, so each line answers the one before it.</p>
        </div>
        <ol className="space-y-1.5 rounded-md bg-muted/50 px-4 py-3 text-sm leading-relaxed">
          <li><span className="font-medium">1. Perform.</span> Pick a role, read each line into the recorder (Space starts and stops), and hear it back in the role&apos;s voice. Your timing and delivery stay; only the voice changes.</li>
          <li><span className="font-medium">2. Cast.</span> Play the auditions for each role and pick a voice. Each one reads that role&apos;s own lines: voices from the ElevenLabs library and voices designed from the character brief. Henrick is his own voice either way: pick how it is made.</li>
          <li><span className="font-medium">3. Listen to the read.</span> The whole film in one take, then line by line. Comment on any line that is wrong, or on the casting.</li>
          <li><span className="font-medium">4. Approve.</span> The lines lock, and the camera script is retimed to them.</li>
        </ol>
        {take && (
          <p className="text-sm text-muted-foreground">
            {take.lines.length} lines · the read runs {Math.round(take.duration)} s; the script plans {planned} s
          </p>
        )}
      </header>

      {!v ? (
        <p className="text-[15px] text-muted-foreground">Auditions and the first read are being made.</p>
      ) : (
        <>
          {take && (
            <ProposalSection title="Perform" about="Read a role's lines yourself, one at a time. Each take is saved on this computer, then the ElevenLabs voice changer turns it into the role's voice: your timing, pauses and delivery stay, the timbre becomes theirs. Nothing is trained." target="voice:perform" pr={pr} op={op}>
              <PerformPanel pr={pr} take={take} name={name} op={op} />
            </ProposalSection>
          )}

          <ProposalSection title="Casting" about="A voice for each role. Each audition reads that character's own lines with the same direction, so you compare voices, not performances." target="voice:cast" pr={pr} op={op}>
            <div className="space-y-6">
              {v.roles.map((r) => (
                <div key={r.who} className="space-y-2">
                  <p className="flex items-baseline gap-2 text-sm">
                    <span className="font-medium">{name(r.who)}</span>
                    <span className="text-muted-foreground">{pr.cast?.find((c) => c.id === r.who)?.voice}</span>
                    {(r.voice || r.real) && <span className="ml-auto shrink-0 text-xs font-medium">{r.real ? `His own voice${r.voice ? `: ${r.voice}` : ""}` : `Cast: ${r.voice}`}</span>}
                    {r.voice && r.auditions.length > 1 && (
                      <button type="button" className="shrink-0 text-xs text-muted-foreground hover:text-foreground" onClick={() => setOpenRoles((s) => ({ ...s, [r.who]: !s[r.who] }))}>
                        {openRoles[r.who] ? "Hide the others" : `${r.auditions.length - 1} other audition${r.auditions.length === 2 ? "" : "s"}`}
                      </button>
                    )}
                  </p>
                  {r.real && <p className="text-sm text-muted-foreground">{r.note ?? "Read in the take by a stand-in voice, then converted to his real recording. The match to his recording is shown on each of his lines below."}</p>}
                  {r.auditions.length > 0 && (
                    <ul className="divide-y rounded-md border">
                      {r.auditions.filter((a) => !r.voice || openRoles[r.who] || a.voice === r.voice).map((a) => (
                        <li key={a.voice} className="space-y-1.5 px-3 py-2.5">
                          <div className="flex items-baseline gap-2">
                            <span className="min-w-0 truncate text-sm font-medium">{a.voice}</span>
                            {a.source && <span className="shrink-0 text-xs text-muted-foreground">{SOURCE[a.source]}</span>}
                            {a.match !== undefined && <span className="shrink-0 font-mono text-xs text-muted-foreground">match {a.match.toFixed(2)}</span>}
                            <Button size="sm" className="ml-auto shrink-0" variant={r.voice === a.voice ? "secondary" : "ghost"} disabled={r.voice === a.voice} onClick={() => op({ op: "voice.cast", who: r.who, voice: a.voice, by: ME })}>
                              {r.voice === a.voice ? "Cast" : "Use"}
                            </Button>
                          </div>
                          {a.about && <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">{a.about}</p>}
                          <audio controls preload="none" src={`/${a.file}`} className="h-8 w-full" />
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          </ProposalSection>

          {take && (
            <ProposalSection
              title="The read"
              about={`The whole film in one take, as performed, with Henrick converted to his real voice. Voices in this take: ${Object.entries(take.cast).map(([who, voice]) => `${name(who)} ${who === "henrick" ? "(his own)" : voice}`).join(", ")}. ${take.model} · ${take.provider}.`}
              target="voice:take"
              pr={pr}
              op={op}
            >
              <audio controls preload="metadata" src={`/${take.file}?v=${encodeURIComponent(take.at)}`} className="w-full" />
              {v.takes.length > 1 && (
                <div className="flex flex-wrap gap-2">
                  {v.takes.map((t) => (
                    <Button key={t.id} size="sm" variant={t.id === take.id ? "secondary" : "ghost"} onClick={() => op({ op: "voice.pick", take: t.id, by: ME })}>
                      Take {t.id}
                    </Button>
                  ))}
                </div>
              )}
              {take.note && <p className="text-sm leading-relaxed">{take.note}</p>}
              <ol className="space-y-6">
                {pr.script.beats.map((b) => {
                  const lines = take.lines.filter((l) => l.beat === b.id)
                  const slot = b.t1 - b.t0
                  const need = speech(b.id)
                  return (
                    <li key={b.id} id={`voice:beat-${b.id}`} className="grid scroll-mt-6 grid-cols-[3.5rem_minmax(0,1fr)] gap-x-4">
                      <span className="pt-0.5 font-mono text-xs text-muted-foreground">{tc(b.t0)}</span>
                      <div className="space-y-2">
                        <h3 className="flex items-baseline gap-2 text-sm font-semibold">
                          {b.title}
                          {lines.length > 0 && (
                            <span className={cn("ml-auto shrink-0 text-xs font-normal", need > slot + 0.3 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground")}>
                              {need.toFixed(1)} s of speech in a {slot} s beat
                            </span>
                          )}
                        </h3>
                        {lines.length === 0 ? <p className="text-sm text-muted-foreground">No lines.</p> : lines.map((l) => <LineRow key={l.n} l={l} who={name(l.who)} />)}
                      </div>
                    </li>
                  )
                })}
              </ol>
            </ProposalSection>
          )}
        </>
      )}

      <StageSettings stage={stage} op={op} />
    </article>
  )
}

/** Stage 06: one continuous take per set, sliced into shots. The set's grey box, with one camera moving through the
 *  take's shots and the locked read as its sound, drives the video model, so a set's shots all come out of one
 *  generation (same room, light and faces). Picks are ops (pixels.pick), the same ones agents use (`stitch take`). */
function PixelsStage({ pr, stage, op }: { pr: Process; stage: Stage; op: Props["op"] }) {
  const lock = blockedBy(pr, "pixels")
  return (
    <article className="space-y-12">
      <header className="space-y-4">
        <div className="space-y-2">
          <Eyebrow pr={pr} stage={stage} />
          <h1 className="text-3xl font-semibold tracking-tight">Pixels</h1>
          <p className="text-[15px] leading-relaxed text-muted-foreground">Each set is shot as one continuous take, so every shot of it comes out of the same generation: the same room, the same light, the same faces. The take is then cut into its shots.</p>
        </div>
        <ol className="space-y-1.5 rounded-md bg-muted/50 px-4 py-3 text-sm leading-relaxed">
          <li><span className="font-medium">1. Block.</span> The set&apos;s grey box with one camera moving through the take&apos;s shots, whipping between them, with the read as its sound. Check the camera and who stands where.</li>
          <li><span className="font-medium">2. Generate.</span> Seedance 2.5 on Higgsfield follows the blockout, with the cast sheets and the set&apos;s frames as references. Drafts at 480p first; the one you pick is finished at 1080p.</li>
          <li><span className="font-medium">3. Compare and pick.</span> Each generation plays next to its blockout. Use the one that holds the camera, the faces and the lines.</li>
          <li><span className="font-medium">4. Slice.</span> The picked take is cut at its whips into the shots of the film.</li>
        </ol>
        {lock && <p className="text-sm text-amber-600 dark:text-amber-400">{lock.name} is not approved yet, so these takes are previews: approve it to lock the read they are timed to.</p>}
      </header>
      {(pr.takes ?? []).map((t) => (
        <TakeSection key={t.id} t={t} pr={pr} op={op} />
      ))}
      <StageSettings stage={stage} op={op} />
    </article>
  )
}

function TakeSection({ t, pr, op }: { t: SetTake; pr: Process; op: Props["op"] }) {
  const room = pr.space?.rooms.find((r) => r.id === t.room)
  const read = pr.voice?.takes.find((x) => x.id === t.read)
  const name = (who: string) => pr.cast?.find((c) => c.id === who)?.name.split(" ")[0] ?? who
  const gens = [...t.gens].sort((a, b) => b.at.localeCompare(a.at))
  return (
    <ProposalSection title={t.name} about={`${room?.name ?? t.room}, ${t.shots.length} shots in one take of ${(t.to - t.from).toFixed(1)} s, timed to read ${t.read} (${tc(t.from)} to ${tc(t.to)}).`} target={`pixels:${t.id}`} pr={pr} op={op}>
      <ol className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {t.shots.map((s, k) => {
          const cam = room?.cameras.find((c) => c.id === s.cam)
          const said = (s.lines ?? []).map((n) => read?.lines.find((l) => l.n === n)).filter((l): l is VoiceLine => !!l)
          return (
            <li key={k} className="space-y-1.5">
              {cam?.frame && <img src={`/${cam.frame.file}`} alt={`${s.cam} ${cam.size}`} className="aspect-video w-full rounded object-cover" />}
              <p className="flex items-baseline gap-1.5 text-xs">
                <span className="font-mono font-medium">{s.cam}</span>
                <span className="text-muted-foreground">{cam?.size}</span>
                <span className="ml-auto font-mono text-muted-foreground tabular-nums">
                  {s.t0.toFixed(1)}-{s.t1.toFixed(1)} s
                </span>
              </p>
              <p className="line-clamp-3 text-xs leading-relaxed text-muted-foreground">{said.length ? said.map((l) => `${name(l.who)}: ${l.text}`).join(" ") : s.what}</p>
            </li>
          )
        })}
      </ol>
      {t.blockout && (
        <div className="space-y-1.5">
          <p className="text-sm font-medium">Blockout</p>
          <video controls preload="metadata" src={`/${t.blockout}`} className="w-full rounded border" />
        </div>
      )}
      <div className="space-y-4">
        <p className="text-sm font-medium">Generations</p>
        {gens.length === 0 && <p className="text-sm text-muted-foreground">None yet.</p>}
        {gens.map((g, k) => (
          <div key={g.id} className={cn("space-y-2 rounded-lg border p-3", t.pick === g.id && "ring-2 ring-emerald-500/50")}>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">Take {gens.length - k}</span>
              <span>
                {g.model} · {g.provider} · {when(g.at)}
              </span>
              {g.status === "running" && (
                <span className="ml-auto inline-flex items-center gap-1">
                  <LoaderCircle className="size-3 animate-spin" /> Rendering
                </span>
              )}
              {g.status === "done" &&
                (t.pick === g.id ? (
                  <Button size="sm" variant="secondary" className="ml-auto" onClick={() => op({ op: "pixels.pick", take: t.id, gen: null, by: ME })}>
                    <Check className="text-emerald-600" /> Using this take
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" className="ml-auto" onClick={() => op({ op: "pixels.pick", take: t.id, gen: g.id, by: ME })}>
                    Use this take
                  </Button>
                ))}
            </div>
            {g.note && <p className="text-xs leading-relaxed text-muted-foreground">{g.note}</p>}
            {g.status === "failed" && <p className="text-sm text-amber-600 dark:text-amber-400">{g.error ?? "Failed"}</p>}
            {g.status === "done" && (g.compare || g.file) && <video controls preload="metadata" src={`/${g.compare ?? g.file}`} className="w-full rounded" />}
            {g.compare && g.file && (
              <a href={`/${g.file}`} target="_blank" rel="noreferrer" className="text-xs text-muted-foreground hover:text-foreground">
                Open the generation on its own
              </a>
            )}
          </div>
        ))}
      </div>
    </ProposalSection>
  )
}

/** Stage 04's recorder: a person performs a role's lines one at a time, with the line before as the cue. Each take is
 *  saved on this machine and converted to the role's voice by the server (POST /api/perform, lib/perform.ts); both
 *  land as voice.perform ops, so agents (`stitch voice perform`) and the board see the same takes. */
function PerformPanel({ pr, take, name, op }: { pr: Process; take: VoiceTake; name: (who: string) => string; op: Props["op"] }) {
  const v = pr.voice!
  const roles = v.roles.filter((r) => take.lines.some((l) => l.who === r.who))
  const [whoParam] = useParam("who")
  // A role, or "all": you read every part, and each line converts to its own character's voice.
  const who = whoParam === "all" ? "all" : (roles.find((r) => r.who === whoParam)?.who ?? roles.find((r) => r.real)?.who ?? roles[0]?.who)
  const role = v.roles.find((r) => r.who === who)
  const lines = who === "all" ? take.lines : take.lines.filter((l) => l.who === who)
  const [lineParam, setLine] = useParam("line")
  const line = lines.find((l) => String(l.n) === lineParam) ?? lines[0]
  const i = line ? lines.indexOf(line) : -1
  const cue = line ? take.lines[take.lines.indexOf(line) - 1] : undefined
  const beat = pr.script.beats.find((b) => b.id === line?.beat)
  const how = beat?.lines.find((x) => x.who.toLowerCase() === line?.who && (x.text.includes(line.text) || line.text.includes(x.text)))?.how
  const all = v.performances ?? []
  const picks = v.picks ?? {}
  // Newest first, numbered in recording order, so a take keeps its number when others are removed.
  const onLine = all.filter((p) => p.n === line?.n).sort((a, b) => b.at.localeCompare(a.at))
  const num = new Map(onLine.map((p, k) => [p.id, onLine.length - k]))
  const takes = onLine.filter((p) => !p.removed)
  const gone = onLine.filter((p) => p.removed)
  const done = new Set(all.filter((p) => (who === "all" || p.who === who) && !p.removed).map((p) => p.n))
  const [showGone, setShowGone] = useState(false)
  const { state, setState, error, setError, devices, mic, setMic, start, stop, meter, clock } = useRecorder()
  const box = useRef<HTMLDivElement>(null)
  const slugQ = projectSlug() ? `&p=${encodeURIComponent(projectSlug())}` : ""
  const into = who === "all" ? "You read every part. Each line converts to its own character's voice: Henrick to the clone of his real voice, everyone else to the voice you cast." : `${name(who ?? "")}'s takes convert to ${role?.real ? "the clone of his real voice" : role?.voice ? `the voice you cast (${role.voice})` : "no voice yet: cast one below"}.`
  const short = (w: string) => name(w).split(" ")[0]
  const go = (d: number) => lines[i + d] && setLine(String(lines[i + d].n), { push: false })
  // Whole scene (one continuous take against the cues) is the default; line by line is for redoing single lines.
  const [mode, setMode] = useParam("mode")
  const scene = mode !== "lines"
  const [building, setBuilding] = useState(false)
  const [buildErr, setBuildErr] = useState<string | null>(null)
  const rebuild = async () => {
    setBuilding(true)
    setBuildErr(null)
    const r = await fetch(`/api/perform?read=1&by=${ME}${slugQ}`, { method: "POST" }).catch(() => null)
    const j = r ? await r.json().catch(() => ({})) : {}
    if (!r?.ok) setBuildErr(j.error ?? "Building the read failed")
    setBuilding(false)
  }

  /** The converted take plays the moment it is ready, so you hear how it worked without reaching for a player. */
  const playing = useRef<HTMLAudioElement | null>(null)
  const play = (file: string) => {
    playing.current?.pause()
    playing.current = new Audio(`/${file}`)
    playing.current.play().catch(() => {})
  }

  /** A take the server did not save stays here, so it can be sent again instead of performed again. */
  const [unsaved, setUnsaved] = useState<{ blob: Blob; n: number } | null>(null)
  const upload = async (blob: Blob, n: number) => {
    setState("saving")
    setError(null)
    try {
      const r = await fetch(`/api/perform?n=${n}&by=${ME}${slugQ}`, { method: "POST", headers: { "content-type": blob.type }, body: blob })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error ?? "Saving the take failed.")
      setUnsaved(null)
      if (j.error) setError(`Saved, but not converted: ${j.error}`)
      else if (j.converted?.file) play(j.converted.file)
    } catch (e) {
      setUnsaved({ blob, n })
      setError(`${(e as Error).message}. The take is kept here: save it again.`)
    }
    setState("idle")
  }
  const toggle = async () => {
    if (!line) return
    if (state === "idle") {
      playing.current?.pause()
      return start()
    }
    if (state !== "recording") return
    const blob = await stop()
    if (blob) await upload(blob, line.n)
  }
  const again = (id: string) => fetch(`/api/perform?convert=${id}${slugQ}`, { method: "POST" })

  // Space records and stops, arrows move between lines, while the panel is on screen and nobody is typing.
  const keys = useRef({ toggle, go, idle: true, scene: true })
  useEffect(() => {
    keys.current = { toggle, go, idle: state === "idle", scene }
  })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (keys.current.scene || e.metaKey || e.ctrlKey || e.altKey || (e.target as HTMLElement).closest("input, textarea, select, [contenteditable=true], [role=listbox], [role=option]")) return
      const r = box.current?.getBoundingClientRect()
      if (!r || r.bottom < 0 || r.top > window.innerHeight) return
      if (e.code === "Space") {
        e.preventDefault()
        ;(document.activeElement as HTMLElement | null)?.blur?.()
        keys.current.toggle()
      } else if (keys.current.idle && (e.key === "ArrowRight" || e.key === "ArrowLeft")) {
        e.preventDefault()
        keys.current.go(e.key === "ArrowRight" ? 1 : -1)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  if (!line || !who) return <p className="text-sm text-muted-foreground">No lines to perform in this read.</p>
  return (
    <div ref={box} className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap rounded-md border p-0.5">
          {[...roles.map((r) => r.who), "all"].map((w) => (
            <Button key={w} size="sm" variant={w === who ? "secondary" : "ghost"} onClick={() => setParams({ who: w, line: null }, { push: false, keepHash: true })}>
              {w === "all" ? "Everyone" : short(w)}
            </Button>
          ))}
        </div>
        {devices.length > 1 && <Choice value={mic || devices[0].value} items={devices} onChange={setMic} />}
        <span className="ml-auto text-sm text-muted-foreground">
          {lines.filter((l) => picks[l.n]).length} of {lines.length} lines picked · {lines.filter((l) => done.has(l.n)).length} recorded
        </span>
      </div>
      <p className="text-sm text-muted-foreground">{into}</p>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-md border p-0.5">
          <Button size="sm" variant={scene ? "secondary" : "ghost"} onClick={() => setMode(null, { push: false })}>
            Whole scene
          </Button>
          <Button size="sm" variant={scene ? "ghost" : "secondary"} onClick={() => setMode("lines", { push: false })}>
            Line by line
          </Button>
        </div>
        {lines.some((l) => picks[l.n]) && (
          <Button size="sm" variant="outline" className="ml-auto" disabled={building} onClick={rebuild} title="A new read with your picked takes in place of the stand-in lines">
            {building && <LoaderCircle className="animate-spin" />} Build the read from my picks
          </Button>
        )}
      </div>
      {buildErr && <p className="text-sm text-amber-600 dark:text-amber-400">{buildErr}</p>}

      {scene ? (
        <SceneRecorder take={take} who={who} name={name} by={ME} />
      ) : (
      <div className="space-y-4 rounded-lg border p-5">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>
            Line {i + 1} of {lines.length}
            {who === "all" ? ` · ${name(line.who)}` : ""}
            {beat ? ` · ${beat.title}` : ""}
          </span>
          <Button size="icon-sm" variant="ghost" className="ml-auto" disabled={i === 0 || state !== "idle"} onClick={() => go(-1)} aria-label="Previous line">
            <ChevronLeft />
          </Button>
          <Button size="icon-sm" variant="ghost" disabled={i === lines.length - 1 || state !== "idle"} onClick={() => go(1)} aria-label="Next line">
            <ChevronRight />
          </Button>
        </div>
        {cue && (
          <div className="flex items-baseline gap-2 text-sm text-muted-foreground">
            <span className="min-w-0">
              <span className="font-medium">{name(cue.who)}:</span> {cue.text}
            </span>
            <button type="button" className="ml-auto inline-flex shrink-0 items-center gap-1 text-xs hover:text-foreground" onClick={() => new Audio(`/${cue.file}`).play()}>
              <Play className="size-3" /> Hear the cue
            </button>
          </div>
        )}
        <p className="text-2xl leading-snug font-medium tracking-tight">{line.text}</p>
        {how && <p className="text-sm text-muted-foreground italic">({how})</p>}
        <div className="flex items-center gap-3">
          <Button size="lg" variant={state === "recording" ? "destructive" : "default"} disabled={state === "saving"} onClick={(e) => (e.currentTarget.blur(), toggle())}>
            {state === "recording" ? <Square /> : state === "saving" ? <LoaderCircle className="animate-spin" /> : <Mic />}
            {state === "recording" ? "Stop" : state === "saving" ? `Converting to ${short(line.who)}` : "Record"}
          </Button>
          <kbd className="rounded border px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">Space</kbd>
          {state === "recording" && (
            <>
              <div className="h-1.5 w-40 overflow-hidden rounded-full bg-muted">
                <div ref={meter} className="h-full w-0 bg-emerald-500 data-[hot=true]:bg-red-500" />
              </div>
              <span ref={clock} className="font-mono text-xs text-muted-foreground tabular-nums" />
            </>
          )}
        </div>
        {error && <p className="text-sm text-amber-600 dark:text-amber-400">{error}</p>}
        {unsaved && state === "idle" && (
          <div className="flex gap-2">
            <Button size="sm" onClick={() => upload(unsaved.blob, unsaved.n)}>
              <RotateCcw /> Save the take again
            </Button>
            <Button size="sm" variant="ghost" onClick={() => (setUnsaved(null), setError(null))}>
              Discard it
            </Button>
          </div>
        )}
        {takes.length > 0 && (
          <ol className="space-y-3">
            {takes.map((p) => (
              <li key={p.id} className="space-y-1.5 border-t pt-3">
                <div className="flex items-center gap-2">
                  <p className="text-xs text-muted-foreground">
                    Take {num.get(p.id)}
                    {p.duration ? ` · ${p.duration.toFixed(1)} s` : ""} · {when(p.at)}
                  </p>
                  {picks[p.n] === p.id ? (
                    <Button size="sm" variant="secondary" className="ml-auto" title="This take is used for the line. Click to unpick it." onClick={() => op({ op: "voice.keep", n: p.n, id: null, by: ME }).then(rebuild)}>
                      <Check className="text-emerald-600" /> Using this take
                    </Button>
                  ) : (
                    <Button size="sm" variant="outline" className="ml-auto" disabled={!p.converted} onClick={() => op({ op: "voice.keep", n: p.n, id: p.id, by: ME }).then(rebuild)}>
                      Use this take
                    </Button>
                  )}
                  <Button size="icon-sm" variant="ghost" aria-label="Remove this take" title="Remove it from the list (the files stay on disk)" onClick={() => op({ op: "voice.remove", id: p.id, by: ME }).then(() => (picks[p.n] === p.id ? rebuild() : undefined))}>
                    <Trash2 />
                  </Button>
                </div>
                {p.note && <p className="text-xs leading-relaxed text-muted-foreground">{p.note}</p>}
                <div className="grid grid-cols-[7rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5">
                  {p.converted?.file !== p.file && (
                    <>
                      <span className="text-sm text-muted-foreground">You</span>
                      <audio controls preload="metadata" src={`/${p.file}`} className="h-8 w-full" />
                      <span />
                    </>
                  )}
                  <span className="truncate text-sm font-medium">{short(p.who)}</span>
                  {p.converted ? <audio controls preload="metadata" src={`/${p.converted.file}`} className="h-8 w-full" /> : <span className={cn("text-sm", p.error ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground")}>{p.error ?? "Converting..."}</span>}
                  {p.converted?.match !== undefined ? (
                    <span className="font-mono text-xs text-muted-foreground" title="Speaker similarity to his real recording (resemblyzer). Two real lines of his score about 0.71.">
                      match {p.converted.match.toFixed(2)}
                    </span>
                  ) : p.error ? (
                    <Button size="sm" variant="ghost" onClick={() => again(p.id)}>
                      <RotateCcw /> Again
                    </Button>
                  ) : (
                    <span />
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}
        {gone.length > 0 && (
          <div className="border-t pt-3 text-xs text-muted-foreground">
            <button type="button" className="hover:text-foreground" onClick={() => setShowGone((s) => !s)}>
              {showGone ? "Hide" : "Show"} {gone.length} removed {gone.length === 1 ? "take" : "takes"}
            </button>
            {showGone && (
              <ul className="mt-2 space-y-1.5">
                {gone.map((p) => (
                  <li key={p.id} className="flex items-center gap-3 opacity-70">
                    <span className="w-14 shrink-0">Take {num.get(p.id)}</span>
                    <audio controls preload="none" src={`/${(p.converted ?? p).file}`} className="h-8 min-w-0 flex-1" />
                    <Button size="sm" variant="ghost" onClick={() => op({ op: "voice.remove", id: p.id, removed: false, by: ME })}>
                      Restore
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
      )}

      <ol className="grid gap-0.5">
        {lines.map((l, k) => (
          <li key={l.n}>
            <button type="button" onClick={() => setParams({ line: String(l.n), mode: "lines" }, { push: false, keepHash: true })} className={cn("flex w-full items-baseline gap-3 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted", l.n === line.n && "bg-muted")}>
              <span className="w-5 shrink-0 font-mono text-xs text-muted-foreground">{k + 1}</span>
              {who === "all" && <span className="w-14 shrink-0 truncate text-xs text-muted-foreground">{short(l.who)}</span>}
              <span className="min-w-0 flex-1 truncate">{l.text}</span>
              {picks[l.n] ? <Check className="size-4 shrink-0 text-emerald-600" aria-label="Take picked" /> : done.has(l.n) ? <span className="size-1.5 shrink-0 self-center rounded-full bg-muted-foreground/60" title="Recorded, no take picked yet" /> : null}
            </button>
          </li>
        ))}
      </ol>
    </div>
  )
}

function LineRow({ l, who }: { l: VoiceLine; who: string }) {
  return (
    <div className="space-y-1">
      <p className="text-sm leading-relaxed">
        <span className="font-medium">{who}</span> <span className="text-muted-foreground">{l.text}</span>
      </p>
      <div className="flex items-center gap-3">
        <audio controls preload="none" src={`/${l.file}`} className="h-8 min-w-0 flex-1" />
        <span className="shrink-0 font-mono text-xs text-muted-foreground">{l.start.toFixed(1)}-{l.end.toFixed(1)} s</span>
        {l.match !== undefined && <span className="shrink-0 text-xs text-muted-foreground" title="Speaker similarity to his real recording (resemblyzer). Two real lines of his score about 0.71.">match {l.match.toFixed(2)}</span>}
      </div>
    </div>
  )
}
