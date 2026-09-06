# Design decisions

This file is the record of design decisions for BarnesTrack. Each entry has a status:

- **CLOSED** — decided. Changing it means adding a new entry that supersedes the old one, not editing history.
- **OPEN** — a provisional default is in effect, exposed as a parameter in the UI and embedded in every export, so results stay reproducible while the default is under review. Each OPEN entry names what will close it.

Data contracts (track representation, session file, maze map, CSV/XLSX schema) are described in `docs/data-contracts.md`; changing one requires a schema version bump and an entry here.

## Closed decisions

Grouped by area. Each entry: the decision, then one line of rationale. Sweep-era working IDs are not used here; references are to this file's D- and O-numbers.

### Scope and platform

**D1 · Task scope.** Barnes maze pipeline only, built deeply. — One tool that a facility can actually adopt beats three sketches.

**D2 · Fully static, client-side page.** No server, no accounts, no API keys, and zero runtime network requests (no CDN scripts, fonts, analytics). The single exception is a user-initiated "fetch a sample clip" button that downloads a clip from the public sample-data repository into the browser. — Makes "what leaves the user's machine" answerable as *nothing* and verifiable from the browser's network tab; works on an offline lab laptop.

**D3 · Stack.** Vite + TypeScript, no UI framework (DOM + `<canvas>`), Vitest, ESLint + Prettier, all dependencies pinned to exact versions, `mp4box.js` and `exceljs` as the only runtime libraries. — The correction UI is canvas-bound, where a framework adds little; TypeScript turns the data contracts into checked types; fewer moving parts to keep working on a fresh clone.

**D4 · Browser support.** WebCodecs (`VideoDecoder`) is required: Chrome/Edge ≥ 94, Safari ≥ 16.4, Firefox ≥ 130. The page detects support at load and names supported browsers in plain language; there is no `<video>`-element fallback. — Only a decoder fed from the MP4 sample table can address every frame of the sample videos (see D6); a second, lower-fidelity path would weaken "traceable to source frames". Old hardware is not old browsers: Chrome software-decodes H.264 without a GPU.

**D5 · Threading.** A dedicated Web Worker owns the tracking pass (demux → decode → per-frame analysis, streaming progress). The frame viewer uses its own decoder instance on the main thread over the same file and the same sample-table code. — Keeps the UI responsive during a 5,500-frame pass; avoids the class of seek-desync bugs that come from sharing one decoder between playback and analysis.

**D6 · Tracking approach: classical computer vision.** Per-pixel temporal-median background over frames sampled across the video; foreground = background − frame restricted to the platform disc (plus margin); Otsu threshold with a live preview; connected components with an area prior and proximity to the previous position; morphological opening to strip the tail; centroid from the body mask; nose from the body ellipse's major axis with the head end chosen by tail direction, motion direction and hole proximity. Every step is explainable in the UI and runs at hundreds of frames per second on a CPU. — Chosen, not forced: segmentation models and pose estimators are legitimate, but CPU inference at 0.2–3 s per frame cannot process three videos while a user watches, a mask still leaves the nose to be inferred from shape, and no browser path exists for the pose models that would help. The named-point contract (D8) admits imported model tracks later. If this approach fails on a sample video, the fallback order is: tighter platform mask and per-video threshold → adaptive threshold on the raw frame → in-browser ONNX/WASM segmenter, recorded as a new decision — never a server.

### Data contracts (schema version 1; details in `docs/data-contracts.md`)

**D7 · Frame identity and time.** A frame is its position in the MP4 sample table sorted by presentation time; its time in seconds comes from that table (composition time minus the edit-list offset, over the track timescale). Nominal frame rate is display-only. Decoder outputs are identified by output order using synthetic, unique, monotone timestamps, never by matching real timestamps back to the table. — All three sample videos contain duplicate presentation timestamps and dropped-frame gaps (one drifts 0.43 s from `frame ÷ fps` by its end); timestamp matching would collapse the duplicates.

**D8 · Track representation.** Per frame: `t_s`; named points `centroid` and `nose`, each `{x, y, confidence, valid, source}` with `source ∈ {auto, corrected, filled, imported}`; a `detectionState ∈ {tracked, not_detected, ambiguous, low_confidence}` with a `reason`; blob area, bounding box and nose-heading confidence. Never a bare (x, y). The automatic layer never contains interpolated points. — The reason string is what lets the quality report cluster failures and lets event detection separate "lost at a hole" from "lost in the open".

**D9 · Session file.** One JSON document per session (cohort) with `schemaVersion`, tool version, video descriptors with a content fingerprint, the maze map, calibration, parameters, and per video three layers: `auto` (immutable output of a tracking run, keyed by a parameters hash), `corrections` (sparse human edits to points, ranges, events, trial bounds and strategy, each with `source: user` and a timestamp), and `derived` (everything recomputed from `auto ⊕ corrections` on load: cleaned track, events, metrics, quality). — Provenance becomes structural: automatic values are never mutated, "revert to automatic" is free, and re-tracking never destroys human work. A SLEAP `.slp` file was considered and rejected as the session format: it is HDF5 (browser writing needs a WASM library) and has no place for events, corrections, ROIs, parameters or per-frame timing.

**D10 · Maze map file.** `{schemaVersion, referenceResolution, platform: {cx, cy, r}, holes: {n, ringRatio, holeRadius_px, phase_deg, offsets?}, target, calibration: {platformDiameter_cm}, createdFrom}`. Parametric ring with optional per-hole nudges; applying a map to another video is a similarity fit (translate / rotate / scale) from at most three clicks. — Hole 7 stays hole 7 across videos, which cohort comparisons need, and the whole map moves with a handful of clicks instead of twenty.

**D11 · Export schema.** Three tidy CSVs — `trials.csv` (one row per trial: identifiers, latencies, errors, path length, speed, quadrant time, strategy and its source, `escaped`, `status ∈ {ok, review, unresolved}`, tracked fraction, correction counts, every event-defining threshold as a column, tool version, schema version, parameters hash), `events.csv` (one row per investigation or entry: hole, target flag, start/end frame and time, duration, `point_used`, minimum nose distance, minimum centroid distance, evidence summary, `source`, and the automatic values as shadow columns when corrected), `quality.csv` (per video: state fractions, gaps, timebase anomalies, calibration) — plus `parameters.json`, the session file, and one XLSX with the same sheets plus `parameters` and `readme`. `snake_case` names with unit suffixes; no comment rows. — "Understand without a legend"; thresholds travel with the numbers so two cohorts can be reconciled six months later. Events carry both distances so a proximity-weighted investigation rule can be added without a schema change.

**D12 · Versioning.** `barnestrack v0.MINOR.PATCH (git-sha7)` injected at build time; a separate `schemaVersion` for the session, maze map and CSV formats; all embedded in every export and shown in the UI footer. — Any number can be tied to the code and schema that produced it.

### ROI and calibration

**D13 · Platform and holes.** Platform circle from three rim clicks (least-squares fit) or centre/radius fields, nudged by arrow keys; hole ring generated parametrically from the circle (count, ring ratio, hole radius); one click on any hole sets the ring phase; one click or a typed number sets the target; per-hole nudge only when a hole is visibly off. Budget: at most six clicks for a new video, at most three with a reused map, with the count shown on screen. — Twenty holes × sixty videos must not be twelve hundred clicks.

**D14 · Calibration and units.** One required input, platform diameter in centimetres; every spatial parameter is stored in centimetres and every temporal parameter in seconds, converted per video. — Thresholds transfer between videos with different zoom or frame rate; centimetres and seconds are what papers report.

**D15 · Coordinates.** All ROI and track coordinates are stored in native video pixels (y down) with the reference resolution; zoom and pan are a view transform only. — Stored data never depends on how the page was displayed.

### Tracking, cleaning, events, metrics

**D16 · Failure semantics.** The automatic layer never interpolates; every non-tracked frame carries a state and a reason. Cleaning may produce `filled` points in the derived layer only, marked, drawn distinctly and counted. — Honest uncertainty over plausible lies.

**D17 · Tracking feedback.** Progress bar with frames per second and time remaining, a live overlay thumbnail during the pass, a plain-language summary line on completion, a cancel button; tracking runs in the background while the user works on another video, with a "track all untracked" queue. — A user will not wait without a reason to trust the wait.

**D18 · Nose and centroid.** Both points are always tracked; events use the nose when its heading confidence clears a visible cutoff (O16) and the centroid otherwise, recording `point_used` per event; path length and speed always use the centroid. If measured nose accuracy on the sample videos is poor, the nose ships labelled experimental and events default to the centroid. — A confident wrong nose is worse than an honest centroid.

**D19 · Event rule set.** Investigation, escape-box entry and tracking failure are distinguished by evidence: where the animal was last seen, how long detection was lost, whether it reappeared and where, and the blob-area trend before the loss. Each event shows this evidence and seeks to its first frame on click. Thresholds are defined in O1–O5. — The line between "investigated" and "went in" is drawn from evidence the user can inspect.

**D20 · Live recompute.** Parameters drive pure functions over `auto ⊕ corrections`; every change re-renders the event track, event list and metrics with a diff badge; user-corrected events stay pinned through parameter changes and can be unpinned. — The consequence of a threshold is visible the moment it changes.

**D21 · Trial bounds.** Trial start is auto-proposed (O5), shown as a marker and correctable; trial end is the escape entry or the cutoff; all latencies are measured from trial start, never from frame 0. — One sample video starts with an empty platform.

**D22 · Analysis as pure functions.** Cleaning, event detection, metrics, strategy classification and the quality report are pure functions over the internal representation with no DOM or video dependency, unit-tested with synthetic trajectories of known answer. — Corrections propagate by recompute; the same functions serve exports and any future agent interface.

**D23 · Strategy classification.** A transparent rule engine over named features (O7) that shows the feature values, the rule that fired and the runner-up, with a user override and free-text reason stored as a correction. Dimensionality-reduction or embedding views are excluded from the core product. — "Show the user why" needs a reason a student can read aloud, not a position in a scatter plot.

### Correction, persistence, sessions

**D24 · Timeline.** Stacked tracks (detection state, confidence, events with hole numbers as text, corrections, trial markers) above a frame-accurate scrubber on one shared time axis with a zoom window; full keyboard navigation (±1, ±10, home/end, next/previous flagged run, next event, frame-number entry); clicking any track seeks. — The interaction model researchers already know from SLEAP's timeline.

**D25 · Corrections.** Point corrections (click or arrow-nudge a named point), range tools ("animal not visible here", "animal in escape box from here"), event corrections (hole, start/end, delete, add), trial-start adjustment and strategy override; stored sparsely in the corrections layer with "revert to automatic" per item; single-frame corrections remain visible on the timeline at any zoom. — Every correction is small, reversible and attributable.

**D26 · Automatic vs corrected, visibly.** Shape + colour + text, never colour alone: automatic = filled marker; corrected = diamond with an edit badge; filled = hollow dashed marker; corrected events hatched with a "user" tag; `source` columns in every table and export; correction counts per trial. — Distinguishable in grayscale and by screen reader.

**D27 · Persistence.** Autosave to IndexedDB on every change, keyed by video fingerprint, plus explicit save/load of the session file. After a reload the video is re-attached by dropping the same file; all ROIs, tracks, corrections and results are already present. — Losing forty minutes to a refresh is how tools get abandoned; the session file is the portable, re-analysable record.

**D28 · Session model.** A session is a cohort: a video list, a shared maze map with per-video transform, shared parameters, per-video analyses and editable metadata (animal, day, trial, group). Intake by drag-and-drop or folder selection, filtered to video files; unsupported files are listed with the reason, never silently dropped. — Cohort-level plots and exports need cohort-level structure.

**D29 · Second video faster, visibly.** Map reuse with a ≤ 3-click fit, shared calibration and thresholds, expected animal size learned from the first tracked video, one-click "track all untracked", and an on-screen click count for the maze step. — The criterion is demonstrated, not just true.

### Quality, visualisation, export, demo

**D30 · Quality report.** Fractions per detection state; gaps run-length-clustered with location class (at hole *k* / open platform / rim) and the longest gap; nose-confidence distribution; timebase anomalies (duplicate timestamps, dropped-frame gaps, drift versus nominal rate); calibration and parameters hash; a GOOD / REVIEW / POOR tier per video. Rendered as a timeline strip, a table and `quality.csv`. — The user knows whether to trust a video before building a figure on it.

**D31 · Cleaning shown, not applied invisibly.** Gap filling, smoothing and outlier marking (O9–O11, O17) are shown as before/after overlays with counts. — The task's own words.

**D32 · Visualisations.** Trajectory overlay on the background frame, time-coloured and speed-coloured paths, occupancy heatmap, hole-visit raster, target-quadrant overlay, quality strip; per-animal learning curve and group comparison once two or more videos carry metadata. PNG export at 2× and 3× with `viridis` / `cividis` colour maps and text labels on every figure. — Figures that survive a grayscale printer and a journal's resolution requirement.

**D33 · Demo state.** A "Load example cohort" button loads bundled precomputed sessions for the three sample videos plus one derived still per video, so every result renders without a video attached; a banner explains how to attach the video for frame-level work, and an optional button fetches one small clip from the public sample-data repository. No sample video is stored in this repository. — Working demo state within a minute of opening the page, without redistributing the data.

**D34 · Hosting.** Static build deployed on every push to `main`; the deployment does not depend on repository visibility. — The live URL is always the tested build.

### Engineering process

**D35 · Testing.** Vitest for every pure layer (sample-table parser against committed per-frame timestamps derived from `ffprobe`, synthetic trajectories for events/metrics/strategy, session round-trip, correction propagation, CSV headers and units); tracker tests on synthetic frames generated in code; a Node integration test that pipes `ffmpeg` raw grayscale frames into the same tracker module, run locally when the sample-data path is set and skipped otherwise. No video files are committed; any clip fixtures are generated in CI with `ffmpeg`. — The computer-vision code is testable without a browser, and the repository stays small.

**D36 · Continuous integration.** Lint, typecheck, unit tests and build on every push; browser smoke tests added if time allows, with a stated note when a check is verified manually instead. — A fresh clone has to build and run the first time; green CI is the evidence.

**D37 · Accessibility, per feature.** Keyboard operability for every step, visible focus, labelled canvases and controls, a live region for status, no meaning in colour alone, usable at 200 % zoom, DOM tables mirroring what the canvases draw. — Required by the brief and checked as each feature lands, not at the end.

**D38 · Reuse and attribution.** Patterns from `talmolab/vibes` (BSD-3-Clause, commit `d9410fa`) are re-implemented in TypeScript with a header comment naming the source tool; `THIRD_PARTY_NOTICES.md` lists vibes, `mp4box.js` and `exceljs`; the README names what was borrowed and what was rewritten and why. Borrowed: the sample-table frame-identity model, keyframe-window decoding and `avcC` decoder configuration (`video-player`); the two-layer canvas with screen-to-video transform and device-pixel-ratio handling (`labelroi`); the row model and paint-style editing operations (`event-annotator`); the worker-side demux/decode core (`slp-viewer`). Ideas only: quality tiers (`quality-review-tool`), re-encode guidance (`encoding-helper`). Not used: `webcam-pose-tracking` (human pose model, GPU delegate, runtime model download), `pose-subspace-analysis` (nothing to decompose in a two-point track), `salk-signature` (hotlinked trademark). No file is copied wholesale; project licence MIT. — Borrow freely, cite precisely, submit nothing that is a copy.

**D39 · Known limitations from day one.** `docs/known-limitations.md` has two sections, defects and excluded scope, appended when a limitation is found. — Honest limitations are cheaper to write at discovery than to reconstruct.

**D40 · Development workflow tooling.** `.claude/` is committed and holds: a reviewer subagent that reads this file plus the diff and tries to break the change before approving; a pre-commit guard hook that blocks staged video files, oversized files and key-shaped strings; a post-edit hook that runs typecheck and lint; and a `/finish-chunk` command that runs tests, invokes the reviewer and prompts for known-limitations updates. Each was added at the point it was first needed. — Guard rails for the constraints in this file, visible in the commit history.

**D41 · Branding.** Product name BarnesTrack; an original logo shipped as an inline SVG (no external assets); institutions are named in text only. — Zero-network and no implied endorsement.

**D42 · Stretch order, after core acceptance only.** (1) An agent interface for cohort summaries — a Claude skill teaching the export schema, or a small MCP package reading exported files; (2) SLEAP `.slp` import onto `source: imported`; (3) automatic maze detection proposing the map. — Each is cheap only because of D8–D11, and none may displace a core feature.

**D43 · Deployment configuration lives in the Cloudflare dashboard, not in the repository.** Implements D34. The site is connected through Cloudflare Pages' Git integration ("Connect to Git"), configured entirely in the dashboard: project `barnestrack` (`https://barnestrack.pages.dev`), production branch `main`, framework preset None, build command `npm run build`, build output directory `dist`, root directory `/`, no environment variables, Node version read from `.nvmrc` by the Pages build image. Preview deployments are enabled for non-production branches. The GitHub app is installed with access to the `barnestrack` repository only. The Workers Builds path that the dashboard now offers by default was rejected: it deploys with `npx wrangler deploy`, which requires a `wrangler.jsonc` committed to the repository and an account API token minted during setup. Cloudflare labels the Pages flow "legacy" in its own UI; if it is withdrawn, migrating to Workers Builds is a new decision, not a silent change. — Consequence to state in the README: a fresh clone contains no deployment configuration, so the build settings are not discoverable from the repository and are recorded here instead.

**D44 · Calibration lives in the maze map only.** Supersedes the `calibration` field listed at session level in D9. `platformDiameter_cm` is a property of the physical maze, so it is stored once in the maze map (D10); the session file has no separate calibration field. Each video's pixels-per-centimetre is derived from the map's platform radius after that video's transform and recorded in the video's `derived` layer and in `quality.csv`, never entered separately. A cohort that uses two mazes carries two maps. — One source of truth for a number that every threshold depends on; "shared calibration" in D28–D29 is satisfied because the map is shared.

**D45 · Tied presentation timestamps are ordered by picture order count.** Amends D7's tie-break. Within a duplicate-timestamp pair the decoder emits the two pictures in the bitstream's picture-order-count (POC) order, which differs from decode order for 68 / 7 / 5 pairs in test50 / test51 / test53 (measured with `ffmpeg -bsf:v trace_headers`; a decode-order tie-break makes the sequential pass non-monotone at frame 174/175 of test50). The index therefore reads each sample's first slice header (`src/video/h264-poc.ts`, POC type 0, frame pictures) and orders ties by POC; streams with POC type 1 or field coding fall back to decode order with a recorded warning. Nothing else in D7 changes: `t_s` still comes from the sample table, and decoder outputs are still identified by synthetic timestamp. — "Frame N" must be the same picture in the tracking pass, in the scrubber and in ffprobe's output; the prototype demonstrates the failure of the simpler rule on request.

**D46 · Known limitations has three sections.** Amends D39: defects (bugs or gaps found and not fixed), excluded scope (deliberately not built), and findings about the sample data (properties of the inputs that the tool handles by design — irregular frame timing, tied timestamps out of decode order, reduced visual quality after re-encoding). — A property of the data is not a defect of the tool, and saying which is which is part of being honest about both.

**D47 · A session exists before a maze or parameters do.** Amends D9. `SessionFile.mazeMap` and `SessionFile.parameters` are nullable: a session is created the moment a video is loaded (so autosave and reload work from the first drop, D27), the maze map is `null` until the maze step is completed, and `parameters` is `null` until the first tracking run stamps the defaults in force at that time; the session carries a user-editable `name` (default from the first video's filename). Schema version stays 1 because no schema-1 file has been written yet. — Losing forty minutes of intake to a refresh is the failure D27 exists to prevent, and it can happen before the maze is drawn.

**D48 · Fragmented animals are merged, and say so.** Refines D6 step 4 and the D8 reason list. When the foreground splits an animal into pieces (a hole or rim shadow cutting the body), all plausible pieces lying within one body length of each other are treated as one candidate: the union's centroid and area are used, the frame is `low_confidence` with the fixed reason `fragmented`, and the union's area must not exceed `min(maxBlobArea, oversizedBlobFactor × expectedBlobArea)` (a larger union stays `ambiguous`), and pieces are merged only within `fragmentMergeDistance_cm` (default 8 cm). No schema bump: `reason` is a string and the documented list gains one entry. — Splits happen mostly at holes, which is exactly where investigations are detected; reporting those frames as `ambiguous` would lose the events the tool exists to find, while merging silently would hide the uncertainty. Measured on the sample videos: 423 / 63 split frames in test50 / test53 before this rule.

**D49 · Hole identity lives in the shared map; placement and rotation live in the per-video transform.** Refines D10 and D28. `mazeMap.phase_deg`, `target` and per-hole `offsets` are properties of the maze and are edited on the shared map; where the maze sits in a given video (translation, scale and rotation) is that video's `mazeTransform`, so aligning the ring on a second video never rewrites the map. Hole *k* in any video is `transform(map hole k)`; the target index is shared per map; a physically different setup (another rig, the escape box moved) is a second map, not a per-video override. — One map means one hole numbering for the whole cohort, which cohort comparisons need, while each camera still gets its own fit.

**D50 · The maze click count counts clicks on the image.** Refines D13. The on-screen badge counts pointer clicks placed on the video frame (rim points, hole alignment, target, nudges); mode buttons, numeric fields and keyboard nudges are not counted, and the badge says "clicks on the image". — The twelve-hundred-clicks warning is about placing things on pictures; the demo states the button presses out loud rather than hiding them in the count.

**D51 · Layer keys.** Refines D9 and D47. The `auto` layer is keyed by the hash of the *tracking* parameters only (`parameters.tracking`), because nothing else changes a tracking run; the `derived` layer is keyed by the hash of the full parameter set. `SessionFile.parameters` is stamped with the defaults in force at the first analysis (derive) run, not at the first tracking run. Hashes are the SHA-256 of the canonical JSON (sorted keys, no whitespace). — Changing an event threshold must not invalidate an hour of tracking, and a tracking change must invalidate everything downstream.

## Open decisions — provisional defaults

Units: spatial thresholds are stored in centimetres and converted per video using the platform-diameter calibration; temporal thresholds are stored in seconds and applied using each frame's timestamp from the file's own timebase, never a nominal frame rate.

**O1 · Hole investigation.** Default: the event point (nose when nose confidence ≥ O16, otherwise centroid; recorded per event as `point_used`) is within 1.5 × hole radius of a hole centre for ≥ 0.2 s; bouts at the same hole separated by < 0.5 s merge into one investigation; each merged bout is one event, so repeat visits to the same hole are separate events. Every event stores the minimum nose distance and minimum centroid distance to the hole, dwell time and `point_used`, so a proximity-weighted rule (nose-over-hole and body-proximity scored separately with adjustable weights) can be added later without changing the event schema. Closes on: Gawel et al. 2019; lab convention.

**O2 · Error counting.** Default: every investigation of a non-target hole is an error, repeat visits included; primary errors are those before the first target investigation; total errors cover the whole trial; investigations of the target hole are never errors. Closes on: Gawel et al. 2019.

**O3 · Primary latency end point.** Default: trial start → first target investigation under O1. Alternative reading of "first reaches the target hole": centroid approach within a set distance. Closes on: Gawel et al. 2019.

**O4 · Escape-box entry and total latency.** Default: an entry is a loss of detection whose last tracked point is within 1.0 × hole radius of the target hole, lasting ≥ 1.0 s, with no reappearance elsewhere during the loss. The trial ends at the first entry that persists to the end of the video or for ≥ 3 s. Total latency = timestamp of the first lost frame. A loss with the same signature at a non-target hole is counted as an investigation and flagged "physically unlikely — review". A loss away from any hole, or a reappearance far from the loss point, is a tracking failure reported in the quality report and never an event. Closes on: Gawel et al. 2019; lab convention.

**O5 · Trial start and cutoff.** Default: trial start is auto-proposed as the first confident, mouse-sized detection inside the platform after the last oversized-foreground frame (start cylinder, experimenter's hand), shown as a timeline marker and adjustable by the user. No acclimation delay is subtracted. Cutoff default 180 s (parameter). If the animal never enters the escape box: `total_latency_s` is left blank, `escaped = false`, `status = review`; a parameter can substitute the cutoff value for statistics. Closes on: Gawel et al. 2019.

**O6 · Target quadrant.** Default: a 90° sector centred on the target hole (target ± 2.5 holes on a 20-hole ring). Alternative: four fixed quadrants with the target's quadrant selected. Closes on: Gawel et al. 2019.

**O7 · Search-strategy classification.** Default: three classes (spatial, serial, random) from a transparent rule set over features computed from the event list and track: number of non-target errors, maximum angular distance (in holes) of investigated holes from the target, longest run of adjacent-hole investigations, centre-zone crossings (radius < 0.5 R) between investigations, path efficiency (straight-line start→target ÷ path length), and cumulative heading change (path tortuosity). Placeholder rules: *spatial* if errors ≤ 3, all errors within ± 2 holes of the target and ≤ 1 centre crossing; *serial* if a run of ≥ 3 adjacent-hole investigations precedes the target visit with no centre crossing during the run; *random* otherwise. The UI shows the feature values, the rule that fired, the runner-up class, and an override with a free-text reason. Closes on: Illouz et al. 2020 (whether a finer scheme is warranted); Gawel et al. 2019.

**O8 · Maze geometry defaults.** Default: 20 holes, evenly spaced (per-hole offsets available for mazes that are not), hole diameter 5 cm, hole-ring radius ≈ 0.89 × platform radius (measured on the sample videos), platform diameter hint 92 cm (the user must enter the real value; nothing is computed until they do). Closes on: Gawel et al. 2019; facility values.

**O9 · Path length and speed.** Default: computed from the body centroid. A 3-frame median filter is applied to positions used for path length and speed only (events use raw positions); raw and smoothed path length are both reported. Gaps are excluded from path length and reported as a fraction of the trial. Mean speed = path length ÷ tracked time within the trial, excluding time after escape. Closes on: Gawel et al. 2019.

**O10 · Gap filling.** Default: on; linear; only gaps ≤ 0.1 s; never when either bounding frame is within one hole radius of a hole (a gap at a hole is evidence, not noise); filled points carry `source: filled`, are drawn hollow, and are counted (`n_filled_frames`). The automatic tracking layer itself never contains filled points. Closes on: lab preference.

**O11 · Kinematics under irregular frame timing.** Default: speed is computed over a centred ± 2-frame window using per-frame timestamps; consecutive frames with Δt < 0.25 × nominal are treated as duplicate timestamps and skipped for speed; Δt > 1.5 × nominal is flagged as a dropped-frame gap (path length still uses the straight segment). The rule is stated in the definitions panel. Closes on: nothing expected — this reflects measured behaviour of the sample files (duplicate presentation timestamps and dropped-frame gaps in all three).

**O12 · Cohort metadata.** Default: editable animal / day / trial / group fields per video; no filename parsing. Closes on: facility naming convention.

**O13 · Input formats.** Default: MP4 with H.264 (AVC) video only. Other containers or codecs are listed with the reason and a re-encode hint, never silently dropped. Closes on: what the facility records.

**O14 · Reviewer identity.** Default: corrections carry `source: user` and a timestamp; no named reviewer. Closes on: whether inter-rater comparison is built.

**O15 · Additional metrics.** Default: the measures named in the task only (primary/total latency, primary/total errors, path length, speed, time in target quadrant, strategy). Closes on: Gawel et al. 2019 — which commonly reported extras to add, and which are always visible versus on demand.

**O16 · Nose-confidence cutoff.** Default: events use the nose when its heading confidence ≥ 0.5, otherwise the centroid (`pointUsed` records which). Revised from 0.6 on 2026-09-05 after the tracker measurement: on the sample videos the tail-direction cue alone yields confidence 0.5 and is correct whenever it exists, while velocity and tail cues rarely agree because the animals are mostly stationary; at 0.6 the nose would never be used. The nose remains labelled experimental in the UI (D18). Closes on: measured nose accuracy on further videos.

**O17 · Outlier rule.** Default: a centroid velocity jump > 150 cm/s marks the frame as an outlier (invalid for kinematics); the point is never replaced. Closes on: lab preference.

## Pending literature review

To be resolved against Gawel et al. 2019 (*Naunyn-Schmiedeberg's Arch Pharmacol* 392:1–18) and Illouz et al. 2020 (*J Neurosci Methods* 334:108579); Barnes 1979 is not accessible: **O1, O2, O3, O4, O5, O6, O7, O8, O9, O15.**

Pending lab or facility convention (no literature answer expected): **O10, O12, O13, O14, O17.**

Pending measurement on the sample videos: **O16.**
