#!/usr/bin/env bun
// The Higgsfield API smoke test: one Seedance 2.5 text-to-video through the official SDK's subscribe (it polls until
// the request settles). HF_CREDENTIALS ("key-id:key-secret") comes from .env.local, which Bun loads and Git ignores;
// it is never printed.
//
//   bun scripts/hf-example.ts
import { config, higgsfield } from "@higgsfield/client/v2"

if (!process.env.HF_CREDENTIALS) throw new Error("HF_CREDENTIALS is not set (.env.local)")
config({ credentials: process.env.HF_CREDENTIALS })

const result = await higgsfield.subscribe("bytedance/seedance-2.5/text-to-video", {
  input: { prompt: "A cinematic scene at sunset", duration: 5, resolution: "720p", aspect_ratio: "16:9" },
  withPolling: true,
})

if (result.status === "completed" && result.video?.url) {
  console.log(`completed ${result.request_id}: ${result.video.url}`)
} else {
  // failed, nsfw (moderated) or anything without a video is not a success
  console.error(`not completed: status ${result.status}, request ${result.request_id}`)
  process.exit(1)
}
