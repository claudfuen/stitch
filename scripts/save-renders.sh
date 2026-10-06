#!/bin/sh
# Mirror every render into ~/Downloads/ministry-renders (Claudio wants every intermediate kept where he can browse it):
#   board/    public/generated: every registered plate, keyframe, take and cut
#   work/     work/: every intermediate the board does not register (grey boxes, candidates, cards, logs)
#   sessions/ scratch folders passed as arguments: sessions/<name>/ for each <name>=<dir>
# Re-runnable: copies what is new or changed, never deletes.
#   sh scripts/save-renders.sh [name=/path/to/scratch ...]
set -e
DEST="$HOME/Downloads/ministry-renders"
mkdir -p "$DEST/board" "$DEST/work" "$DEST/sessions"
cd "$(dirname "$0")/.."
rsync -a public/generated/ "$DEST/board/"
rsync -a work/ "$DEST/work/"
for pair in "$@"; do
  name="${pair%%=*}"; dir="${pair#*=}"
  mkdir -p "$DEST/sessions/$name"
  rsync -a "$dir/" "$DEST/sessions/$name/"
done
du -sh "$DEST"
