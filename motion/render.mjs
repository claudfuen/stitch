// Renders each composition to a transparent ProRes 4444 .mov (for ffmpeg compositing) in out/
// and a small VP9 alpha .webm preview in ../public/generated/motion/ for the board.
import { bundle } from "@remotion/bundler"
import { renderMedia, selectComposition } from "@remotion/renderer"
import { mkdirSync } from "node:fs"
import { execFileSync } from "node:child_process"

const only = process.argv.slice(2)
const chrome = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
mkdirSync("out", { recursive: true })
mkdirSync("../public/generated/motion", { recursive: true })
const serveUrl = await bundle({ entryPoint: "./src/index.ts" })
const ids = ["MinistrySign", "TicketDisplay", "FormStamp", "CalendarFlip", "DashboardScore", "Captions", "CaptionImpossible", "CaptionGood", "EndCard"].filter((i) => !only.length || only.includes(i))
for (const id of ids) {
  const composition = await selectComposition({ serveUrl, id, browserExecutable: chrome })
  const out = `out/${id}.mov`
  await renderMedia({ composition, serveUrl, codec: "prores", proResProfile: "4444", pixelFormat: "yuva444p10le", imageFormat: "png", outputLocation: out, browserExecutable: chrome })
  execFileSync("ffmpeg", ["-v", "error", "-y", "-i", out, "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-b:v", "0", "-crf", "34", "-an", `../public/generated/motion/${id}.webm`])
  console.log("rendered", id)
}
