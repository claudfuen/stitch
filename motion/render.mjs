// Renders compositions to transparent ProRes 4444 .mov files in out/ (for ffmpeg compositing),
// plus a small VP9-alpha .webm preview in ../public/generated/motion/ for the board.
//   bun run render.mjs [Comp ...]                 render the named comps (all if none)
//   bun run render.mjs CaptionTrack --props f.json   render one comp with input props (no preview)
import { bundle } from "@remotion/bundler"
import { renderMedia, selectComposition } from "@remotion/renderer"
import { mkdirSync, readFileSync } from "node:fs"
import { execFileSync } from "node:child_process"

const args = process.argv.slice(2)
const pi = args.indexOf("--props")
const inputProps = pi >= 0 ? JSON.parse(readFileSync(args[pi + 1], "utf8")) : undefined
const only = args.filter((a, i) => !a.startsWith("--") && (pi < 0 || i !== pi + 1))
const chrome = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
mkdirSync("out", { recursive: true })
mkdirSync("../public/generated/motion", { recursive: true })
const serveUrl = await bundle({ entryPoint: "./src/index.ts" })
const all = ["MinistrySign", "TicketDisplay", "FormStamp", "CalendarFlip", "DashboardScore", "EndCard"]
const ids = only.length ? only : all
for (const id of ids) {
  const composition = await selectComposition({ serveUrl, id, browserExecutable: chrome, inputProps })
  const out = `out/${id}.mov`
  await renderMedia({ composition, serveUrl, inputProps, codec: "prores", proResProfile: "4444", pixelFormat: "yuva444p10le", imageFormat: "png", outputLocation: out, browserExecutable: chrome, timeoutInMilliseconds: 120000 })
  if (!inputProps) execFileSync("ffmpeg", ["-v", "error", "-y", "-i", out, "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-b:v", "0", "-crf", "34", "-an", `../public/generated/motion/${id}.webm`])
  console.log("rendered", id)
}
