import React from "react"
import { interpolate, useCurrentFrame } from "remotion"
import { EMERALD, FONT, MONO, Panel, SAFE, useFade, useSpring } from "./ui"

const Tile: React.FC<{ name: string; delay: number }> = ({ name, delay }) => {
  const s = useSpring(delay)
  const ok = useSpring(delay + 8, { damping: 20, stiffness: 200, mass: 0.5 })
  return (
    <div style={{ opacity: s, transform: `translateY(${(1 - s) * 40}px) scale(${0.9 + 0.1 * s})`, display: "flex", alignItems: "center", gap: 14, padding: "14px 20px", borderRadius: 10, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)" }}>
      <div style={{ width: 30, height: 30, borderRadius: 8, background: "rgba(255,255,255,0.16)" }} />
      <div style={{ fontFamily: FONT, fontSize: 28, fontWeight: 600, color: "#fff", flex: 1 }}>{name}</div>
      <div style={{ width: 34, height: 34, borderRadius: 17, background: EMERALD, color: "#04210f", display: "grid", placeItems: "center", fontWeight: 900, fontSize: 22, transform: `scale(${ok})` }}>✓</div>
    </div>
  )
}

export const DashboardScore: React.FC = () => {
  const frame = useCurrentFrame()
  const op = useFade(0, 120, 9)
  const score = Math.round(interpolate(frame, [34, 90], [0, 100], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }))
  const stamp = useSpring(96, { damping: 9, stiffness: 220, mass: 0.6 })
  return (
    <div style={{ position: "absolute", right: SAFE.side, top: SAFE.top, width: 560, opacity: op }}>
      <Panel style={{ padding: 28 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {["AWS", "GitHub", "Okta", "Google Workspace"].map((n, i) => <Tile key={n} name={n} delay={4 + i * 8} />)}
        </div>
        <div style={{ marginTop: 26, display: "flex", alignItems: "baseline", gap: 14 }}>
          <div style={{ fontFamily: MONO, fontSize: 120, fontWeight: 700, color: EMERALD, lineHeight: 1 }}>{score}</div>
          <div style={{ fontFamily: FONT, fontSize: 44, color: "#9ca3af" }}>%</div>
          <div style={{ marginLeft: "auto", fontFamily: FONT, fontSize: 24, color: "#9ca3af", letterSpacing: 3 }}>CONTROLS PASSING</div>
        </div>
        <div style={{ height: 10, borderRadius: 5, background: "rgba(255,255,255,0.1)", marginTop: 16, overflow: "hidden" }}>
          <div style={{ width: `${score}%`, height: "100%", background: EMERALD }} />
        </div>
      </Panel>
      <div style={{ position: "absolute", right: 110, bottom: -34, opacity: stamp > 0.02 ? 1 : 0, transform: `rotate(-6deg) scale(${interpolate(stamp, [0, 1], [2.4, 1])})`, border: `6px solid ${EMERALD}`, color: EMERALD, padding: "6px 22px", fontFamily: FONT, fontWeight: 900, fontSize: 48, letterSpacing: 6, borderRadius: 8, background: "rgba(4,33,15,0.85)" }}>SOC 2 READY</div>
    </div>
  )
}
