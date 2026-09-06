# Tracker v0 — measured results (chunk 2)

How the D6 tracker module (`src/analysis/tracker/`) behaves on the three sample videos when driven
from Node by `scripts/track-node.ts` (ffmpeg → gray frames → the same module the browser worker
will use). Measured on 2026-09-06 on a **MacBook Pro, Apple M1 Pro, 32 GB, macOS 15.5**, Node
v26.8.1, ffmpeg 6.0. The sample videos live in the public sample-data repository
(`../rse-takehome-2026/data/barnes-maze/`); nothing from them is committed here except the evidence
images in this folder (backgrounds, contact sheets, zoom sheets, moving-frame sheets).

Reproduce (the platform circles are the estimator's proposals, checked by eye on
`out/<video>.estimate.png`):

```
npx tsx scripts/track-node.ts ../rse-takehome-2026/data/barnes-maze/test51.mp4 --platform-diameter-cm 92 \
  --platform 280.7,242.7,221.1 --extra 0-2:3 --extra -15-end:3
npx tsx scripts/track-node.ts ../rse-takehome-2026/data/barnes-maze/test53.mp4 --platform-diameter-cm 92 \
  --platform 324.6,240.5,208.2 --extra 0-2.5:3
npx tsx scripts/track-node.ts ../rse-takehome-2026/data/barnes-maze/test50.mp4 --platform-diameter-cm 92 \
  --platform 324.6,240.8,208.2
BARNESTRACK_SAMPLE_DIR=../rse-takehome-2026/data/barnes-maze npx vitest run tests/analysis/tracker/sample-videos.test.ts
```

Outputs go to `prototypes/tracker/out/` (gitignored): `<video>.track.json` (frames, per-frame axis
and nose cues, candidates, summary, timing), `<video>.background.png`, `<video>.estimate.png`,
`<video>.contact.png`, `<video>.zoom.png`, `<video>.moving.png`, and `<video>.stage-<n>.png` for
`--debug` frames. The committed copies here are the contact, zoom and moving sheets and the
backgrounds. All parameters were the defaults in `src/analysis/tracker/params.ts` (Otsu threshold,
1.5 cm mask margin, 4–80 cm² area range, expected area learned, opening radius 0.8 cm, moving speed
8 cm/s, fragment merge distance 8 cm); nothing was tuned per video. The fragment merge (D48) was added
after the first measurement; the before/after counts are at the end of this file.

## Summary per video

| video  | frames | tracked | low_confidence | ambiguous | not_detected | threshold (Otsu) | px/cm | expected body area (learned) | median tracked blob |
| ------ | -----: | ------: | -------------: | --------: | -----------: | ---------------: | ----: | ---------------------------: | ------------------: |
| test50 |   5539 | 4112 (74.2 %) | 1277 (23.1 %) | 0 (0.0 %) | 150 (2.7 %) | 51 | 4.526 | 564 px² = 27.5 cm² | 555 px² = 27.1 cm² |
| test51 |    741 |  576 (77.7 %) |  90 (12.1 %) |  75 (10.1 %) |   0 (0.0 %) | 48 | 4.807 | 537 px² = 23.2 cm² | 536 px² = 23.2 cm² |
| test53 |    905 |  590 (65.2 %) | 165 (18.2 %) |  0 (0.0 %)  | 150 (16.6 %) | 43 | 4.526 | 461 px² = 22.5 cm² | 471 px² = 23.0 cm² |

Reasons (`state / reason`):

| video  | single_blob | proximity_to_previous | no_foreground | multiple_blobs | oversized_blob | partial_at_rim | small_blob | fragmented |
| ------ | ----------: | --------------------: | ------------: | -------------: | -------------: | -------------: | ---------: | ---------: |
| test50 |        4112 |                     0 |           150 |              0 |              0 |            794 |          0 |        483 |
| test51 |         576 |                     0 |             0 |             75 |              0 |             61 |         15 |         14 |
| test53 |         590 |                     0 |           150 |              0 |              0 |              0 |         89 |         76 |

Longest `not_detected` run: test50 frames 0–149 (150 frames, 4.97 s, empty platform before the
animal is placed; no tracked point before it); test53 frames 0–149 (150 frames, 4.97 s, same); test51
none (the platform is never empty: the start cylinder is on it from frame 0). The remaining
`not_detected` count is zero in all three clips: every loss of the animal in these recordings is a
`small_blob` (head in a hole, rear still visible) or, in test51, the start cylinder, never an empty platform.

Where the states sit (runs of ≥ 3 frames): test51 `multiple_blobs` 0–74 (start cylinder);
`fragmented` 102–107, 382–387 (animal over the left rim); `partial_at_rim` 180–191, 262–274,
555–571, 664–682 (rim holes); `small_blob` 726–740 (head in the last hole). test53 `fragmented`
352–380, 584–630 (animal straddling a hole at the right and bottom rim); `small_blob` 816–904 (head
in the hole at 3 o'clock, rear outside). test50 `partial_at_rim` in 20 runs of 24–74 frames at rim
holes; `fragmented` in 40 runs of 3–49 frames, all with the animal over the left rim or straddling a
hole.

### Timing (Node, this Mac)

| video  | tracker compute only | including ffmpeg decode + pipe | sample pass | median (150 frames) | track pass | total |
| ------ | -------------------: | -----------------------------: | ----------: | ------------------: | ---------: | ----: |
| test50 |           2194 fps   |                      1755 fps  |      527 ms |              191 ms |    3156 ms | 4140 ms |
| test51 |           1482 fps   |                      1098 fps  |      114 ms |              202 ms |     675 ms | 1251 ms |
| test53 |           1767 fps   |                      1224 fps  |      133 ms |              205 ms |     739 ms | 1368 ms |

Vitest's informational check on 200 synthetic 640 × 480 frames reports 2646 fps (the
`tracker throughput` line printed by `npx vitest run tests/analysis/tracker/tracker.test.ts --reporter=verbose`). The ≥ 150 fps criterion holds with a ten-fold margin; the
browser pass will be bounded by decoding (≈ 400–900 fps software, chunk 1), not by the tracker.

### Platform estimate (`estimatePlatformCircle`, harness-only, untuned)

| video  | first pass (centroid + area radius) | refit on the outermost boundary pixel per angle bin | rim points kept | rms residual | circle used |
| ------ | ----------------------------------- | --------------------------------------------------- | --------------: | -----------: | ----------- |
| test50 | (323.6, 240.2) r 204.2 | (324.6, 240.8) r 208.2 | 720 / 720 | 0.32 px | the refit |
| test51 | (282.6, 241.2) r 217.7 | (280.7, 242.7) r 221.1 | 720 / 720 | 0.50 px | the refit |
| test53 | (323.4, 239.9) r 204.2 | (324.6, 240.5) r 208.2 | 720 / 720 | 0.33 px | the refit |

It worked untuned on all three (`out/<video>.estimate.png` shows the circle on the rim). The area
radius is ≈ 2 % low because the twenty holes are dark and subtracted from the bright area; the refit
corrects it. One design change was needed before any video-specific tuning: the first version took
every boundary pixel farther than 0.8 × r from the centre as a rim point, which includes the hole
rims (they lie at 0.83–0.95 r) and shrank the fit by 5 %; the committed version keeps the outermost
boundary pixel per angle bin, where hole rims never are. This is a candidate seed for the automatic
maze map (D42), not part of the product.

### Background contamination check

What it did: the median of 150 uniformly spaced frames is clean on all three clips (no animal, no
cylinder: `<video>.background.png`). Inside the mask it finds exactly the 20 holes in each clip
(median dark blob 15.4–16.2 cm²; largest 19.6–20.3 cm², 1.16–1.32 × the median, elongation
1.02–1.11) and reports **no warning** for any clip. test51's animal sits at one rim hole for the last
15 s (≈ 30 % of the samples); the median excluded it, so there was nothing to report, and the check
said so rather than inventing a warning. Two things it cannot see, recorded in
`docs/known-limitations.md`: a stationary animal touching the rim zone (indistinguishable from the
dark surround, so rim-touching blobs are skipped) and one smaller than a hole. The first version
flagged the five to six holes nearest the camera-far platform edge, which are seen obliquely as
crescents (0.3–0.7 × the hole area, elongation 1.8–2.5); the elongation rule now applies only to
blobs at least hole-sized.

## Eyeballed frames

The contact sheet (`<video>.contact.png`) tiles the 30 uniformly sampled frames plus the extras
(tagged `+`) at one third scale with the overlay; the zoom sheet (`<video>.zoom.png`) shows the
same frames as 2 × crops around the centroid, which is where the judgements below were made. "Nose on
head end" was judged only on frames the tracker marks moving (centroid speed ≥ 8 cm/s), as the brief
asks; for the other frames the column is "–". The head end was judged from the animal's visible tail
in the crop (the tail is unmistakable; the head is the other end). The images are here for a second reader
to re-check the judgements.

### test51 (start cylinder, lighter surround; 30 uniform + 5 extra — 6 were requested, one coincided with a uniform frame)

| frame | mouse visible? | single blob correct? | centroid within one body width? | nose on head end? (moving only) | state / reason |
| ----: | -------------- | -------------------- | ------------------------------- | ------------------------------- | -------------- |
| 12 | no (inside the start cylinder) | n/a — correctly not tracked | n/a | – | ambiguous / multiple_blobs |
| 37 | no (cylinder) | n/a — correctly not tracked | n/a | – | ambiguous / multiple_blobs |
| 61 | no (cylinder) | n/a — correctly not tracked | n/a | – | ambiguous / multiple_blobs |
| 86 | yes | yes | yes | yes (12 cm/s, conf 0.5) | tracked / single_blob |
| 111 | yes | yes | yes | – | tracked / single_blob |
| 135 | yes | yes | yes | – | tracked / single_blob |
| 160 | yes | yes | yes | – | tracked / single_blob |
| 185 | yes (over the rim) | yes | yes | – | low_confidence / partial_at_rim |
| 209 | yes | yes | yes | – | tracked / single_blob |
| 234 | yes | yes | yes | – (nose invalid: no cue) | tracked / single_blob |
| 259 | yes | yes | yes | – | tracked / single_blob |
| 284 | yes | yes | yes | – | tracked / single_blob |
| 308 | yes | yes | yes | – (nose invalid) | tracked / single_blob |
| 333 | yes | yes | yes | – (nose invalid) | tracked / single_blob |
| 358 | yes | yes | yes | – (nose invalid) | tracked / single_blob |
| 382 | yes (over the left rim) | yes — body and the part over the rim, merged (D48) | yes | – (nose invalid) | low_confidence / fragmented |
| 407 | yes | yes | yes | – (nose invalid) | tracked / single_blob |
| 432 | yes | yes | yes | yes (21 cm/s, conf 0.5) | tracked / single_blob |
| 456 | yes | yes | yes | – | tracked / single_blob |
| 481 | yes | yes | yes | – | tracked / single_blob |
| 506 | yes | yes | yes | – (nose invalid) | tracked / single_blob |
| 531 | yes | yes | yes | yes (10 cm/s, conf 0.5) | tracked / single_blob |
| 555 | yes (over the rim) | yes | yes | – | low_confidence / partial_at_rim |
| 580 | yes | yes | yes | – (nose invalid) | tracked / single_blob |
| 605 | yes | yes | yes | – | tracked / single_blob |
| 629 | yes | yes | yes | – | tracked / single_blob |
| 654 | yes | yes | yes | – | tracked / single_blob |
| 679 | yes (over the rim) | yes | yes | – | low_confidence / partial_at_rim |
| 703 | yes | yes | yes | – | tracked / single_blob |
| 728 | partly (head in a hole, rear visible) | yes | yes (of the visible part) | – | low_confidence / small_blob |
| 4 + | no (cylinder) | n/a | n/a | – | ambiguous / multiple_blobs |
| 14 + | no (cylinder) | n/a | n/a | – | ambiguous / multiple_blobs |
| 24 + | no (cylinder) | n/a | n/a | – | ambiguous / multiple_blobs |
| 552 + | yes | yes | yes | – (nose invalid) | tracked / single_blob |
| 627 + | yes | yes | yes | – | tracked / single_blob |

Derived (30 uniform frames): mouse visible in 27; single correct blob 27 / 27 = **100 %**; centroid
within one body width 27 / 27 = **100 %**; nose on head end on the moving frames 3 / 3. Whole clip:
none of the 666 frames with the animal outside the cylinder is `multiple_blobs` (14 are
`fragmented`, all with the animal over the left rim). Zero `tracked` frames while the cylinder is on
the platform (frames 0–74; it is lifted between 74 and 76, no hand visible).

### test53 (empty start; 30 uniform + 3 extra)

| frame | mouse visible? | single blob correct? | centroid within one body width? | nose on head end? (moving only) | state / reason |
| ----: | -------------- | -------------------- | ------------------------------- | ------------------------------- | -------------- |
| 15 | no (empty platform) | n/a — correctly nothing | n/a | – | not_detected / no_foreground |
| 45 | no | n/a | n/a | – | not_detected / no_foreground |
| 75 | no | n/a | n/a | – | not_detected / no_foreground |
| 105 | no | n/a | n/a | – | not_detected / no_foreground |
| 135 | no | n/a | n/a | – | not_detected / no_foreground |
| 165 | yes | yes | yes | – | tracked / single_blob |
| 196 | yes | yes | yes | – | tracked / single_blob |
| 226 | yes | yes | yes | – | tracked / single_blob |
| 256 | yes | yes | yes | – | tracked / single_blob |
| 286 | yes | yes | yes | – (nose invalid) | tracked / single_blob |
| 316 | yes | yes | yes | – (nose invalid: body round, tail across the axis) | tracked / single_blob |
| 346 | yes | yes | yes | – (nose invalid) | tracked / single_blob |
| 377 | yes (at the right rim hole) | yes — split by the hole, merged (D48) | yes | – (nose invalid) | low_confidence / fragmented |
| 407 | yes | yes | yes | – (nose invalid) | tracked / single_blob |
| 437 | yes | yes | yes | – | tracked / single_blob |
| 467 | yes | yes | yes | yes (9 cm/s, conf 1.0) | tracked / single_blob |
| 497 | yes | yes | yes | – | tracked / single_blob |
| 527 | yes | yes | yes | yes (15 cm/s, conf 1.0) | tracked / single_blob |
| 558 | yes | yes | yes | – | tracked / single_blob |
| 588 | yes (at the bottom rim hole) | yes — split by the hole, merged | yes | ? (11 cm/s, conf 0.0: tail and velocity disagree; the head is not visible in the crop) | low_confidence / fragmented |
| 618 | yes (at the bottom rim hole) | yes — split by the hole, merged | yes | – | low_confidence / fragmented |
| 648 | yes | yes | yes | – | tracked / single_blob |
| 678 | yes | yes | yes | – | tracked / single_blob |
| 708 | yes | yes | yes | – | tracked / single_blob |
| 739 | yes | yes | yes | yes (18 cm/s, conf 1.0) | tracked / single_blob |
| 769 | yes | yes | yes | – | tracked / single_blob |
| 799 | yes | yes | yes | – | tracked / single_blob |
| 829 | partly (rear only; head in the hole at 3 o'clock) | yes | yes (of the visible part) | – | low_confidence / small_blob |
| 859 | partly (rear only) | yes | yes (of the visible part) | – | low_confidence / small_blob |
| 889 | partly (rear only) | yes | yes (of the visible part) | – | low_confidence / small_blob |
| 12 + | no | n/a | n/a | – | not_detected / no_foreground |
| 37 + | no | n/a | n/a | – | not_detected / no_foreground |
| 62 + | no | n/a | n/a | – | not_detected / no_foreground |

Derived (30 uniform frames): mouse visible in 25; single correct blob 25 / 25 = **100 %**; centroid
within one body width 25 / 25 = **100 %**; nose on head end on the moving frames 3 / 3 plus one
unresolvable (588). Whole clip: none of the 755 frames after the animal is placed is
`multiple_blobs`; 76 are `fragmented` (the animal split by a hole, pieces within 6.5 cm of each
other, median 4.1 cm, merged under D48). Frames 0–149 are all `not_detected / no_foreground` (the
animal appears at the right rim at frame 150; no hand is ever visible inside the mask).

### test50 (3 min; 30 uniform)

| frame | mouse visible? | single blob correct? | centroid within one body width? | nose on head end? (moving only) | state / reason |
| ----: | -------------- | -------------------- | ------------------------------- | ------------------------------- | -------------- |
| 92 | no (empty platform) | n/a | n/a | – | not_detected / no_foreground |
| 276 | yes | yes | yes | – | tracked / single_blob |
| 461 | yes | yes | yes | yes (15 cm/s, conf 0.5) | tracked / single_blob |
| 646 | yes | yes | yes | – | tracked / single_blob |
| 830 | yes | yes | yes | yes (10 cm/s, conf 0.5) | tracked / single_blob |
| 1015 | yes (over the left rim) | yes — body and the part over the rim, merged (D48) | yes | – (nose invalid) | low_confidence / fragmented |
| 1200 | yes | yes | yes | yes (14 cm/s, conf 0.5) | tracked / single_blob |
| 1384 | yes | yes | yes | – | tracked / single_blob |
| 1569 | yes | yes | yes | – | tracked / single_blob |
| 1754 | yes (over the left rim) | yes — merged | yes | – (nose invalid) | low_confidence / fragmented |
| 1938 | yes | yes | yes | – | tracked / single_blob |
| 2123 | yes | yes | yes | yes (18 cm/s, conf 1.0) | tracked / single_blob |
| 2307 | yes | yes | yes | – (nose invalid: tail below threshold) | tracked / single_blob |
| 2492 | yes | yes | yes | – | tracked / single_blob |
| 2677 | yes | yes | yes | yes (22 cm/s, conf 1.0) | tracked / single_blob |
| 2861 | yes | yes | yes | – (nose invalid) | tracked / single_blob |
| 3046 | yes | yes | yes | – | tracked / single_blob |
| 3231 | yes | yes | yes | – (nose invalid) | tracked / single_blob |
| 3415 | yes (over the rim) | yes | yes | – | low_confidence / partial_at_rim |
| 3600 | yes | yes | yes | yes (14 cm/s, conf 1.0) | tracked / single_blob |
| 3784 | yes | yes | yes | – | tracked / single_blob |
| 3969 | yes | yes | yes | yes (19 cm/s, conf 1.0) | tracked / single_blob |
| 4154 | yes | yes | yes | yes (15 cm/s, conf 0.5) | tracked / single_blob |
| 4338 | yes (over the left rim) | yes — merged | yes | yes (19 cm/s, conf 0.5) | low_confidence / fragmented |
| 4523 | yes | yes | yes | yes (13 cm/s, conf 0.5) | tracked / single_blob |
| 4708 | yes | yes | yes | yes (15 cm/s, conf 0.5) | tracked / single_blob |
| 4892 | yes | yes | yes | yes (25 cm/s, conf 1.0) | tracked / single_blob |
| 5077 | yes | yes | yes | – (nose invalid) | tracked / single_blob |
| 5262 | yes | yes | yes | – | tracked / single_blob |
| 5446 | yes | yes | yes | – (nose invalid) | tracked / single_blob |

Derived (30 uniform frames): mouse visible in 29; single correct blob 29 / 29 = **100 %**; centroid
within one body width 29 / 29 = **100 %**; nose on head end on the moving frames 12 / 12. Whole clip:
none of the 5389 frames after the animal is placed is `multiple_blobs`; 483 are `fragmented` (pieces
within 6.3 cm of each other, median 4.7 cm, merged under D48).

### Nose on moving frames (`<video>.moving.png`: 30 frames sampled uniformly among the moving frames)

Judged tile by tile from the animal's visible tail. Confidence in brackets is the tracker's
`noseHeadingConfidence` (1.0 = tail and velocity agree, 0.5 = one cue).

| video  | moving frames in the clip | sampled | nose on head end | notes |
| ------ | ------------------------: | ------: | ---------------: | ----- |
| test51 | 82 | 30 | **30 / 30** | 13 at 1.0, 17 at 0.5 |
| test53 | 127 | 30 | **28 / 30**, 2 not resolvable at 2 × (frames 622, 627: `fragmented` at the bottom hole, tail not in the crop) | 22 at 1.0, 7 at 0.5, 1 at 0.0 (frame 631, tail cue chosen and right) |
| test50 | 1637 | 30 | **30 / 30** | 15 at 1.0, 13 at 0.5, 2 at 0.0 (frames 3017, 4548, tail cue chosen and right) |

Nearly every moving frame carries a valid nose (82 / 82, 126 / 127, 1630 / 1637), and on frames with
both cues tail and velocity disagree on 0 of 42 (test51), 2 of 98 (test53) and 88 of 760 (test50,
12 %; conf 0.0 on 95 of its 1637 moving frames). Before D48 the moving sets were 82 / 98 / 1354
frames and the judgement was 30 / 30, 30 / 30, 29 / 30 (+1 unresolvable).

### Nose-cue analysis behind the moving-speed default

Measured with the first default (`noseMovingSpeed_cmPerS = 2`) and before the detached-tail
attachment below, over frames where both the tail cue and the velocity cue were available, binned by
centroid speed. "Disagree" is the fraction where the two cues named opposite ends.

| speed (cm/s) | test51 n / disagree | test53 n / disagree | test50 n / disagree |
| ------------ | ------------------: | ------------------: | ------------------: |
| 2–4          | 65 / 18 %           | 95 / 28 %           | 332 / 46 %          |
| 4–6          | 43 / 14 %           | 53 / 28 %           | 199 / 35 %          |
| 6–8          | 21 / 5 %            | 23 / 0 %            | 172 / 30 %          |
| 8–12         |  9 / 0 %            | 29 / 0 %            | 202 / 24 %          |
| 12–20        | 18 / 0 %            | 52 / 0 %            | 263 / 5 %           |
| 20–40        |  4 / 0 %            |  1 / 0 %            | 110 / 1 %           |

Median centroid speed is 1.8 / 1.8 / 3.3 cm/s (test51 / test53 / test50): the animals are nearly
stationary most of the time, and below walking speed the direction of the centroid's motion is
jitter (the head dipping into a hole moves the blob's centroid), not heading. The default was raised
to 8 cm/s on this table; the residual 24 % disagreement in test50's 8–12 cm/s bin is unresolved (a
shadow beyond the rim can be attributed as "tail" when the animal hangs over the edge on the left,
where the wall is grey) and is recorded in `docs/known-limitations.md`.

Tail cue availability on frames with a blob, after attaching detached tail pieces (the re-encoded
tail base frequently falls below the foreground threshold, so the tail is a separate thin piece
next to the body; pieces are attached only when at least 2.5 × elongated, because a compact shadow
next to the body was otherwise taken for a tail and put the nose on the wrong end — test51 frame
111): test51 70 %, test53 75 %, test50 51 % of the frames with a blob (after D48, which adds the
fragmented frames to the denominator); nose invalid (no cue at all) 24 %, 21 %, 32 %. The
remaining no-cue frames are tails entirely below threshold (e.g. test50 frame 2307) or a hunched,
nearly round body whose major axis is undefined so the tail lies across it (test53 frame 316); both
are honest outcomes.

### O16 recommendation

Where the tracker commits to a nose on a moving frame it is on the head end in 89 / 90 judged frames
(the 90th could not be judged); where it does not commit, it says so (`valid: false`, confidence 0).
Under the current confidence scheme a tail-only nose scores 0.5, below O16's 0.6 cutoff, and the two
cues agree (1.0) on only 42 / 96 / 672 frames per clip, so with O16 as it stands events would use the
centroid on nearly every hole visit (the animal is stationary at holes, so the velocity cue is
unavailable there by design). Recommendation: keep D18's fallback — ship the nose labelled
experimental and let events default to the centroid — and let Alex decide, from the zoom and moving
sheets, whether a tail-only nose (0.5) deserves to clear the cutoff; the evidence here says the tail
cue is right whenever it exists, but the cutoff is his call, not this chunk's.

## Verdicts against the acceptance criteria (§5 of the chunk prompt)

| criterion | test50 | test51 | test53 | evidence |
| --------- | :----: | :----: | :----: | -------- |
| single correct blob ≥ 95 % where the mouse is visible | PASS 100 % (29 / 29; clip 100 %) | PASS 100 % (27 / 27; clip 100 %) | PASS 100 % (25 / 25; clip 100 %) | tables above; before D48 this read 90 % / 96 % / 88 % (clips 92.2 % / 97.9 % / 91.7 %): every miss was one animal split into two pieces by a hole or the rim shadow, now merged |
| centroid within one body width ≥ 95 % where the mouse is visible | PASS 100 % | PASS 100 % | PASS 100 % | 0 misplaced centroids in the 83 judged tracked/low_confidence tiles, the 7 merged frames included |
| zero `tracked` during test53's empty start | PASS (frames 0–149 all `not_detected / no_foreground`) | — | PASS | summary; `sample-videos.test.ts` |
| zero `tracked` during test51's start-cylinder frames | — | PASS (frames 0–74 all `ambiguous / multiple_blobs`) | — | summary; `sample-videos.test.ts` |
| experimenter's hand frames are `ambiguous / oversized_blob` | NOT TESTABLE on this data | NOT TESTABLE | NOT TESTABLE | no hand ever appears inside the platform mask in any clip (test53's animal appears at the rim at frame 150; test51's cylinder is lifted between frames 74 and 76 without a visible hand); `oversized_blob` is exercised by the synthetic-hand tests only; the cylinder itself is two crescents 8.9 cm apart, not one oversized blob |
| nose on the correct end ≥ 80 % of moving frames | PASS 30 / 30 | PASS 30 / 30 | PASS 28 / 30 (+2 unresolvable) | moving sheets |
| ≥ 150 fps in Node | PASS 2194 fps | PASS 1482 fps | PASS 1767 fps | timing table (compute only; 1098–1755 fps including ffmpeg) |
| deterministic | PASS | PASS | PASS | `sample-videos.test.ts` (two runs byte-identical on test53); `tracker.test.ts` on synthetic frames |
| background contamination check reports test51's stationary end honestly | — | PASS (nothing baked in; no warning; said so) | — | section above |
| lint / typecheck / test / build green; nothing from `out/` or a video committed; sheets ≤ 700 KB | PASS | PASS | PASS | `npm run lint && npm run typecheck && npm test && npm run build`; committed PNGs are 42–441 KB |
| fallback ladder for test51's light surround | not needed | not needed | not needed | Otsu 48 on a clean background; the 1.5 cm mask margin was not tightened; no adaptive threshold; not BLOCKED |

## Fragment merge (D48): before and after

An animal straddling a hole (dark in the background, so no difference signal under the body) or
hanging over the rim (the rim's shadow line splits the difference image) is two foreground pieces.
The first measurement, with the selection rule of the chunk prompt, made two plausible pieces
`ambiguous / multiple_blobs` unless exactly one was near the previous position — both always were —
and the single-blob and centroid criteria read 90 % / 96 % / 88 % on the sampled frames (92.2 % /
97.9 % / 91.7 % over the clips). In every such frame of test50 and test53 the pieces lay within one
body length of each other (max 6.3 / 6.5 cm, median 4.7 / 4.1 cm); the start cylinder's two
crescents in test51 are 8.9 cm apart.

D48 merges plausible pieces whose centroids all lie within `fragmentMergeDistance_cm` (8 cm) into
one candidate — union centroid, area, bounding box and summed moments, so the ellipse and the nose
cues still work — as `low_confidence / fragmented`, provided the union satisfies the same area
bounds as a single blob (minimum area, and the oversized bound `min(maxBlobArea, oversizedBlobFactor
× expected)`); otherwise the frame stays `ambiguous / multiple_blobs`.

| video  | `multiple_blobs` before → after | `fragmented` after | `tracked` before → after | single blob, sampled frames | single blob, whole clip |
| ------ | ------------------------------: | -----------------: | -----------------------: | --------------------------: | ----------------------: |
| test50 | 423 → 0 | 483 (the 423, plus 43 `proximity_to_previous` and 17 `small_blob` frames that also had two pieces within reach) | 4155 → 4112 | 90 % → 100 % | 92.2 % → 100 % |
| test51 | 89 → 75 (the cylinder frames 0–74, crescents 8.9 cm apart, correctly not merged; as one blob their 1610 px² would also exceed the oversized bound of 3 × 537) | 14 | 576 → 576 | 96 % → 100 % | 97.9 % → 100 % |
| test53 | 63 → 0 | 76 (the 63, plus 12 `proximity_to_previous` and 1 `small_blob`) | 602 → 590 | 88 % → 100 % | 91.7 % → 100 % |

What the merge does not give: the union centroid is the area-weighted centroid of the visible
pieces (with the head in a hole it sits on the visible body); the nose is available on 21 % / 66 % /
53 % of fragmented frames (test51 / test53 / test50); the union's bounding box spans the hole.
Recorded in `docs/known-limitations.md`.
