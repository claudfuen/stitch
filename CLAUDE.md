@AGENTS.md

# Stitch

Local production board for AI video. `data/project.json` is the single source of truth (types in `lib/model.ts`).
Read README.md for the architecture.

## Assistant is the operating system

A session started here has the same skills as one started in `~/Repos/assistant`: `scripts/link-assistant.sh` (run
by the SessionStart hook) links every Assistant skill into `.claude/skills`. Those links are never committed.

- Paths inside Assistant skills (`tooling/...`, `domains/...`, `skills/...`, `data/...`) are relative to
  `~/Repos/assistant`. Run them from there (`cd ~/Repos/assistant && ...`), not from this repo.
- Before choosing a provider or model, run `assistant capabilities "<task>"` and `assistant services`; run
  `assistant doctor --service <id>` before calling a provider unavailable. Media goes through Leap first
  (`assistant doctor --service provider.leap`).
- `~/Repos/assistant/AGENTS.md` is the policy for anything beyond this repo's code: approval before anything external,
  research notes in `~/Repos/assistant/domains/research/` (the `research` skill), and `todo` read-only.
- The skills most used here: `leap`, `av-review`, `generate-image`, `use-ai-gateway`, `use-fx`, `research`,
  `publish-cloud-artifact`.

## Rules

- Change the project only through ops: `bun run stitch ...` or `POST /api/project { ops }`. Never edit
  `data/project.json` by hand and never write a second copy of any fact; derive it in `lib/derive.ts`.
- New UI interactions get an op in `lib/ops.ts` in the same change, so agents can do what the UI does.
- Every view renders from `lib/derive.ts` and the shared pieces in `components/studio/media.tsx`. Do not re-derive
  verdicts, tones or timings inside a component.
- Register every generated file with `stitch asset add` (with `--model` and `--inputs` for provenance), attach it
  as a take, and pick takes with `stitch take circle`. Log what you are doing with `stitch log` so the activity feed
  shows progress.
- A shot is not done until its checklist passes. Checks are judgments with evidence in the note. Do not mark a
  check from a metric alone, and do not grade your own take as approved: status `approved` is Claudio's call.
- Make scenes in the playbook order in README.md: floor plan, grey box, hero plate, set plates, keyframes, voices,
  video, cut. Never prompt a shot from scratch, and never put a second camera on the far side of a 180-degree line.
- Every camera is a setup on its location's plan, and every shot names its setup. Plan edits go through the plan ops.
- Route generation through Leap first (`bun run leap`); Henrick's real likeness goes to video through Higgsfield.
- Show Claudio a contact sheet (`scripts/sheet.py`) for every round, with the critique on the board as take notes.
- Build cuts with `bun run stitch build --version vN`. Audit every cut frame by frame (the av-review card) before
  calling it better than the last one.
- Never commit licensed files: Apple impulse responses, the Lausanne font, or anything under `work/`.
- Stack: Next.js + React Flow, shadcn/ui on the Base UI preset (no `asChild`, use the `render` prop; menu items
  use `onClick`).
- Style: no em dashes or double hyphens in prose.
