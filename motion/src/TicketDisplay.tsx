import React from "react"
import { interpolate, useCurrentFrame } from "remotion"
import { MONO, Panel, RED, useFade } from "./ui"

export const TicketDisplay: React.FC = () => {
  const frame = useCurrentFrame()
  const op = useFade(0, 96, 9)
  const serving = frame < 52 ? "0000016" : "0000017"
  const flash = interpolate(frame, [52, 54, 62], [0, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
  const led = (t: string, size: number, glow = 1) => (
    <div style={{ fontFamily: MONO, fontSize: size, color: RED, letterSpacing: 6, textShadow: `0 0 ${18 * glow}px rgba(255,69,58,0.8)` }}>{t}</div>
  )
  return (
    <div style={{ position: "absolute", right: 96, bottom: 120, opacity: op }}>
      <Panel style={{ padding: "26px 40px", background: "#120606", border: "2px solid #3a1210", minWidth: 560 }}>
        <div style={{ fontFamily: MONO, fontSize: 24, color: "#7a2b26", letterSpacing: 5 }}>NOW SERVING</div>
        <div style={{ filter: `brightness(${1 + flash * 0.8})` }}>{led(serving, 96)}</div>
        <div style={{ height: 14 }} />
        <div style={{ fontFamily: MONO, fontSize: 24, color: "#7a2b26", letterSpacing: 5 }}>YOUR NUMBER</div>
        {led("4,201,990", 72, Math.floor(frame / 12) % 2 ? 0.6 : 1)}
      </Panel>
    </div>
  )
}
