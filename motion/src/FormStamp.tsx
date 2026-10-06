import React from "react"
import { interpolate, useCurrentFrame } from "remotion"
import { FONT, MONO, RED, SAFE, useFade, useSpring } from "./ui"

const Stamp: React.FC<{ delay: number; text: string; rot: number; color: string; top: number; left: number }> = ({ delay, text, rot, color, top, left }) => {
  const s = useSpring(delay, { damping: 9, stiffness: 220, mass: 0.6 })
  const scale = interpolate(s, [0, 1], [2.6, 1])
  return (
    <div style={{ position: "absolute", top, left, opacity: s > 0.02 ? 1 : 0, transform: `rotate(${rot}deg) scale(${scale})`, border: `6px solid ${color}`, color, padding: "6px 22px", fontFamily: FONT, fontWeight: 900, fontSize: 54, letterSpacing: 6, borderRadius: 8, mixBlendMode: "multiply" }}>{text}</div>
  )
}

export const FormStamp: React.FC = () => {
  const op = useFade(0, 120, 9)
  const title = "APPLICATION FOR THE APPLICATION"
  const frameTyped = useSpring(6, { damping: 40, stiffness: 60, mass: 1 })
  const chars = Math.floor(title.length * Math.min(1, frameTyped * 1.2))
  return (
    <div style={{ position: "absolute", right: SAFE.side, top: SAFE.top, opacity: op, width: 600, background: "#efe9d6", color: "#2b2a24", padding: "30px 36px", borderRadius: 4, boxShadow: "0 18px 60px rgba(0,0,0,0.5)", transform: "rotate(1.5deg)" }}>
      <div style={{ fontFamily: MONO, fontSize: 22, letterSpacing: 4, color: "#6d6a58" }}>FORM 27-B &nbsp;·&nbsp; SECTION 4(c)</div>
      <div style={{ fontFamily: FONT, fontWeight: 800, fontSize: 40, marginTop: 10, minHeight: 100 }}>{title.slice(0, chars)}<span style={{ opacity: chars < title.length ? 1 : 0 }}>|</span></div>
      <Stamp delay={58} text="RECEIVED" rot={-8} color={RED} top={118} left={190} />
      <Stamp delay={92} text="PENDING" rot={6} color="#1d4ed8" top={150} left={30} />
    </div>
  )
}
