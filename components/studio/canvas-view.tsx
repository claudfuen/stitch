"use client"

import { Background, BackgroundVariant, Controls, Handle, MiniMap, Position, ReactFlow, useNodesState, useReactFlow, type Edge, type Node, type NodeProps } from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import { useEffect, useMemo, useRef } from "react"
import { canvasGraph, type CanvasEdge, type CanvasNode, type Index, type ShotRow } from "@/lib/derive"
import type { ProjectWithRev } from "@/lib/model"
import type { Op } from "@/lib/ops"
import { cn } from "@/lib/utils"
import { Chip, FaceChip, ModeChip, Thumb, VerdictChip, VoiceChip, fmt } from "./media"

type Data<K extends CanvasNode["kind"]> = Extract<CanvasNode, { kind: K }>["data"] & { baselines: ProjectWithRev["baselines"] }
const dot = "!size-2 !border-0 !bg-sky-400/70"

function AssetNode({ data }: NodeProps<Node<Data<"asset">>>) {
  const a = data.asset
  return (
    <div className={cn("w-[220px] rounded-xl border bg-card p-2 shadow-lg", data.circled && "border-emerald-400/60")}>
      <Handle id="t" type="target" position={Position.Top} className={dot} />
      <Handle id="b" type="target" position={Position.Bottom} className={dot} />
      <Handle id="l" type="target" position={Position.Left} className={dot} />
      <div className="mb-1.5 flex items-center gap-1.5 text-[10px] tracking-widest text-muted-foreground uppercase">
        {data.role}{data.shot && <span className="font-mono normal-case">· {data.shot}</span>}
        {!!data.alts && data.alts > 0 && <span className="ml-auto normal-case">+{data.alts} takes</span>}
      </div>
      <Thumb asset={a} className={cn("w-full rounded-md", a.media === "audio" ? "" : "aspect-video")} />
      <div className="mt-1.5 truncate text-[12px]" title={a.label}>{a.label}</div>
      <div className="mt-1 flex flex-wrap gap-1">
        <FaceChip value={a.scores?.face} target={data.baselines.faceTarget} baseline={data.baselines.face} />
        <VoiceChip value={a.scores?.voice} baseline={data.baselines.voice} />
        <VerdictChip verdict={a.qa?.verdict} note={a.qa?.note} />
        {a.origin === "real" && <Chip tone="good">real footage</Chip>}
      </div>
      <Handle id="s" type="source" position={Position.Bottom} className={dot} />
      <Handle id="r" type="source" position={Position.Right} className={dot} />
    </div>
  )
}

function ShotNode({ data }: NodeProps<Node<Data<"shot">>>) {
  const r: ShotRow = data.row
  const color = r.section?.color ?? "#64748b"
  return (
    <div className="w-[300px] rounded-lg px-3 py-2" style={{ background: `${color}1f`, borderLeft: `4px solid ${color}` }}>
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-base font-semibold" style={{ color }}>{r.shot.id}</span>
        <span className="truncate text-sm font-medium">{r.shot.name}</span>
        <span className="ml-auto text-[11px] text-muted-foreground">{r.shot.status}</span>
      </div>
      <div className="mt-1 flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
        <span style={{ color }}>{r.section?.name}</span>
        {r.timing && <span className="font-mono">{fmt(r.timing.start)} to {fmt(r.timing.start + r.timing.dur)}</span>}
        <span>checks {r.checked.ok}/{r.checked.total}</span>
        {r.issues.length > 0 && <span className="text-rose-300">{r.issues.length} issues</span>}
      </div>
    </div>
  )
}

function LinesNode({ data }: NodeProps<Node<Data<"lines">>>) {
  return (
    <div className="w-[300px] rounded-xl border bg-card p-3 shadow-lg">
      <div className="mb-1.5 text-[10px] tracking-widest text-muted-foreground uppercase">Dialogue · {data.row.shot.id}</div>
      <div className="space-y-1.5">
        {data.row.lines.map((l, i) => (
          <div key={i} className="text-[12px] leading-snug">
            <b>{l.speaker?.name ?? l.who}</b> {l.text} <ModeChip mode={l.mode} />
          </div>
        ))}
      </div>
      <Handle id="top" type="source" position={Position.Top} className={dot} />
    </div>
  )
}

function GraphicNode({ data }: NodeProps<Node<Data<"graphic">>>) {
  const g = data.use
  return (
    <div className="w-[220px] rotate-[-0.5deg] rounded-sm border border-dashed border-amber-300/50 bg-amber-200/10 p-2 shadow-md">
      <div className="mb-1 text-[10px] tracking-widest text-amber-300 uppercase">Motion graphic</div>
      <Thumb asset={g.preview} className="aspect-video w-full rounded-sm" autoPlay />
      <div className="mt-1 text-[12px]">{g.g?.label}</div>
      <div className="text-[11px] text-muted-foreground">at {fmt(g.at)} for {fmt(g.dur)}</div>
      <Handle id="top" type="source" position={Position.Top} className="!size-2 !border-0 !bg-amber-400" />
    </div>
  )
}

function CharacterNode({ data }: NodeProps<Node<Data<"character">>>) {
  const c = data.character
  return (
    <div className="w-[260px] rounded-xl border bg-card p-3 shadow-lg">
      <div className="text-[10px] tracking-widest text-muted-foreground uppercase">Character · {c.role}</div>
      <div className="mt-0.5 text-base font-semibold">{c.name}</div>
      <div className="mt-1 text-[11px] leading-snug text-muted-foreground">Voice: {c.voice?.engine}{c.voice?.note ? ` · ${c.voice.note}` : ""}</div>
      <div className="mt-1 text-[11px] text-muted-foreground">{c.anchors.length} real anchors · {c.sheets.length} sheets</div>
    </div>
  )
}

function LocationNode({ data }: NodeProps<Node<Data<"location">>>) {
  const l = data.location
  return (
    <div className="w-[260px] rounded-xl border bg-card p-3 shadow-lg">
      <div className="text-[10px] tracking-widest text-muted-foreground uppercase">Location · look</div>
      <div className="mt-0.5 text-base font-semibold">{l.name}</div>
      {l.look.concept && <div className="mt-1 text-[12px] leading-snug">{l.look.concept}</div>}
      <div className="mt-1.5 flex gap-1">{l.look.palette.map((c) => <span key={c} className="size-4 rounded-sm border" style={{ background: c }} />)}</div>
      <div className="mt-1.5 text-[11px] leading-snug text-muted-foreground">{l.look.light}. {l.look.lens}.</div>
      {data.style.length === 0 && <div className="mt-1.5"><Chip tone="warn">no set plate yet</Chip></div>}
      <Handle id="r" type="source" position={Position.Right} className={dot} />
    </div>
  )
}

function FinalNode({ data }: NodeProps<Node<Data<"final">>>) {
  const cut = data.cut
  return (
    <div className="w-[640px] rounded-2xl border-2 border-emerald-400/70 bg-card p-4 shadow-2xl" style={{ boxShadow: "0 0 0 6px rgba(52,211,153,0.08), 0 30px 80px rgba(0,0,0,0.6)" }}>
      <Handle id="l" type="target" position={Position.Left} className="!size-3 !border-2 !border-background !bg-emerald-400" />
      <div className="flex items-center gap-3">
        <span className="rounded-md bg-emerald-400 px-2.5 py-1 text-xs font-extrabold tracking-widest text-emerald-950 uppercase">Final cut</span>
        <span className="font-mono text-sm text-emerald-300">{cut?.version ?? "none"}</span>
        {cut && <span className="ml-auto font-mono text-xs text-muted-foreground">{fmt(cut.duration)}</span>}
      </div>
      {data.asset ? <Thumb asset={data.asset} className="nodrag nowheel mt-3 aspect-video w-full rounded-lg" controls /> : <div className="mt-3 aspect-video rounded-lg bg-muted" />}
      {cut?.audit?.issues && <ul className="mt-2 space-y-0.5 text-[12px] text-muted-foreground">{cut.audit.issues.map((i) => <li key={i}>· {i}</li>)}</ul>}
    </div>
  )
}

const nodeTypes = { asset: AssetNode, shot: ShotNode, lines: LinesNode, graphic: GraphicNode, character: CharacterNode, location: LocationNode, final: FinalNode }

const edgeStyle: Record<CanvasEdge["kind"], React.CSSProperties> = {
  input: { stroke: "#60a5fa", strokeWidth: 1.4, opacity: 0.55 },
  assumed: { stroke: "#64748b", strokeWidth: 1.2, strokeDasharray: "4 4", opacity: 0.6 },
  voice: { stroke: "#38bdf8", strokeWidth: 1.4, strokeDasharray: "2 3" },
  graphic: { stroke: "#fbbf24", strokeWidth: 1.4, strokeDasharray: "4 4" },
  cut: { stroke: "#34d399", strokeWidth: 1.8 },
  set: { stroke: "#a78bfa", strokeWidth: 1.4, opacity: 0.7 },
}
const handles: Record<CanvasEdge["kind"], { sourceHandle: string; targetHandle: string }> = {
  input: { sourceHandle: "s", targetHandle: "t" },
  assumed: { sourceHandle: "s", targetHandle: "t" },
  voice: { sourceHandle: "top", targetHandle: "b" },
  graphic: { sourceHandle: "top", targetHandle: "b" },
  cut: { sourceHandle: "r", targetHandle: "l" },
  set: { sourceHandle: "r", targetHandle: "l" },
}

export function CanvasView({ project: p, ix, rows, op, focus }: { project: ProjectWithRev; ix: Index; rows: ShotRow[]; op: (...o: Op[]) => Promise<void>; focus?: string | null }) {
  const graph = useMemo(() => canvasGraph(p, rows, ix), [p, rows, ix])
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([])
  const dragging = useRef(false)
  const { fitView } = useReactFlow()
  const first = useRef(true)

  useEffect(() => {
    if (dragging.current) return
    setNodes(graph.nodes.map((n) => ({ id: n.id, type: n.kind, position: { x: n.x, y: n.y }, data: { ...n.data, baselines: p.baselines } })))
    if (first.current) {
      first.current = false
      setTimeout(() => fitView({ padding: 0.08 }), 80)
    }
  }, [graph, setNodes, fitView, p.baselines])

  useEffect(() => {
    if (focus) setTimeout(() => fitView({ nodes: [{ id: focus }], padding: 0.8, duration: 450 }), 120)
  }, [focus, fitView])

  const edges: Edge[] = useMemo(
    () => graph.edges.map((e) => ({ id: e.id, source: e.source, target: e.target, ...handles[e.kind], style: edgeStyle[e.kind], animated: e.kind === "cut" })),
    [graph],
  )

  return (
    <ReactFlow
      nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={onNodesChange} colorMode="dark" minZoom={0.1} proOptions={{ hideAttribution: true }}
      onNodeDragStart={() => (dragging.current = true)}
      onNodeDragStop={(_, n) => {
        dragging.current = false
        op({ op: "position.set", node: n.id, x: n.position.x, y: n.position.y })
      }}
    >
      <Background variant={BackgroundVariant.Dots} gap={22} size={1} />
      <Controls showInteractive={false} position="bottom-left" />
      <MiniMap pannable zoomable className="!bg-card" maskColor="rgba(0,0,0,0.6)" />
    </ReactFlow>
  )
}
