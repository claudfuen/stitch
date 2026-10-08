"use client"

// Stage 04's scene mode: the performer records a role through the whole read in one continuous take. The other
// roles' lines play as cues (in headphones, so they stay out of the recording) and wait for the performer; Space ends
// each of the performer's lines and plays the next cue. One recording keeps the voice the same from line to line and
// the timing conversational. The server converts it in one pass, cuts each line at its words, picks those takes and
// builds a new read (POST /api/perform/scene, lib/perform.ts performScene).

import { LoaderCircle, Mic, Square } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import type { SceneEvent, VoiceTake } from "@/lib/process"
import { cn } from "@/lib/utils"
import { useRecorder } from "./recorder"
import { projectSlug } from "./use-project"

type Phase = "ready" | "running" | "saving" | "done"
type Run = { t0: number; events: SceneEvent[]; shown: number; audio: HTMLAudioElement | null; over: boolean }

const Kbd = ({ children }: { children: React.ReactNode }) => <kbd className="rounded border px-1.5 py-0.5 font-mono text-[11px] opacity-70">{children}</kbd>

/** `who`: the role performed against the others as cues, or "all": every line waits for the performer, who reads every part. */
export function SceneRecorder({ take, who, name, by }: { take: VoiceTake; who: string; name: (who: string) => string; by: string }) {
  const { start, stop, setState, error, setError, meter, clock } = useRecorder()
  const lines = [...take.lines].sort((a, b) => a.n - b.n)
  const [phase, setPhase] = useState<Phase>("ready")
  const [i, setI] = useState(0)
  const [done, setDone] = useState<{ text: string; file: string } | null>(null)
  const [unsaved, setUnsaved] = useState<{ blob: Blob; events: SceneEvent[] } | null>(null)
  const run = useRef<Run | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const isMine = (w: string) => who === "all" || w === who
  const mine = lines.filter((l) => isMine(l.who)).length
  const role = who === "all" ? "every part" : name(who)
  const slugQ = projectSlug() ? `&p=${encodeURIComponent(projectSlug())}` : ""
  const at = (r: Run) => (performance.now() - r.t0) / 1000

  const upload = async (blob: Blob, events: SceneEvent[]) => {
    setPhase("saving")
    setError(null)
    const form = new FormData()
    form.append("audio", blob, "scene")
    form.append("who", who)
    form.append("take", take.id)
    form.append("events", JSON.stringify(events))
    try {
      const res = await fetch(`/api/perform/scene?by=${by}${slugQ}`, { method: "POST", body: form })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error ?? "Saving the scene failed")
      setUnsaved(null)
      setDone({ text: `${j.performances.length} of your lines were cut, converted and picked, and read ${j.take.id} is built from them. It is playing. To redo a line, click it in the list below, press Space, say it, press Space: the new take replaces it in the read.`, file: j.take.file })
      setPhase("done")
    } catch (e) {
      setUnsaved({ blob, events })
      setError(`${(e as Error).message}. The recording is kept here: save it again.`)
      setPhase("ready")
    }
  }

  const finish = async () => {
    const r = run.current
    if (!r || r.over) return
    r.over = true
    r.audio?.pause()
    run.current = null
    const blob = await stop()
    setState("idle")
    if (!blob || !r.events.some((e) => e.kind === "mine")) {
      setPhase("ready")
      setError("Nothing to save: none of your lines were recorded.")
      return
    }
    await upload(blob, r.events)
  }

  /** Line k: a cue plays and moves on by itself; the performer's line waits for Space. */
  const show = (k: number) => {
    const r = run.current
    if (!r || r.over) return
    if (k >= lines.length) return void finish()
    setI(k)
    r.shown = at(r)
    const l = lines[k]
    if (isMine(l.who)) return
    const a = new Audio(`/${l.file}`)
    r.audio = a
    const next = () => {
      if (run.current !== r || r.over) return
      r.events.push({ n: l.n, kind: "cue", start: r.shown, end: at(r) })
      show(k + 1)
    }
    a.onended = next
    a.onerror = next
    a.play().catch(next)
  }

  /** The performer finished their line: note where it was, then the next cue. */
  const said = () => {
    const r = run.current
    const l = lines[i]
    if (!r || r.over || !l || !isMine(l.who)) return
    r.events.push({ n: l.n, kind: "mine", start: r.shown, end: at(r) })
    show(i + 1)
  }

  const begin = async () => {
    setError(null)
    setDone(null)
    if (!(await start())) return
    run.current = { t0: performance.now(), events: [], shown: 0, audio: null, over: false }
    setPhase("running")
    show(0)
  }

  const cancel = async () => {
    const r = run.current
    if (r) {
      r.over = true
      r.audio?.pause()
    }
    run.current = null
    await stop()
    setState("idle")
    setPhase("ready")
  }

  // Space starts the scene and ends each of your lines; Escape cancels. Only while this is on screen and nobody types.
  const keys = useRef({ said, begin, cancel, phase })
  useEffect(() => {
    keys.current = { said, begin, cancel, phase }
  })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || (e.target as HTMLElement).closest("input, textarea, select, [contenteditable=true], [role=listbox], [role=option]")) return
      const b = box.current?.getBoundingClientRect()
      if (!b || b.bottom < 0 || b.top > window.innerHeight) return
      const k = keys.current
      if (e.code === "Space" && (k.phase === "running" || k.phase === "ready")) {
        e.preventDefault()
        ;(document.activeElement as HTMLElement | null)?.blur?.()
        if (k.phase === "running") k.said()
        else void k.begin()
      } else if (e.key === "Escape" && k.phase === "running") void k.cancel()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  // Silence the cue if the page goes away mid-scene (the recorder lets go of the microphone itself).
  useEffect(() => {
    const holder = run
    return () => {
      const r = holder.current
      if (r) {
        r.over = true
        r.audio?.pause()
      }
    }
  }, [])

  const cur = lines[i]
  const prev = lines[i - 1]
  const after = lines[i + 1]
  return (
    <div ref={box} className="space-y-4 rounded-lg border p-5">
      {phase === "ready" && (
        <div className="space-y-3">
          <p className="text-sm leading-relaxed">
            {who === "all" ? (
              <>
                <span className="font-medium">You read every part.</span> All {mine} lines wait for you in order: say each one as its character, then press <Kbd>Space</Kbd>. Each line becomes its own character&apos;s voice. One take, start to finish: Escape cancels, Stop saves what you have.
              </>
            ) : (
              <>
                <span className="font-medium">Headphones on.</span> The whole read plays with the other parts in your ears, and it waits for you at each of {name(who)}&apos;s {mine} lines. Say the line, then press <Kbd>Space</Kbd> for the next cue. One take, start to finish: Escape cancels, Stop saves what you have.
              </>
            )}
          </p>
          <Button size="lg" onClick={(e) => (e.currentTarget.blur(), void begin())}>
            <Mic /> Start the scene <Kbd>Space</Kbd>
          </Button>
        </div>
      )}
      {phase === "running" && cur && (
        <div className="space-y-4">
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="size-2 shrink-0 animate-pulse rounded-full bg-red-500" />
            <span className="shrink-0">
              Line {i + 1} of {lines.length}
            </span>
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
              <div className="h-full bg-foreground/30" style={{ width: `${(i / lines.length) * 100}%` }} />
            </div>
            <div className="h-1.5 w-20 overflow-hidden rounded-full bg-muted">
              <div ref={meter} className="h-full w-0 bg-emerald-500 data-[hot=true]:bg-red-500" />
            </div>
            <span ref={clock} className="w-12 text-right font-mono tabular-nums" />
          </div>
          {prev && (
            <p className="text-sm text-muted-foreground">
              <span className="font-medium">{name(prev.who)}:</span> {prev.text}
            </p>
          )}
          <div className={cn("space-y-1 rounded-md p-4", isMine(cur.who) ? "bg-emerald-500/10 ring-1 ring-emerald-500/40" : "bg-muted/60")}>
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{isMine(cur.who) ? (who === "all" ? `You, as ${name(cur.who)}` : "You") : `${name(cur.who)}, playing`}</p>
            <p className={cn("leading-snug", isMine(cur.who) ? "text-2xl font-medium tracking-tight" : "text-lg text-muted-foreground")}>{cur.text}</p>
          </div>
          {after && (
            <p className="text-sm text-muted-foreground">
              Next, <span className="font-medium">{name(after.who)}:</span> {after.text}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {isMine(cur.who) && (
              <Button size="lg" onClick={(e) => (e.currentTarget.blur(), said())}>
                Next <Kbd>Space</Kbd>
              </Button>
            )}
            <Button variant="outline" onClick={() => void finish()}>
              <Square /> Stop and save
            </Button>
            <Button variant="ghost" onClick={() => void cancel()}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      {phase === "saving" && (
        <p className="flex items-center gap-2 text-sm">
          <LoaderCircle className="size-4 animate-spin" /> Converting {role}, cutting your lines and building the read: about 20 seconds.
        </p>
      )}
      {phase === "done" && (
        <div className="space-y-3">
          <p className="text-sm leading-relaxed">{done?.text}</p>
          {done && <audio controls autoPlay src={`/${done.file}`} className="w-full" />}
          <Button variant="outline" onClick={() => setPhase("ready")}>
            Record the scene again
          </Button>
        </div>
      )}
      {error && <p className="text-sm text-amber-600 dark:text-amber-400">{error}</p>}
      {unsaved && phase === "ready" && (
        <div className="flex gap-2">
          <Button size="sm" onClick={() => void upload(unsaved.blob, unsaved.events)}>
            Save the recording again
          </Button>
          <Button size="sm" variant="ghost" onClick={() => (setUnsaved(null), setError(null))}>
            Discard it
          </Button>
        </div>
      )}
    </div>
  )
}
