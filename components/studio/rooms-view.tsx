"use client"

// Rooms: every location is one 3D scene, the GLB its plates are rendered from (`stitch room <loc>`), with its cameras,
// marks and lights. Audit a room by orbiting it, then look through any camera at its real lens and lay the frames made
// for that setup over the 3D view: chairs, people, walls and windows must land where the room puts them.

import { Html, OrbitControls, PerspectiveCamera, useGLTF } from "@react-three/drei"
import { Canvas } from "@react-three/fiber"
import { Camera, Orbit } from "lucide-react"
import { Suspense, useEffect, useMemo, useRef, useState } from "react"
import * as THREE from "three"
import { kelvinColor, pick, planView, type Index, type SetupView } from "@/lib/derive"
import type { Asset, Location, Plan, PlanItem, Project, Shot } from "@/lib/model"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { FloorPlan, WHO_COLOR } from "./floor-plan"
import { Chip } from "./media"

const SETUP = "#a78bfa"
/** Plan metres (x right, y toward the far wall, z up) to the GLB's y-up world, as Blender's glTF export writes it. */
const P = (x: number, y: number, z = 0) => new THREE.Vector3(x, z, -y)

type Frame = { asset: Asset; tag: string; tone: "good" | "warn" | "bad" | "muted"; at?: number }

/** What was made for one camera: its grey render, its plates, and the keyframes and circled takes of the shots on it. */
function framesFor(loc: Location, setup: SetupView, shots: Shot[], ix: Index): Frame[] {
  const out: Frame[] = []
  const add = (id: string | undefined, tag: string, tone: Frame["tone"], at?: number) => {
    const asset = id ? ix.assets.get(id) : undefined
    if (asset && !out.some((f) => f.asset.id === asset.id)) out.push({ asset, tag, tone, at })
  }
  add(setup.render, "3D render", "muted")
  for (const p of setup.plates ?? []) add(p.asset, `plate · ${p.verdict}`, p.verdict === "circled" ? "good" : p.verdict === "reject" ? "bad" : "muted")
  for (const s of shots.filter((x) => x.location === loc.id && x.setup === setup.id)) {
    for (const k of s.keyframes ?? []) add(k.asset, `${s.id} keyframe · ${k.verdict}`, k.verdict === "circled" ? "good" : k.verdict === "reject" ? "bad" : "muted")
    const t = pick(s.takes)
    add(t?.asset, `${s.id} take`, "good", typeof s.edit.in === "number" ? s.edit.in : 0)
  }
  return out
}

export function RoomsView({ project, ix }: { project: Project; ix: Index }) {
  const rooms = project.locations.filter((l) => l.plan)
  const [roomId, setRoomId] = useState(rooms[0]?.id)
  const [setupId, setSetupId] = useState<string | null>(null)
  const [look, setLook] = useState(false)
  const [beat, setBeat] = useState<string>("")
  const [overlay, setOverlay] = useState<string | null>(null)
  const [opacity, setOpacity] = useState(0.5)

  useEffect(() => {
    try {
      const r = localStorage.getItem("stitch-room")
      if (r && rooms.some((l) => l.id === r)) setRoomId(r)
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const chooseRoom = (id: string) => {
    setRoomId(id)
    setSetupId(null)
    setLook(false)
    setOverlay(null)
    try { localStorage.setItem("stitch-room", id) } catch {}
  }

  const loc = rooms.find((l) => l.id === roomId)
  const view = useMemo(() => (loc ? planView(loc) : undefined), [loc])
  const setup = view?.setups.find((u) => u.id === setupId)
  const model = loc?.model ? ix.assets.get(loc.model) : undefined
  const frames = useMemo(() => (loc && setup ? framesFor(loc, setup, project.shots, ix) : []), [loc, setup, project.shots, ix])
  const shotsHere = (l: Location) => project.shots.filter((s) => s.location === l.id)
  const beats = useMemo(() => [...new Set(loc?.plan?.marks.map((m) => m.beat).filter((b): b is string => !!b))], [loc])
  const activeBeat = look && setup ? (setup.beat ?? "") : beat

  const chooseSetup = (id: string) => {
    setSetupId(id)
    setLook(true)
    const u = view?.setups.find((x) => x.id === id)
    const f = u && loc ? framesFor(loc, u, project.shots, ix) : []
    setOverlay((f.find((x) => x.tone === "good" && x.asset.media === "image") ?? f[0])?.asset.id ?? null)
  }
  const shown = frames.find((f) => f.asset.id === overlay)

  return (
    <div className="absolute inset-0 flex pt-16">
      {/* Rooms: one per location, with the shots and scenes that play in it. */}
      <aside className="w-64 shrink-0 overflow-y-auto border-r p-3">
        <div className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Rooms</div>
        {rooms.map((l) => {
          const shots = shotsHere(l)
          const scenes = [...new Set(shots.map((s) => s.section))].map((id) => project.sections.find((x) => x.id === id)?.name ?? id)
          return (
            <button key={l.id} onClick={() => chooseRoom(l.id)} className={cn("mb-2 w-full rounded-lg border p-2.5 text-left transition-colors", l.id === roomId ? "border-violet-400/60 bg-violet-400/10" : "hover:bg-muted/50")}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">{l.name}</span>
                {l.model ? <Chip tone="good">3D</Chip> : <Chip tone="warn">no 3D</Chip>}
              </div>
              <div className="mt-1 text-[11px] text-muted-foreground">
                {l.plan!.width} x {l.plan!.depth} x {l.plan!.height} m · {l.plan!.setups.length} cameras · {l.plan!.items.filter((i) => i.kind === "light").length} lights
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {scenes.map((n) => <Chip key={n} tone="muted">{n}</Chip>)}
              </div>
              <div className="mt-1 text-[11px] text-muted-foreground">shots {shots.map((s) => s.id).join(", ") || "none"}</div>
            </button>
          )
        })}
      </aside>

      {/* The room in 3D. */}
      <main className="relative flex min-w-0 flex-1 flex-col items-center justify-center bg-black/40 p-4">
        {!loc?.plan ? null : !model ? (
          <div className="max-w-md text-center text-sm text-muted-foreground">
            {loc.name} has a floor plan but no 3D model yet. Build it with
            <code className="mx-1 rounded bg-muted px-1.5 py-0.5 text-xs text-foreground">bun run stitch room {loc.id}</code>
          </div>
        ) : (
          <>
            <div className="mb-3 flex w-full items-center gap-2">
              <Button size="sm" variant={look ? "ghost" : "secondary"} onClick={() => setLook(false)}><Orbit /> Orbit</Button>
              <Button size="sm" variant={look ? "secondary" : "ghost"} disabled={!setup} onClick={() => setLook(true)}><Camera /> {setup ? `Through ${setup.id}` : "Pick a camera"}</Button>
              {!look && beats.length > 0 && (
                <div className="ml-2 flex items-center gap-1 text-xs text-muted-foreground">
                  marks:
                  {["", ...beats].map((b) => (
                    <Button key={b || "all"} size="xs" variant={beat === b ? "secondary" : "ghost"} onClick={() => setBeat(b)}>{b || "all"}</Button>
                  ))}
                </div>
              )}
              <div className="ml-auto text-[11px] text-muted-foreground">{model.gen?.model} · {model.gen?.prompt}</div>
            </div>
            <div className={cn("relative overflow-hidden rounded-lg border bg-black", look ? "aspect-video" : "h-full w-full")} style={look ? { width: "min(100%, calc((100svh - 220px) * 16 / 9))" } : undefined}>
              <Canvas dpr={[1, 2]} gl={{ antialias: true }}>
                <color attach="background" args={["#0b0f14"]} />
                <ambientLight intensity={0.9} />
                <directionalLight position={[3, 10, 4]} intensity={1.4} />
                <Suspense fallback={null}>
                  <RoomScene url={model.path} plan={loc.plan} setups={view!.setups} selected={setupId} look={look} beat={activeBeat} onPick={chooseSetup} />
                </Suspense>
              </Canvas>
              {look && shown && (
                shown.asset.media === "video" ? (
                  <OverlayVideo src={shown.asset.path} at={shown.at ?? 0} opacity={opacity} />
                ) : shown.asset.media === "image" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={shown.asset.path} alt={shown.asset.label} className="pointer-events-none absolute inset-0 h-full w-full object-cover" style={{ opacity }} />
                ) : null
              )}
            </div>
            {look && (
              <div className="mt-3 flex w-full max-w-xl items-center gap-3 text-xs text-muted-foreground">
                <span className="w-20 text-right">3D room</span>
                <input type="range" min={0} max={1} step={0.01} value={opacity} onChange={(e) => setOpacity(Number(e.target.value))} className="flex-1 accent-violet-400" aria-label="Overlay opacity" />
                <span className="w-20">{shown ? "the frame" : "no frame"}</span>
              </div>
            )}
          </>
        )}
      </main>

      {/* Cameras: pick one to look through it and audit what was made for it. */}
      <aside className="w-96 shrink-0 overflow-y-auto border-l p-3">
        {view && (
          <>
            <FloorPlan view={view} width={360} selected={setupId ?? undefined} onSelect={chooseSetup} className="mb-3 rounded-lg" />
            <div className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Cameras</div>
            <div className="grid grid-cols-2 gap-1.5">
              {view.setups.map((u) => (
                <button key={u.id} onClick={() => chooseSetup(u.id)} className={cn("rounded-md border px-2 py-1.5 text-left text-xs", u.id === setupId ? "border-violet-400/60 bg-violet-400/10" : "hover:bg-muted/50")}>
                  <div className="font-semibold">{u.id} <span className="font-normal text-muted-foreground">{u.size} · {u.lens} mm</span></div>
                  <div className="truncate text-[11px] text-muted-foreground">{u.name}</div>
                </button>
              ))}
            </div>
            {setup && (
              <div className="mt-4">
                <div className="text-sm font-medium">{setup.id}: {setup.name}</div>
                <div className="mt-1 text-[11px] text-muted-foreground">
                  {setup.size}, {setup.lens} mm ({setup.fov.toFixed(0)}° wide), lens at {setup.height} m{setup.tilt ? `, tilt ${setup.tilt}°` : ""}, facing {setup.facing}°{setup.beat ? `, beat ${setup.beat}` : ""}
                </div>
                {setup.purpose && <div className="mt-1 text-xs">{setup.purpose}</div>}
                <div className="mt-2 flex flex-wrap gap-1">
                  {setup.inFrame.map((m) => (
                    <Chip key={m.mark.id} tone="muted" title={`${m.dist.toFixed(1)} m from the lens`}>
                      <span className="mr-1 inline-block size-2 rounded-full" style={{ background: WHO_COLOR[m.mark.who] ?? "#cbd5e1" }} />
                      {m.mark.who} {m.x < 0.34 ? "left" : m.x > 0.66 ? "right" : "centre"} · {m.dist.toFixed(1)} m
                    </Chip>
                  ))}
                </div>
                <div className="mt-4 mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Frames over the room</div>
                {frames.length === 0 && <div className="text-xs text-muted-foreground">Nothing made for this camera yet.</div>}
                <div className="grid grid-cols-2 gap-2">
                  {frames.map((f) => (
                    <button key={f.asset.id} onClick={() => { setOverlay(f.asset.id); setLook(true) }} className={cn("overflow-hidden rounded-md border text-left", f.asset.id === overlay ? "border-violet-400 ring-1 ring-violet-400" : "hover:border-muted-foreground/50")}>
                      {f.asset.media === "video"
                        ? <video src={f.asset.path} className="aspect-video w-full bg-black object-cover" muted preload="metadata" />
                        // eslint-disable-next-line @next/next/no-img-element
                        : <img src={f.asset.path} alt={f.asset.label} className="aspect-video w-full bg-muted object-cover" />}
                      <div className="p-1"><Chip tone={f.tone}>{f.tag}</Chip></div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </aside>
    </div>
  )
}

function OverlayVideo({ src, at, opacity }: { src: string; at: number; opacity: number }) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const v = ref.current
    if (!v) return
    const seek = () => { v.currentTime = at }
    v.addEventListener("loadedmetadata", seek)
    if (v.readyState >= 1) seek()
    return () => v.removeEventListener("loadedmetadata", seek)
  }, [src, at])
  return <video ref={ref} src={src} muted playsInline preload="auto" className="pointer-events-none absolute inset-0 h-full w-full object-cover" style={{ opacity }} />
}

function RoomScene({ url, plan, setups, selected, look, beat, onPick }: {
  url: string
  plan: Plan
  setups: SetupView[]
  selected: string | null
  look: boolean
  beat: string
  onPick: (id: string) => void
}) {
  const gltf = useGLTF(url)
  const scene = useMemo(() => gltf.scene.clone(true), [gltf.scene])
  // The GLB's cameras, by setup id (the exporters tag each camera with its setup).
  const cams = useMemo(() => {
    scene.updateMatrixWorld(true)
    const out = new Map<string, THREE.PerspectiveCamera>()
    scene.traverse((o) => {
      const id = o.userData?.setup as string | undefined
      if (id && (o as THREE.PerspectiveCamera).isPerspectiveCamera) out.set(id, o as THREE.PerspectiveCamera)
    })
    return out
  }, [scene])

  // Marks of other beats leave the set, as they do in the renders; the ceiling lifts off while orbiting.
  useEffect(() => {
    scene.traverse((o) => {
      if (o.userData?.mark !== undefined && !(o as THREE.Camera).isCamera) {
        const b = o.userData.beat as string | undefined
        o.visible = !beat || !b || b === beat
      }
      if (/^ceiling/.test(o.name)) o.visible = look
    })
  }, [scene, beat, look])

  const cam = selected ? cams.get(selected) : undefined
  const pose = useMemo(() => {
    if (!cam) return undefined
    const p = new THREE.Vector3()
    const q = new THREE.Quaternion()
    cam.matrixWorld.decompose(p, q, new THREE.Vector3())
    return { p, q, fov: cam.fov }
  }, [cam])

  const center = P(plan.width / 2, plan.depth / 2)
  return (
    <>
      <primitive object={scene} />
      {plan.items.filter((it) => it.kind === "light").map((it) => <LightGlyph key={it.id} it={it} />)}
      {!look && plan.marks.filter((m) => !beat || !m.beat || m.beat === beat).map((m) => (
        <Html key={m.id} position={P(m.at[0], m.at[1], (m.z ?? 0) + (m.pose === "sit" ? 1.45 : 1.85))} center style={{ pointerEvents: "none" }}>
          <div className="rounded px-1 text-[10px] font-semibold whitespace-nowrap text-slate-950" style={{ background: WHO_COLOR[m.who] ?? "#cbd5e1" }}>{m.who}</div>
        </Html>
      ))}
      {!look && setups.map((u) => {
        const c = cams.get(u.id)
        return c ? <Frustum key={u.id} cam={c} id={u.id} on={u.id === selected} onPick={onPick} /> : null
      })}
      {look && pose ? (
        <PerspectiveCamera makeDefault position={pose.p} quaternion={pose.q} fov={pose.fov} near={0.05} far={200} />
      ) : (
        <>
          <PerspectiveCamera makeDefault position={[plan.width / 2, Math.max(plan.width, plan.depth) * 1.1, plan.depth * 0.25]} fov={40} near={0.1} far={400} />
          <OrbitControls makeDefault target={center} />
        </>
      )}
    </>
  )
}

/** A camera's view cone, 2.2 m deep, in the camera's own frame so it sits exactly where the export put it. */
function Frustum({ cam, id, on, onPick }: { cam: THREE.PerspectiveCamera; id: string; on: boolean; onPick: (id: string) => void }) {
  const geom = useMemo(() => {
    const depth = 2.2
    const h = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) * depth
    const w = h * cam.aspect
    const o = new THREE.Vector3()
    const c = [[-w, -h], [w, -h], [w, h], [-w, h]].map(([x, y]) => new THREE.Vector3(x, y, -depth))
    return new THREE.BufferGeometry().setFromPoints([...c.flatMap((p) => [o, p]), c[0], c[1], c[1], c[2], c[2], c[3], c[3], c[0]])
  }, [cam])
  const matrix = useMemo(() => cam.matrixWorld.clone(), [cam])
  return (
    <group matrix={matrix} matrixAutoUpdate={false}>
      <lineSegments geometry={geom}>
        <lineBasicMaterial color={SETUP} transparent opacity={on ? 1 : 0.55} />
      </lineSegments>
      <Html center position={[0, 0.12, 0]}>
        <button onClick={() => onPick(id)} className={cn("rounded px-1.5 text-[11px] font-bold", on ? "bg-violet-300 text-violet-950" : "bg-violet-500/80 text-white hover:bg-violet-400")}>{id}</button>
      </Html>
    </group>
  )
}

/** A plan light drawn in its colour temperature: a bulb, a soft source with its throw toward the aim, or a lit panel. */
function LightGlyph({ it }: { it: PlanItem }) {
  const l = it.light
  const color = l ? kelvinColor(l.kelvin) : "#fef9c3"
  const z = (it.z ?? 0) + it.size[2] / 2
  const pos = P(it.at[0], it.at[1], z)
  const ref = useRef<THREE.Mesh>(null)
  useEffect(() => {
    if (ref.current && l?.aim) ref.current.lookAt(P(l.aim[0], l.aim[1], l.aim[2]))
  }, [l])
  const throwLine = useMemo(() => {
    if (l?.type !== "area" || !l.aim) return null
    const aim = P(l.aim[0], l.aim[1], l.aim[2])
    const dir = aim.clone().sub(pos).normalize().multiplyScalar(Math.min(2.4, aim.distanceTo(pos)))
    return new THREE.BufferGeometry().setFromPoints([pos, pos.clone().add(dir)])
  }, [l, pos])
  const label = l?.role === "key" ? "KEY" : undefined
  return (
    <group>
      {l?.type === "point" ? (
        <>
          <mesh position={pos}><sphereGeometry args={[0.07, 16, 16]} /><meshBasicMaterial color={color} /></mesh>
          <mesh position={pos}><sphereGeometry args={[0.22, 16, 16]} /><meshBasicMaterial color={color} transparent opacity={0.18} depthWrite={false} /></mesh>
        </>
      ) : l?.type === "area" ? (
        <mesh ref={ref} position={pos}>
          <planeGeometry args={l.size ?? [Math.max(it.size[0], it.size[1]), it.size[2]]} />
          <meshBasicMaterial color={color} transparent opacity={0.45} side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
      ) : null}
      {throwLine && <lineSegments geometry={throwLine}><lineBasicMaterial color={color} /></lineSegments>}
      {label && (
        <Html position={pos} center style={{ pointerEvents: "none" }}>
          <div className="rounded bg-black/70 px-1 text-[10px] font-bold" style={{ color }}>{label}</div>
        </Html>
      )}
    </group>
  )
}
