import React from "react"
import { interpolate, useCurrentFrame } from "remotion"
import { FONT, MONO, SERIF, useFade } from "./ui"

export const CalendarFlip: React.FC = () => {
  const frame = useCurrentFrame()
  const op = useFade(0, 96, 9)
  const a = "NINE MONTHS LATER"
  const b = "ELEVEN YEARS LATER"
  const typedA = Math.min(a.length, Math.floor(interpolate(frame, [4, 30], [0, a.length], { extrapolateRight: "clamp" })))
  const flip = interpolate(frame, [50, 60], [0, 180], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
  const typedB = Math.min(b.length, Math.floor(interpolate(frame, [60, 84], [0, b.length], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })))
  const showB = flip >= 90
  const years = Math.floor(interpolate(frame, [50, 92], [2026, 2037], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }))
  return (
    <div style={{ position: "absolute", inset: 0, opacity: op, display: "flex", alignItems: "flex-end", justifyContent: "center", paddingBottom: 70 }}>
      <div style={{ background: "rgba(5,6,7,0.78)", padding: "26px 60px", borderTop: "2px solid #e8e2d0", borderBottom: "2px solid #e8e2d0", transform: `perspective(1200px) rotateX(${showB ? 180 - flip : flip}deg)`, textAlign: "center" }}>
        <div style={{ fontFamily: SERIF, fontSize: 84, letterSpacing: 8, color: "#f1ecdc", whiteSpace: "pre" }}>{showB ? b.slice(0, typedB) : a.slice(0, typedA)}</div>
        <div style={{ marginTop: 6, fontFamily: MONO, fontSize: 32, letterSpacing: 8, color: "#8f8a76" }}>{showB ? years : 2026}</div>
      </div>
      <div style={{ position: "absolute", fontFamily: FONT }} />
    </div>
  )
}
