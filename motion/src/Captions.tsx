import React from "react"
import { FONT, useFade } from "./ui"

const Line: React.FC<{ text: string; from: number; to: number }> = ({ text, from, to }) => {
  const op = useFade(from, to, 5)
  return <div style={{ position: "absolute", left: 0, right: 0, bottom: 110, textAlign: "center", opacity: op, fontFamily: FONT, fontWeight: 700, fontSize: 52, color: "#fff", textShadow: "0 3px 18px rgba(0,0,0,0.9), 0 0 3px rgba(0,0,0,0.9)" }}>{text}</div>
}

export const Captions: React.FC = () => {
  const bug = useFade(0, 132, 12)
  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <div style={{ position: "absolute", top: 56, right: 72, opacity: bug, display: "flex", alignItems: "center", gap: 12, padding: "10px 18px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.4)", background: "rgba(0,0,0,0.35)", fontFamily: FONT, color: "#fff" }}>
        <span style={{ fontSize: 16, letterSpacing: 3, opacity: 0.8 }}>PRESENTED BY</span>
        <span style={{ fontSize: 26, fontWeight: 800 }}>Comp AI</span>
      </div>
      <Line text="In Europe, we would call this impossible." from={0} to={76} />
      <Line text="It is good." from={80} to={124} />
    </div>
  )
}
