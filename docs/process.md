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
4. **Reference sheets for the models.** Separate images, not a grid: front and three-quarter close-ups, profile, full
   body front and back, and the expressions the script needs. Plain grey backdrop on purpose: their job is to pin the
   face and costume; the look is applied in the shot. Each view is an edit of the approved face.
5. **Lock test before any video** (next): the sheet must give the same recognisable person in 10 of 10 new scenes.

## Rules that hold across stages

- **Provenance on everything.** Every image, clip and sound records its model and provider (or that it is real),
  with job ID, prompt and cost. `stitch sheet add|view|scene` refuses an asset without model and provider.
- **One model per job within a film**, chosen by the agents; the person sees it labelled and can ask for another.
- **Everything in frame is in the look**, except reference sheets.
- **Leap first** for any model Leap carries; fal (Leap's fal account) when Leap cannot take the input; Higgsfield
  only for a model or input neither offers (for example Seedance with a real person's face).
- **Physical plausibility is checked by a person.** Edit models do not notice a hand through glass.
- **Dense storyboards are not the default.** One strong opening frame plus timed beats in text placed every beat in
  our test; extra keyframes made motion stiffer (research note 2026-10-07-storyboard-density-test).

## Changes

- 2026-10-07: First version, from Order Now. Stage 02 moved from "pick one of three model outputs per item" to one
  proposal reviewed as a whole, after Claudio asked what we were actually asking him to decide.
