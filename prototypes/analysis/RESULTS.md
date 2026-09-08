# Analysis engine — smoke run on the sample videos

What `derive()` (`src/analysis/derive.ts`) makes of the tracker's real output for the three sample
videos, with the shipped defaults and the maze as fitted in Chrome in chunk 3. There is no ground
truth for these clips: this is a sanity check against the contact sheets in `prototypes/tracker/`,
not acceptance. First measured on 2026-09-06 (chunk 5); re-run on 2026-09-07 (chunk 6) after O4 was
revised and O7 settled; **re-run again on 2026-09-07 (chunk 10a) after the O-review closed the open
decisions.** MacBook Pro (Apple M1 Pro, 32 GB, macOS 15.5), Node v26.

## What changed in this run, and what moved

Four defaults changed (`docs/decisions.md` D58–D61):

| decision | change | effect on these clips |
| --- | --- | --- |
| **D58** search strategy | Gawel et al. 2019, Table 1: errors ≤ 2, error holes ≤ 1 from the target, 0 centre crossings, serial run ≥ 2 and not counting the target or the holes beside it | **test50 spatial → random**; test51 and test53 stay serial (their runs are 13→12→11 and 4→3→2, none adjacent to target 7) |
| **D59** an entry to the end of the clip needs no minimum duration | `longEnough` is `toEnd \|\| duration ≥ 1.0 s` | **test51's 0.93 s run at hole 19 is now entry-shaped.** Under the recorded map (target 7) that makes its last investigation *physically unlikely — review*; under the signature check (target 19) it is a **persistent escape entry, `escaped` true, total latency 44.04 s** — the first sample clip in which this tool detects an escape |
| **D60** gap filling off | `gapFilling.enabled` false | nothing: all three clips already had 0 filled frames |
| **D61** path efficiency | Illouz et al. 2020, Fig. 1C: first→last positioned frame of the trial window ÷ smoothed path over that window | reported values move (0.02 / 0.30 / 0.16); a reported feature, not a rule input, so no classification changes |

Error counts did not move: 2 · 45, 13 · 13, 8 · 8 as before. Latencies, paths, speeds, quadrant
times, tiers and nose fractions are unchanged.

One line differs from the chunk-6 record for a reason that is not a default: every video now shows
a `stale_auto_layer` review flag. That is the harness, not the analysis — `sample-derive.test.ts`
loads the tracker's JSON under the placeholder `auto.parametersHash` `'tracker-run'`, which by
construction never equals the hash of `parameters.tracking`, and D56 says such a layer is flagged.
It is listed below rather than hidden, and it is why every trial reads `review`.

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
O4 1.0 × / 1.0 s / 3 s with D59; O5 180 s; O16 0.5; O17 150 cm/s; gap filling **off**, 0.1 s;
strategy 2 / 1 / 0 / 2 / 0.5; D30 0.9 / 0.7). No corrections. That map is the record; the two
"signature check" runs at the end move the target to the hole the animal ends at and are test-only.

In the tables, "tracked fraction (trial)" is `TrialMetrics.trackedFraction` — frames with
`detectionState: 'tracked'` only — and "positioned" is `QualityReport.positionedFraction`, the
frames the tracker positioned (tracked or low confidence) over the trial window, which is what the
tier is judged on (D54); the whole-clip twin follows it.

## Timing

| track                                       | frames | events | derive, median of 5 |
| ------------------------------------------- | -----: | -----: | ------------------: |
| synthetic (`tests/analysis/derive.test.ts`) |  5,539 |    191 |            ≈ 6 ms |
| test50 (real tracker output)                |  5,539 |     53 |              5.3 ms |
| test51                                      |    741 |     13 |              0.8 ms |
| test53                                      |    905 |      8 |              0.9 ms |

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
| strategy (source) · runner-up | **random** (auto) · spatial |
| path raw · smoothed · mean speed | 1245.60 cm · 1213.71 cm · 6.74 cm/s |
| target-quadrant time (fraction) | 90.03 s (0.50) |
| tracked fraction (trial) · positioned (trial · whole clip) · tier | 0.76 · 1.00 · 0.97 · GOOD |
| events judged on the nose | 0.79 |
| events: investigations · escape entries · tracking failures | 53 · 0 · 0 |
| holes visited before the first target visit | 5→5→7 |
| path efficiency · tortuosity | 0.02 · 23.81 rad |
| filled frames · outliers · unfilled gaps | 0 · 0 · 1 (the empty start, unbounded) |
| quality gaps in the trial · longest | 0 · 0.00 s |
| timebase: duplicates · drops · drift | 201 · 214 · 0.433 s (drift from the MP4 index) |
| review flags | `stale_auto_layer` (the harness's placeholder tracking hash, above) |

After the first target visit at 12.7 s the animal walks the ring hole by hole, never disappears
into a hole, and the trial runs to the cutoff. Twelve partial-detection runs of half a second or
more occur; only one sits within the entry radius of a hole (frames 1100–1129 at hole 12, centroid
0.6 cm from its centre) and it is exactly at the 1.0 s minimum without reaching the end of the clip,
so no run is entry-shaped and nothing is flagged.

**The classification moved from spatial to random.** The search phase is 5→5→7: two errors, both at
hole 5, which is *two* holes from target 7. Gawel's spatial definition allows errors only at holes
adjacent to the target, so the second condition now fails — `every error hole within 2 holes of the
target (at most 1) — no` — while the error count (2 ≤ 2) and the centre crossings (0 ≤ 0) still
hold. Spatial is the runner-up. Under the previous placeholder (± 2 holes) it fired. Nothing about
the trial changed; the definition did.

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
| path raw · smoothed · mean speed | 193.03 cm · 182.24 cm · 4.11 cm/s |
| target-quadrant time (fraction) | 0.00 s (0.00) |
| tracked fraction (trial) · positioned (trial · whole clip) · tier | 0.86 · 1.00 · 0.90 · GOOD |
| events judged on the nose | 0.69 |
| events: investigations · escape entries · tracking failures | 13 · 0 · 0 |
| holes visited | 12→13→12→12→12→12→12→11→18→19→19→19→19 |
| path efficiency · tortuosity | 0.30 · 50.78 rad |
| filled frames · outliers · unfilled gaps | 0 · 0 · 1 (the cylinder frames, unbounded) |
| quality gaps in the trial · longest | 0 · 0.00 s |
| timebase: duplicates · drops · drift | 24 · 23 · −0.067 s (drift from the MP4 index) |
| review flags | **`physically_unlikely_entry` @ frame 684** (new under D59); `stale_auto_layer` |

**D59 changes this clip.** The head-in-hole run at hole 19 is frames 726–740: 15 frames at
14.985 fps, 0.93 s first-to-last, still under `escapeEntry.minDuration_s` = 1.0 s — but it reaches
the last frame of the video, so it is entry-shaped whatever its duration. Hole 19 is not the target
under the recorded map, so the last investigation (frames 684–740) is now flagged *physically
unlikely — review* exactly as test53's is. The run's partial blobs sit 1.8 cm from the hole centre,
inside the 2.5 cm entry radius; it was the duration convention alone that excluded it before, and
D59 is what removed that exclusion.

The serial run is 13→12→11, and under D58 none of those holes is adjacent to target 7, so all three
count.

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
| path raw · smoothed · mean speed | 110.06 cm · 104.59 cm · 4.15 cm/s |
| target-quadrant time (fraction) | 0.00 s (0.00) |
| tracked fraction (trial) · positioned (trial · whole clip) · tier | 0.78 · 1.00 · 0.83 · GOOD |
| events judged on the nose | 0.88 |
| events: investigations · escape entries · tracking failures | 8 · 0 · 0 |
| holes visited | 1→2→2→2→4→4→3→2 |
| path efficiency · tortuosity | 0.16 · 32.88 rad |
| filled frames · outliers · unfilled gaps | 0 · 0 · 1 (the empty start, unbounded) |
| quality gaps in the trial · longest | 0 · 0.00 s |
| timebase: duplicates · drops · drift | 32 · 34 · 0.067 s (drift from the MP4 index) |
| review flags | `physically_unlikely_entry` @ frame 736; `stale_auto_layer` |

Unchanged from the chunk-6 run: the last investigation (hole 2, frames 736–904) contains an
entry-shaped run — 72 partial frames 833–904, 2.37 s to the end of the video, within 2.5 cm of
hole 2 — and hole 2 is not the target under the recorded map, so the investigation is flagged
"physically unlikely — review". The serial run is 4→3→2.

## Signature checks (test-only: the target moved to the hole the animal ends at)

| clip | target moved to | outcome |
| --- | --- | --- |
| test51 | hole 19 | **persistent escape entry** frames 735–740 (0.27 s, to the end of the video); trial ends at frame 735 (49.05 s), `escaped` true, total latency 44.04 s; no review flag beyond the harness's `stale_auto_layer` |
| test53 | hole 2 | **persistent escape entry** frames 833–904 (2.37 s, to the end of the video); trial ends at frame 833 (27.83 s), `escaped` true, total latency 22.83 s |

Both clips now produce an escape when the map names the hole the animal actually entered. test51 is
the one D59 changed: at the chunk-6 defaults its run was 0.93 s and the rule honestly did not fire,
and Alex declined to widen the radius or the duration convention to force it. D59 does not widen
either — it says that a run continuing to the last frame of the clip cannot be a head-poke, because
protocol keeps the animal in the box until the trial is ended and no later frame could contradict
the reading.

Note that test51's entry is the *last six* frames (735–740), not the whole 726–740 partial run: the
run's earlier frames are partial detections at hole 19, and the entry starts where the run does
under the `escapeEntry.radiusFactor` test. Total latency 44.04 s is the timestamp of that first
frame.

## Observations

- **Duplicate-stamp counts exceed the index's exact ties** (201 / 24 / 32 against 162 / 17 / 25):
  the O11 rule (Δt < 0.25 × nominal) also catches pairs one timescale tick apart (65–67 µs), which
  are skipped for speed exactly like exact ties.
- **Quality is judged on the trial window** (D54), so the empty starts (150 frames in test50 and
  test53, the 75 cylinder frames in test51) show up only as the gap between the trial-window
  positioned fraction (1.00 in all three) and the whole-clip fraction (0.97 / 0.90 / 0.83); inside
  the trials the tracker never lost the animal.
- **Between 69 % and 88 % of events are judged on the nose** (O16 at 0.5): the tail-only cue
  clears the cutoff on most investigation frames. The remaining 12–31 % are judged on the centroid
  and so are not head events by Gawel's definition — recorded in `docs/known-limitations.md`.
- **No `oversized_blob` frame exists in any clip**, so the O5 clause "after the last oversized
  frame" was exercised only by the synthetic tests.
- **Gap filling being off costs nothing here**: all three clips have zero fillable gaps inside the
  trial window, so D60 changes no number on this data. It is a change of default, not of result.
