import React from "react"
import { interpolate, useCurrentFrame, useVideoConfig } from "remotion"
import { BRAND, Mark, useBrandFont } from "./ui"

export type CaptionProps = { lines: { text: string; from: number; to: number }[]; bugUntil: number; duration: number }

/** Full-length transparent track: captions on every line plus the series bug, matching Henrick's real videos. */
export const CaptionTrack: React.FC<CaptionProps> = ({ lines, bugUntil }) => {
  useBrandFont()
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const t = frame / fps
  const bugOpacity = interpolate(t, [0, 0.4, bugUntil - 0.4, bugUntil], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
  const current = lines.find((l) => t >= l.from && t <= l.to)
  const op = current ? interpolate(t, [current.from, current.from + 0.12, current.to - 0.12, current.to], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) : 0
  return (
    <div style={{ position: "absolute", inset: 0, fontFamily: BRAND }}>
      <div style={{ position: "absolute", top: 54, right: 64, opacity: bugOpacity, display: "flex", alignItems: "center", gap: 12, padding: "9px 16px", border: "1px solid rgba(255,255,255,0.45)", borderRadius: 6, background: "rgba(0,0,0,0.28)", color: "#fff" }}>
        <span style={{ fontSize: 14, letterSpacing: 2.5, opacity: 0.85 }}>PRESENTED BY</span>
        <span style={{ width: 1, height: 18, background: "rgba(255,255,255,0.45)" }} />
        <Mark size={22} />
        <span style={{ fontSize: 22, fontWeight: 700, letterSpacing: -0.2 }}>Comp AI</span>
      </div>
      {current && (
        <div style={{ position: "absolute", left: 160, right: 160, bottom: 92, textAlign: "center", opacity: op, color: "#fff", fontSize: 46, fontWeight: 400, lineHeight: 1.25, textShadow: "0 2px 14px rgba(0,0,0,0.85), 0 0 2px rgba(0,0,0,0.9)" }}>
          {current.text}
        </div>
      )}
    </div>
  )
}
