"use client"

// Shared render pieces. Every view shows assets, scores and verdicts through these, so they look and
// mean the same everywhere.

import type { Asset, LineMode, TakeVerdict, Verdict } from "@/lib/model"
import { cn } from "@/lib/utils"

export function Thumb({ asset, className, controls, autoPlay }: { asset?: Asset; className?: string; controls?: boolean; autoPlay?: boolean }) {
  if (!asset) return <div className={cn("grid place-items-center bg-muted text-[11px] text-muted-foreground", className)}>none</div>
  if (asset.media === "image")
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={asset.path} alt={asset.label} className={cn("bg-muted object-cover", className)} />
  if (asset.media === "video")
    return <video src={asset.path} className={cn("bg-black object-cover", className)} controls={controls} autoPlay={autoPlay} muted={!controls} loop playsInline preload="metadata" />
  return (
    <div className={cn("flex flex-col justify-center gap-1 bg-muted p-2", className)}>
      <div className="truncate text-[11px] text-muted-foreground">{asset.label}</div>
      <audio src={asset.path} controls preload="none" className="h-7 w-full" />
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
