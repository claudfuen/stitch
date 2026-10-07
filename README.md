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
| Derived views | `lib/derive.ts` | Shot rows, issues, canvas graph (edges from provenance), cut timelines and history (current cut, what changed), where each asset is used, the activity feed |
| API | `app/api/project`, `app/api/thumb` | `GET` the project (with each asset's file time), `POST { ops }` to change it; small cached WebP posters of any image or video |
| UI | `components/studio` | Shots, Cuts, Activity, Canvas and Rooms views; one media viewer; shared chips and posters in `media.tsx` |
| CLI | `scripts/stitch.ts` | The agent's way in. Same ops as the UI |
| Renderer | `scripts/build.ts` | Builds a cut straight from the project and registers it |
| Grey box | `scripts/greybox.py` | Builds a location in Blender from its floor plan and renders every camera setup |
| Leap | `scripts/leap.ts` | Leap API runner: uploads cached by hash, batches, a provenance sidecar per output |
| Review | `scripts/sheet.py`, `scripts/realism.ts` | Labelled contact sheets per round; a blind three-judge realism panel with real frames as controls |

The UI and agents never write the file directly: both send named ops (`take.set`, `shot.card`, `check.set`,
`location.update`, ...). That keeps every change auditable in the activity feed and identical whether a person or
an agent made it.

## Views

The top bar always shows the **current cut** (the newest full cut, never a scene cut) with a Watch button, and
whether the agents are working (the last thing they logged and how long ago).

- **Shots** (default): the film in order, one line per shot, grouped into scenes: its picked take, whether the
  current cut shows that take ("in v6", "v6 has an older take", "not in v6"), issues and checks. Filter by scene,
  issues or text. Select a shot for its detail: the take player, takes and keyframes to pick from, dialogue with how
  each line was voiced (on camera, voice-over, or laid over a silent clip and therefore not lip-synced), graphics,
  the checklist and the shot card. Open decisions and the cast and look bible fold away above the list.
- **Cuts**: every version of the film and of each scene, newest first. The newest full cut is marked current;
  older ones say what replaced them. Each plays with its timeline (click a shot to jump to it) and lists what changed
  from the version before, shot by shot.
- **Activity**: the work in progress, newest first, by the hour: what the agents log, the files they make (batched
  by file time, with posters and the shots they are for) and every cut as it renders. Everything since you last
  looked sits above a "new" line, and the tab counts it.
- **Canvas**: the pipeline as a graph. Real anchors and sheets feed keyframes, keyframes feed takes, voices and
  graphics feed takes, takes feed the final cut. Edges come from asset provenance, not hand-drawn links.
- **Rooms**: every location as one 3D scene (the GLB its plates are rendered from), with its cameras, marks and lights.
  Orbit it; look through any camera at its real lens with its frames laid over the 3D view and the faces' expected
  boxes drawn; or scout: place a free camera on the floor plan, dial lens, height, facing and tilt, see the frame live,
  and save it as a setup.

Lists never load media files: every image and video shows as a small poster from `/api/thumb` (cached in `.cache/`),
and a click opens the one viewer (full file, what made it, scores, where it is used). The board polls the project
every second; an unchanged project is answered from its file time alone, and each change is structurally shared
with the last, so a new log line re-renders only the activity views.

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
bun run stitch plan <loc> | plan set <loc> plan.json | plan plate <loc> <setup> <asset> circle|alt|reject
bun run stitch greybox <loc> [setup ...]
bun run stitch build --version v4
bun run leap batch jobs.json            # generations on Leap; see scripts/leap.ts
bun run realism label=path ...          # blind realism panel; include real frames as controls
```

## How a scene is made (the playbook)

Measured on the Ministry hall pilot (2026-10-06). The research and the numbers are in the Assistant research note
`domains/research/notes/2026-10-06-cinema-grade-ai-film-pipeline.md`. Never prompt a shot from scratch.

1. **Floor plan.** Put `Location.plan` on the board: walls, openings, furniture, marks (with a scene `beat`), the
   180-degree `axes`, and one `setup` per camera (size, lens on Super 35, height, position, facing, tilt). `stitch plan
   <loc>` prints each setup's field of view and the screen position of each mark. Derived checks flag setups on both
   sides of a line, and shots that cross it from the previous shot. Establish a seated exchange from the side its
   coverage is shot from; a master from behind flips the pair.
2. **Grey box.** `stitch greybox <loc>` renders every setup in Blender from the plan and attaches the renders. Look at
   them before spending: they find cameras inside heads, actors behind walls and marks leaking between scenes.
3. **Hero plate.** One master still per location from a written production brief, run on 3 to 5 models. Write the
   positive version of everything (no "Avoid" list): what the place is, what is in it from near to far, the light, and
   the photographic qualities (stock, lens, available light, deep focus).
4. **Set plates.** For each setup: the grey render as image 1 (layout) and the hero as image 2 (look), with a short brief
   for that angle. State what the wall in view holds and what is behind the camera; otherwise signage drifts onto the
   reverse wall. Circle plates as takes on the setup (`stitch plan plate`).
5. **Keyframes.** Edit the circled plate with "change only: add these people", passing real frames (Henrick) or
   character sheets as references. Gate every still against the AI tells (rim light, HDR micro-contrast, gloss, fake
   bokeh, uniform grade, stock staging, generic props, garbled text), the face score, and `bun run realism` with real
   frames as controls. Later states of a scene (eleven years later) are edits of the circled keyframe, so the frame
   stays identical.
6. **Voices.** Cast supporting characters from 3 to 4 auditions put in front of Claudio, loudness-matched. The picked
   read becomes the audio reference for every shot of that character.
7. **Video.** One line and one face per clip, with the keyframe as the start image, real references and the voice
   reference. Write the timing and a positive restraint clause ("keeps his head still while he speaks"). Draft at
   480p (several takes), review each on the av-review card, and finalize the circled take at 1080p.
8. **Cut.** Cut from the coverage. Hold one beat after a punchline, cut the dead air, replace generated room sound
   with one continuous bed, and audit the cut on the card.

**Routing.** Leap first for every model it carries (`bun run leap`; key in the Keychain service `LEAP_API_KEY`). The
fal MCP runs on Leap's fal account. Seedance with Henrick's real likeness is refused by fal and the Vercel gateway, so it
goes through Higgsfield `seedance_2_5` (`omni_reference`: start image, image references, audio references). Image
models that worked: GPT Image 2.5 Sunburst and Flare (plates and keyframes, realism 91 to 94 against a real control of
92). Nano Banana Pro scored 5 to 7 and lost Henrick's likeness. Inserts with no people work on Kling 3.0 Pro on Leap
(first and last frame for a state change).

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
- Hall shot 2.4 (Seedance 2.5 on Higgsfield, keyframe + 2 real frames + founder sheet + voice reference): face 0.71 in a
  32 mm two-shot, voice 0.74 (real vs real 0.71), the word on the mouth. Drafts cost 5 credits, the 1080p final 60.

## Model picks, by task (measured, not assumed)

Choosing the model for a task and doing the task are separate efforts: a small bake-off on one real frame, judged by
the blind realism panel (`bun run realism`), the room fit (`stitch fit`), conform and a geometry check, then the winner
does the work. Re-run a bake-off when a new model ships.

| Task | Picked | Evidence (2026-10-06) | Also tried |
|---|---|---|---|
| Realism pass on a plate (make a geometry-true frame read as a photograph) | Nano Banana 2.1 edit, 2K, frame + 3 real material crops | Realism 94 on both takes (real photo control 96, input 42); geometry held within 1% scale and 10 px | GPT Image 2.5 Sunburst 87 / 74 (holds geometry to 2 px but stays smoother); Seedream 5.0 Pro edit reframed wider on both takes (fails geometry); GPT Flare fills 71 |
| People on a plate (actors on the 3D stand-ins) | GPT Image 2.5 Flare edit: plate + blocking render + real Henrick frames + character sheet | Realism 96 (real control 96), Henrick face 0.70-0.72, fit ok for Henrick and the knitter | Nano Banana 2.1: realism 5-7 (judges read it as generated), face 0.52-0.61 |
| Carry a plate to another camera of the same room | `reproject.py` through the room GLB | Within 4 px of the projection; paint passes with a same-direction reference copied that reference's framing twice | Flare paint from the lit render |
| Plate from a lit 3D render | GPT Image 2.5 Flare with an opposite-angle look reference and material crops | Conform 83-89 | Same-direction reference: copied composition |
| Dialogue video with Henrick | Seedance 2.5 omni_reference (Higgsfield) | Face 0.71, voice 0.74 in a two-shot | Kling 3.0 Pro + Index TTS clone + lipsync-3: face 0.76-0.81, voice 0.80-0.90 on interview singles |

## Stack

Next.js, React Flow (`@xyflow/react`), shadcn/ui on the Base UI preset, Tailwind, Bun, Remotion (`motion/`), ffmpeg.
