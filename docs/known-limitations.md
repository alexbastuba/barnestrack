# Known limitations

Three sections: defects (bugs or gaps found and not yet fixed), excluded scope (deliberately not
built), and findings about the sample data (properties of the inputs that the tool handles by
design rather than defects of the tool). Appended whenever a limitation is discovered, in the same
session it is found (D39).

## Defects

- **The cohort figures always plot primary latency.** `PlottableMetric` offers seven measures and
  `src/viz/cohort.ts` names them all in `METRIC_LABELS`, but the Review step's figures section
  exposes no control for it, so the learning curve and the group comparison are fixed to
  `DEFAULT_METRIC`. The figure gallery prototype has the select; the step does not. A fix is one
  more control in `#review-figures` feeding `FigureData.metric` — a figure option under D53, not a
  parameter, so no contract change is involved.
- **The trajectory figures never sit on a video frame.** `FigureOpts.background` is wired through
  to the platform clip (chunk 8) and the example bundle ships one derived still per video (D33),
  but nothing in the Review step supplies either, so every spatial figure draws on a plain disc
  even when the video is attached and the frame is already decoded in the frame view. The figures
  are correct and legible; they are just less recognisable than D32 intends.
- **The export's stale-analysis refusal cannot be reached from the UI.** `prepareExport` re-derives
  the whole cohort and then refuses if any video's stamped hash still disagrees with the parameters
  in force (trust audit A2). Since the store now drops every derived cache whenever the parameters,
  the maze map or a transform change, that branch should be unreachable, and it is covered only by
  a unit test of `staleAnalyses` on a hand-built session — not end to end. It is kept deliberately,
  as an internal-consistency stop rather than a user state; if it ever fires, that is a defect
  report, not a setting to change.
- **The events panel's height is a fixed 34 rem.** Chunk 7b moved the cap off the component and on
  to `#review-events` so the step's layout owns it, which is the right owner, but the value is
  still a constant rather than something measured from the space beside the timeline. At a very
  short viewport the list scrolls sooner than it needs to.
- **The maze click count is not in the session file.** The "Maze step: N clicks on the image" badge
  is the on-screen evidence for the D29 click budget, but `SessionFile` has no field for it (D47
  did not add one), so it lives only in the browser's autosave record. It therefore survives a
  reload and is restored with the session, but a session file saved, reset and loaded again comes
  back with the badge at zero. The maze itself is unaffected.
- **A fitted transform can carry floating-point rotation noise.** "Adjust" and "Apply from" fit a
  similarity from circle correspondences, whose true rotation is exactly zero; the least-squares
  fit returns values around 1e-15 degrees instead. Nothing measurable depends on it and no
  threshold was invented to round it away, but it is visible in a saved session file's
  `mazeTransform.rotationDeg`.
- **A reload inside the autosave window can lose the last edit.** Changes are written to IndexedDB
  about half a second after the last one, and the page also asks the store to flush on `pagehide`.
  That flush cannot be awaited — the browser may discard an IndexedDB transaction opened while the
  page is going away — so a reload in the moment after an edit can lose it. The header says
  "Saving…" until the write lands, and "All changes saved in this browser" once it has; wait for
  that before reloading. A fix would write synchronously on `visibilitychange` to a store that
  supports it.
- **One autosave slot per browser, not per session.** The IndexedDB record is stored under a single
  `current` key, so two BarnesTrack tabs open at once overwrite each other's autosave without
  noticing: the last tab to make a change wins, and the other tab's cohort is gone after its next
  reload. D27 speaks of autosave "keyed by video fingerprint"; this build has one slot. Until it is
  fixed, work in one tab at a time, and use Save session file before opening a second. A fix would
  refuse to overwrite a record saved after the one this tab loaded, and say so.
- **A merged animal is positioned, but only as a union.** When the animal straddles a hole (dark
  in the background, so there is no difference signal under the body) or hangs over the rim where
  the rim's shadow line cuts the difference image, the foreground is two pieces; since D48 the
  pieces are merged into one `low_confidence / fragmented` candidate when their centroids lie within
  `fragmentMergeDistance_cm` (8 cm) of each other and the union satisfies the single-blob area
  bounds. This is 8.7 % of test50's frames and 8.4 % of test53's (483 and 76 frames; 14 in test51),
  concentrated at holes. What remains: the union centroid is the area-weighted centroid of the
  visible pieces, so with the head in a hole it sits on the visible body, not the true body centre;
  the nose is available on only 53 % / 66 % / 21 % of fragmented frames (test50 / test53 / test51),
  and the union's bounding box spans the hole. Two pieces farther apart than the merge distance are
  still `ambiguous / multiple_blobs` (only the start cylinder's two crescents, 8.9 cm apart, in the
  sample videos — 0.9 cm beyond the merge distance; their union of 1610–1692 px² sits at the
  oversized bound of 1611 px², so the area bound alone would not exclude them, and the robust
  exclusion of the start is the trial-start marker, O5).
- **The nose is often unavailable, and where it exists it usually rests on a single cue.** The tail
  cue exists on 70 % / 75 % / 51 % of frames with a blob (test51 / test53 / test50) and no cue at all
  on 24 % / 21 % / 32 %: the re-encoded tail is frequently below the foreground threshold along its
  whole length, and a hunched, nearly round body has no defined major axis. Where only the tail cue
  exists the heading confidence is 0.5, which exactly meets O16's cutoff as revised on 2026-09-05 —
  so on those frames events use the nose on the strength of one cue, with no second cue agreeing.
  (At the original 0.6 the nose would instead have been unused on nearly every hole visit, since the
  animal is stationary there and the velocity cue is unavailable by design.) The two cues agree, and
  the confidence reaches 1.0, on only 42 / 96 / 672 frames per clip. Measured in
  `prototypes/tracker/RESULTS.md`; the nose ships as experimental (D18).
- **Velocity and tail cues can disagree on the left rim of test50.** With the moving threshold at
  8 cm/s the two cues still name opposite ends in 12 % of test50's frames that have both (88 of 760),
  mostly with the animal hanging over the left rim, where the grey wall lets part of the animal's
  shadow beyond the edge be attributed as "tail". Not resolved; such frames carry heading confidence
  0.0 and the nose is not trusted.
- **The background contamination check cannot see everything.** A stationary animal that touches the
  rim zone is skipped (indistinguishable from the dark surround inside the mask margin), and one
  smaller than a hole is not flagged (the elongation rule requires at least hole-sized area, because
  holes near the far platform edge are seen obliquely as small crescents). A baked-in animal of at
  least hole size away from the rim is flagged (unit-tested); on the sample videos there was nothing
  to flag.
- **Edited tracking parameters are not in the session file.** D51 stamps `SessionFile.parameters` at
  the first *analysis* run, not the first tracking run, so until the analysis engine lands there is
  nowhere in the contract for a tracking threshold the user changed to live. It is kept in the
  browser's autosave record instead, beside the maze draft and the click count: it survives a reload
  but a session file saved, reset and loaded again comes back at the defaults. The automatic layer's
  `parametersHash` still records *which* parameters produced it, so a mismatch is detectable even
  though the values themselves are not yet in the file. Closes when chunk 5 stamps `parameters`.
- **A reload during a tracking pass loses the pass, silently.** No run state is persisted, so a video
  whose pass was interrupted by a reload comes back simply "not tracked" rather than saying that a
  run was interrupted. The guarantee that matters holds — the automatic layer is written once, at the
  end, so nothing half-written can exist — but the user is not told why the video they left tracking
  is untracked. A fix would persist a run marker and clear it on completion.
- **The tracked percentage in the summary counts only the `tracked` state.** test53 reads "Tracked
  65.2 % of frames" when 150 of its 905 frames have no animal on the platform at all and 165 more are
  `low_confidence` — frames that do carry a position. The breakdown line beneath gives all four
  counts, which is why it is there, but the headline number reads worse than the tracking is. A
  fuller headline would separate "no animal present" from "animal present, not resolved", which needs
  the trial bounds (O5) that land with the analysis engine.
- **A cohort of long videos makes a large session file.** A 5,539-frame automatic layer is 3.96 MB of
  session JSON on its own (measured), so the three sample videos together come to about 5.3 MB and a
  cohort of twenty 3-minute videos would be near 80 MB. It round-trips in 14 ms and IndexedDB holds
  it without complaint, but it is a large thing to email. The file is pretty-printed for
  readability; compact JSON, or a per-frame encoding narrower than one object per frame, would cut it
  substantially and is a contract change, not a formatting one.
- **An escape-box entry needs a full loss of detection.** O4 reads an entry as a loss of detection
  whose last-seen event point is within 1.0 × hole radius of the target. In the sample recordings
  the animal's rear stays visible while its head is in a hole (`small_blob` keeps a positioned
  centroid), so no entry is detected: test51's last 15 s head-in-hole at hole 19 is an
  investigation, and every sample trial is `review` under O5. A rear-only centroid also sits about
  a body length from the hole centre, so even a full disappearance from that pose would fall
  outside the entry radius and read as a tracking failure at the hole. The radius is O4's default
  and was not widened (`prototypes/analysis/RESULTS.md`).
- **A parameter change can orphan an event correction.** Event corrections address automatic
  events by an id made of kind, hole and start frame, matched exactly or by span (see
  `docs/data-contracts.md` §6). A change that moves an event away from the frame named in the id,
  or removes it, orphans the correction: an orphaned edit stays pinned as a corrected event
  without `autoShadow`; an orphaned delete is reported as a review flag and the automatic event
  stands. Unpinning is the user's action of removing the correction.
- **Repeat visits split at the merge-gap boundary.** Bouts at the same hole 0.53 s apart are two
  investigations under the 0.5 s default (test51, hole 12): the repeat-visit count is sensitive to
  the merge gap near its own value. The gap is a visible O1 parameter.
- **The O7 placeholder classifies an empty search as spatial, and looks only at the search phase.**
  A trial with no investigation and no target visit satisfies the spatial rule vacuously (the
  reasoning says so; the status carries the warning). And because the rules consider investigations
  before the first target visit only, test50 — which walks the ring hole by hole for two minutes
  *after* its first target visit at 12.7 s — classifies as spatial from two errors at hole 5.
  Whether post-target behaviour should enter the classification is an O7 question.
- **Adjacent runs are direction-agnostic and may end at the target visit.** The serial rule's
  "run of adjacent-hole investigations" counts a step of one hole in either direction, so
  12→13→12→11 is a run of four (a same-direction reading would make it three), and the target
  visit may be the run's last element, so 9→8→7 with target 7 is a run of three where O7's
  "precedes the target visit" could be read as two. Both readings are stated in the serial rule's
  definition text; which one O7 means is a decision for `docs/decisions.md`.
- **Thresholds outside the contract are not in the parameters hash.** The O5 censoring switch,
  the five O7 rule numbers and the two D30 tier thresholds live in `DEFAULT_ANALYSIS_OPTIONS`
  (`trialCensoring.censorToCutoff`, `strategy.spatialMaxErrors`, `strategy.spatialMaxHoleDistance`,
  `strategy.spatialMaxCentreCrossings`, `strategy.serialMinRun`, `strategy.centreZoneRadiusFraction`,
  `quality.goodMinPositionedFraction`, `quality.poorMaxPositionedFraction`) because `Parameters` has
  no field for them; they are neither hashed into `parametersHash` nor stamped on exports. Two
  derived layers or exports can therefore carry the same `parameters_hash` and disagree on
  `strategy`, `total_latency_s` or the quality tier if these were changed between them. Until the
  fields join the contract, the defaults are the only values in use and the tool version identifies
  them.
- **Some derived numbers cannot be null in the contract.** `TrialMetrics.trialStart_s` and
  `meanSpeed_cmPerS`, and `EventRecord.minNoseDistance_cm` (when the nose was never usable during
  an event, a common case on these clips) are `NaN`, which JSON writes as `null`; consumers must
  treat non-finite and null alike and a CSV writer must emit an empty cell.
- **Cleaning counts and the strategy reasoning are not persisted.** `n_filled_frames`, the outlier
  indices, the unfilled-gap reasons, the trial bounds, the strategy features and reasoning and the
  review flags live on the result of `derive()` and not in the session's `DerivedLayer`; they are
  recomputed on load, never stored.
- **`src/viz/figure-export.ts` has no automated test.** Node has neither `OffscreenCanvas` nor
  `document`, so the one module that turns a figure into a PNG cannot be exercised by Vitest; its
  test only asserts that it says so plainly rather than failing obscurely. Everything it draws is
  covered — the figures themselves are unit-tested against a recording 2D context — but the canvas
  sizing, the 2×/3× scaling and the PNG encoding are checked by hand in Chrome through
  `prototypes/viz-gallery/`, where a 3× PNG of each of the nine figures was exported, converted to
  grayscale with `sips` and read (chunk 8). A fix would be a Playwright spec in `tests/browser/`
  that exports one figure and asserts the PNG's dimensions and magic bytes.
- **The export ZIP is stored, not compressed.** `src/export/zip.ts` writes store-only entries, so a
  bundle is as large as the files inside it: 11.1 MiB for the three-video synthetic cohort, of which
  11.07 MiB is the session file carrying its embedded `auto` track layer. A twenty-video cohort
  would give a bundle near 80 MB where deflate would give a small fraction of that. The workbook
  is already deflated, so only the JSON and the CSVs would benefit. A fix would be a raw-deflate
  implementation, or `CompressionStream('deflate-raw')` where the browser has it, behind the same
  `zipStore` signature.
- **`session_id` in the exports is the cohort name, not a stable identifier.** `SessionFile` (D9,
  D47) has no id field, only the user-editable `name`, so that is what `trials.csv`, `events.csv`
  and `quality.csv` carry in `session_id`. Renaming a cohort changes the value in every row exported
  afterwards, and two cohorts that happen to share a name are indistinguishable in a merged
  spreadsheet. A fix is a generated, immutable session id in the session contract, which needs a
  schema-version bump and Alex's sign-off.
- **`events.csv` cannot express a tracking failure.** `EventKind` admits `tracking_failure`, but D11
  and `docs/data-contracts.md` give the exported `kind` column the domain
  `investigation | escape_entry`, and O4 makes a loss away from any hole a finding of the quality
  report rather than an event. `eventRows()` therefore drops those records; they survive in the
  session file, in `quality.csv` as gaps, and in the timeline. Anyone reconciling the two files must
  know that the event count in `events.csv` is not the length of `derived.events`.
- **A cohort of more than six animals cannot be read from the learning curve's key in print.**
  `src/viz/learning-curve.ts` gives each animal a marker shape from a list of six and a dash
  pattern from a list of four, and in the print theme every series is black. The *lines* stay
  distinguishable past six animals because shape and dash cycle out of step, but the legend swatch
  carries only the shape, so animals 0 and 6 get the same key entry. At a 9 px swatch a dash
  pattern is not legible, so the fix is a longer glyph list or a swatch drawn as a short line
  segment rather than a marker (D26, D32).
- **The cohort skill's column lists are a hand-kept copy of the export headers.**
  `skills/barnestrack-cohort/SKILL.md` quotes the three CSV header lines verbatim so a reader can
  diff them against a real export, but nothing binds the two: the header lines were generated
  through `src/export/` and pasted, and a change to `src/export/columns.ts` will not fail any test
  because of the stale copy. The counts as written are 35, 23 and 17 columns. A fix is a test in
  `tests/export/` asserting that each `csvHeaderRow` appears in the skill file.
- **`THIRD_PARTY_NOTICES.md` now under-claims relative to D38.** D38 lists the row model and
  paint-style editing operations of `talmolab/vibes/event-annotator` among the borrowed patterns,
  but no file carries an `event-annotator` attribution header — the event list that would use it
  has not been built. The notices file therefore moves it to "ideas only, no code", so that every
  borrowing it claims is confirmed by `grep -rn "Adapted from talmolab/vibes" src/`. Either D38
  needs an amendment or the header needs to appear when the event list lands; until then the
  decision record and the notices file disagree, in the safe direction.

## Excluded scope

- **Input format.** MP4 with H.264 (AVC) video only (D4, O13). Other containers/codecs are listed
  in the UI with the reason, never silently dropped, and with a re-encode hint:

  ```
  ffmpeg -i in.avi -c:v libx264 -pix_fmt yuv420p -g 15 -bf 0 out.mp4
  ```

- **H.264 features outside the sample videos.** Only 8-bit 4:2:0 H.264 is accepted: the High 10,
  High 4:2:2 and High 4:4:4 Predictive profiles are rejected at intake with a re-encode hint
  (`-pix_fmt yuv420p`), and a decoder that still hands back a 10/12-bit frame stops the pass with
  an "unsupported decoded pixel format" error rather than reading two-byte samples as bytes.
  Frame identity orders same-timestamp frames by the bitstream's picture order count (POC type 0,
  frame pictures; see below). Streams using POC type 1 or field (interlaced) coding fall back to
  ordering ties by decode order, and the index records a warning saying so; a
  `memory_management_control_operation` 5 (a POC reset without an IDR, which x264 never emits) is
  not detected and would only affect the order within a tied pair. In an open-GOP stream (a non-IDR
  keyframe whose leading pictures reference the previous group) the scrubber cannot reach those
  leading pictures from their keyframe: it reports "frame N was not produced by the decoder" for
  them and decodes the rest of the group normally; it never substitutes a neighbouring frame.

- **No perspective correction.** The platform is fitted as a circle in image pixels. A camera that
  is not directly overhead images the platform as an ellipse, and a circle fit then splits the
  difference between the long and short axes; `px_per_cm` is a single number for the whole
  platform, so distances near the far rim are slightly under-measured and near the close rim
  slightly over-measured. Correcting this needs a homography from four rim points and a
  ground-plane assumption, which is a larger change to the maze map contract than this tool needs
  for the sample data (see the test51 note below).

- **The live thumbnail during a pass is provisional, and says so.** It shows the frame's largest
  foreground blob (or the D48 union when the animal is split), not a result: the nose and the
  detection state are decided at the end of the pass from cues across frames — the learned body area,
  the velocity window, the previous position — so a mid-pass value for either would be a plausible
  lie (D16). The thumbnail's caption and `aria-label` both read "provisional — final track computed
  at end of pass", and it is drawn as an outline and a cross rather than a filled marker. Showing the
  settled state live would mean running the tracker twice.
- **No automated tests of the DOM layer.** `src/maze/` and `src/session/` are pure and unit-tested
  in Node; `src/ui/` is DOM- and canvas-bound, and the project has no DOM test environment (D3
  keeps the dependency list short). The DOM-free parts of a step — the summary sentence the Track
  step prints, and the like — are extracted and unit-tested in `tests/ui/`; everything that touches
  an element or a canvas is covered by TypeScript, by the browser checks in `tests/browser/`, and by
  a recorded manual pass in Google Chrome. Adding jsdom or a component-test runner is deliberately
  not done.

- **The video is never stored, only its fingerprint.** After a reload a video is present but "not
  attached" until the same file is dropped again (D27). BarnesTrack could keep the file in
  IndexedDB and re-open it automatically, but that would put copies of a lab's video data in the
  browser profile without the user asking, so it is not done.

- **Figures are drawn on a plain platform disc, not the video frame.** `FigureOpts.background`
  accepts a still and `drawPlatform` clips it to the disc, but nothing produces that still yet: D33
  calls for one derived still per video so every result renders without a video attached, and that
  belongs with the demo-state work. Until then a trajectory is read against the numbered hole ring
  rather than against the arena the animal was actually in.

## Findings about the sample data

- **Frame timing anomalies.** All three sample videos contain duplicate presentation timestamps
  (162 / 17 / 25 tied pairs in test50 / test51 / test53) and dropped-frame gaps (214 / 23 / 34 gaps
  longer than 1.5 × the nominal frame interval) in their MP4 sample tables; test50 runs 0.433 s
  longer than `frame ÷ fps` by its end. Per-frame time is always taken from the file's own sample
  table (composition time minus edit-list offset, over the track timescale); nominal frame-rate
  arithmetic is never used for timing. See D7, O11.
- **Tied timestamps are not in decode order.** Within the tied pairs, the decoder emits the two
  frames in the bitstream's picture-order-count (POC) order, which differs from their order in the
  sample table for 68 / 7 / 5 pairs (test50 / test51 / test53, measured with `ffmpeg -bsf:v
  trace_headers`). BarnesTrack therefore orders ties by POC, read from each sample's first slice
  header (D45), so that "frame N" means the same picture in the sequential tracking pass, in the
  scrubber, and in ffprobe's output order. A plain sort by timestamp then decode order makes the
  decoder's output non-monotone at the first such pair (frame 174/175 of test50), which the
  prototype demonstrates on request (`prototypes/frame-server/RESULTS.md`).
- **Reduced visual quality.** The sample clips were re-encoded from the originals at lower quality:
  decoded frames show soft edges and smoothed texture (no blocking), and the mouse remains a
  well-separated dark blob on the white platform. Noted as a property of the inputs; whether it
  limits nose detection is measured in the tracker chunk.
- **test50 and test53 share a rig and a framing; test51 does not.** Fitted in Chrome from three rim
  clicks each: test53 and test50 both give a platform at (327.8, 239.7) px with radius 208.5 px, so
  a maze map made on one applies to the other with no adjustment at all. test51's platform is
  larger and left of centre — (280.0, 239.9) px, radius 222.5 px — giving 4.838 px/cm against
  4.533 px/cm for the other two, so its map needs the three-click "Adjust". This is why the maze
  map is shared but the placement is stored per video (D10, D28).
- **test51's platform is not quite circular in frame.** Its rim measures about 15 % wider than it
  is tall in the image, so the camera is not directly overhead. The circle fit splits the
  difference and the generated hole ring sits a few pixels inside the real holes on the near side.
  Individual holes can be nudged where it matters; no perspective correction is applied (see
  "Excluded scope").
- **The nominal frame rate and the per-frame timestamps disagree, by design.** The video card shows
  the file's nominal frame rate for orientation; the scrubber shows each frame's own timestamp from
  the sample table. On these clips the two drift apart by up to 0.43 s by the end of the video, so
  the two numbers next to each other are not two readings of the same thing. Every measurement uses
  the timestamp (D7, O11).
- **test51 opens with the start cylinder on the platform.** Frame 0 shows the cylinder near the
  centre of the maze and no visible animal, which is what makes it the useful frame for marking the
  maze and the reason trial start is detected rather than assumed to be frame 0 (O5).
- **No experimenter's hand, and the start cylinder is two crescents.** No hand appears inside the
  platform mask in any clip: test53's animal simply appears at the right rim at frame 150 (the
  platform is empty for frames 0–149), and test51's start cylinder is lifted between frames 74 and 76
  without a visible hand. The `oversized_blob` rule is therefore exercised only by the synthetic-hand
  tests. The cylinder itself (frames 0–74 of test51) thresholds as two crescents of ≈ 900 and 700 px²
  8.9 cm apart, so those frames are `ambiguous / multiple_blobs` (never `tracked`), not
  `oversized_blob`; as one blob its difference image (≈ 2000 px²) would be only 3.3–3.7 × the body
  area, so the × 3 oversized factor has little margin. The robust way to exclude the start is the
  trial-start marker (O5), not the blob rule.
- **The tail after re-encoding.** The tail is visible to the eye in nearly every frame but its
  difference from the background is often below the Otsu threshold (43–51) along most of its
  length, and its base is frequently the first part to drop out, leaving a detached thin piece
  beside the body. The tracker attaches such pieces to the one body within two opening radii when
  they are elongated (a compact shadow next to the body is not a tail) and still gets no tail cue on
  22–32 % of frames. The tail is thin enough that the 0.8 cm opening removes it wherever it is
  above threshold, so the centroid is unaffected.
- **Holes near the far platform edge are crescents.** The camera is not exactly overhead: the five
  or six holes on the platform's left (test50, test53) or right (test51) edge appear as crescents
  0.3–0.7 × the area of a face-on hole with elongation 1.8–2.5. The contamination check ignores
  them; a parametric hole ring (D10) still fits their centres.
- **test51's lighter surround needed no fallback.** With the median background the surround cancels
  and Otsu lands at 48 (test50 51, test53 43); the 1.5 cm mask margin was not tightened and no
  adaptive threshold was used. The animal's shadow on the grey wall when it hangs over the left rim of
  test50 is the one place the surround matters (see Defects).
- **The animals are nearly stationary most of the time.** Median centroid speed 1.8 / 1.8 / 3.3 cm/s
  (test51 / test53 / test50); only 82 / 127 / 1637 frames exceed 8 cm/s. Below walking speed the
  centroid's direction of motion is jitter (the head dipping into a hole shifts the blob), which is
  why the velocity cue for the nose applies only from 8 cm/s.
- **No escape-box entry is detectable in the three clips.** test50 circles the rim and never
  enters a hole (53 investigations, target reached at 12.7 s, cutoff at 180 s); test51 ends with its
  head in hole 19 (top right) and test53 in hole 2 (about four o'clock on the right; the tracker
  results said "3 o'clock" by eye), both with the rear visible. Under O4 none of these is an entry
  (see Defects), so all three trials are `review`.
- **Trial starts land where the contact sheets say.** Frame 150 for test50 and test53 (the animal
  appears at the rim after an empty platform) and frame 75 for test51 (the first frame after the
  cylinder is lifted). No `oversized_blob` frame exists in any clip, so the O5 clause "after the
  last oversized frame" is exercised only by the synthetic tests.
- **Duplicate stamps under O11 outnumber the index's exact ties.** The quality report counts
  201 / 24 / 32 duplicate stamps (test50 / test51 / test53) against 162 / 17 / 25 exact ties in the
  sample tables: the extra pairs are one timescale tick apart (65–67 µs) and are skipped for speed
  like exact ties.
