"use client"

import { Handle, Position, useReactFlow, type NodeProps } from "@xyflow/react"
import { ImageIcon, Loader2, Type, Video } from "lucide-react"
import type { AssetNode, GenNode, MotionNode, PromptNode, SectionNode } from "@/lib/graph"
import { cn } from "@/lib/utils"

const handleCls = "!size-2.5 !border-2 !border-background !bg-sky-400"

function Shell({ title, icon, selected, children, className }: { title: string; icon: React.ReactNode; selected?: boolean; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-xl border bg-card text-card-foreground shadow-lg", selected ? "border-sky-400 ring-2 ring-sky-400/30" : "border-border", className)}>
      <div className="flex items-center gap-1.5 px-3 pt-2.5 pb-2 text-xs font-medium text-muted-foreground">
        {icon}
        {title}
      </div>
      {children}
    </div>
  )
}

export function PromptNodeView({ id, data, selected }: NodeProps<PromptNode>) {
  const { updateNodeData } = useReactFlow()
  return (
    <Shell title={data.title ?? "Prompt"} icon={<Type className="size-3.5" />} selected={selected} className="w-72">
      <textarea
        value={data.text}
        onChange={(ev) => updateNodeData(id, { text: ev.target.value })}
        className="nodrag nowheel mx-3 mb-3 block h-36 w-[calc(100%-1.5rem)] resize-none rounded-md bg-background/60 p-2 text-xs leading-relaxed outline-none focus:ring-1 focus:ring-sky-400/60"
      />
      <Handle type="source" position={Position.Right} className={handleCls} />
    </Shell>
  )
}

export function AssetNodeView({ data, selected }: NodeProps<AssetNode>) {
  return (
    <Shell title={data.title ?? "Reference"} icon={<ImageIcon className="size-3.5" />} selected={selected} className="w-60">
      {data.url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={data.url} alt={data.label} className="mx-3 block h-28 w-[calc(100%-1.5rem)] rounded-md object-cover" />
      ) : (
        <div className="mx-3 h-24 rounded-md" style={{ background: `linear-gradient(135deg, hsl(${data.hue} 40% 25%), hsl(${data.hue + 40} 50% 12%))` }} />
      )}
      <div className="truncate px-3 pt-2 pb-3 font-mono text-[11px] text-muted-foreground">{data.label}</div>
      <Handle type="source" position={Position.Right} className={handleCls} />
    </Shell>
  )
}

export function GenerationNodeView({ id, data, selected }: NodeProps<GenNode>) {
  const { updateNodeData } = useReactFlow()
  const isVideo = data.kind === "video"
  const run = () => {
    updateNodeData(id, { status: "running" })
    setTimeout(() => updateNodeData(id, { status: "done", hue: Math.floor(Math.random() * 360) }), 2000)
  }
  return (
    <Shell title={data.title ?? (isVideo ? "Video Generation" : "Image Generation")} icon={isVideo ? <Video className="size-3.5" /> : <ImageIcon className="size-3.5" />} selected={selected} className={isVideo ? "w-80" : "w-52"}>
      <div
        className={cn("relative mx-3 grid place-items-center overflow-hidden rounded-md", isVideo ? "aspect-video" : "aspect-square")}
        style={{ background: data.url ? "#000" : data.status === "done" ? `linear-gradient(135deg, hsl(${data.hue} 55% 35%), hsl(${data.hue + 50} 60% 10%))` : "var(--muted)" }}
      >
        {data.url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={data.url} alt={data.title ?? "generation"} className="absolute inset-0 size-full object-cover" />
        )}
        {data.status === "running" && <Loader2 className="size-5 animate-spin text-muted-foreground" />}
        {data.status === "idle" && <span className="text-[11px] text-muted-foreground">not generated</span>}
      </div>
      <div className="flex items-center justify-between px-3 pt-2 pb-3 text-[11px] text-muted-foreground">
        <span className="font-mono">{data.model}</span>
        <button onClick={run} disabled={data.status === "running"} className="nodrag rounded-md bg-sky-400/15 px-2 py-0.5 text-sky-300 hover:bg-sky-400/25 disabled:opacity-50">
          {data.status === "done" ? "Regenerate" : "Generate"}
        </button>
      </div>
      <Handle type="target" position={Position.Left} className={handleCls} />
      <Handle type="source" position={Position.Right} className={handleCls} />
      <Handle id="overlay" type="target" position={Position.Bottom} className="!size-2 !border-0 !bg-amber-400" />
    </Shell>
  )
}

export function SectionNodeView({ data }: NodeProps<SectionNode>) {
  return (
    <div className="h-full rounded-lg px-4 py-3" style={{ background: `${data.color}1f`, borderLeft: `4px solid ${data.color}` }}>
      <div className="flex items-baseline gap-2">
        <span className="text-sm font-semibold tracking-wide uppercase" style={{ color: data.color }}>{data.name}</span>
        <span className="font-mono text-xs text-muted-foreground">{data.range}</span>
      </div>
      <div className="mt-1 text-xs text-muted-foreground">{data.why}</div>
    </div>
  )
}

const motionStatus = { idea: "bg-muted-foreground/40", designed: "bg-amber-400", rendered: "bg-emerald-400" }

export function MotionNodeView({ data, selected }: NodeProps<MotionNode>) {
  return (
    <div className={cn("w-60 -rotate-1 rounded-sm border border-dashed border-amber-300/50 bg-amber-200/10 p-3 shadow-md", selected && "ring-2 ring-amber-300/50")}>
      <div className="flex items-center gap-2 text-[10px] tracking-wide text-amber-300 uppercase">
        <i className={cn("size-1.5 rounded-full", motionStatus[data.status])} />
        <span>Motion graphic · {data.kind}</span>
        <span className="ml-auto font-mono normal-case">{data.start}-{data.end}s</span>
      </div>
      <div className="mt-1.5 text-sm font-medium leading-snug">{data.title}</div>
      <div className="mt-1 text-xs leading-snug text-muted-foreground">{data.note}</div>
      <div className="mt-2 font-mono text-[10px] text-muted-foreground">{data.tool}</div>
      <Handle type="source" position={Position.Top} className="!size-2 !border-0 !bg-amber-400" />
    </div>
  )
}

export const nodeTypes = { motion: MotionNodeView, section: SectionNodeView, prompt: PromptNodeView, asset: AssetNodeView, generation: GenerationNodeView }
