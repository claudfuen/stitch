import React from "react"
import { interpolate, useCurrentFrame } from "remotion"
import { EMERALD, FONT, MONO, useSpring } from "./ui"

export const EndCard: React.FC = () => {
  const frame = useCurrentFrame()
  const logo = useSpring(4)
  const tag = useSpring(18)
  const url = interpolate(frame, [34, 46], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
  const glow = 0.5 + 0.5 * Math.sin(frame / 8)
  return (
    <div style={{ position: "absolute", inset: 0, background: "radial-gradient(ellipse at 50% 42%, #0f1f19 0%, #070a09 62%)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", fontFamily: FONT }}>
      <div style={{ display: "flex", alignItems: "center", gap: 22, opacity: logo, transform: `scale(${0.9 + 0.1 * logo})` }}>
        <div style={{ width: 88, height: 88, borderRadius: 44, background: EMERALD, boxShadow: `0 0 ${60 + glow * 40}px rgba(52,211,153,0.55)`, display: "grid", placeItems: "center" }}>
          <div style={{ width: 34, height: 34, borderRadius: 17, background: "#06130d" }} />
        </div>
        <div style={{ fontSize: 96, fontWeight: 800, color: "#fff", letterSpacing: -2 }}>Comp AI</div>
      </div>
      <div style={{ marginTop: 44, fontSize: 64, color: "#e5e7eb", fontWeight: 600, opacity: tag, transform: `translateY(${(1 - tag) * 24}px)` }}>SOC 2, handled.</div>
      <div style={{ marginTop: 26, fontFamily: MONO, fontSize: 30, color: "#6b7280", letterSpacing: 4, opacity: url }}>trycomp.ai</div>
    </div>
  )
}
