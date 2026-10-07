#!/usr/bin/env bash
# Link every Assistant skill into .claude/skills so a session started in Stitch has the same skills as one started
# in ~/Repos/assistant. Links are relative (both machines keep repos in ~/Repos) and gitignored. Idempotent;
# runs from the SessionStart hook, so skills added to Assistant appear here on the next session.
set -euo pipefail
cd "$(dirname "$0")/.."
src=../assistant/.claude/skills
[ -d "$src" ] || exit 0
mkdir -p .claude/skills
for dir in "$src"/*/; do
  name=$(basename "$dir")
  [ "$name" = _partials ] && continue
  [ -f "$dir/SKILL.md" ] || continue
  link=.claude/skills/$name
  if [ -e "$link" ] && [ ! -L "$link" ]; then continue; fi   # a Stitch-owned skill of the same name wins
  ln -sfn "../../$src/$name" "$link"
done
# Remove links to skills Assistant no longer has.
for link in .claude/skills/*; do
  if [ -L "$link" ] && [ ! -e "$link" ]; then rm "$link"; fi
done
