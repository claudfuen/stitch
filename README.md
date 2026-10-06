# Stitch

A local production board for AI video. One typed project file holds the whole production: cast, look bible,
assets with provenance, shots (with shot cards, takes, dialogue, graphics, sound cues and a craft checklist) and
rendered cuts. Every view and the renderer derive from it, so the board can never drift from what was built.

```bash
bun install
bun run dev                 # http://localhost:3000
bun run stitch show         # the same project, from the terminal
```

## Architecture

| Layer | File | Role |
|---|---|---|
| Model | `lib/model.ts` | Types for the project: characters, locations (look bible), assets, shots, graphics, cuts, activity |
| Operations | `lib/ops.ts` | The only way the project changes. Pure `(project, op) -> project` |
| Store | `lib/store.ts` | Locked, atomic reads and writes of `data/project.json` |
| Derived views | `lib/derive.ts` | Shot rows, issues, canvas graph (edges from provenance), timeline (from the latest cut) |
| API | `app/api/project` | `GET` the project, `POST { ops }` to change it |
| UI | `components/studio` | Shots view, Canvas view, timeline, activity, final-cut player |
| CLI | `scripts/stitch.ts` | The agent's way in. Same ops as the UI |
| Renderer | `scripts/build.ts` | Builds a cut straight from the project and registers it |

The UI and agents never write the file directly: both send named ops (`take.set`, `shot.card`, `check.set`,
`location.update`, ...). That keeps every change auditable in the activity feed and identical whether a person or
an agent made it.

## Views

- **Shots** (default): one row per shot. Keyframe and take (with alternates you can pick), dialogue with how each
  line was voiced (on camera, voice-over, or laid over a silent clip and therefore not lip-synced), graphics, the
  shot card (framing, blocking, performance, continuity, sound, cut points) and a nine-point craft checklist.
  Above the shots: open decisions, the cast and the look bible.
- **Canvas**: the pipeline as a graph. Real anchors and sheets feed keyframes, keyframes feed takes, voices and
  graphics feed takes, takes feed the final cut. Edges come from asset provenance, not hand-drawn links.
- **Timeline**: what the latest cut actually contains, line by line.
- **Watch final cut**: every rendered version.

## CLI

```bash
bun run stitch show [shot]
bun run stitch asset add <id> --media image|video|audio --from <url|file> --label ".." --model .. --inputs a,b
bun run stitch score <asset> [--face] [--voice]      # ArcFace / speaker similarity to the real anchors
bun run stitch take add <shot> <asset> [--keyframe] [--circle]
bun run stitch take circle|alt|reject <shot> <asset> [--note ..]
bun run stitch card <shot> <field> "<text>"
bun run stitch check <shot> <key> ok|fail|clear --note ".."
bun run stitch op '<op json or array>'
bun run stitch build --version v4
```

## The renderer enforces the craft rules

- Head trims skip the model's warm-up frames and keep about 0.35 s before speech; "speech" tails end 0.45 s after
  the last word (speech detected relative to each clip's own level).
- Frames are scaled to fill and cropped, never padded. Optional punch-in to motivate a cut between takes that
  share a framing.
- Each shot is colour-matched to its location's look: the real footage for the study, the style plates elsewhere.
- One continuous room-tone bed per run of shots in a location. Voices laid into a scene are convolved with a
  recorded room for that location.
- Captions on every line with the series bug, a dissolve into the end card, 48 kHz audio at -14 LUFS.

## Look bible

Each location carries style frames (an empty set plate and detail plates), a palette and notes on light, lens,
contrast and grain, the images its grade is matched to, an ambience bed, and a recorded room. Recurring props have a
reference sheet. Keyframes for a location should take its plate as a reference so the set stays the same.

## Licensed files are not in this repo

- Room impulse responses come from Apple's Logic library on the machine (`/Library/Audio/Impulse Responses`).
- The Lausanne font is Comp AI's licensed brand face; `motion/public/fonts/` is filled from `comp-web-v3` and is
  gitignored.

The Henrick images and voice are the actor's likeness, used with signed permission for Comp AI work only.

## What we measured (see `docs-resemblance.md`)

- Edit a real still to make a keyframe (face 0.75 to 0.82, the real-vs-real ceiling is 0.82). Sheets dilute the face.
- Seedance 2.5 with real stills and a voice reference: face 0.76 to 0.82, voice up to 0.86.
- Face replacement after the fact did not move the score.
- Laid voices over silent clips read as cheap. Generate on-camera lines inside the shot.

## Stack

Next.js, React Flow (`@xyflow/react`), shadcn/ui on the Base UI preset, Tailwind, Bun, Remotion (`motion/`), ffmpeg.
