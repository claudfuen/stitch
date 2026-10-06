import React, { useEffect, useState } from "react"
import { continueRender, delayRender, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion"

/** Comp AI's brand face. The font files are copied from comp-web-v3 at setup and never committed. */
export const BRAND = "Lausanne, Inter, 'Helvetica Neue', Helvetica, Arial, sans-serif"
export const FONT = BRAND
export const MONO = "'SF Mono', Menlo, Consolas, monospace"
export const SERIF = "Georgia, 'Times New Roman', serif"
export const EMERALD = "#34d399"
/** Screen zones reserved for the caption track (bottom) and the series bug (top right). Graphics stay out of both. */
export const SAFE = { top: 150, bottom: 230, side: 96 }
export const RED = "#ff453a"

let fontsReady = false
export function useBrandFont() {
  const [handle] = useState(() => (fontsReady ? null : delayRender("brand font")))
  useEffect(() => {
    if (!handle) return
    Promise.all(
      [400, 700].map((w) => new FontFace("Lausanne", `url(${staticFile(`fonts/Lausanne-${w}.ttf`)})`, { weight: String(w) }).load().then((f) => document.fonts.add(f))),
    )
      .catch(() => undefined)
      .finally(() => {
        fontsReady = true
        continueRender(handle)
      })
  }, [handle])
}

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

/** The real Comp AI mark (from comp-web-v3), white. */
export const Mark: React.FC<{ size: number }> = ({ size }) => <img src={staticFile("comp-mark-white.svg")} width={size} height={size} style={{ display: "block" }} />
