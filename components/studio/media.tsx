"use client"

// Shared render pieces. Every view shows assets, scores and verdicts through these, so they look and mean the same
// everywhere. Lists show small posters from /api/thumb, never the file itself; a click opens the one viewer, the only
// place (with the take player in a shot's detail) where a full image loads or a video plays. Audio goes through one
// shared player, so a list of lines holds no media elements at all.

import { Box, ChevronLeft, ChevronRight, Pause, Play, X } from "lucide-react"
import { createContext, memo, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
import type { AssetUse } from "@/lib/derive"
import { modelInfo } from "@/lib/models"
import type { Asset, Id, LineMode, Project, TakeVerdict, Verdict } from "@/lib/model"
import { cn } from "@/lib/utils"

type Media = {
  mtimes: Record<Id, number>
  uses: Map<Id, AssetUse[]>
  assets: Map<Id, Asset>
  baselines: Project["baselines"]
  /** Open the viewer on `list`, at `index`; arrow keys move through the list. */
  open: (list: Asset[], index?: number) => void
  /** Play an audio asset in the shared player, or stop it if it is the one playing. */
  play: (a: Asset) => void
}
const MediaCtx = createContext<Media | null>(null)
const PlayingCtx = createContext<Id | null>(null)
export function useMedia() {
  const m = useContext(MediaCtx)
  if (!m) throw new Error("useMedia outside MediaProvider")
  return m
}

/** A small WebP poster of an image or video (a frame 1 s in), versioned by the file's time so it caches for good. */
export const posterUrl = (a: Asset, w: number, mtimes: Record<Id, number>) =>
  `/api/thumb?src=${encodeURIComponent(a.path)}&w=${w}${mtimes[a.id] ? `&v=${mtimes[a.id]}` : ""}`

export function MediaProvider({ mtimes, uses, assets, baselines, children }: Omit<Media, "open" | "play"> & { children: React.ReactNode }) {
  const [view, setView] = useState<{ list: Asset[]; i: number } | null>(null)
  const [playing, setPlaying] = useState<Id | null>(null)
  const audio = useRef<HTMLAudioElement | null>(null)
  const current = useRef<Id | null>(null)

  const open = useCallback((list: Asset[], i = 0) => {
    audio.current?.pause()
    setView({ list, i })
  }, [])
  const play = useCallback((a: Asset) => {
    if (!audio.current) {
      audio.current = new Audio()
      audio.current.addEventListener("ended", () => ((current.current = null), setPlaying(null)))
    }
    const el = audio.current
    if (current.current === a.id) {
      el.pause()
      current.current = null
      setPlaying(null)
      return
    }
    el.src = a.path
    el.play().catch(() => {})
    current.current = a.id
    setPlaying(a.id)
  }, [])
  useEffect(() => () => audio.current?.pause(), [])

  const value = useMemo(() => ({ mtimes, uses, assets, baselines, open, play }), [mtimes, uses, assets, baselines, open, play])
  const move = useCallback((d: number) => setView((v) => (v ? { ...v, i: (v.i + d + v.list.length) % v.list.length } : v)), [])
  const close = useCallback(() => setView(null), [])
  return (
    <MediaCtx.Provider value={value}>
      <PlayingCtx.Provider value={playing}>
        {children}
        {view && <Viewer list={view.list} i={view.i} onMove={move} onClose={close} />}
      </PlayingCtx.Provider>
    </MediaCtx.Provider>
  )
}

type ThumbProps = {
  asset?: Asset
  /** Poster width in pixels to ask for: about twice the drawn width. */
  w?: number
  className?: string
  /** The viewer steps through this list (defaults to the asset alone). */
  list?: Asset[]
  /** Replaces opening the viewer. */
  onClick?: () => void
  fit?: "cover" | "contain"
}

/** An asset as a poster: images and videos draw a lazy WebP thumbnail (videos with a play mark), audio is a play button. */
export const Thumb = memo(function Thumb({ asset, w = 320, className, list, onClick, fit = "cover" }: ThumbProps) {
  const m = useMedia()
  if (!asset) return <div className={cn("grid place-items-center rounded bg-muted text-[11px] text-muted-foreground", className)}>none</div>
  if (asset.media === "audio") return <AudioButton asset={asset} className={className} />
  if (asset.media === "model")
    return <div title={asset.label} className={cn("grid place-items-center rounded bg-muted text-muted-foreground", className)}><Box className="size-5" /></div>
  const click = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (onClick) return onClick()
    const l = list ?? [asset]
    m.open(l, Math.max(0, l.findIndex((x) => x.id === asset.id)))
  }
  return (
    <button type="button" title={asset.label} onClick={click} className={cn("relative block shrink-0 overflow-hidden rounded bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring", className)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={posterUrl(asset, w, m.mtimes)} alt="" loading="lazy" decoding="async" draggable={false} className={cn("size-full", fit === "cover" ? "object-cover" : "object-contain")} />
      {asset.media === "video" && (
        <span className="absolute bottom-1 left-1 grid size-5 place-items-center rounded-full bg-black/65 text-white"><Play className="size-2.5 fill-current" /></span>
      )}
    </button>
  )
})

/** Play or stop an audio asset in the shared player. */
export function AudioButton({ asset, label, className }: { asset: Asset; label?: React.ReactNode; className?: string }) {
  const { play } = useMedia()
  const on = useContext(PlayingCtx) === asset.id
  return (
    <button type="button" title={asset.label} onClick={(e) => (e.stopPropagation(), play(asset))}
      className={cn("flex min-w-0 items-center gap-2 rounded-md bg-muted px-2 py-1 text-left text-[11px] hover:bg-muted/70", on && "bg-sky-400/15 text-sky-200", className)}>
      {on ? <Pause className="size-3.5 shrink-0" /> : <Play className="size-3.5 shrink-0" />}
      <span className="min-w-0 truncate">{label ?? asset.label}</span>
      {asset.duration ? <span className="ml-auto shrink-0 font-mono text-muted-foreground">{asset.duration.toFixed(1)}s</span> : null}
    </button>
  )
}

/** The one place a full image or a video opens: the file, what made it, its scores and where it is used. */
function Viewer({ list, i, onMove, onClose }: { list: Asset[]; i: number; onMove: (d: number) => void; onClose: () => void }) {
  const m = useMedia()
  const a = list[i]
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
      else if (e.key === "ArrowRight" && list.length > 1) onMove(1)
      else if (e.key === "ArrowLeft" && list.length > 1) onMove(-1)
    }
    window.addEventListener("keydown", key)
    return () => window.removeEventListener("keydown", key)
  }, [onClose, onMove, list.length])
  if (!a) return null
  const uses = m.uses.get(a.id) ?? []
  const inputs = (a.gen?.inputs ?? []).map((id) => m.assets.get(id)).filter((x): x is Asset => !!x)
  const stop = (e: React.MouseEvent) => e.stopPropagation()
  const b = m.baselines
  return (
    <div role="dialog" aria-modal aria-label={a.label} className="fixed inset-0 z-50 flex flex-col bg-black/90 backdrop-blur-sm" onClick={onClose}>
      <div className="flex items-center gap-3 border-b border-white/10 px-4 py-2.5" onClick={stop}>
        <span className="min-w-0 truncate text-sm font-medium">{a.label}</span>
        {list.length > 1 && <span className="shrink-0 font-mono text-xs text-muted-foreground">{i + 1} / {list.length}</span>}
        <button type="button" onClick={onClose} aria-label="Close" className="ml-auto rounded-md p-1 text-muted-foreground hover:bg-white/10 hover:text-foreground"><X className="size-5" /></button>
      </div>
      <div className="relative grid min-h-0 flex-1 place-items-center p-4">
        {a.media === "video" ? (
          <video key={a.id} src={a.path} controls autoPlay playsInline onClick={stop} className="max-h-full max-w-full rounded-md bg-black" />
        ) : a.media === "image" ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={a.id} src={a.path} alt={a.label} onClick={stop} className="max-h-full max-w-full rounded-md object-contain" />
        ) : a.media === "audio" ? (
          <audio key={a.id} src={a.path} controls autoPlay onClick={stop} className="w-[min(560px,90vw)]" />
        ) : (
          <div className="text-sm text-muted-foreground" onClick={stop}>A 3D room: open it in Rooms.</div>
        )}
        {list.length > 1 && (
          <>
            <button type="button" aria-label="Previous" onClick={(e) => (stop(e), onMove(-1))} className="absolute top-1/2 left-3 grid size-10 -translate-y-1/2 place-items-center rounded-full bg-white/10 hover:bg-white/20"><ChevronLeft className="size-5" /></button>
            <button type="button" aria-label="Next" onClick={(e) => (stop(e), onMove(1))} className="absolute top-1/2 right-3 grid size-10 -translate-y-1/2 place-items-center rounded-full bg-white/10 hover:bg-white/20"><ChevronRight className="size-5" /></button>
          </>
        )}
      </div>
      <div className="max-h-[32vh] overflow-y-auto border-t border-white/10 px-4 py-3 text-xs" onClick={stop}>
        <div className="flex flex-wrap items-center gap-1.5">
          <Chip tone={a.origin === "real" ? "good" : "muted"}>{a.origin}</Chip>
          <FaceChip value={a.scores?.face} target={b.faceTarget} baseline={b.face} />
          <VoiceChip value={a.scores?.voice} baseline={b.voice} />
          <VerdictChip verdict={a.qa?.verdict} note={a.qa?.note} />
          {a.duration ? <Chip tone="muted">{fmt(a.duration)}</Chip> : null}
          {m.mtimes[a.id] && <span className="text-muted-foreground">made {stamp(m.mtimes[a.id])}</span>}
        </div>
        {a.gen?.steps && a.gen.steps.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="text-muted-foreground">Made by</span>
            {a.gen.steps.map((s, i) => (
              <span key={i} className="flex items-center gap-1.5">
                {i > 0 && <span className="text-muted-foreground">then</span>}
                <Chip tone={s.inferred ? "muted" : "good"} title={`${s.model} on ${s.provider}${s.job ? `, job ${s.job}` : ""}${s.costUsd ? `, $${s.costUsd.toFixed(2)}` : ""}${s.inferred ? " (read from the label, no job record)" : ""}${s.settings ? `\n${JSON.stringify(s.settings)}` : ""}`}>
                  {modelInfo(s.model)?.name ?? s.model} · {s.provider}{s.job ? ` · ${s.job.slice(0, 10)}` : ""}
                </Chip>
              </span>
            ))}
          </div>
        )}
        {uses.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="text-muted-foreground">Used in</span>
            {uses.map((u) => <Chip key={u.what} tone={u.picked || u.cut ? "good" : "muted"}>{u.what}</Chip>)}
          </div>
        )}
        {a.qa?.note && <p className="mt-2 max-w-4xl leading-relaxed">{a.qa.note}</p>}
        {a.gen?.prompt && <p className="mt-2 line-clamp-4 max-w-4xl leading-relaxed text-muted-foreground" title={a.gen.prompt}>{a.gen.prompt}</p>}
        {inputs.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="text-muted-foreground">Made from</span>
            {inputs.map((x) => <Thumb key={x.id} asset={x} w={160} list={inputs} className="h-10 w-16" />)}
          </div>
        )}
      </div>
    </div>
  )
}

type Tone = "good" | "warn" | "bad" | "muted"
const toneCls: Record<Tone, string> = {
  good: "bg-emerald-400/15 text-emerald-300",
  warn: "bg-amber-400/15 text-amber-300",
  bad: "bg-rose-400/15 text-rose-300",
  muted: "bg-muted text-muted-foreground",
}
export function Chip({ tone, children, title, className }: { tone: Tone; children: React.ReactNode; title?: string; className?: string }) {
  return <span title={title} className={cn("inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap", toneCls[tone], className)}>{children}</span>
}

export const faceTone = (v: number, target: number): Tone => (v >= target ? "good" : v >= target - 0.1 ? "warn" : "bad")
export function FaceChip({ value, target, baseline }: { value?: number; target: number; baseline: number }) {
  if (value === undefined) return null
  return <Chip tone={faceTone(value, target)} title={`Face match to real Henrick footage. Real vs real: ${baseline}. Target: ${target}.`}>face {value.toFixed(2)}</Chip>
}
export function VoiceChip({ value, baseline }: { value?: number; baseline: number }) {
  if (value === undefined) return null
  return <Chip tone={value >= baseline ? "good" : "warn"} title={`Voice match to Henrick's real recordings. Real vs real: ${baseline}.`}>voice {value.toFixed(2)}</Chip>
}
export function VerdictChip({ verdict, note }: { verdict?: Verdict; note?: string }) {
  if (!verdict) return null
  return <Chip tone={verdict === "pass" ? "good" : verdict === "borderline" ? "warn" : "bad"} title={note}>{verdict}</Chip>
}
export function TakeChip({ verdict }: { verdict: TakeVerdict }) {
  const t: Record<TakeVerdict, Tone> = { circled: "good", alt: "muted", reject: "bad", pending: "warn" }
  return <Chip tone={t[verdict]}>{verdict === "circled" ? "picked" : verdict}</Chip>
}
export function ModeChip({ mode }: { mode: LineMode }) {
  if (mode === "native") return <Chip tone="good" title="Spoken inside the clip, lip-synced">on camera</Chip>
  if (mode === "vo") return <Chip tone="muted" title="Speaker off screen or facing away">voice-over</Chip>
  return <Chip tone="bad" title="Audio laid over an on-camera speaker: not lip-synced">not lip-synced</Chip>
}

export const fmt = (t: number) => `${t.toFixed(1)}s`
/** Wall-clock time, with the day when it is not today: "7:55 PM", "Oct 5, 7:55 PM". */
export function stamp(t: number) {
  const d = new Date(t)
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
  return d.toDateString() === new Date().toDateString() ? time : `${d.toLocaleDateString([], { month: "short", day: "numeric" })}, ${time}`
}
/** How long ago, in words: "just now", "4 min ago", "2 h ago", "3 d ago". */
export function ago(t: number, now: number) {
  const s = Math.max(0, (now - t) / 1000)
  if (s < 45) return "just now"
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} h ago`
  return `${Math.round(s / 86400)} d ago`
}
/** The current time, refreshed every `ms`, for relative times. */
export function useNow(ms = 30_000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(t)
  }, [ms])
  return now
}
