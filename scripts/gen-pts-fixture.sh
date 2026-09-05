#!/usr/bin/env bash
# Writes tests/fixtures/<name>.pts.json: the per-frame presentation timestamps
# (seconds, decoder output order) of a video as ffprobe reports them. These are
# the ground truth the sample-table parser is tested against (D35).
#
# Usage: scripts/gen-pts-fixture.sh <video.mp4> [<video.mp4> ...]
# Requires ffprobe on PATH. Sample videos live in the upstream take-home repo
# (../rse-takehome-2026/data/barnes-maze/); only the timestamps are committed.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$REPO_ROOT/tests/fixtures"
mkdir -p "$OUT_DIR"

if [[ $# -eq 0 ]]; then
  echo "usage: $0 <video.mp4> [...]" >&2
  exit 1
fi

for video in "$@"; do
  name="$(basename "${video%.*}")"
  out="$OUT_DIR/$name.pts.json"
  # ffprobe prints one pts_time per line; the first line may carry a trailing
  # comma (side-data column) and an empty line may follow it.
  ffprobe -v error -select_streams v:0 -show_entries frame=pts_time -of csv=p=0 "$video" \
    | sed -e 's/,.*$//' -e '/^[[:space:]]*$/d' \
    | awk 'BEGIN { printf "[" } NR > 1 { printf "," } { printf "%s", $1 } END { print "]" }' \
    > "$out"
  frames="$(tr ',' '\n' < "$out" | wc -l | tr -d ' ')"
  echo "wrote $out ($frames frames, $(wc -c < "$out" | tr -d ' ') bytes)"
done
