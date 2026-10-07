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
   - Image 1 is the box from this camera, painted in the set's real colours. The box carries a palette (floor, walls,
     a gradient on the far wall) and a colour per item, so the layout carries the look as well as the geometry. A grey
     wall in the layout came back as a grey wall in the frame.
   - Image 2 is one labelled reference board (`bun run space-board <film> <room> <cam>`), holding:
     - MAP: the top-down plan, with this camera's cone.
     - THE ROOM: the approved set (materials and light only).
     - PROPS AND SIGNS: the approved designs of every prop and sign, from the stage 02 sheets.
     - Identity panels for the people this camera sees.
     The labels are the tags the prompt refers to. No model has a per-image tag field; roles go in the prompt (research
     note 2026-10-07-tagged-multi-reference-models).
   - The text carries the blocking computed from the 3D plan (`bun run space-judge <film> <room> --truth`): where
     each person and object lands across and up the frame, which way people face, and what this angle must not show.
     It also says to keep every person exactly as large as in Image 1, because models zoom in.
   - Each principal in frame also gets their approved face and costume as separate full-size images after the board
     (`space-frames prep --cast-refs`). A face that reaches the model only as a small board panel drifts.
   - Nano Banana 2.1 (edit) makes the takes and the one-change fixes. Seedream 5.0 Pro paints the set better but does
     not hold faces: Henrick's ArcFace similarity to his real photos was 0.19 to 0.34 on Seedream and 0.45 to 0.54 on
     Nano Banana for the same frontal cameras (two real photos of him score 0.82). Use Seedream only for a frame with
     no principal in it. Use 2 to 4 takes per camera.
   - Before the first take, lint the words against the pictures (`bun run space-lint <film> <room> ...`). Opus 5.5
     and GPT-6 Astra each see every reference and list each sentence of the legend, cast descriptions, style and shots
     that a reference contradicts. Fix the text (or the reference) until the lint is clean.
8. **Two gates, both required.** Neither gate alone was enough.
   - **The space judge** (`bun run space-judge <film> --frames ...`, Opus 5.5). It sees:
     - one sheet with the labelled plan, every camera's layout, and this layout beside the frame;
     - the board;
     - the computed blocking.

     It scores space, identity, look and realism, and the gate is all four at 8 or more with no high-severity finding.
     Its findings are classed as model, layout or plan errors; layout and plan errors are fixed in the box, not by
     regenerating.
   - **The cohesion judge** (`bun run space-cohesion <film> --frames ... --picks ...`). Opus 5.5 and GPT-6 Astra each
     see the board, the other chosen angles of the room and the candidate. Each scores two things: is it a believable
     photograph, and does it read as the same shoot (props, signs, costumes, light) as the approved references and
     the other angles? Both models must give 8 or more.

     The space judge passed a Brock who was floating mid-air. The cohesion judge failed that frame at plausibility 3
     and caught props redesigned from cut to cut.
   - `bun run space-frames prep|run|candidates|pick` runs the loop: `run` sends the jobs to fal with the Keychain
     key (`FAL_KEY`) and writes each take with its sidecar, about 90 s a take, no uploads or pasting. A person still
     looks at every frame that passes.
9. **Fix, don't regenerate, when a take is close.** One "change only X" edit from the judge's own fix list
   (`space-frames fix`). It starts from the clean take, so no frame gets more than two generative passes.
10. **Review every frame for logic:** the same person twice in a crowd, a stranger in a known character's place, a
   prop that should not be there yet, a room bigger in one angle than another.

What the Order Now runs measured on the studio and operator cameras: 9 cameras, about 90 takes, all judged by the
same four-score judge.

| Input | Model | Pass rate | Look | Space |
|---|---|---|---|---|
| Clay box + separate references | Nano Banana 2.1 | 0 of 8 | 5.8 | 5.6 |
| Clay box + board | Seedream 5 Pro | 0 of 8 | 8.8 | 5.8 |
| Colour box + board | Nano Banana 2.1 | 1 of 18 | 6.6 | 6.8 |
| Colour box + board | Seedream 5 Pro | 5 of 18 | 8.1 | 6.7 |
| Detailed box (shapes, posed mannequins) + board | Nano Banana 2.1 | 1 of 18 | 6.0 | 6.8 |
| Detailed box + board | Seedream 5 Pro | 0 of 6 | 5.8 | 5.5 |
| Colour box + board, text contradicting the references | Seedream 5 Pro | 0 of 16 | 6.9 | 6.0 |
| Colour box + board + full-size cast references, linted text | Nano Banana 2.1 | 6 of 30 | 6.8 | 6.7 |
| The same, then one fix pass from the judge's findings | Nano Banana 2.1 | 17 of 17 chosen for review | | |

The last three rows cover all four boxed rooms (studio, operators, audit, kitchen). The 6 first-take passes covered
A1, A2, K1, K2 and O2, each at identity 8 or 9. The judge's identity score did not see Seedream's drift (7.9 against
7.6 for Nano Banana) because it compares faces with small board panels; ArcFace against the real photos did. In the
studio, Nano Banana's first takes pushed Brock's tan to orange and greyed the gradient wall; the fix pass repaired the
wall, not the tan.

- The model decides the look: Seedream holds the set's colours and the cast; Nano Banana greys the gradient wall.
- The colour box helps space.
- The detailed box (real shapes, lettered signs, posed mannequins) helped space on some cameras (C1 reached 8) and
  anchored the operator room. It cost look everywhere, because the mock-up's plastic surfaces leak into the photo, and
  its single-line lettering redesigned a sign the approved plate has on two lines. Keep it as an optional pose guide,
  not as Image 1.

## Stage 04 in detail

1. **State of the art first.** Before the first take, name the current best voice model and check that the route
   exposes the feature that matters. In October 2026 that is ElevenLabs Eleven v4 (top of the Voice Arena), and the
   features are the Voice Library, Voice Design, clones and Text to Dialogue. Leap and fal carry v4 with only the 21
   stock voices and no dialogue mode, so voice goes to ElevenLabs direct (`scripts/eleven.ts`, Claudio's Pro plan).
2. **Cast.** `bun scripts/voice-cast.ts <film>` makes three Voice Library voices and two Voice Design voices (written
   from the character brief, `eleven_ttv_v3`) per role. Each one reads that role's own lines with the same direction
   as one v4 dialogue request, so the person compares voices, not performances. A real person (Henrick) gets a clone
   of his real recordings, never of generated audio, scored against his recording with `scripts/voice-score.py`.
   Everything lands in the app (`stitch voice set`), and the person picks.
3. **Read the whole film in one take** with the picked voices (`scripts/voice-take.ts`), cut into lines by word
   timings, and check every beat's speech against its slot.

v4 takes direction in one free bracket per line (`[dry, precise, fussy]`), built from each character's standing
read, the beat, and the line's own `how` (`acted()` in `scripts/eleven.ts`). Transcripts of the auditions came back
word for word, with none of the direction spoken.

| Henrick's voice | Match to his recording |
|---|---|
| Stock voice, converted (Chatterbox HD), take 1, per line | 0.71 mean (0.57 to 0.83) |
| Same, his lines joined | 0.84 |
| Eleven v4 instant clone of his 4 real lines (13.6 s) | 0.91 (in sample: it learned from the reference) |

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

- 2026-10-07 (voice): Claudio, on the first auditions (ElevenLabs v3 stock voices via Leap): "I don't love the voices
  you pulled... are we using state-of-the-art or no?" and "for everything we do, we should always be using
  state-of-the-art." Casting moved to ElevenLabs direct on Eleven v4 with library, designed and cloned voices (stage
  04 in detail). Every stage now starts by naming the current best model and checking the route exposes it.

- 2026-10-07 (later): Claudio, on the Seedream rounds: "we lost character consistency... it was coming out way better
  with Nano Banana... we have to go back to that approach". ArcFace confirmed it (step 7), so takes went back to Nano
  Banana with full-size cast references. Four more changes came out of the same stretch:
  - Round 4 failed 16 of 16 takes because the prompt text contradicted the approved pictures (a black button base,
    a golden tan, navy glasses). `space-lint` now checks the words against the references before any money is spent.
  - The kitchen and audit room got boxes. Their maps contradicted their own briefs (a table "running left to right"
    shot "down its length"), and the approved kitchen plate carries a modern laptop; a PROPS panel now holds the 1994
    computer and printer.
  - Items and marks can live in several beats (`beats`), so a set can change between shots (the binders are gone in A3).
  - Leap's Seedream takes at most 4,000 characters of prompt and no output size, so these frames ran on fal; Leap
    text-to-image worked and made the kitchen props reference.

  Stage 03 took far longer than stages 01 and 02. Most of the time went to rounds that measured a model or an input
  rather than shipping a frame. The order next time: lint, then box every room, then Nano Banana with cast references,
  then one fix pass, then put the draft in front of the person.

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
