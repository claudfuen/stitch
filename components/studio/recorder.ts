"use client"

// The browser side of stage 04's recorder: the microphone as recorded (no echo cancellation, noise suppression or
// automatic gain, which smear a performance), a live level for the meter, and the take as one Blob. Saving and
// converting happen on the server (POST /api/perform, lib/perform.ts).

import { useCallback, useEffect, useRef, useState } from "react"

export type RecState = "idle" | "recording" | "saving"
const MIC_KEY = "stitch:mic"
/** Microphones by name, once the page may see them (labels are blank until the first permission). */
const inputs = (all: MediaDeviceInfo[]) => all.filter((d) => d.kind === "audioinput" && d.deviceId && d.deviceId !== "default").map((d, i) => ({ value: d.deviceId, label: d.label || `Microphone ${i + 1}` }))

export function useRecorder() {
  const [state, setState] = useState<RecState>("idle")
  const [error, setError] = useState<string | null>(null)
  const [devices, setDevices] = useState<{ value: string; label: string }[]>([])
  const [mic, setMicState] = useState<string>(() => {
    try {
      return localStorage.getItem(MIC_KEY) ?? ""
    } catch {
      return ""
    }
  })
  const rec = useRef<{ r: MediaRecorder; chunks: Blob[]; stream: MediaStream; ctx: AudioContext; raf: number; t0: number } | null>(null)
  /** Elements the recorder drives directly, so the meter and clock do not re-render the page 60 times a second. */
  const meter = useRef<HTMLDivElement | null>(null)
  const clock = useRef<HTMLSpanElement | null>(null)

  const listDevices = useCallback(() => {
    navigator.mediaDevices.enumerateDevices().then((all) => setDevices(inputs(all)), () => {})
  }, [])
  useEffect(() => {
    let live = true
    navigator.mediaDevices.enumerateDevices().then((all) => live && setDevices(inputs(all)), () => {})
    return () => {
      live = false
    }
  }, [])

  const setMic = useCallback((id: string) => {
    setMicState(id)
    try {
      localStorage.setItem(MIC_KEY, id)
    } catch {}
  }, [])

  /** Start recording; false when the microphone could not be opened (the reason is in `error`). */
  const start = useCallback(async (): Promise<boolean> => {
    if (rec.current) return true
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: mic ? { exact: mic } : undefined, echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
      })
      listDevices()
      const mimeType = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"].find((t) => MediaRecorder.isTypeSupported(t))
      const r = new MediaRecorder(stream, mimeType ? { mimeType, audioBitsPerSecond: 256_000 } : undefined)
      const chunks: Blob[] = []
      r.ondataavailable = (e) => e.data.size && chunks.push(e.data)
      const ctx = new AudioContext()
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 1024
      ctx.createMediaStreamSource(stream).connect(analyser)
      const buf = new Float32Array(analyser.fftSize)
      const t0 = performance.now()
      const tick = () => {
        analyser.getFloatTimeDomainData(buf)
        const rms = Math.sqrt(buf.reduce((s, x) => s + x * x, 0) / buf.length)
        const db = 20 * Math.log10(rms || 1e-6)
        if (meter.current) {
          meter.current.style.width = `${Math.max(0, Math.min(100, ((db + 60) / 60) * 100))}%`
          meter.current.dataset.hot = db > -3 ? "true" : "false"
        }
        if (clock.current) clock.current.textContent = `${((performance.now() - t0) / 1000).toFixed(1)} s`
        if (rec.current) rec.current.raf = requestAnimationFrame(tick)
      }
      r.start()
      rec.current = { r, chunks, stream, ctx, raf: requestAnimationFrame(tick), t0 }
      setState("recording")
      return true
    } catch (e) {
      const name = (e as DOMException).name
      setError(name === "NotAllowedError" ? "The microphone is blocked for this page. Allow it in the browser's site settings, then try again." : name === "OverconstrainedError" ? "That microphone is gone. Pick another one." : (e as Error).message)
      return false
    }
  }, [mic, listDevices])

  /** Stop and hand back the take, or null when nothing usable was recorded. */
  const stop = useCallback(async (): Promise<Blob | null> => {
    const cur = rec.current
    if (!cur) return null
    rec.current = null
    cancelAnimationFrame(cur.raf)
    const done = new Promise<void>((res) => (cur.r.onstop = () => res()))
    cur.r.stop()
    await done
    cur.stream.getTracks().forEach((t) => t.stop())
    cur.ctx.close().catch(() => {})
    if (meter.current) meter.current.style.width = "0%"
    const blob = new Blob(cur.chunks, { type: cur.r.mimeType || "audio/webm" })
    if (performance.now() - cur.t0 < 400 || blob.size < 1000) {
      setState("idle")
      return null
    }
    return blob
  }, [])

  // Let go of the microphone if the page goes away mid-take.
  useEffect(
    () => () => {
      const cur = rec.current
      if (!cur) return
      cancelAnimationFrame(cur.raf)
      if (cur.r.state !== "inactive") cur.r.stop()
      cur.stream.getTracks().forEach((t) => t.stop())
      cur.ctx.close().catch(() => {})
    },
    [],
  )

  return { state, setState, error, setError, devices, mic, setMic, start, stop, meter, clock }
}
