import React from "react"
import { interpolate, useCurrentFrame } from "remotion"
import { EMERALD, FONT, MONO, Mark, useBrandFont, useSpring } from "./ui"

// The Comp AI app as it appears on the founder's laptop in shot 5.2: a full screen (16:10), composited onto the
// laptop's own screen, never a card floating in the frame. Serious product UI, no decoration.

const INK = "#0f1412"
const MUTED = "#6b7570"
const LINE = "#e5e9e7"
const CHECKS = ["AWS", "GitHub", "Google Workspace", "Okta", "Employee devices", "Vendor reviews", "Policies signed"]

const Row: React.FC<{ name: string; at: number }> = ({ name, at }) => {
  const done = useSpring(at, { damping: 22, stiffness: 220, mass: 0.5 })
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "14px 0", borderBottom: `1px solid ${LINE}` }}>
      <div style={{ fontFamily: FONT, fontSize: 24, color: INK, flex: 1 }}>{name}</div>
      <div style={{ fontFamily: FONT, fontSize: 18, color: done > 0.5 ? "#0f7a52" : MUTED, width: 120, textAlign: "right" }}>{done > 0.5 ? "Passing" : "Checking"}</div>
      <div style={{ width: 26, height: 26, borderRadius: 13, background: done > 0.5 ? EMERALD : LINE, display: "grid", placeItems: "center", color: "#04210f", fontSize: 16, fontWeight: 900, transform: `scale(${0.8 + 0.2 * done})` }}>{done > 0.5 ? "✓" : ""}</div>
    </div>
  )
}

export const LaptopScreen: React.FC = () => {
  useBrandFont()
  const frame = useCurrentFrame()
  const score = Math.round(interpolate(frame, [6, 40], [86, 100], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }))
  const ready = useSpring(44, { damping: 18, stiffness: 160, mass: 0.6 })
  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", background: "#f7f8f7" }}>
      <div style={{ width: 230, background: "#0b0f0d", padding: "34px 26px", display: "flex", flexDirection: "column", gap: 26 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Mark size={34} />
          <div style={{ fontFamily: FONT, fontSize: 24, fontWeight: 700, color: "#fff" }}>Comp AI</div>
        </div>
        {["Overview", "Frameworks", "Controls", "Evidence", "Vendors", "People"].map((n, i) => (
          <div key={n} style={{ fontFamily: FONT, fontSize: 19, color: i === 1 ? "#fff" : "#8b948f" }}>{n}</div>
        ))}
      </div>
      <div style={{ flex: 1, padding: "46px 60px", display: "flex", flexDirection: "column" }}>
        <div style={{ fontFamily: FONT, fontSize: 18, color: MUTED, letterSpacing: 2 }}>FRAMEWORKS</div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 24, marginTop: 8 }}>
          <div style={{ fontFamily: FONT, fontSize: 46, fontWeight: 700, color: INK }}>SOC 2 Type II</div>
          <div style={{ marginLeft: "auto", fontFamily: MONO, fontSize: 64, fontWeight: 700, color: INK }}>{score}%</div>
        </div>
        <div style={{ height: 10, borderRadius: 5, background: LINE, marginTop: 14, overflow: "hidden" }}>
          <div style={{ width: `${score}%`, height: "100%", background: EMERALD }} />
        </div>
        <div style={{ marginTop: 22 }}>{CHECKS.map((n, i) => <Row key={n} name={n} at={4 + i * 5} />)}</div>
        <div style={{ marginTop: "auto", opacity: ready, transform: `translateY(${(1 - ready) * 16}px)`, display: "flex", alignItems: "center", gap: 18, padding: "20px 26px", borderRadius: 12, background: "#e8f8f0", border: `2px solid ${EMERALD}` }}>
          <div style={{ width: 40, height: 40, borderRadius: 20, background: EMERALD, display: "grid", placeItems: "center", color: "#04210f", fontSize: 24, fontWeight: 900 }}>✓</div>
          <div style={{ fontFamily: FONT, fontSize: 30, fontWeight: 700, color: INK }}>Ready for audit</div>
          <div style={{ marginLeft: "auto", fontFamily: FONT, fontSize: 20, color: MUTED }}>All controls passing</div>
        </div>
      </div>
    </div>
  )
}
