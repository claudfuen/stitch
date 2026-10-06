import React from "react"
import { interpolate, useCurrentFrame } from "remotion"
import { BRAND, Mark, useBrandFont } from "./ui"

/** Restrained end card: the real Comp AI mark and wordmark in Lausanne. The cut dissolves into it. */
export const EndCard: React.FC = () => {
  useBrandFont()
  const frame = useCurrentFrame()
  const settle = interpolate(frame, [0, 20], [1.03, 1], { extrapolateRight: "clamp" })
  const tag = interpolate(frame, [10, 22], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
  const url = interpolate(frame, [20, 32], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
  return (
    <div style={{ position: "absolute", inset: 0, background: "#101113", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", fontFamily: BRAND, color: "#fff" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 26, transform: `scale(${settle})` }}>
        <Mark size={92} />
        <div style={{ fontSize: 96, fontWeight: 700, letterSpacing: -2.5 }}>Comp AI</div>
      </div>
      <div style={{ marginTop: 40, fontSize: 50, fontWeight: 400, color: "#d9dadc", opacity: tag }}>SOC 2, handled.</div>
      <div style={{ marginTop: 22, fontSize: 26, fontWeight: 400, color: "#8b8d93", letterSpacing: 1, opacity: url }}>trycomp.ai</div>
    </div>
  )
}
