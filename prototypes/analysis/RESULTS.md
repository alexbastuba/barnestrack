# Analysis engine — smoke run on the sample videos

What `derive()` (`src/analysis/derive.ts`) makes of the tracker's real output for the three sample
videos, with the O1–O17 defaults and the maze as fitted in Chrome in chunk 3. There is no ground
truth for these clips: this is a sanity check against the contact sheets in `prototypes/tracker/`,
not acceptance. First measured on 2026-09-06 (chunk 5); re-run on 2026-09-07 (chunk 6) after O4
was revised (an entry may be a run of partial detections), O7 was settled (monotone runs, direct
approach is spatial) and D54 added the positioned fractions and the nose-judged share. MacBook Pro
(Apple M1 Pro, 32 GB, macOS 15.5), Node v26.

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
208.5 px, ring ratio 0.89, hole radius 11.3 px, ring angle 356.82°, **target hole 7**, 92 cm;
identity transform for test50 and test53, and for test51 the similarity that takes that circle onto
(280.0, 239.9) px, radius 222.5 px. Parameters: `DEFAULT_PARAMETERS` (O1 1.5 × / 0.2 s / 0.5 s;
O4 1.0 × / 1.0 s / 3 s; O5 180 s; O16 0.5; O17 150 cm/s; O10 on, 0.1 s; O7 3 / 2 / 1 / 3 / 0.5;
D30 0.9 / 0.7). No corrections. That map is the record; the two "signature check" runs at the end
move the target to the hole the animal ends at and are test-only.

In the tables, "tracked fraction (trial)" is `TrialMetrics.trackedFraction` — frames with
`detectionState: 'tracked'` only — and "positioned" is `QualityReport.positionedFraction`, the
frames the tracker positioned (tracked or low confidence) over the trial window, which is what the
tier is judged on (D54); the whole-clip twin follows it.

## Timing

| track                                       | frames | events | derive, median of 5 |
| ------------------------------------------- | -----: | -----: | ------------------: |
| synthetic (`tests/analysis/derive.test.ts`) |  5,539 |    191 |           ≈ 6 ms |
| test50 (real tracker output)                |  5,539 |     53 |              5.3 ms |
| test51                                      |    741 |     13 |              0.9 ms |
| test53                                      |    905 |      8 |              1.0 ms |

The acceptance figure is < 50 ms for 5,539 frames; the 5,539-frame track derives in about 5 ms.

## Per video (recorded map, target hole 7)

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
| tracked fraction (trial) · positioned (trial · whole clip) · tier | 0.76 · 1.00 · 0.97 · GOOD |
| events judged on the nose | 0.79 |
| events: investigations · escape entries · tracking failures | 53 · 0 · 0 |
| holes visited before the first target visit | 5→5→7 |
| filled frames · outliers · unfilled gaps | 0 · 0 · 1 (the empty start, unbounded) |
| quality gaps in the trial · longest | 0 · 0.00 s |
| timebase: duplicates · drops · drift | 201 · 214 · 0.433 s (drift from the MP4 index) |
| review flags | none |

Unchanged from chunk 5: after the first target visit at 12.7 s the animal walks the ring hole by
hole, never disappears into a hole, and the trial runs to the cutoff. Twelve partial-detection runs
of half a second or more occur, but only one sits within the entry radius of a hole (frames
1100–1129 at hole 12, centroid 0.6 cm from its centre) and it is a hair under the 1.0 s minimum, so
no run is entry-shaped and nothing is flagged. The classification is *spatial* because the O7 rules
look at the search phase before the first target visit (two errors at hole 5, next to the target);
the serial walk that follows is outside that window by O7's settled scope.

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
| tracked fraction (trial) · positioned (trial · whole clip) · tier | 0.86 · 1.00 · 0.90 · GOOD |
| events judged on the nose | 0.69 |
| events: investigations · escape entries · tracking failures | 13 · 0 · 0 |
| holes visited | 12→13→12→12→12→12→12→11→18→19→19→19→19 |
| filled frames · outliers · unfilled gaps | 0 · 0 · 1 (the cylinder frames, unbounded) |
| quality gaps in the trial · longest | 0 · 0.00 s |
| timebase: duplicates · drops · drift | 24 · 23 · −0.067 s (drift from the MP4 index) |
| review flags | none |

**test51 does not end in `escape_entry`.** The head-in-hole run at hole 19 is frames 726–740:
15 frames at 14.985 fps, **0.93 s first-to-last**, under `escapeEntry.minDuration_s` = 1.0 s, so
under the recorded map (target 7) it is the tail of the last investigation at hole 19 and, with the
target moved to hole 19 (signature check below), it is still an investigation and not an entry.
The partial blobs themselves are within the entry radius (centroid 1.8 cm from the hole centre,
radius 2.5 cm): the duration convention, not the radius, decides it. Per Alex (2026-09-06) the
convention stays first-to-last and O4 is not widened to fit this clip. The serial run is now
13→12→11 (the 12→13→12→11 walk read as four under the old direction-agnostic rule).

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
| tracked fraction (trial) · positioned (trial · whole clip) · tier | 0.78 · 1.00 · 0.83 · GOOD |
| events judged on the nose | 0.88 |
| events: investigations · escape entries · tracking failures | 8 · 0 · 0 |
| holes visited | 1→2→2→2→4→4→3→2 |
| filled frames · outliers · unfilled gaps | 0 · 0 · 1 (the empty start, unbounded) |
| quality gaps in the trial · longest | 0 · 0.00 s |
| timebase: duplicates · drops · drift | 32 · 34 · 0.067 s (drift from the MP4 index) |
| review flags | `physically_unlikely_entry` @ frame 736 |

New under the revised O4: the last investigation (hole 2, frames 736–904) contains an entry-shaped
run — 72 partial frames 833–904, 2.37 s to the end of the video, within 2.5 cm of hole 2 — and
hole 2 is not the target under the recorded map, so the investigation is flagged "physically
unlikely — review". That is the rule doing what it says; whether a long head-in-hole dwell at a
non-target hole should count as entry-shaped is recorded in `docs/known-limitations.md`.

## Signature checks (test-only: the target moved to the hole the animal ends at)

| clip | target moved to | outcome |
| --- | --- | --- |
| test51 | hole 19 | **no entry**: the 726–740 run is 0.93 s < 1.0 s; trial ends at the end of the video, `escaped` false |
| test53 | hole 2 | **persistent escape entry** frames 833–904 (2.37 s, to the end of the video); trial ends at frame 833 (27.83 s), `escaped` true, total latency 22.83 s; no review flag |

So the revised rule fires on a real head-in-hole run when the run clears the minimum duration
(test53), and honestly does not when it falls short (test51). Both clips' partial runs sit well
inside the entry radius (1.4 cm and 1.8 cm from the hole centre).

## Observations

- **Duplicate-stamp counts exceed the index's exact ties** (201 / 24 / 32 against 162 / 17 / 25):
  the O11 rule (Δt < 0.25 × nominal) also catches pairs one timescale tick apart (65–67 µs), which
  are skipped for speed exactly like exact ties.
- **Quality is judged on the trial window** (D54), so the empty starts (150 frames in test50 and
  test53, the 75 cylinder frames in test51) show up only as the gap between the trial-window
  positioned fraction (1.00 in all three) and the whole-clip fraction (0.97 / 0.90 / 0.83); inside
  the trials the tracker never lost the animal.
- **Between 69 % and 88 % of events are judged on the nose** (O16 at 0.5): the tail-only cue
  clears the cutoff on most investigation frames.
- **No `oversized_blob` frame exists in any clip**, so the O5 clause "after the last oversized
  frame" was exercised only by the synthetic tests.
