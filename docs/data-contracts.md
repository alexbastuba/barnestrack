# Data contracts

This document describes BarnesTrack's file formats and internal representations: the per-frame
track record, the session file, the maze map file, and the CSV/XLSX export schema. It is written
from the TypeScript types in `src/contracts/` and the decisions in `docs/decisions.md` (D7–D12);
it does not invent fields beyond those decisions.

**Versioning rule.** Each contract carries its own `schemaVersion`. Changing a contract's shape —
adding, removing, renaming or retyping a field, or changing what a field means — bumps that
contract's schema version and adds a new entry to `docs/decisions.md`. A schema version is never
reused for an incompatible shape.

Current versions: `SESSION_SCHEMA_VERSION = 1`, `MAZE_MAP_SCHEMA_VERSION = 1`,
`EXPORT_SCHEMA_VERSION = 1`.

## Conventions used throughout

- **Never a bare `(x, y)`.** Every position estimate is a named point —
  `{ x, y, confidence, valid, source }` — never raw coordinates. (Hard constraint, `CLAUDE.md`.)
- **Coordinates** are native video pixels, `y` down, at the video's reference resolution (D15). Zoom
  and pan in the UI are a view transform only; stored data never depends on how the page was
  displayed.
- **Units.** Spatial thresholds are stored in centimetres and converted per video using the
  platform-diameter calibration; temporal thresholds are stored in seconds and applied using each
  frame's own timestamp, never a nominal frame rate (D7, D14).
- **Provenance.** `source` on a point is one of `auto | corrected | filled | imported` (D8). The
  automatic tracking layer never contains `filled` points — filling is a derived-layer cleaning
  step, always shown and always counted (D16, O10).

## 1. Frame identity and time (D7, D45)

A frame's identity is its position in the MP4 sample table, sorted by presentation time — not a
nominal-rate index. Frames that share a presentation time are ordered by the bitstream's picture
order count (the decoder's own display order), then by decode order; streams whose picture order
cannot be read fall back to decode order with a recorded warning (D45). Its time in seconds comes
from that same table (composition time minus the edit-list offset, over the track timescale). All
three sample videos contain duplicate presentation timestamps and dropped-frame gaps; one drifts
0.43 s from `frame ÷ fps` by its end, so nominal-rate arithmetic is never used for frame time.
Decoder output frames are identified by output order using synthetic, monotone timestamps — never
by matching a decoded frame back to the sample table by timestamp value, which would collapse the
duplicates.

| Field        | Type   | Unit    | Notes                                            |
| ------------ | ------ | ------- | ------------------------------------------------- |
| `frameIndex` | number | —       | Position in the sample table, sorted by PTS.       |
| `t_s`        | number | seconds | From the sample table, not `frameIndex / fps`.     |

## 2. Track frame (D8)

One record per frame of one video's track.

| Field                   | Type            | Unit    | Notes                                                              |
| ----------------------- | --------------- | ------- | ------------------------------------------------------------------- |
| `frameIndex`            | number          | —       | See §1.                                                              |
| `t_s`                   | number          | seconds | See §1.                                                              |
| `centroid`              | NamedPoint      | px      | Body centroid. See below.                                            |
| `nose`                  | NamedPoint      | px      | Head-end point. See below.                                           |
| `detectionState`        | enum            | —       | `tracked \| not_detected \| ambiguous \| low_confidence`.            |
| `reason`                | string          | —       | Why `detectionState` took this value. One of the eight fixed strings enumerated in §6. |
| `blobArea_px2`          | number          | px²     | Foreground blob area at this frame.                                  |
| `boundingBox`           | BBox \| null    | px      | `{ x, y, width, height }`, or `null` when nothing was detected.      |
| `noseHeadingConfidence` | number          | 0–1     | Confidence in the head-end choice along the body ellipse's axis.     |

**NamedPoint** (`centroid`, `nose`):

| Field        | Type    | Unit | Notes                                     |
| ------------ | ------- | ---- | ------------------------------------------ |
| `x`, `y`     | number  | px   | Native video pixels, y down.               |
| `confidence` | number  | 0–1  | —                                           |
| `valid`      | boolean | —    | False when the point should not be used.   |
| `source`     | enum    | —    | `auto \| corrected \| filled \| imported`. |

The automatic layer never contains a frame with `source: 'filled'` on either point (D8, D16).

```json
{
  "frameIndex": 412,
  "t_s": 13.7333,
  "centroid": { "x": 512.4, "y": 388.1, "confidence": 0.91, "valid": true, "source": "auto" },
  "nose": { "x": 528.9, "y": 371.0, "confidence": 0.58, "valid": true, "source": "auto" },
  "detectionState": "tracked",
  "reason": "single_blob",
  "blobArea_px2": 842,
  "boundingBox": { "x": 498, "y": 360, "width": 46, "height": 40 },
  "noseHeadingConfidence": 0.58
}
```

## 3. Session file (D9, D27, D28, D44, D47)

One JSON document per session (cohort): a name, a video list, a shared maze map with a per-video
transform, shared parameters, and per-video analyses in three layers.

**A session exists before a maze or parameters do (D47).** The session is created the moment a
video is loaded, so autosave and reload work from the first dropped file (D27). `mazeMap` is `null`
until the maze step is finished; `parameters` is `null` until the first analysis run stamps the
defaults in force at that time (D51); `analyses` has no entry for a video that has not been tracked,
and a tracked video's `derived` is `null` until it is analysed (D52) — never a placeholder
`auto`/`derived` layer. `SESSION_SCHEMA_VERSION` stays 1: no schema-1 file had
been written when this was decided.

**No session-level calibration field.** `platformDiameter_cm` lives once in the shared `mazeMap`
(§4); the session file does not repeat it. A video's pixels-per-centimetre is derived from the
map's platform radius after that video's `mazeTransform` and recorded in
`analyses[videoId].derived.quality.pxPerCm` and in `quality.csv`'s `px_per_cm` column — never
entered separately. A cohort that uses two physical mazes carries two maze map files (D44,
superseding the session-level "calibration" field named in D9's prose).

| Field           | Type                                    | Notes                                                    |
| --------------- | ---------------------------------------- | --------------------------------------------------------- |
| `schemaVersion` | `1`                                       | `SESSION_SCHEMA_VERSION`.                                  |
| `toolVersion`   | string                                    | `barnestrack v<major>.<minor>.<patch> (<git-sha7>)`.       |
| `name`          | string                                    | User-editable cohort name; defaults to the first video's filename (D47). |
| `videos`        | VideoDescriptor[]                        | See below.                                                 |
| `mazeMap`       | `MazeMapFile \| null`                    | Shared across the cohort; `null` until the maze step is finished (D47). See §4. |
| `parameters`    | `Parameters \| null`                     | Every event/cleaning threshold; `null` until the first analysis run (D47, D51). See §6. |
| `analyses`      | `Record<videoId, VideoAnalysis>`         | No entry until the video is tracked. See below.            |

**VideoDescriptor**

| Field                | Type            | Notes                                                        |
| -------------------- | --------------- | -------------------------------------------------------------- |
| `id`                 | string          | —                                                                |
| `filename`           | string          | Display only; re-attach is by fingerprint, not path.            |
| `fingerprint`        | VideoFingerprint | `{ byteLength, durationSeconds, frameCount, sha256 }`. Lets a reload re-attach the video by dropping the same file. |
| `referenceResolution`| `{ width, height }` | px                                                          |
| `mazeTransform`      | SimilarityTransform | `{ translateX, translateY, rotationDeg, scale }` fit of `mazeMap` onto this video (D10). |
| `metadata`           | VideoMetadata   | `{ animal?, day?, trial?, group? }`, user-editable, no filename parsing (O12). |

**VideoAnalysis** — the three layers for one video:

- **`auto`** — `{ parametersHash, frames: TrackFrame[] }`. Immutable output of one tracking run,
  keyed by the parameters that produced it. Re-running tracking with the same parameters is a
  no-op; different parameters produce a new `auto` layer rather than mutating the old one.
- **`corrections`** — `{ entries: CorrectionEntry[] }`. Sparse human edits — point corrections,
  range tools, event corrections, trial-start adjustment, strategy override — each carrying
  `source: 'user'` and an ISO 8601 `timestamp` (D25). Never mutates `auto`.
- **`derived`** — `{ cleanedTrack, events, metrics, quality } | null`. Everything recomputed from
  `auto ⊕ corrections` on load: safe to discard and recompute at any time; never treated as the
  source of truth (D9, D20). `quality.pxPerCm` is this video's derived calibration value (D44).
  `null` for a video that has been tracked but not yet analysed (D52) — a placeholder or fabricated
  derived layer is forbidden (D16), so the honest value is a null.

```json
{
  "schemaVersion": 1,
  "toolVersion": "barnestrack v0.1.0 (a1b2c3d)",
  "name": "cohort3_day1",
  "videos": [
    {
      "id": "vid_01",
      "filename": "cohort3_day1_animal07.mp4",
      "fingerprint": { "byteLength": 88234112, "durationSeconds": 182.4, "frameCount": 5472, "sha256": "…" },
      "referenceResolution": { "width": 1280, "height": 720 },
      "mazeTransform": { "translateX": 0, "translateY": 0, "rotationDeg": 0, "scale": 1 },
      "metadata": { "animal": "07", "day": "1", "group": "control" }
    },
    {
      "id": "vid_02",
      "filename": "cohort3_day1_animal08.mp4",
      "fingerprint": { "byteLength": 84110336, "durationSeconds": 179.1, "frameCount": 5372, "sha256": "…" },
      "referenceResolution": { "width": 1280, "height": 720 },
      "mazeTransform": { "translateX": 0, "translateY": 0, "rotationDeg": 0, "scale": 1 },
      "metadata": { "animal": "08", "day": "1", "group": "control" }
    }
  ],
  "mazeMap": { "…": "see §4" },
  "parameters": { "…": "see §6" },
  "analyses": {
    "vid_01": {
      "auto": { "parametersHash": "3f1c…", "frames": ["…"] },
      "corrections": { "entries": [] },
      "derived": { "cleanedTrack": ["…"], "events": ["…"], "metrics": {}, "quality": {} }
    },
    "vid_02": {
      "auto": { "parametersHash": "3f1c…", "frames": ["…"] },
      "corrections": { "entries": [] },
      "derived": null
    }
  }
}
```

`vid_02` above has been tracked but not yet analysed: its `derived` is `null` (D52), and
`parameters` at the top level is only non-null once some video *has* been analysed (D51).

## 4. Maze map file (D10, D13, O8)

A parametric hole ring fit to a platform circle, reusable across videos by a similarity transform
so hole numbering stays consistent across a cohort.

| Field                 | Type                | Unit  | Notes                                                     |
| --------------------- | ------------------- | ----- | ------------------------------------------------------------ |
| `schemaVersion`       | `1`                  | —     | `MAZE_MAP_SCHEMA_VERSION`.                                    |
| `referenceResolution` | `{ width, height }` | px    | —                                                              |
| `platform`            | `{ cx, cy, r }`      | px    | Fit from three rim clicks or typed centre/radius.             |
| `holes.n`             | number               | —     | Default 20 (O8).                                               |
| `holes.ringRatio`     | number               | —     | Hole-ring radius ÷ platform radius. Default ≈ 0.89 (O8).       |
| `holes.holeRadius_px` | number               | px    | Default corresponds to 5 cm (O8).                              |
| `holes.phase_deg`     | number               | deg   | Angle of hole 0; set by one click on any hole.                 |
| `holes.offsets`       | HoleOffset[]?        | px    | Per-hole `{ holeIndex, dx_px, dy_px }` nudge, only when needed.|
| `target.holeIndex`    | number               | —     | —                                                              |
| `calibration.platformDiameter_cm` | number  | cm    | The one required calibration input (D14).                      |
| `createdFrom`         | string               | —     | Video id this map was originally fit from.                     |

```json
{
  "schemaVersion": 1,
  "referenceResolution": { "width": 1280, "height": 720 },
  "platform": { "cx": 640.2, "cy": 358.9, "r": 301.5 },
  "holes": { "n": 20, "ringRatio": 0.89, "holeRadius_px": 16.4, "phase_deg": 9.0 },
  "target": { "holeIndex": 7 },
  "calibration": { "platformDiameter_cm": 92 },
  "createdFrom": "vid_01"
}
```

## 5. Events (D8, D19; O1, O4)

| Field                  | Type                                  | Unit    | Notes                                                    |
| ---------------------- | -------------------------------------- | ------- | ----------------------------------------------------------|
| `id`                   | string                                  | —       | —                                                           |
| `kind`                 | enum                                    | —       | `investigation \| escape_entry \| tracking_failure`.        |
| `holeIndex`            | number \| null                         | —       | `null` for a failure away from any hole.                    |
| `isTarget`             | boolean                                 | —       | —                                                            |
| `startFrame`/`endFrame`| number                                  | —       | —                                                            |
| `startTime_s`/`endTime_s` | number                               | seconds | —                                                            |
| `durationSeconds`      | number                                  | seconds | —                                                            |
| `pointUsed`            | `'nose' \| 'centroid'`                 | —       | Nose when heading confidence ≥ cutoff (O16), else centroid.  |
| `minNoseDistance_cm`   | number \| null                         | cm      | Recorded whichever point was used (O1); `null` when the nose was never usable during the event (D55). |
| `minCentroidDistance_cm`| number                                 | cm      | Always recorded (O1).                                        |
| `evidence`             | string                                  | —       | Plain-language: last seen, loss duration, reappearance, blob-area trend. |
| `source`               | `'auto' \| 'corrected'`                | —       | —                                                            |
| `autoShadow`           | partial event?                         | —       | The automatic `holeIndex`/`startFrame`/`endFrame`, kept when a correction changes them. |

## 6. Parameters

Every threshold that changes a number — an event or cleaning threshold, the trial-censoring switch,
the search-strategy rule numbers and the quality-tier thresholds — lives in one `Parameters` value
(`src/contracts/parameters.ts`), never inline in analysis code (D55). Defaults and the one-sentence
definitions the UI shows verbatim live in the single configuration module
`src/analysis/parameters.ts` (`DEFAULT_PARAMETERS`, `PARAMETER_DEFINITIONS`, `PARAMETER_UNITS`,
`PARAMETER_DECISIONS`, keyed by dotted path); the value is hashed into `parametersHash`, embedded in
every export and drives live recomputation (D20). Spatial thresholds are centimetres or multiples of
the hole radius, converted per video from the maze calibration (D14, D44); temporal thresholds are
seconds applied to each frame's own timestamp (D7).

### Analysis parameters (O1–O17, D30)

| Field                                  | Unit               | Default | Definition                                                                                                                      | From |
| -------------------------------------- | ------------------ | ------- | ------------------------------------------------------------------------------------------------------------------------------- | ---- |
| `holeInvestigation.radiusFactor`       | × hole radius      | 1.5     | An investigation is counted while the event point (nose when its heading confidence clears the cutoff, else centroid) is within this multiple of the hole radius of a hole centre. | O1 |
| `holeInvestigation.minDuration_s`      | s                  | 0.2     | Time at a hole, first to last frame within the radius, that a bout needs to count as an investigation.                           | O1 |
| `holeInvestigation.mergeGap_s`         | s                  | 0.5     | Bouts at the same hole separated by less than this merge into one investigation; a longer gap makes the return a separate event. | O1 |
| `escapeEntry.radiusFactor`             | × hole radius      | 1.0     | An escape-box entry is a loss of detection whose last-seen event point was within this multiple of the hole radius of the target. | O4 |
| `escapeEntry.minDuration_s`            | s                  | 1.0     | A loss must last at least this long, with no reappearance away from the hole, to be an entry; at a non-target hole it is an investigation flagged physically unlikely; elsewhere it is a tracking failure. | O4 |
| `escapeEntry.persistCutoff_s`          | s                  | 3       | The trial ends at the first entry lasting at least this long or to the end of the video; total latency is its first lost frame.  | O4 |
| `trialCutoff_s`                        | s                  | 180     | The trial ends this long after the trial start without an entry: total latency blank, `escaped` false, status `review`.          | O5 |
| `targetQuadrant.holeSpan`              | holes              | 2.5     | The target quadrant reaches this many hole spacings either side of the target hole (2.5 on a 20-hole ring = 90°).               | O6 |
| `kinematicsSmoothingWindowFrames`      | frames             | 3       | Median filter width applied to centroid positions for path length and speed only; stored track and events use raw positions.    | O9 |
| `gapFilling.enabled`                   | on/off             | on      | Whether short gaps in the derived track are filled linearly; filled points are marked `filled`, drawn hollow and counted.        | O10 |
| `gapFilling.maxDuration_s`             | s                  | 0.1     | Only gaps no longer than this (between the positioned frames either side) are filled, never when either side is within one hole radius of a hole. | O10 |
| `kinematics.speedWindowFrames`         | frames             | 2       | Speed at a frame is the path over the centred window of this many frames either side, over the span of their timestamps.         | O11 |
| `kinematics.duplicateTimestampFactor`  | × nominal interval | 0.25    | Consecutive frames closer in time than this fraction of the nominal interval carry a duplicate stamp: skipped for speed and the outlier test, kept for path length. | O11 |
| `kinematics.dropGapFactor`             | × nominal interval | 1.5     | Consecutive frames farther apart than this multiple of the nominal interval are a dropped-frame gap: counted, path keeps the straight segment. | O11 |
| `noseConfidenceCutoff`                 | 0–1                | 0.5     | Events use the nose when its heading confidence is at least this (or it was placed by hand), otherwise the centroid; `pointUsed` records which. | O16 |
| `outlierVelocityThreshold_cmPerS`      | cm/s               | 150     | A centroid moving faster than this from the previous positioned frame is an outlier: marked invalid, kept, never replaced.        | O17 |
| `trialCensoring.censorToCutoff`        | on/off             | off     | Report the cutoff as total latency for a trial that never reached the escape box, for statistics; `escaped` stays false and the status stays `review`. | O5 |
| `strategy.spatialMaxErrors`            | count              | 3       | Spatial: at most this many non-target investigations before the target.                                                          | O7 |
| `strategy.spatialMaxHoleDistance`      | holes              | 2       | Spatial: every error hole within this many holes of the target around the ring.                                                  | O7 |
| `strategy.spatialMaxCentreCrossings`   | count              | 1       | Spatial: at most this many entries into the centre zone before the target.                                                       | O7 |
| `strategy.serialMinRun`                | count              | 3       | Serial: a run of at least this many adjacent-hole investigations with no centre crossing during it, before or ending at the target visit. | O7 |
| `strategy.centreZoneRadiusFraction`    | fraction           | 0.5     | The centre zone is the disc of this fraction of the platform radius; entering it between two investigations is one centre crossing. | O7 |
| `quality.goodMinPositionedFraction`    | fraction           | 0.9     | GOOD when at least this fraction of trial frames were positioned by the tracker (tracked or low confidence; filled frames do not count). | D30 |
| `quality.poorMaxPositionedFraction`    | fraction           | 0.7     | POOR below this fraction; REVIEW between the two.                                                                                | D30 |

The nominal frame interval used by the O11 and O17 rules is the median of the positive
timestamp differences over the whole track, computed once per derive run. The eight thresholds
after O17 joined `Parameters` under D55: they are hashed and travel on the parameters sheet and in
`parameters.json`, but they are not `trials.csv` columns (D11's column rule covers event-defining
thresholds; the readme sheet says so, as it does for the O9 smoothing window).

### Maze defaults (O8)

`MAZE_DEFAULTS` in the same module: 20 holes, ring ratio 0.89, hole diameter 5 cm, platform diameter
hint 92 cm. `src/maze/ring.ts` re-exports them under its original names.

### Strategy rule order (O7, D23)

The strategy rules are tried in the order spatial, serial, random; the first rule to fire is the
classification, a later rule that also fired is reported as "fired, outranked", and the runner-up
is the rule that would fire next.

Fixed model constants (`ANALYSIS_MODEL`, not user-adjustable): the blob-area trend window before a
loss (10 frames), the minimum smoothed step that contributes heading change to tortuosity (1 cm),
and the nose-confidence histogram bin count (5).

### Hashing (D51)

`hashParameters(p)` and `hashTrackingParameters(p.tracking)` are the lower-case hex SHA-256 of the
canonical JSON of the value: object keys sorted by UTF-16 code unit, arrays in their order, no
whitespace, scalars exactly as `JSON.stringify` writes them, `undefined` properties dropped, hashed
as UTF-8 bytes. The tracking hash keys the `auto` layer; the full hash keys the `derived` layer and
stamps every export. Any other implementation (chunk 4's auto-layer writer) must match byte for byte.

### Derived-layer definitions

- **Derived reason strings.** Besides the tracker's eight, the derived track uses `outlier_velocity`
  (O17; `detectionState: 'ambiguous'`, both points `valid: false` with their coordinates kept, never
  replaced), `not_visible` and `in_escape_box` (range corrections; `detectionState: 'not_detected'`,
  points invalid at (0, 0) with `source: 'corrected'`), and `corrected` (a hand-placed centroid:
  `detectionState: 'tracked'` when the placed point is valid, `'not_detected'` when the user
  declared it invalid, so the state fractions, the tier and the gaps follow the correction; a
  nose-only correction leaves the state and reason as the tracker set them).
- **Filled points** (O10) carry `source: 'filled'` on the centroid only, linearly interpolated in
  time between the positioned frames either side; the nose stays invalid and `detectionState` /
  `reason` keep the tracker's values. Gaps that touch an outlier or contain a hand-corrected point are
  never filled. The automatic layer never contains a filled point (D16).
- **Not-recorded numbers.** `trialStart_s` (no trial start), `meanSpeed_cmPerS` (no tracked
  time) and `minNoseDistance_cm` (the nose was never usable during the event) are `null` in the
  contract when they cannot exist (D55). A `number` field the contract still types as plain
  `number` but that cannot always be computed (`minCentroidDistance_cm` of a loss with no
  positioned approach frame, the kinematics fractions of an empty trial) is `NaN`, which JSON
  serialises as `null`; consumers treat non-finite and `null` alike (`isRecorded()`) and a CSV
  writer emits an empty cell for either.
- **Event ids and correction matching.** Automatic ids are deterministic from content:
  `auto-<kind>-h<holeIndex|x>-f<startFrame>`; user-added events are `user-<correctionId>`. An event
  correction matches its automatic event by exact id first; otherwise by the automatic event of the
  same kind and hole whose frame span contains the start frame named in the id (an `edit` also
  matches an overlap with its own new span); otherwise it is orphaned — an orphaned `edit` still
  produces its corrected event, pinned, without `autoShadow`; an orphaned `delete` is reported as a
  review flag, never a silent resurrection. Corrections apply in `timestamp` then `id` order.
- **Durations.** For every event kind `durationSeconds = endTime_s − startTime_s`, first to last
  frame of the event; the O1 and O4 minimum-duration tests use the same quantity. A quality-report
  gap's `durationSeconds` is the time between the positioned frames either side of it (the
  unpositioned time), the same quantity O10 tests against `gapFilling.maxDuration_s`.
- **Readings of O3 and O9 in the metrics.** `primaryLatency_s` ends at the first target event of
  either kind — the first target investigation (O3) or, when the animal enters without a detected
  investigation, the escape entry — so primary latency never exceeds total latency.
  `meanSpeed_cmPerS` is the smoothed path (O9) over the tracked time within the trial.
- **Trial window.** Investigations are detected between the trial start and the trial end, so
  one still in progress at a cutoff ends there and says so in its evidence; an escape entry or a
  tracking failure keeps the span of its loss. When an event correction deletes or moves the first
  persistent escape entry, detection runs again with the corrected trial end (a bounded number of
  passes, so a later persistent entry revealed by the change can end the trial instead); an entry
  moved before the trial start can never end it (D21) and is flagged for review. Only events that
  begin inside the trial count toward errors and latencies (O2, O3): a user-added event outside it
  is kept as annotation and says so.
- **Scopes.** `TrialMetrics.trackedFraction` counts frames with `detectionState: 'tracked'` only, as
  the contract says; the quality tier counts frames the tracker positioned (tracked or low
  confidence), so the two numbers differ by the low-confidence share and neither counts filled
  frames. Both, and the quality report's state fractions and gaps, are judged over the trial window (trial start to trial end) when a trial start exists, and over
  the whole video otherwise, so that an empty platform before the animal is placed does not count
  against the video; the timebase anomalies are properties of the file and are always whole-video,
  recounted from the frame timestamps with the session's O11 factors (the MP4 index counts exact
  ties with its own factor).

**The hash (D51).** `parametersHash` is the lowercase hex SHA-256 of the *canonical JSON* of the
value. Canonical means: object keys sorted ascending by code unit at every level; no whitespace
anywhere; array order preserved, because order is part of the value; `undefined` members omitted,
exactly as `JSON.stringify` omits them; numbers written as `JSON.stringify` writes them. Two layers
whose hashes match were produced by the same parameters, so a hash that differed by a byte between
two implementations would silently invalidate stored work — there is therefore one implementation,
`hashParameters` / `hashTrackingParameters` in `src/analysis/parameters.ts`, and everything else
(the tracking queue, the session store, the exports) imports it rather than deriving its own.

Which value is hashed depends on the layer: the `auto` layer is keyed by the hash of
`parameters.tracking` alone, since nothing outside the tracking block changes a tracking run; the
`derived` layer and the export stamp are keyed by the hash of the whole `Parameters` value. Changing
an event threshold therefore invalidates the analysis but not an hour of tracking.

### Tracking parameters (`parameters.tracking`, D6)

The thresholds of the tracking pass, added to `Parameters` without a schema bump (no schema-1
session file had been written when they were added). Defaults and the one-line definitions the UI
shows verbatim live in `src/analysis/tracker/params.ts`; every centimetre value is converted to
pixels per video from the platform calibration (D14, D44) in `src/analysis/tracker/calibration.ts`
and nowhere else. Like every other parameter they are hashed into `parametersHash` and travel with
every export.

| Field                     | Type                         | Unit   | Default | Definition                                                                                         |
| ------------------------- | ---------------------------- | ------ | ------- | -------------------------------------------------------------------------------------------------- |
| `backgroundSampleCount`   | number                       | frames | 150     | Frames spaced uniformly across the video whose per-pixel median is the background.                 |
| `backgroundExcludeRanges` | `{ startFrame, endFrame }[]` | frames | `[]`    | Inclusive frame ranges never used as background samples (stationary animal or object).             |
| `platformMaskMargin_cm`   | number                       | cm     | 1.5     | Platform disc grown outward by this margin; foreground is searched only inside the grown disc.     |
| `threshold.mode`          | `otsu \| manual`             | —      | `otsu`  | Otsu: chosen once per video from the sample frames' background-minus-frame histogram.              |
| `threshold.manualValue`   | number                       | 1–255  | 40      | Smallest background-minus-frame difference counted as foreground when `mode` is `manual`. `createTracker` rejects a threshold outside 1–255: at 0 every pixel is foreground. |
| `minBlobArea_cm2`         | number                       | cm²    | 4       | Components smaller than this are ignored.                                                          |
| `maxBlobArea_cm2`         | number                       | cm²    | 80      | Components larger than this are never the animal: the frame is `ambiguous / oversized_blob`.       |
| `expectedBlobArea_cm2`    | number \| null               | cm²    | `null`  | Expected body area after tail removal; `null` learns the median of the video's unambiguous frames. |
| `oversizedBlobFactor`     | number                       | ×      | 3       | A component above this multiple of the expected area marks the frame `ambiguous / oversized_blob`. |
| `smallBlobFactor`         | number                       | ×      | 0.5     | A selected blob below this fraction of the expected area is `low_confidence / small_blob`.         |
| `tailOpeningRadius_cm`    | number                       | cm     | 0.8     | Disc radius of the morphological opening that strips the tail before the centroid is taken.        |
| `noseCueWindowFrames`     | number                       | frames | 3       | Half-width of the centred window over which centroid velocity is measured as a head cue.           |
| `noseMovingSpeed_cmPerS`  | number                       | cm/s   | 8       | Below this centroid speed the velocity cue is unavailable and the hole cue may apply.              |
| `rimContactMargin_cm`     | number                       | cm     | 1.0     | A blob with any pixel within this distance of the platform edge, or beyond it, is `partial_at_rim`. |
| `proximityRadius_cm`      | number                       | cm     | 6       | With several plausible blobs, tracked only if exactly one lies within this of the last centroid.   |
| `fragmentMergeDistance_cm` | number                      | cm     | 8       | Plausible pieces whose centroids all lie within this of each other are one animal, `low_confidence / fragmented`, when the union satisfies the single-blob area bounds (one body length; D48). |

The per-frame `reason` strings the tracker emits are fixed (`src/analysis/tracker/select.ts`):
`single_blob`, `proximity_to_previous` (tracked); `no_foreground` (not_detected); `multiple_blobs`,
`oversized_blob` (ambiguous); `partial_at_rim`, `small_blob`, `fragmented` (low_confidence; D48). The quality report
clusters on them (D8, D30).

## 7. Export schema (D11)

Three tidy CSVs, `snake_case` names with unit suffixes, no comment rows, plus `parameters.json`, the
session file, and one XLSX with the same sheets plus `parameters` and `readme`. Every row carries
`tool_version`, `schema_version` and `parameters_hash` (`EXPORT_SCHEMA_VERSION = 1`).

### `trials.csv` — one row per trial

| Column | Unit | Source |
| --- | --- | --- |
| `session_id`, `video_id`, `animal`, `day`, `trial_label`, `group` | — | identifiers / O12 metadata |
| `trial_start_s` | s (nullable: no trial start) | O5 |
| `primary_latency_s` | s (nullable) | O3 |
| `total_latency_s` | s (nullable) | O4 |
| `primary_errors`, `total_errors` | count | O2 |
| `path_length_cm`, `path_length_smoothed_cm` | cm | O9 |
| `mean_speed_cm_per_s` | cm/s (nullable: no tracked time) | O9 |
| `target_quadrant_time_s` | s | O6 |
| `strategy`, `strategy_source` | — | O7 |
| `escaped` | bool | O4 |
| `status` | — | `ok \| review \| unresolved` (O5) |
| `tracked_fraction` | 0–1 | — |
| `correction_count` | count | — |
| `hole_investigation_radius_factor`, `hole_investigation_min_duration_s`, `hole_investigation_merge_gap_s` | ×hole radius, s, s | O1 |
| `escape_entry_radius_factor`, `escape_entry_min_duration_s`, `escape_entry_persist_cutoff_s` | ×hole radius, s, s | O4 |
| `trial_cutoff_s` | s | O5 |
| `target_quadrant_hole_span` | holes | O6 |
| `gap_fill_max_duration_s` | s | O10 |
| `nose_confidence_cutoff` | 0–1 | O16 |
| `outlier_velocity_threshold_cm_per_s` | cm/s | O17 |
| `tool_version`, `schema_version`, `parameters_hash` | — | D12 |

### `events.csv` — one row per investigation or entry

| Column | Unit | Source |
| --- | --- | --- |
| `session_id`, `video_id`, `trial_label`, `event_id` | — | identifiers |
| `kind` | — | `investigation \| escape_entry` |
| `hole_index` (nullable), `is_target` | —, bool | — |
| `start_frame`, `end_frame` | — | D7 |
| `start_time_s`, `end_time_s`, `duration_s` | s | D7 |
| `point_used` | — | `nose \| centroid` (O16) |
| `min_nose_distance_cm` (nullable: nose never usable), `min_centroid_distance_cm` | cm | O1 |
| `evidence_summary` | — | D19 |
| `source` | — | `auto \| corrected` |
| `auto_hole_index`, `auto_start_frame`, `auto_end_frame` (nullable) | — | shadow columns, populated only when `source = corrected` |
| `tool_version`, `schema_version`, `parameters_hash` | — | D12 |

### `quality.csv` — one row per video

| Column | Unit | Source |
| --- | --- | --- |
| `session_id`, `video_id` | — | identifiers |
| `tracked_fraction`, `not_detected_fraction`, `ambiguous_fraction`, `low_confidence_fraction` | 0–1 | D30 |
| `gap_count`, `longest_gap_s` | count, s | D30 |
| `duplicate_timestamp_count`, `dropped_frame_gap_count`, `drift_s` | count, count, s | D7, O11 |
| `platform_diameter_cm` | cm | D14 |
| `px_per_cm` | px/cm | this video's calibration, derived from the maze map's platform radius after its transform (D44) |
| `tier` | — | `GOOD \| REVIEW \| POOR` |
| `tool_version`, `schema_version`, `parameters_hash` | — | D12 |
