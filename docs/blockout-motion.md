# Blockout motion: what it is for, and how it is tested

Stage 06 drives the video model (Seedance 2.5 omni reference) with an animated grey-box blockout
(`scripts/greybox.py --anim`, `stitch take block`). The model copies the blockout's camera and body motion almost
one to one. So every movement in the blockout ends up on screen, the corny ones included.

## The goal

The blockout is a reference, not a performance. It fixes five things exactly:

- where each person is;
- which way each person faces and turns;
- when each person leans, walks, sits or stands;
- the camera: placement, lens, moves, whips;
- the timing against the locked read.

Everything that makes a person look alive comes from the model, guided by the reference stills and the prompt: arms,
hands, faces, lips, eyes and acting. The blockout's own motion must be the motion of real people filmed in a real
studio: small, motivated, physically plausible. If a viewer could tell the motion was keyframed, it is wrong.

## Principles

1. **No rhythmic motion.** People do not bounce while they talk. A periodic bob or sway reads as a cartoon. It was
   the defect of take A2 and the first A3 render (Claudio, 2026-10-08: "very cartoonish, corny ... always kind of
   hopping").
2. **Articulated, not rigid.** A body moves at the hips, at two spine joints, at the neck and head, and at the knees.
   A lean starts in the spine; a turn starts in the head and the chest follows; a walk has knees.
3. **Idle life, low amplitude.** Weight shifts of about 1 to 2 degrees, breathing, and a head that drifts a few
   degrees. These run on slow noise, never on a sine.
4. **Motivated accents.** A move happens because of the script: a nod lands on a stressed word, a turn lands on the
   name, a lean lands on the question, a slam lands on its beat. Accents attack fast and release slowly.
5. **Physical plausibility.**
   - Feet stay planted unless walking.
   - A walk's stride matches its speed.
   - The body follows a lean from the hips, not the feet.
   - Nothing pops between frames.
6. **Arms are the model's.** The figures have no arms (take `render.arms: false`): rigid stick arms pinned the model
   to wrong poses. Arm actions go in the prompt, shot by shot.
7. **Character is in the amount.**
   - Brock is big: bigger turns, deeper leans, a nod on every stress.
   - Henrick is the joke: almost nothing moves, only the eyes, the mouth and a two-degree nod.
   - The audience moves only together, on its cues.

## What each studio beat must achieve (take A)

| Beat | What the scene must achieve | Natural body motion that serves it | Stress test |
|---|---|---|---|
| 5 There is (C1, C2) | Brock explodes onto a set that is already cheering | A brisk walk-in with real strides (C1); on the name, the head and then the chest turn to Henrick; nods on THERE, IS, EUROPE, HENRICK, JOHANSSON | Strides match speed and feet do not slide; no vertical bounce beyond the walk's own 1 to 2 cm; the turn lands on "HENRICK" |
| 6 Please stop (C3) | Henrick kills the energy by not moving | Hands-in-lap stillness; idle breathing only; a 2-degree nod on "Thank you" and "Nothing" | Henrick reads as still but alive: no frozen statue, no visible sway |
| 7 What it does (C2, C3, C7) | Brock leans in, Henrick stays unmoved, the audience goes "Ooooh" | Brock: a spine lean of 12 to 15 degrees, building to "DO?!", head turned to Henrick. Henrick: as in beat 6. Audience: all lean in together on the cue, with a small spread in timing | The lean comes from the spine, not the feet; the audience moves as a crowd, not in lockstep |
| 8 The button (C4) | Brock slams the button again and again while Henrick, off screen, deflates it | Three slams: the spine pitches forward about 20 degrees, the head drops on impact, and the body rises back between slams; the binder tower crushes flat into a folder on the first slam | Each slam is a distinct hit; there is no bounce between slams; the tower collapse is visible |

## How a generation is judged

Judge every shot against the story, not against the prompt. Read the dense strips, with the blockout underneath, and
grade each shot on six questions. For each question, note what works and what fails, with the time:

1. **Beat.** Does the shot do what its beat needs? For example, the button must be established before it pays off,
   and a line has to land on the person it is about.
2. **Motion.** Is the motion natural, with no corny bounce, frozen poses, dance steps or sliding?
3. **Camera.** Do the moves read (pushes, snaps, whips), and does the framing hold the subject?
4. **Continuity.**
   - Each face stays the same character in every shot and every still.
   - Props stay where the story needs them, and in frame when they matter.
5. **Sound and lips.** Is the line lip-synced to the person who speaks it, and is an off-screen line motivated?
6. **Realism.** Real skin, light and materials, with no AI gloss and no orange or waxy faces.

Then watch the whole film in order (`public/generated/<film>/cut/current-cut.mp4`, rebuilt after each take): a shot
that works alone can still break the story's cohesion.

## How a blockout is checked before it goes to the model

1. **Dense strips** (`skills/content/av-review/scripts/strips.py` in the assistant repo):
   - one row per second at 8 frames a second, and 24 for whips and slams;
   - the blockout under its generation with `-with`;
   - look for periodic bars (a bounce), lone tall bars (pops), empty bars inside a move (stalls) and sliding feet.
2. **The beat table above:** every stress test passes.
3. **Then generate.** After the generation, run the same strips on it, with the blockout underneath.
