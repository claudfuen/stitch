# The process

How a film gets made in Stitch. It is a working method, not a contract: change it when a film teaches us something,
and say what changed and why at the bottom.

## The shape

Eight stages, in order. Agents propose and do the work; a person decides at each gate. Who does a stage (an agent, a
person or both) is set per film. A required gate blocks every later stage until it is approved. An advisory gate
shows its status and blocks nothing. A stage a film does not need is skipped: a footage-only edit or a motion-graphics
piece skips the AI stages and runs the same rail.

| # | Stage | What it produces | Gate |
|---|---|---|---|
| 01 | Script and beats | Three concepts, then a timed beat sheet with a joke in every beat, the cast as the script introduces them, and a shareable PDF | Required |
| 02 | Look and sheets | One proposal for how the whole film looks: art direction, the world in that look, the cast inside the world, and their reference sheets | Required |
| 03 | Space and camera | One master image per room; 3D only for hard blocking | Advisory |
| 04 | Voice | Each line performed and recorded first; speech-to-speech when a character needs another voice | Required |
| 05 | Body and face | An actor on camera, an actor's take transferred, or generated from the sheets | Advisory |
| 06 | Pixels | Video takes: 5 to 64 per kept shot | Advisory |
| 07 | Pick and cut | Rough assemblies early; throw out pretty takes that break the character | Required |
| 08 | Finish and score | Cleanup, grade, grain, music, foley, room tone | Required |

## How a person is asked to decide

- **Show one proposal, not a menu.** Agents make the calls and present the result as a whole. The person reacts to
  the whole: approve, or say what feels off. Offer options only for a real fork in taste, and then as two clearly
  different directions, never as three model outputs.
- **Show finished work.** A face portrait does not show whether the sheet holds; a single room does not show whether
  the world is cohesive. Present the sheet, the board of every set, the character inside the world.
- **Comments are where specifics go.** Any part can take a comment, including "try this in Seedream". Agents read open
  comments with `stitch feedback` and resolve them as they act.
- **The bar at the bottom decides.** Approve unlocks the next stage. Request changes needs a note. Reject needs none.

## Stage 02 in detail (the one we learned the most on)

1. **Art direction first.** One look frame per world in the film (here: 1994 Betacam infomercial in colour, and its
   black-and-white "before"). Everything after must match these.
2. **The world, as one family.** Every set, prop and crowd from one model (GPT Image 2.5 Sunburst on this film), with
   the same look words, then the same deterministic grade (`scripts/look.sh <look>`) so they read as one show. Shown
   together on one board, because cohesion only shows side by side.
3. **The cast inside the world.** For each character, one frame of them in the film's look: what the person reviews.
   Real people come from real footage (real photos beat generated ones).
4. **Reference sheets for the models.** Separate images, not a grid, 13 per character: a body turnaround (front,
   three-quarter, profile, back), three face views (front, three-quarter, profile), two expressions the script needs,
   and four poses that are actions from the script (Brock heaving the binders, Gerald sliding the sticky note). Plain
   grey backdrop on purpose: their job is to pin the face and costume; the look is applied in the shot. Each view is
   an edit of the approved face, made with Nano Banana 2.1 (edit), which keeps skin and fabric clean. GPT Image 2.5
   views came out grainy and painterly. A real person keeps their real stills on the sheet next to the generated
   views. The prompts are a data file (`work/<film>/sheets/nb-views.json`), so a sheet can be rerun or extended.
   Look at every view before it goes on the sheet, at full size: costume details drift between views (Gerald's
   glasses chain hung like a necklace in three of four face views), and props combine in impossible ways (a headset
   and a handheld receiver on the same ear). Fix a drifting detail by passing the one view that got it right as
   Image 1.
5. **Lock test before any video** (next): the sheet must give the same recognisable person in 10 of 10 new scenes.

## Stage 03 in detail

From the research (note 2026-10-07-sota-ai-film-vs-stitch), not from 3D: the best 30-90 s spots build no rooms in 3D.
They rotate one approved set into a few angles and write the space down.

1. **Per room, a space map in words.** Who sits or stands where, which side of screen each person is on, where they
   look, what is behind each camera. It goes into every prompt, because the failures to prevent are left-right
   flips, invented reverse walls and moving signs.
2. **2-4 cameras per room**, the wide master first (it loads the layout). Every camera stays on one side of the
   action. Comedy rules: wide lenses are funny, the reaction is funnier, hold one beat after the punchline.
3. **A grey box where blocking is hard** (many cameras, several people, a crowd, a line to hold): the room as simple
   blocks with a flat-coloured stand-in per character (`data/space/<film>/<room>.json`, rendered by
   `scripts/greybox.py`). Each camera's render becomes that frame's Image 1: it fixes framing, positions, screen
   direction and what is not in frame. Skip it for one person or one camera. On Order Now the studio and the operator
   room got one; the frames made without it had the desk move, bleachers appear where the angle cannot see them, and
   Henrick change seats between cuts. No camera solving or reprojection: that was the Ministry's overspend. The one
   judge is the whole-room check in step 8, and it sees the same box the frames are made from.
4. **One frame per camera:** the grey-box render (or, without one, the approved set plate) as Image 1, the set plate
   for the look, the cast's sheets and the script pose as references, then the film grade. Two takes each; keep the
   one that matches the layout.
5. **Continuity is written as rules, not hoped for.** What is always in the room (the studio audience), what is on
   the desk in which beat, who is behind the camera. A crowd is cast like a character: one reference frame (the
   reverse angle), a seating chart with the front row described person by person, and every other frame copies it.
6. **The camera script:** which camera is on screen at each second. It is retimed to the recorded voices at stage 04.
7. **Give the generator the room, not a pile of pictures.** Each frame gets two images and computed text:
   - Image 1 is the grey-box layout from this camera.
   - Image 2 is one labelled reference board (`bun run space-board <film> <room> <cam>`). It holds the top-down
     plan with this camera's cone, the approved set (materials and light only), and identity panels for the people
     this camera sees. The labels are the tags the prompt refers to.
   - The text adds the blocking computed from the 3D plan (`bun run space-judge <film> <room> --truth`): where each
     person and object lands across the frame, which way people face, and what this angle must not show.
   - Settings: a system prompt saying the layout wins over any reference, and thinking set to high.

   On the Order Now A/B (four cameras, two takes each, judged as in step 8) this recipe scored 6.4/10, against
   about 4.6 for the old frames and 5.75 for separate references. Four of its eight takes had no high-severity
   finding, against none of the old frames. The board alone, without the blocking text, was no better than separate
   references: the computed text did the work. Pass the set plate only on the board or as tight material crops. A
   full plate, or a full crowd frame, is a ready-made composition: the model copies it instead of the layout (on
   Order Now it blew up the bleachers in every angle).
8. **Judge every frame against the whole room:** `bun run space-judge <film> [room]` builds one sheet per camera:
   - the labelled top-down plan with every person, prop and camera;
   - every camera's layout;
   - this camera's layout beside its frame.

   Opus 5.5 gets that sheet, the space map and the computed blocking. It returns findings classed as model (the
   frame is wrong), layout (the box is wrong) or plan (the camera does not serve the shot). A pair of images hides
   room-level errors. On Order Now the room view found faults a pairwise check had passed:
   - a crowd seated in the beat where it stands;
   - a neon sign the camera physically cannot see;
   - an operator facing the opposite way from every other chair.

   `--frames candidates.json` scores takes before one is picked. `python3 scripts/adherence.py <film>` (layout,
   frame, 50/50 blend) stays as the quick visual check. Read the judge's findings before acting on them. Some are
   layout or plan errors, and those are fixed in the box, not by regenerating.
9. **Review every frame for logic:** the same person twice in a crowd, a stranger in a known character's place, a
   prop that should not be there yet, a room bigger in one angle than another. Fix with one "change only X" edit
   from the clean take, so no frame gets more than two generative passes.

Nano Banana 2.1 (edit) makes the frames. On the studio A/B it followed framing and action more literally than
Seedream 5.0 Pro (edit), which kept skin a little more natural; Seedream is the fallback when a frame fails.

## Rules that hold across stages

- **Provenance on everything.** Every image, clip and sound records its model and provider (or that it is real),
  with job ID, prompt and cost. `stitch sheet add|view|scene` refuses an asset without model and provider.
- **One model per job within a film**, chosen by the agents; the person sees it labelled and can ask for another.
- **Everything in frame is in the look**, except reference sheets.
- **Generate clean, grade once.** Models get ungraded, evenly lit inputs; the film grade is applied once, at the end,
  by `scripts/look.sh`. Feeding a graded image into an edit makes the model darken it again, then the grade doubles it.
- **The grade matches tone, not just colour.** `look.sh` maps each image's luma range onto the approved look frame's
  (measured on the centre, away from the vignette), so a night set and a bright room land at the same brightness.
  Lighting still has to be right in the source: grading cannot turn chiaroscuro into flat 1994 fluorescent light.
- **Period is part of the look.** Wardrobe, props and sets are checked against the era (a 1994 film gets a CRT and a
  pager, not a laptop and earbuds).
- **Exports for review.** The script and the look book (`/api/script-pdf?doc=look`) download as PDFs, with every image
  captioned by model and provider, so the look can be reviewed and refined outside the app.
- **Leap first** for any model Leap carries; fal (Leap's fal account) when Leap cannot take the input; Higgsfield
  only for a model or input neither offers (for example Seedance with a real person's face). On fal, `bun run fal
  batch jobs.json` runs a jobs file with a key, and the fal connector (8 jobs per call) runs the same requests
  without one. Either way, every output gets a sidecar (`<file>.json`: provider, model, request ID, the prompt that
  actually ran, inputs), and `stitch sheet view` reads it, so provenance is never typed by hand.
- **A refused prompt is retried once, reworded, and the sidecar says so.** fal's content checker flags harmless
  prompts now and then (3 of 52 sheet views: a neutral face, a camera flash, a chair tipping over). Refusals are not
  billed.
- **Physical plausibility is checked by a person.** Edit models do not notice a hand through glass.
- **Dense storyboards are not the default.** One strong opening frame plus timed beats in text placed every beat in
  our test; extra keyframes made motion stiffer (research note 2026-10-07-storyboard-density-test).

## Changes

- 2026-10-07: Claudio asked for a judge that sees the whole room, not two images: "Here's a whole room, a bunch of
  different stills, and then here's the particular camera angle versus the actual visual". He also asked to feed
  the generator that same context. Building it found errors in the plan, not only in the frames:
  - The neon sign was boxed a metre too high against the approved set.
  - The beat 5 crowd was seated when the script has it standing.
  - C7 could see only 38 of the 48 seats.
  - In both operator frames, Henrick faced the opposite way from every other operator. The approved plate has
    everyone facing their partition.

  The boxes were fixed first. Then a four-arm A/B ran on C1, C2, C5 and O2 (Nano Banana 2.1 three ways, plus
  Seedream 5.0 Pro), and the board plus computed blocking became the recipe (step 7). The winners replaced the old
  frames.

- 2026-10-07: Claudio saw space drift between angles (the stage, Henrick's seat in the operator room) and asked
  whether the 3D step was worth it. Yes, scoped to rooms with hard blocking: grey boxes for the studio and the
  operator room, each frame remade with its camera's render as Image 1, the render shown inset on the page.
- 2026-10-07: Stage 03 built from first principles (no floor-plan geometry, no Blender): rooms, cameras, space maps
  and a camera script in the process (`stitch space`), a frame per camera. Claudio's review found the audience
  appearing and vanishing, the same woman in two seats, and bleachers of different sizes; the audience became a cast
  with a reference frame and a seating chart, and continuity rules went into the space map.
- 2026-10-07: Character sheets regenerated with Nano Banana 2.1 (edit) on fal after Claudio saw grain and a painted
  look in the GPT Image 2.5 views: 13 views per character (turnaround, faces, expressions, script poses). Henrick's
  sheet keeps his real stills and the poses from his Ministry book. `stitch sheet view` reads sidecars and stores big
  PNGs as JPEG; `stitch sheet unview` takes old views off. The demo props rebuilt on the infomercial set itself.
- 2026-10-07: Kyle redesigned as a 1994 founder after Claudio's note; the black-and-white sets rebuilt with flat 1994
  light because grading alone could not match them; tonal matching added to the grade; "generate clean, grade once";
  look book PDF export; the "other options" section removed from the review page.
- 2026-10-07: First version, from Order Now. Stage 02 moved from "pick one of three model outputs per item" to one
  proposal reviewed as a whole, after Claudio asked what we were actually asking him to decide.
