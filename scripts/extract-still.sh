#!/usr/bin/env bash
# Extracts one still from a sample video for the bundled example cohort (D33).
#
# The example cohort renders every result with no video attached, so each video
# needs one frame to draw the figures over. A still is a derived image, not the
# recording: the sample-data repository ships stills of its own, and no sample
# video is ever committed here.
#
#   scripts/extract-still.sh <video> <out.jpg> [frame]
#
# Frame 0 is right for test50 and test53 — the platform is empty for their first
# 150 frames, which is exactly what a backdrop wants. test51 starts under a
# start cylinder that is lifted between frames 74 and 76 (docs/known-limitations.md),
# so it needs a later frame with neither the cylinder nor the hand in shot.
set -euo pipefail

if [[ $# -lt 2 || $# -gt 3 ]]; then
  echo "usage: scripts/extract-still.sh <video> <out.jpg> [frame]" >&2
  exit 64
fi

VIDEO="$1"
OUT="$2"
FRAME="${3:-0}"

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "extract-still: ffmpeg is not on PATH." >&2
  exit 69
fi

if [[ ! -f "$VIDEO" ]]; then
  echo "extract-still: no such video '$VIDEO'." >&2
  exit 66
fi

mkdir -p "$(dirname "$OUT")"

# `select` counts decoded frames, so this is frame-accurate rather than a seek
# to the nearest keyframe. -q:v 4 is JPEG quality ≈ 80.
ffmpeg -hide_banner -loglevel error -y \
  -i "$VIDEO" \
  -vf "select=eq(n\,${FRAME}),scale=640:480" \
  -fps_mode passthrough -frames:v 1 -q:v 4 \
  "$OUT"

BYTES="$(wc -c <"$OUT" | tr -d ' ')"
echo "extract-still: $(basename "$VIDEO") frame ${FRAME} -> ${OUT} (${BYTES} bytes)"

# The budget the chunk works to; a still that blows it would bloat the build.
if [[ "$BYTES" -gt 61440 ]]; then
  echo "extract-still: ${OUT} is ${BYTES} bytes, over the 60 KB budget." >&2
  exit 1
fi
