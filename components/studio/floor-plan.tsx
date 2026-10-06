"use client"

// Top-down floor plan of a location: walls, furniture, marks (who stands where, facing which way), the 180-degree
// lines and every camera setup with its field of view. Drawn in metres from the plan in the project; the far wall is
// at the top, the entrance at the bottom. Geometry (fov, sides, in-frame marks) comes from lib/derive.

import { heading, kelvinColor, type PlanView } from "@/lib/derive"
import type { PlanItem } from "@/lib/model"

const FILL: Record<PlanItem["kind"], string> = {
  wall: "#94a3b8", window: "#7dd3fc", door: "#64748b", counter: "#92400e", seats: "#ca8a04", furniture: "#57534e",
  prop: "#a8a29e", light: "#fef9c3", board: "#e2e8f0",
}
export const WHO_COLOR: Record<string, string> = { henrick: "#7dd3fc", founder: "#fcd34d", clerk: "#fda4af" }
const SETUP_COLOR = "#a78bfa"

export function FloorPlan({ view, width = 360, selected, onSelect, className }: {
  view: PlanView
  width?: number
  selected?: string
  onSelect?: (setup: string) => void
  className?: string
}) {
  const { plan, setups } = view
  const pad = 0.6
  const s = width / (plan.width + pad * 2)
  const X = (x: number) => (x + pad) * s
  const Y = (y: number) => (plan.depth - y + pad) * s
  const height = (plan.depth + pad * 2) * s
  const marks = new Map(plan.marks.map((m) => [m.id, m]))

  const item = (it: PlanItem) => {
    const [w, d] = it.size
    const t = `rotate(${it.rot ?? 0} ${X(it.at[0])} ${Y(it.at[1])})`
    if (it.kind === "light") {
      // A glyph per source, in its colour temperature: a bulb, a soft source with its throw toward the aim, a lit panel.
      const l = it.light
      const c = l ? kelvinColor(l.kelvin) : FILL.light
      const cx = X(it.at[0])
      const cy = Y(it.at[1])
      const tip = `${it.label}${l ? `: ${l.type}, ${l.kelvin} K${l.role ? `, ${l.role}` : ""}` : ""}`
      const key = l?.role === "key" && <text x={cx + 6} y={cy - 6} fontSize={10} fontWeight={800} fill={c}>KEY</text>
      if (l?.type === "point")
        return (
          <g key={it.id}>
            <circle cx={cx} cy={cy} r={9} fill={c} opacity={0.22} />
            <circle cx={cx} cy={cy} r={3.5} fill={c} />
            {key}
            <title>{tip}</title>
          </g>
        )
      const box = <rect transform={t} x={X(it.at[0] - w / 2)} y={Y(it.at[1] + d / 2)} width={Math.max(3, w * s)} height={Math.max(3, d * s)} fill={c} opacity={0.9} />
      if (l?.type === "area" && l.aim) {
        const [ax, ay] = l.aim
        const len = Math.hypot(ax - it.at[0], ay - it.at[1]) || 1
        const reach = Math.min(2.4, len)
        const ex = it.at[0] + ((ax - it.at[0]) / len) * reach
        const ey = it.at[1] + ((ay - it.at[1]) / len) * reach
        return (
          <g key={it.id}>
            {box}
            <line x1={cx} y1={cy} x2={X(ex)} y2={Y(ey)} stroke={c} strokeWidth={1.6} markerEnd="url(#throw)" />
            {key}
            <title>{tip}</title>
          </g>
        )
      }
      return <g key={it.id}>{box}{key}<title>{tip}</title></g>
    }
    if (it.kind === "wall") {
      // Wall segments around its openings (offset along the wall from its left end).
      const x0 = it.at[0] - w / 2
      const segs: [number, number][] = []
      let cur = 0
      for (const [off, ow] of [...(it.openings ?? [])].sort((a, b) => a[0] - b[0])) {
        if (off > cur) segs.push([cur, off])
        cur = off + ow
      }
      if (cur < w) segs.push([cur, w])
      return (
        <g key={it.id} transform={t}>
          {segs.map(([a, b]) => <rect key={a} x={X(x0 + a)} y={Y(it.at[1] + d / 2)} width={(b - a) * s} height={Math.max(2, d * s)} fill={FILL.wall} />)}
        </g>
      )
    }
    const opacity = it.kind === "window" ? 0.9 : it.kind === "board" ? 0.5 : 0.75
    return (
      <rect key={it.id} transform={t} x={X(it.at[0] - w / 2)} y={Y(it.at[1] + d / 2)} width={Math.max(1.5, w * s)} height={Math.max(1.5, d * s)}
        fill={FILL[it.kind]} opacity={opacity} rx={it.kind === "seats" ? 1.5 : 0}>
        <title>{it.label}</title>
      </rect>
    )
  }

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} className={className} role="img" aria-label="Floor plan">
      <defs>
        <marker id="throw" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill="context-stroke" />
        </marker>
      </defs>
      <rect x={X(0)} y={Y(plan.depth)} width={plan.width * s} height={plan.depth * s} fill="#0f172a" stroke="#94a3b8" strokeWidth={2} />
      {plan.items.filter((it) => it.kind !== "light").map(item)}
      {plan.items.filter((it) => it.kind === "light").map(item)}

      {plan.axes.map((ax) => {
        const a = marks.get(ax.a)?.at
        const b = marks.get(ax.b)?.at
        if (!a || !b) return null
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
        const ux = (b[0] - a[0]) / len
        const uy = (b[1] - a[1]) / len
        const ext = 2.2
        return (
          <line key={ax.id} x1={X(a[0] - ux * ext)} y1={Y(a[1] - uy * ext)} x2={X(b[0] + ux * ext)} y2={Y(b[1] + uy * ext)} stroke="#f87171" strokeWidth={1.2} strokeDasharray="5 4">
            <title>180-degree line: {ax.label}</title>
          </line>
        )
      })}

      {setups.map((u) => {
        const on = selected === u.id
        const reach = Math.max(1.6, ...u.inFrame.filter((m) => !u.subjects || u.subjects.includes(m.mark.id)).map((m) => m.dist))
        const [lx, ly] = heading(u.facing - u.fov / 2)
        const [rx, ry] = heading(u.facing + u.fov / 2)
        const [cx, cy] = u.at
        return (
          <g key={u.id} onClick={() => onSelect?.(u.id)} className={onSelect ? "cursor-pointer" : undefined} opacity={selected && !on ? 0.35 : 1}>
            <path d={`M${X(cx)},${Y(cy)} L${X(cx + lx * reach)},${Y(cy + ly * reach)} L${X(cx + rx * reach)},${Y(cy + ry * reach)} Z`} fill={SETUP_COLOR} fillOpacity={on ? 0.3 : 0.12} stroke={SETUP_COLOR} strokeOpacity={0.7} strokeWidth={on ? 1.6 : 0.8} />
            <circle cx={X(cx)} cy={Y(cy)} r={on ? 6 : 4.5} fill={SETUP_COLOR} />
            <text x={X(cx) + 6} y={Y(cy) - 5} fontSize={11} fontWeight={700} fill="#ede9fe">{u.id}</text>
            <title>{`${u.id} ${u.name}: ${u.size}, ${u.lens} mm, ${u.height} m${u.purpose ? `. ${u.purpose}` : ""}`}</title>
          </g>
        )
      })}

      {plan.marks.map((m) => {
        const [fx, fy] = heading(m.facing)
        const c = WHO_COLOR[m.who] ?? "#cbd5e1"
        return (
          <g key={m.id}>
            <circle cx={X(m.at[0])} cy={Y(m.at[1])} r={4.5} fill={c} stroke="#0f172a" strokeWidth={1} strokeDasharray={m.beat ? undefined : "1.5 1.5"} />
            <line x1={X(m.at[0])} y1={Y(m.at[1])} x2={X(m.at[0] + fx * 0.55)} y2={Y(m.at[1] + fy * 0.55)} stroke={c} strokeWidth={1.6} />
            <title>{`${m.who}${m.beat ? ` (${m.beat})` : ""}: ${m.pose}${m.note ? `. ${m.note}` : ""}`}</title>
          </g>
        )
      })}
      <text x={X(plan.width / 2)} y={Y(0) + 12} fontSize={9} textAnchor="middle" fill="#94a3b8">entrance · {plan.width} x {plan.depth} m</text>
    </svg>
  )
}
