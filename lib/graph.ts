import type { Edge, Node } from "@xyflow/react"

export type PromptData = { text: string; title?: string }
export type AssetData = { title?: string; label: string; kind: "image" | "video" | "audio"; url?: string; hue: number }
export type GenData = {
  title?: string
  url?: string
  video?: string
  prompt?: string
  job?: string
  kind: "image" | "video"
  model: string
  status: "idle" | "running" | "done"
  hue: number
}

export type PromptNode = Node<PromptData, "prompt">
export type AssetNode = Node<AssetData, "asset">
export type GenNode = Node<GenData, "generation">
export type MotionData = {
  title: string
  kind: "title" | "ui" | "stat" | "stamp" | "transition" | "end-card" | "caption"
  start: number
  end: number
  tool: string
  note: string
  status: "idea" | "designed" | "rendered"
}
export type MotionNode = Node<MotionData, "motion">
export type SectionData = { name: string; range: string; color: string; why: string }
export type SectionNode = Node<SectionData, "section">
export type AppNode = PromptNode | AssetNode | GenNode | SectionNode | MotionNode

export type Activity = { t: string; text: string; kind?: "run" | "done" | "info" | "warn" }

export type Story = {
  title: string
  runtime: number
  logline: string
  sections: { id: string; name: string; color: string; start: number; end: number; purpose: string }[]
  beats: { scene: number; name: string; start: number; end: number; section: string; vo: string }[]
  open: string[]
  tracks?: { id: string; name: string; items: TrackItem[] }[]
}

export type TrackItem = { id: string; start: number; end: number; label: string; kind: string; row?: number; note?: string }
