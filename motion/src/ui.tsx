import React from "react"
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion"

export const FONT = "Inter, 'Helvetica Neue', Helvetica, Arial, sans-serif"
export const MONO = "'SF Mono', Menlo, Consolas, monospace"
export const SERIF = "Georgia, 'Times New Roman', serif"
export const EMERALD = "#34d399"
export const RED = "#ff453a"

export const useSpring = (delay = 0, config = { damping: 14, stiffness: 140, mass: 0.7 }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  return spring({ frame: frame - delay, fps, config })
}

export const useFade = (inAt: number, outAt: number, d = 8) => {
  const frame = useCurrentFrame()
  return interpolate(frame, [inAt, inAt + d, outAt - d, outAt], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
}

export const Panel: React.FC<{ style?: React.CSSProperties; children: React.ReactNode }> = ({ style, children }) => (
  <div style={{ background: "rgba(8,10,12,0.86)", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 14, boxShadow: "0 18px 60px rgba(0,0,0,0.5)", ...style }}>{children}</div>
)
