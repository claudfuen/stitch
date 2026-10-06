@AGENTS.md

# Stitch

Local production board for AI video. `data/project.json` is the single source of truth (types in `lib/model.ts`).
Read README.md for the architecture.

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
- Build cuts with `bun run stitch build --version vN`. Audit every cut frame by frame (the av-review card) before
  calling it better than the last one.
- Never commit licensed files: Apple impulse responses, the Lausanne font, or anything under `work/`.
- Stack: Next.js + React Flow, shadcn/ui on the Base UI preset (no `asChild`, use the `render` prop; menu items
  use `onClick`).
- Style: no em dashes or double hyphens in prose.
