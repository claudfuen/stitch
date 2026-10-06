"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import {
  addEdge, Background, BackgroundVariant, Controls, MiniMap, ReactFlow, ReactFlowProvider,
  useEdgesState, useNodesState, useReactFlow, type Connection, type Edge,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import { ImageIcon, Maximize, Type, Video } from "lucide-react"
import { nodeTypes } from "./nodes"
import type { Activity, AppNode, Story } from "@/lib/graph"
import { ActivityPanel } from "./activity"
import { Timeline } from "./timeline"
import { Button } from "@/components/ui/button"

let counter = 0

// What we persist: no measurements, selection or drag state.
const strip = (nodes: AppNode[]) =>
  nodes.map((n) => ({ id: n.id, type: n.type, position: n.position, data: n.data, ...(n.type === "section" ? { width: n.width, draggable: false, selectable: false, connectable: false } : {}) }))
const sig = (nodes: AppNode[], edges: Edge[]) => JSON.stringify([strip(nodes), edges])

type Remote = { nodes: AppNode[]; edges: Edge[]; story?: Story; activity?: Activity[]; rev: number }

function Inner() {
  const [nodes, setNodes, onNodesChange] = useNodesState<AppNode>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])
  const { screenToFlowPosition, fitView } = useReactFlow()
  const [story, setStory] = useState<Story | null>(null)
  const [activity, setActivity] = useState<Activity[]>([])
  const synced = useRef("")
  const rev = useRef(0)
  const loaded = useRef(false)
  const fromRemote = useRef(false)

  // The file on disk is the source of truth: poll it and apply external edits.
  useEffect(() => {
    let stop = false
    const pull = async () => {
      try {
        const r: Remote = await (await fetch("/api/graph", { cache: "no-store" })).json()
        if (stop || r.rev === rev.current) return
        rev.current = r.rev
        fromRemote.current = true
        setNodes(r.nodes)
        setEdges(r.edges)
        setStory(r.story ?? null)
        setActivity(r.activity ?? [])
        synced.current = sig(r.nodes, r.edges)
        if (!loaded.current) {
          loaded.current = true
          setTimeout(() => fitView({ padding: 0.1 }), 100)
        }
      } catch {}
    }
    pull()
    const t = setInterval(pull, 1000)
    return () => { stop = true; clearInterval(t) }
  }, [setNodes, setEdges, fitView])

  // Local edits (drag, type, connect) are written back to the same file, only when something real changed.
  useEffect(() => {
    if (!loaded.current) return
    if (fromRemote.current) { fromRemote.current = false; return }
    if (sig(nodes, edges) === synced.current) return
    const t = setTimeout(async () => {
      try {
        const r = await fetch("/api/graph", { method: "PUT", body: JSON.stringify({ nodes: strip(nodes), edges, baseRev: rev.current }) })
        const j = await r.json()
        if (r.status === 409) { rev.current = 0; return } // file moved under us: next poll re-syncs
        rev.current = j.rev
        synced.current = sig(nodes, edges)
      } catch {}
    }, 400)
    return () => clearTimeout(t)
  }, [nodes, edges])

  const onConnect = useCallback((c: Connection) => setEdges((eds) => addEdge(c, eds)), [setEdges])

  const add = (type: AppNode["type"]) => {
    const position = screenToFlowPosition({ x: window.innerWidth / 2 - 100, y: window.innerHeight / 2 - 100 })
    const id = `n${Date.now()}${counter++}`
    const data =
      type === "prompt" ? { text: "" }
      : type === "asset" ? { label: "new-reference.png", kind: "image" as const, hue: Math.floor(Math.random() * 360) }
      : { kind: "video" as const, model: "Veo 3.1", status: "idle" as const, hue: 0 }
    setNodes((ns) => [...ns, { id, type, position, data } as AppNode])
  }

  return (
    <div className="flex h-svh w-svw flex-col">
      <div className="relative min-h-0 flex-1">
      <ReactFlow
        nodes={nodes} edges={edges} nodeTypes={nodeTypes}
        onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect}
        colorMode="dark" fitView minZoom={0.2}
        defaultEdgeOptions={{ type: "default", style: { stroke: "#60a5fa", strokeWidth: 1.5, opacity: 0.8 } }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable className="!bg-card" maskColor="rgba(0,0,0,0.6)" />
      </ReactFlow>
      <div className="pointer-events-none absolute top-4 left-4 flex items-center gap-2">
        <div className="pointer-events-auto rounded-xl border bg-card px-4 py-2 text-sm font-medium shadow-lg">Stitch</div>
        <div className="pointer-events-auto flex gap-1 rounded-xl border bg-card p-1 shadow-lg">
          <Button size="sm" variant="ghost" onClick={() => add("prompt")}><Type /> Prompt</Button>
          <Button size="sm" variant="ghost" onClick={() => add("asset")}><ImageIcon /> Reference</Button>
          <Button size="sm" variant="ghost" onClick={() => add("generation")}><Video /> Generation</Button>
          <Button size="sm" variant="ghost" onClick={() => fitView({ padding: 0.1, duration: 400 })}><Maximize /> Fit</Button>
          
        </div>
      </div>
      </div>
      <ActivityPanel items={activity} />
      {story && <Timeline story={story} nodes={nodes} onFocus={(n) => fitView({ nodes: [`kp${n}`, `k${n}`, `mp${n}`, `v${n}`].map((id) => ({ id })), padding: 0.4, duration: 500 })} />}
    </div>
  )
}

export function Canvas() {
  return <ReactFlowProvider><Inner /></ReactFlowProvider>
}
