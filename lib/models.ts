// Every model that has made an asset, under one canonical id, and the providers they ran on. Assets record their
// generation as steps ({ model, provider, job, ... } in the order they ran: `Asset.gen.steps`), so any question of the
// form "what made this, and which model makes the takes we keep" is answered from data, not from labels. asset.add
// rejects a generated asset whose steps name a model that is not here: add the model first.

import type { GenStep, Provider } from "./model"

export type ModelKind = "image" | "video" | "voice" | "lipsync" | "sfx" | "local"
export type ModelInfo = { id: string; name: string; vendor: string; kind: ModelKind; aliases: RegExp[] }

export const PROVIDERS: Provider[] = ["leap", "fal", "higgsfield", "ai-gateway", "local", "unknown"]

export const MODELS: ModelInfo[] = [
  // Video
  { id: "kling/kling-3.0-pro", name: "Kling 3.0 Pro", vendor: "Kuaishou", kind: "video", aliases: [/kling[-/ ]?(video\/)?v?3(\.0)?[-/ ]pro/i] },
  { id: "bytedance/seedance-2.5", name: "Seedance 2.5", vendor: "ByteDance", kind: "video", aliases: [/seedance[- ]?2\.5/i] },
  // Images
  { id: "openai/gpt-image-2.5-flare", name: "GPT Image 2.5 Flare", vendor: "OpenAI", kind: "image", aliases: [/gpt-image-2\.5[-/]flare/i] },
  { id: "openai/gpt-image-2.5-sunburst", name: "GPT Image 2.5 Sunburst", vendor: "OpenAI", kind: "image", aliases: [/gpt-image-2\.5[-/]sunburst/i] },
  { id: "openai/gpt-image-2.5", name: "GPT Image 2.5", vendor: "OpenAI", kind: "image", aliases: [/gpt_image_2_5|gpt-image-2\.5(?![-/](flare|sunburst))/i] },
  { id: "google/nano-banana-2.1", name: "Nano Banana 2.1", vendor: "Google", kind: "image", aliases: [/nano-banana-2\.1/i] },
  { id: "google/nano-banana-pro", name: "Nano Banana Pro", vendor: "Google", kind: "image", aliases: [/nano-banana-pro|gemini-3-pro-image/i] },
  { id: "google/gemini-3.1-flash-image", name: "Gemini 3.1 Flash Image", vendor: "Google", kind: "image", aliases: [/gemini-3\.1-flash-image/i] },
  { id: "bytedance/seedream-5.0-pro", name: "Seedream 5.0 Pro", vendor: "ByteDance", kind: "image", aliases: [/seedream-5\.0-pro/i] },
  { id: "xai/grok-imagine-image-2.0", name: "Grok Imagine Image 2.0", vendor: "xAI", kind: "image", aliases: [/grok-imagine-image-2\.0/i] },
  { id: "meta/muse-image-1.0", name: "Muse Image 1.0", vendor: "Meta", kind: "image", aliases: [/muse-image-1\.0/i] },
  { id: "ideogram/ideogram-v3-reframe", name: "Ideogram 3 Reframe", vendor: "Ideogram", kind: "image", aliases: [/ideogram-v3-reframe/i] },
  // Voice, lip-sync, sound
  { id: "indextts/index-tts-2", name: "Index TTS 2", vendor: "Bilibili", kind: "voice", aliases: [/index ?tts ?2/i] },
  { id: "elevenlabs/tts", name: "ElevenLabs TTS (version not recorded)", vendor: "ElevenLabs", kind: "voice", aliases: [/elevenlabs (chris|alice|sarah)|elevenlabs tts/i] },
  { id: "sync/lipsync-3", name: "sync lipsync-3", vendor: "sync.", kind: "lipsync", aliases: [/lipsync-3/i] },
  { id: "elevenlabs/sfx-v2", name: "ElevenLabs SFX v2", vendor: "ElevenLabs", kind: "sfx", aliases: [/elevenlabs sfx v2/i] },
  // Local steps (our own code)
  { id: "local/blender-greybox", name: "Blender grey box", vendor: "local", kind: "local", aliases: [/blender\/greybox/i] },
  { id: "local/blender-lightbox", name: "Blender lightbox (Cycles, plan lights)", vendor: "local", kind: "local", aliases: [/lightbox/i] },
  { id: "local/reproject", name: "Camera projection through the room GLB", vendor: "local", kind: "local", aliases: [/reproject\.py/i] },
  { id: "local/maskpaste", name: "Mask paste of original pixels", vendor: "local", kind: "local", aliases: [/maskpaste\.py/i] },
  { id: "local/pasteback", name: "Paste-back of original pixels", vendor: "local", kind: "local", aliases: [/pasteback\.py|feathered paste/i] },
  { id: "local/ecc-warp", name: "ECC warp onto a plate", vendor: "local", kind: "local", aliases: [/ECC warp/i] },
  { id: "local/screenpin", name: "Screen corner pin", vendor: "local", kind: "local", aliases: [/screenpin\.py/i] },
  { id: "local/ffmpeg", name: "ffmpeg (crop, extract, mux)", vendor: "local", kind: "local", aliases: [/ffmpeg|muxed/i] },
  { id: "local/remotion", name: "Remotion motion graphics", vendor: "local", kind: "local", aliases: [/remotion/i] },
  { id: "local/stitch-build", name: "stitch build (cut render)", vendor: "local", kind: "local", aliases: [] },
]

const byId = new Map(MODELS.map((m) => [m.id, m]))
export const modelInfo = (id: string) => byId.get(id)

/** The canonical id for a model id or provider endpoint ("fal-ai/kling-video/v3/pro/image-to-video" is
 *  kling/kling-3.0-pro), or undefined when no registered model matches. */
export function canonicalModel(id: string): string | undefined {
  if (byId.has(id)) return id
  return MODELS.find((m) => m.aliases.some((a) => a.test(id)))?.id
}

/** A step from a provider sidecar (`<output>.json` written by scripts/leap.ts, and the same shape for fal and
 *  Higgsfield outputs): provider, model or endpoint, job id, cost, and the scalar settings it ran with. */
export function stepFromSidecar(sc: Record<string, unknown>): GenStep | undefined {
  const raw = String(sc.model ?? sc.endpoint ?? "")
  const model = canonicalModel(raw)
  const provider = String(sc.provider ?? "unknown") as Provider
  if (!model) return undefined
  const input = (sc.input ?? {}) as Record<string, unknown>
  const settings = Object.fromEntries(Object.entries(input).filter(([k, v]) => !/prompt/i.test(k) && v !== null && ["string", "number", "boolean"].includes(typeof v) && !/^file_/.test(String(v))))
  const job = String(sc.generation ?? sc.request_id ?? sc.job ?? "") || undefined
  const cost = Number(sc.cost_usd ?? sc.costUsd)
  return { model, provider: PROVIDERS.includes(provider) ? provider : "unknown", ...(job ? { job } : {}), ...(cost ? { costUsd: cost } : {}), ...(raw !== model ? { settings: { endpoint: raw, ...settings } } : Object.keys(settings).length ? { settings } : {}) }
}

/** Parse a CLI step: "model@provider" or "model@provider:job" ("kling/kling-3.0-pro@leap:gen_abc"). */
export function parseStep(text: string): GenStep {
  const m = /^([^@]+)@([a-z-]+)(?::(.+))?$/.exec(text.trim())
  if (!m) throw new Error(`step "${text}": use model@provider or model@provider:job`)
  const model = canonicalModel(m[1]) ?? m[1]
  return { model, provider: m[2] as Provider, ...(m[3] ? { job: m[3] } : {}) }
}

/** What is wrong with a step list, if anything: unknown models, providers, or no steps at all. */
export function checkSteps(steps: GenStep[] | undefined): string | undefined {
  if (!steps?.length) return "no generation steps"
  for (const s of steps) {
    if (!byId.has(s.model)) return `unknown model "${s.model}" (add it to lib/models.ts)`
    if (!PROVIDERS.includes(s.provider)) return `unknown provider "${s.provider}"`
  }
  return undefined
}

/** The provider a legacy label names: "(Leap)", "(fal ...)", "(Higgsfield)", "(AI Gateway)", or a fal endpoint. */
function providerOf(text: string, model: ModelInfo): Provider {
  if (model.kind === "local") return "local"
  if (/\(fal|fal-ai\/|\bfal\b/i.test(text)) return "fal"
  if (/\(Leap\)|Leap\)/i.test(text)) return "leap"
  if (/higgsfield/i.test(text)) return "higgsfield"
  if (/AI Gateway/i.test(text)) return "ai-gateway"
  return "unknown"
}

/** Steps read from a legacy free-text label ("kling/kling-3.0-pro (Leap) + Index TTS 2 ... (fal) + sync/lipsync-3 (Leap)").
 *  Each part names one model; a part that names none is skipped. Marked inferred: a label is not a job record. */
export function parseLegacy(label: string): GenStep[] {
  const steps: GenStep[] = []
  for (const part of label.split(/\s\+\s|;\s(?=[a-z]+\.py)/i)) {
    const found = MODELS.filter((m) => m.aliases.some((a) => a.test(part)))
    // Within one part, a model step and a local step can both appear ("lightbox.py (Cycles) + ..." is split above;
    // "change-only edit + maskpaste.py" too). Keep the order they are named in.
    for (const m of found.sort((a, b) => part.search(a.aliases.find((x) => x.test(part))!) - part.search(b.aliases.find((x) => x.test(part))!)))
      if (!steps.some((s) => s.model === m.id && s.provider === providerOf(part, m))) steps.push({ model: m.id, provider: providerOf(part, m), inferred: true })
  }
  return steps
}
