@AGENTS.md

# Stitch

Local node board for planning AI video. `data/graph.json` is the source of truth and the viewer polls it, so edit
that file to change the board. See README.md for the node types, the `story` shape and `scripts/add-gen.py`.

- Stack: Next.js + React Flow, shadcn/ui on the Base UI preset (no `asChild`, use the `render` prop; menu items
  use `onClick`). Add components with `bunx --bun shadcn@latest add <name>`.
- Never write secrets, presigned URLs or API keys into `data/graph.json` or any tracked file.
- Style: no em dashes or double hyphens in prose.
