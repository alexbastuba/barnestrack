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

## 1. Frame identity and time (D7)

A frame's identity is its position in the MP4 sample table, sorted by presentation time — not a
nominal-rate index. Its time in seconds comes from that same table (composition time minus the
edit-list offset, over the track timescale). All three sample videos contain duplicate
presentation timestamps and dropped-frame gaps; one drifts 0.43 s from `frame ÷ fps` by its end, so
nominal-rate arithmetic is never used for frame time. Decoder output frames are identified by
output order using synthetic, monotone timestamps — never by matching a decoded frame back to the
sample table by timestamp value, which would collapse the duplicates.

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
| `reason`                | string          | —       | Why `detectionState` took this value.                                |
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
  "reason": "single blob within area prior",
  "blobArea_px2": 842,
  "boundingBox": { "x": 498, "y": 360, "width": 46, "height": 40 },
  "noseHeadingConfidence": 0.58
}
```

## 3. Session file (D9, D27, D28, D44)

One JSON document per session (cohort): a video list, a shared maze map with a per-video
transform, shared parameters, and per-video analyses in three layers.

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
| `videos`        | VideoDescriptor[]                        | See below.                                                 |
| `mazeMap`       | MazeMapFile                              | Shared across the cohort. See §4.                          |
| `parameters`    | Parameters                               | Every event/cleaning threshold. See §6.                    |
| `analyses`      | `Record<videoId, VideoAnalysis>`         | See below.                                                 |

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
- **`derived`** — `{ cleanedTrack, events, metrics, quality }`. Everything recomputed from
  `auto ⊕ corrections` on load: safe to discard and recompute at any time; never treated as the
  source of truth (D9, D20). `quality.pxPerCm` is this video's derived calibration value (D44).

```json
{
  "schemaVersion": 1,
  "toolVersion": "barnestrack v0.1.0 (a1b2c3d)",
  "videos": [
    {
      "id": "vid_01",
      "filename": "cohort3_day1_animal07.mp4",
      "fingerprint": { "byteLength": 88234112, "durationSeconds": 182.4, "frameCount": 5472, "sha256": "…" },
      "referenceResolution": { "width": 1280, "height": 720 },
      "mazeTransform": { "translateX": 0, "translateY": 0, "rotationDeg": 0, "scale": 1 },
      "metadata": { "animal": "07", "day": "1", "group": "control" }
    }
  ],
  "mazeMap": { "…": "see §4" },
  "parameters": { "…": "see §6" },
  "analyses": {
    "vid_01": {
      "auto": { "parametersHash": "p_9f2a", "frames": ["…"] },
      "corrections": { "entries": [] },
      "derived": { "cleanedTrack": ["…"], "events": ["…"], "metrics": {}, "quality": {} }
    }
  }
}
```

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
| `minNoseDistance_cm`   | number                                  | cm      | Always recorded, whichever point was used (O1).              |
| `minCentroidDistance_cm`| number                                 | cm      | Always recorded (O1).                                        |
| `evidence`             | string                                  | —       | Plain-language: last seen, loss duration, reappearance, blob-area trend. |
| `source`               | `'auto' \| 'corrected'`                | —       | —                                                            |
| `autoShadow`           | partial event?                         | —       | The automatic `holeIndex`/`startFrame`/`endFrame`, kept when a correction changes them. |

## 6. Parameters

Every event-defining or cleaning threshold lives in one `Parameters` value (`src/contracts/parameters.ts`), never
inline in analysis code. It is hashed into `parametersHash`, embedded in every export, and drives
live recomputation (D20). The full default values and the single configuration module that owns
them are added in chunk 5 — this section is a placeholder until then; the shape (which fields
exist) is fixed by `src/contracts/parameters.ts` today.

## 7. Export schema (D11)

Three tidy CSVs, `snake_case` names with unit suffixes, no comment rows, plus `parameters.json`, the
session file, and one XLSX with the same sheets plus `parameters` and `readme`. Every row carries
`tool_version`, `schema_version` and `parameters_hash` (`EXPORT_SCHEMA_VERSION = 1`).

### `trials.csv` — one row per trial

| Column | Unit | Source |
| --- | --- | --- |
| `session_id`, `video_id`, `animal`, `day`, `trial_label`, `group` | — | identifiers / O12 metadata |
| `trial_start_s` | s | O5 |
| `primary_latency_s` | s (nullable) | O3 |
| `total_latency_s` | s (nullable) | O4 |
| `primary_errors`, `total_errors` | count | O2 |
| `path_length_cm`, `path_length_smoothed_cm` | cm | O9 |
| `mean_speed_cm_per_s` | cm/s | O9 |
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
| `point_used` | — | `nose \| centroid` (O16, O18) |
| `min_nose_distance_cm`, `min_centroid_distance_cm` | cm | O1 |
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
