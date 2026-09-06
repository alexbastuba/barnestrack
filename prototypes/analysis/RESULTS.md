# Analysis engine — smoke run on the sample videos (chunk 5)

What `derive()` (`src/analysis/derive.ts`) makes of the tracker's real output for the three sample
videos, with the O1–O17 defaults and the maze as fitted in Chrome in chunk 3. There is no ground
truth for these clips: this is a sanity check against the contact sheets in `prototypes/tracker/`,
not acceptance. Measured on 2026-09-06 on a MacBook Pro (Apple M1 Pro, 32 GB, macOS 15.5), Node
v26.8.1.

Reproduce (the tracker outputs are gitignored; the first three commands are the ones recorded in
`prototypes/tracker/RESULTS.md`):

```
npx tsx scripts/track-node.ts ../rse-takehome-2026/data/barnes-maze/test51.mp4 --platform-diameter-cm 92 \
  --platform 280.7,242.7,221.1 --extra 0-2:3 --extra -15-end:3
npx tsx scripts/track-node.ts ../rse-takehome-2026/data/barnes-maze/test53.mp4 --platform-diameter-cm 92 \
  --platform 324.6,240.5,208.2 --extra 0-2.5:3
npx tsx scripts/track-node.ts ../rse-takehome-2026/data/barnes-maze/test50.mp4 --platform-diameter-cm 92 \
  --platform 324.6,240.8,208.2
BARNESTRACK_SAMPLE_DIR=../rse-takehome-2026/data/barnes-maze npx vitest run tests/analysis/sample-derive.test.ts --reporter=verbose
```

Maze (chunk-3 handoff, `tests/analysis/sample-derive.test.ts`): platform (327.8, 239.7) px, radius
208.5 px, ring ratio 0.89, hole radius 11.3 px, ring angle 356.82°, target hole 7, 92 cm; identity
transform for test50 and test53, and for test51 the similarity that takes that circle onto
(280.0, 239.9) px, radius 222.5 px. Parameters: `DEFAULT_PARAMETERS` (O1 1.5 × / 0.2 s / 0.5 s;
O4 1.0 × / 1.0 s / 3 s; O5 180 s; O16 0.5; O17 150 cm/s; O10 on, 0.1 s). No corrections.

## Timing

| track                                   | frames | events | derive, median of 5 |
| --------------------------------------- | -----: | -----: | ------------------: |
| synthetic (`tests/analysis/derive.test.ts`) | 5,539 |   191 |             6.0 ms |
| test50 (real tracker output)            |  5,539 |     53 |             6.1 ms |
| test51                                  |    741 |     13 |             0.8 ms |
| test53                                  |    905 |      8 |             0.9 ms |

The acceptance figure is < 50 ms for 5,539 frames; both 5,539-frame tracks derive in about 6 ms.

## Per video

### test50 (3 min; the contact sheet shows the animal circling the rim)

| field | value |
| --- | --- |
| frames · px/cm | 5539 · 4.533 |
| trial start | frame 150 (5.00 s, auto; no oversized frame in the clip) |
| trial end | frame 5537 (185.00 s), cutoff (180 s after the start) |
| primary latency · total latency | 12.67 s · — |
| primary errors · total errors | 2 · 45 |
| escaped · status | false · review |
| strategy (source) · runner-up | spatial (auto) · random |
| path raw · smoothed · mean speed | 1245.6 cm · 1213.7 cm · 6.74 cm/s |
| target-quadrant time (fraction) | 90.03 s (0.50) |
| tracked fraction (trial) · tier | 0.76 · GOOD |
| events: investigations · escape entries · tracking failures | 53 · 0 · 0 |
| holes visited before the first target visit | 5→5→7 |
| filled frames · outliers · unfilled gaps | 0 · 0 · 1 (the empty start, unbounded) |
| quality gaps in the trial · longest | 0 · 0.00 s |
| timebase: duplicates · drops · drift | 201 · 214 · 0.433 s (drift from the MP4 index) |
| review flags | none |

Matches the sheet: after the first target visit at 12.7 s the animal walks the ring hole by hole
(7→8→9→11→12→6→7→8→9→10→11→12→14→16→17→18→0→1→2→4→5→6→7…, 53 investigations, 45 non-target),
never disappears into a hole, and the trial runs to the cutoff. The classification is *spatial*
because the O7 rules look only at the search phase before the first target visit (two errors at
hole 5, next to the target); the serial walk that follows is outside the rules' window — an O7
question for Alex, recorded in the chunk report.

### test51 (start cylinder; the sheet shows the animal ending at the top-right hole)

| field | value |
| --- | --- |
| frames · px/cm | 741 · 4.837 |
| trial start | frame 75 (5.00 s, auto) — the first frame after the cylinder is lifted (74–76) |
| trial end | frame 740 (49.32 s), end of video (before the cutoff) |
| primary latency · total latency | — · — |
| primary errors · total errors | 13 · 13 |
| escaped · status | false · review |
| strategy (source) · runner-up | serial (auto) · random |
| path raw · smoothed · mean speed | 193.0 cm · 182.2 cm · 4.11 cm/s |
| target-quadrant time (fraction) | 0.00 s (0.00) |
| tracked fraction (trial) · tier | 0.86 · GOOD |
| events: investigations · escape entries · tracking failures | 13 · 0 · 0 |
| holes visited | 12→13→12→12→12→12→12→11→18→19→19→19→19 |
| filled frames · outliers · unfilled gaps | 0 · 0 · 1 (the cylinder frames, unbounded) |
| quality gaps in the trial · longest | 0 · 0.00 s |
| timebase: duplicates · drops · drift | 24 · 23 · −0.067 s (drift from the MP4 index) |
| review flags | none |

Matches the sheet: the last four investigations are at hole 19 — at 338.8° from the platform
centre, i.e. right and above centre, the top-right hole — and the final one (45.6–49.3 s) covers the
head-in-hole frames 726–740. No entry is detected because the rear stays visible (`small_blob`
keeps a positioned centroid), which is what O4 predicts for this pose; see
`docs/known-limitations.md`. The five separate events at hole 12 are returns 0.53–2.94 s apart;
the 0.53 s one sits just over the 0.5 s merge gap.

### test53 (empty start; the sheet shows the animal ending with its head in a hole on the right)

| field | value |
| --- | --- |
| frames · px/cm | 905 · 4.533 |
| trial start | frame 150 (5.00 s, auto) — the frame the animal appears at the right rim |
| trial end | frame 904 (30.20 s), end of video |
| primary latency · total latency | — · — |
| primary errors · total errors | 8 · 8 |
| escaped · status | false · review |
| strategy (source) · runner-up | serial (auto) · random |
| path raw · smoothed · mean speed | 110.1 cm · 104.6 cm · 4.15 cm/s |
| target-quadrant time (fraction) | 0.00 s (0.00) |
| tracked fraction (trial) · tier | 0.78 · GOOD |
| events: investigations · escape entries · tracking failures | 8 · 0 · 0 |
| holes visited | 1→2→2→2→4→4→3→2 |
| filled frames · outliers · unfilled gaps | 0 · 0 · 1 (the empty start, unbounded) |
| quality gaps in the trial · longest | 0 · 0.00 s |
| timebase: duplicates · drops · drift | 32 · 34 · 0.067 s (drift from the MP4 index) |
| review flags | none |

Matches the sheet: the trial starts at frame 150 and the last investigation (hole 2, at 32.8°,
about four o'clock on the right — the tracker results called it "3 o'clock" by eye) covers the
head-in-hole frames 816–904, whose centroid sits 1.4–1.5 cm from hole 2's centre. The holes are
visited in short adjacent runs (4→3→2), which the O7 placeholder reads as serial.

## Observations

- **No escape-box entry in any clip, by construction of O4.** An entry is a *loss of detection*
  within 1.0 × hole radius of the target. In these recordings the animal's rear stays visible with
  its head in a hole, so the centroid never disappears; and a rear-only centroid sits about a body
  length from the hole centre, outside 1.0 × radius. Every trial is therefore `review` under O5
  ("never entered"). This is the first thing a user will see on these clips; the radius is O4's
  default and was not widened here.
- **Duplicate-stamp counts exceed the index's exact ties** (201 / 24 / 32 against 162 / 17 / 25):
  the O11 rule (Δt < 0.25 × nominal) also catches pairs one timescale tick apart (65–67 µs), which
  are skipped for speed exactly like exact ties.
- **Quality is judged on the trial window**, so the empty starts (150 frames in test50 and test53,
  the 75 cylinder frames in test51) appear as one unbounded, unfilled gap in the cleaning report
  and not in the quality report's gap list; inside the trials the tracker never lost the animal.
- **No `oversized_blob` frame exists in any clip**, so the O5 clause "after the last oversized
  frame" was exercised only by the synthetic tests.
