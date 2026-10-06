# Stitch

A local node board for planning AI video: reference stills feed a character sheet, the sheet feeds
keyframes, keyframes feed video, and motion graphics and sound sit on a timeline underneath. It is a
planning and visualisation surface. It does not call any model itself.

An agent (Claude Code, or your own) drives it by editing one JSON file. The viewer watches that file and
updates within a second, so the board you see is always the board the agent sees.

```bash
bun install
bun run dev        # http://localhost:3000
```

## How it works

- `data/graph.json` is the single source of truth: `nodes`, `edges` and a `story` (sections, beats, tracks,
  open questions). The viewer polls `/api/graph` every second and applies external edits. Your drags and
  typing are written back to the same file. If the file is missing, `data/graph.example.json` is copied in.
- Node types: `prompt` (editable text), `asset` (reference still), `generation` (image or video, shows the
  result when `data.url` is set), `section` (colored header over a group of scenes), `motion` (a sticky for a
  motion-graphics piece, tied to its scene's video by a dashed edge).
- The bottom strip is the edit view: section bands, one card per scene with frame and video status dots, and
  tracks for motion graphics and sound. Click a card to zoom the canvas to that scene.
- `scripts/add-gen.py` downloads a finished generation and drops it onto the board:
  `scripts/add-gen.py <node-id> <url> <job-id> "<title>" "<model>" <x> <y> [source-node ...]`

## What is in this snapshot

A working board for a satirical 40 second spot ("The Ministry") built around a real actor with signed likeness
rights, shared as a starting point. It includes the reference stills, character sheets for three characters,
face grids, keyframes and the storyboard. `data/graph.example.json` is a small neutral starter if you want to
begin clean (copy it over `data/graph.json`).

The Henrick images are the actor's likeness, used with permission for Comp AI work. Do not reuse them outside
that.

## What we learned about character consistency

- One-pass character sheets work: ask for five full-body views (front, three-quarter, profile, three-quarter
  back, back) on top and four head portraits below, on a plain grey backdrop, in a single image. Use the whole
  sheet as the reference for every later shot.
- Anchor only on real footage. Our first sheet used three stills that were themselves AI-generated, and the
  likeness drifted. Rebuilding from real stills only, at the model's maximum quality and 4K, was a clear jump.
- Back and exact-profile views are inferred by the model. Trust them for wardrobe, not for identity.
- Generate original characters (founder, clerk) their own sheets too, or they change faces between shots.
- Submit image batches of about six at a time. Twelve at once hit 429 rate limits.
- Keep scenes fictional where the joke is institutional: no real flags, seals or agencies in the frame.
- Model notes from this run (Higgsfield): `gpt_image_2_5` accepted multiple reference images every time.
  `nano_banana_pro` failed or tripped the content filter on face close-ups in our tests.

## Stack

Next.js, React Flow (`@xyflow/react`), shadcn/ui on the Base UI preset, Tailwind, Bun.
