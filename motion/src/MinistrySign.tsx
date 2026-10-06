import React from "react"
import { interpolate, useCurrentFrame } from "remotion"
import { FONT, SERIF, useFade } from "./ui"

export const MinistrySign: React.FC = () => {
  const frame = useCurrentFrame()
  const op = useFade(0, 48, 9)
  const x = interpolate(frame, [0, 12], [-60, 0], { extrapolateRight: "clamp" })
  return (
    <div style={{ position: "absolute", left: 96, bottom: 150, opacity: op, transform: `translateX(${x}px)`, fontFamily: FONT }}>
      <div style={{ borderLeft: "6px solid #e8e2d0", paddingLeft: 28 }}>
        <div style={{ fontFamily: SERIF, fontSize: 64, letterSpacing: 6, color: "#f1ecdc", textTransform: "uppercase", textShadow: "0 4px 24px rgba(0,0,0,0.7)" }}>Ministry of Compliance</div>
        <div style={{ marginTop: 10, fontSize: 28, color: "#c9c3ae", letterSpacing: 2, textShadow: "0 2px 12px rgba(0,0,0,0.7)" }}>est. 1403 &nbsp;·&nbsp; Compliance is a journey. A very long one.</div>
      </div>
    </div>
  )
}
