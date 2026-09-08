# BarnesTrack

Turn a folder of Barnes maze videos into latencies, errors, path measures and search-strategy
calls that you can defend six months later — in a browser tab, with nothing to install.

**Live:** <https://barnestrack.pages.dev>
**Demo video:** <!-- DEMO_URL --> _placeholder — link added when the recording is made._
**Nothing to hand?** Press **Load example cohort** on the Videos step to open a worked cohort with
every result already computed.

## What it does, and who it is for

BarnesTrack is for the person who runs the maze: a student or postdoc with sixty videos, a
deadline, and no wish to become a software operator. It does not need a terminal, an install, an
account, a GPU or admin rights, because it is a static page that runs entirely in the browser
already on the laptop.

The work is four steps, and the page says the same thing at the top of each one:

1. **Videos** — "Load the videos of one cohort. Each file is read in this browser: BarnesTrack
   parses its frame table and fingerprints its contents so the session can find the same file again
   after a reload. Nothing is uploaded."
2. **Maze** — "Mark the platform, generate the hole ring, name the target hole and enter the
   platform diameter. The map belongs to the whole session, so hole 7 means the same hole in every
   video; a second video only needs to say where that maze sits in its own frame." D13 budgets at
   most six clicks on the image for a new maze and at most three for a reused one; on the sample
   recordings a new maze cost five, reusing it on a video from the same rig cost none, and three
   where the camera had moved. The panel shows the running count.
3. **Track** — "Run the automatic tracking pass over each video and watch it work. Tracking runs in
   the background, so you can keep working on the Videos and Maze steps while it does." A
   3-minute video takes a few seconds, and the page stays responsive while it happens.
4. **Review & Export** — "Check every event against the frames it came from, correct what the
   tracker got wrong, and read the metrics. Every correction is stored beside the automatic values
   and everything is recomputed from both." A timeline of the trial with every correction on it, the
   evidence behind each event, a metrics card and a quality summary. Six of the thresholds are
   editable there with a live recompute of what changing one does; the full parameters panel, the
   figures and the export bundle land in a later release.

Three things shape everything else:

- **A missing frame stays missing.** Tracking failures are flagged, never quietly interpolated. If
  a documented cleaning step fills a gap, the filled points are drawn differently, counted, and
  labelled as filled.
- **Nothing is a bare (x, y).** Every position carries its named point, a confidence, a valid flag
  and where it came from — automatic, human-corrected, filled or imported.
- **A correction never edits a result.** It is stored beside the automatic layer, and everything
  downstream is recomputed. "Revert to automatic" is free, and re-running tracking cannot destroy
  an afternoon of human work.

Every threshold that decides a number is a named parameter rather than a constant buried in code:
adjustable in the interface wherever the step that uses it has shipped, and carried into every
export either as its own column or through the parameter set the export's hash covers, alongside
the tool version. Two spreadsheets that disagree can be reconciled from what travels with them.

## How to run it

### As a user

Open <https://barnestrack.pages.dev> and drop in your videos. There is no sign-in, no upload and no
setup.

Supported browsers: **Chrome or Edge 94 and later, Safari 16.4 and later, or Firefox 130 and
later**. The page checks at load and says so in plain language if the browser cannot decode video
frames; it does not fall back to a lower-fidelity path, because every measurement is tied to a
specific frame of the file (see D7 and D4 in [`docs/decisions.md`](docs/decisions.md)). An old
laptop is fine — Chrome decodes H.264 in software and the tracker runs on the CPU at over a
thousand frames per second. Input is MP4 with H.264 video; anything else is listed with the reason
and an `ffmpeg` line that converts it, never silently ignored.

### From a fresh clone

Node 24 or later (the version is in [`.nvmrc`](.nvmrc)). No environment variables, no API keys, no
services to provision.

```bash
npm ci          # dependencies are pinned to exact versions
npm run dev     # http://localhost:5173
npm test        # unit tests (vitest)
npm run lint
npm run typecheck
npm run build   # static site in dist/, deployable as-is
```

`npm test` runs 1,090 unit tests, all passing. Most cover the pure layers — metrics, event
detection, cleaning, strategy, maze geometry, the export writers, the session file and the MP4
parser; a smaller set covers the DOM-free parts of the interface. Sixteen skip without
`BARNESTRACK_SAMPLE_DIR` (below); fifteen of those are the sample-video tests and one skips for its
own reason, so pointing that variable at the clips leaves a single skip and 1,089 passing.

Two optional extras:

- `BARNESTRACK_SAMPLE_DIR=/path/to/data/barnes-maze npm test` includes the tests that read the
  sample videos. Without it those tests skip themselves and say so. No video is committed to this
  repository; the clips live in the sample-data repository.
- `npx playwright test` runs the browser checks against your installed Google Chrome. They are not
  part of CI; [`tests/browser/README.md`](tests/browser/README.md) says what each spec covers and
  records what was verified by hand instead.

CI runs lint, typecheck, tests and the build on every push
([`.github/workflows`](.github/workflows)).

One consequence worth stating plainly: the deployment configuration is not in this repository. The
site is built and served by Cloudflare Pages from the dashboard — build command `npm run build`,
output `dist`, no environment variables — so a fresh clone gives you the application but not the
hosting. The settings are written down in D43 of [`docs/decisions.md`](docs/decisions.md) so they
can be reproduced from the record rather than from memory.

## Design decisions

The full record, with the reasoning for each, is in [`docs/decisions.md`](docs/decisions.md); the
file formats and internal representations are in
[`docs/data-contracts.md`](docs/data-contracts.md). The themes:

**A page, not a service (D2, D3, D41).** BarnesTrack is a static client-side build with no server,
no accounts, no API keys and no runtime network requests at all — no CDN script, no web font, no
analytics, an inline SVG logo. That makes "what leaves the user's machine?" answerable as _nothing_
and checkable in the browser's own network tab, and it means the tool still works on a lab laptop
with no internet. There is no UI framework: the correction surface is a canvas, where a framework
adds little, and TypeScript turns the data contracts into types the compiler checks. `mp4box.js`
and `exceljs` are the only runtime dependencies, both pinned exactly.

**Classical computer vision, chosen rather than settled for (D6).** A per-pixel temporal-median
background, an Otsu threshold with a live preview, connected components with an area prior and
proximity to the previous position, a morphological opening to strip the tail, and the nose taken
from the body ellipse's major axis with the head end chosen by tail direction, motion and hole
proximity. Every step is explainable on screen and runs at over a thousand frames per second on a
CPU. Segmentation models and pose estimators are legitimate tools, but browser-side inference at
0.2–3 s per frame cannot process three videos while someone watches, a mask still leaves the nose
to be inferred from shape, and the named-point contract admits an imported model track later
anyway. D6 also writes down the fallback ladder if the approach fails on a video — tighter mask,
per-video threshold, adaptive threshold, an in-browser WASM segmenter — and rules out a server at
every rung.

**Contracts before features (D7–D12).** A frame is its position in the MP4 sample table, and its
time comes from that table rather than from `frame ÷ fps`. Every position is a named point with
confidence, a valid flag and a source. A session is one JSON document with three layers per video:
`auto`, which a tracking run writes once and nothing ever mutates; `corrections`, a sparse list of
human edits; and `derived`, recomputed from `auto ⊕ corrections` on load. The maze map is
parametric, shared across the cohort, and placed per video. Exports are three tidy CSVs plus
`parameters.json`, the session file and an XLSX, every row stamped with the tool version, the
schema version and a parameters hash — and every trial row with its `target_hole`, because Gawel's
protocol rotates the platform between trials and a latency is meaningless without the hole it was
measured to (D62). Two places where the sample data forced a refinement are
worth naming: same-timestamp frames are ordered by the bitstream's picture order count, because
the decoder emits them that way and a simpler rule makes the tracking pass non-monotone (D45); and
an animal split into pieces by a hole's shadow is merged into one candidate, marked
`low_confidence / fragmented` rather than reported as ambiguous, because splits happen exactly
where investigations are detected (D48).

**Honest failure, and thresholds you can see (D16–D20).** The automatic layer never interpolates:
every frame without a position carries a state and a reason string, and the quality report clusters
on those reasons. Gap filling is **off by default** (D60): a gap stays a gap, is drawn as one, and
enters no kinematic value. A lab that wants it can turn it on — the filling is then confined to the
derived layer and to gaps within a documented limit, and the filled points are drawn hollow and
counted — but no data is better than invented data. Investigations, escape-box entries and
tracking failures are told apart by evidence the user can inspect — where the animal was last seen,
how long detection was lost, whether it came back and where, and the blob-area trend before the
loss — and each event seeks to its own first frame on click. Both the nose and the centroid are
always tracked; events use the nose when its heading confidence clears a visible cutoff and the
centroid otherwise, recording which per event, because a confident wrong nose is worse than an
honest centroid. Changing a parameter re-renders the events and the metrics immediately, with a
badge showing what changed.

**A strategy call you can read aloud (D23, D58).** Search strategy comes from a transparent rule
engine over named features — errors, hole distance of investigated holes from the target, longest
run of adjacent holes, centre crossings, path efficiency, tortuosity. The rules are Gawel et al.
2019, Table 1, and the interface says so beside the answer: a user who cites the paper is citing
what the tool actually computed. The interface shows the feature values, the rule that fired, any
rule that fired but was outranked, and the runner-up, and it accepts an override with a free-text
reason stored as a correction. Dimensionality-reduction views
were deliberately excluded: a student defending a classification needs a sentence, not a position
in a scatter plot.

**Correcting without losing anything (D24–D27).** A stacked timeline over one shared time axis —
detection state, confidence, events labelled with hole numbers, corrections, trial markers — above
a frame-accurate scrubber, fully keyboard-navigable. Corrections are point nudges, range tools
("not visible here", "in the escape box from here"), event edits, trial-start adjustment and
strategy overrides, each stored sparsely and individually revertible. Automatic and corrected
values differ by shape _and_ text as well as colour, so they survive a grayscale printer and a
screen reader. Everything autosaves to IndexedDB on every change, and the session file is the
portable record.

**What is hashed, and what is only a cache (D51, D55).** The `auto` layer is keyed by a hash of the
tracking parameters alone, so changing an event threshold does not throw away an hour of tracking,
while a tracking change invalidates everything downstream. The full parameter set is hashed into
every export. The derived layer is a cache: it is recomputed on load and never trusted as
authoritative, because what is not hashed cannot be reproduced and what is recomputed cannot go
stale.

## Ambiguities, and how they were resolved

Barnes maze conventions vary between laboratories, so the behavioural definitions cannot simply be
looked up — they are lab conventions, not facts. Each one is resolved with an explicit default that
is **in force, visible in the interface, adjustable, and written into every export as a column**, so
a later change of mind is a recomputation rather than a reanalysis.

Every one of them was reviewed against Gawel et al. 2019 and Illouz et al. 2020 on **2026-09-07**.
Five changed as a result and are recorded as closed decisions D58–D62 in
[`docs/decisions.md`](docs/decisions.md): the search-strategy rules became the paper's, an entry
that runs to the end of the clip stopped needing a minimum duration, gap filling was turned off by
default, path efficiency took Illouz's definition, and every trial row now names its target hole.
The rest were confirmed at their measured defaults, with the reason each closes recorded beside it.
The numbers below are what the tool ships with today.

- **What counts as investigating a hole? (O1)** The event point is within 1.5 × the hole radius of
  a hole centre for at least 0.2 s; bouts at the same hole less than 0.5 s apart merge into one, so
  a genuine return is a second event. Both the minimum nose distance and the minimum centroid
  distance are stored on every event, so a proximity-weighted rule can replace this one later
  without a schema change.
- **What is an error? (O2)** Every investigation of a non-target hole, repeat visits included.
  Primary errors are those before the first target investigation; total errors cover the trial; an
  investigation of the target is never an error.
- **When does primary latency end? (O3)** At the first target investigation under O1. The
  alternative reading of "first reaches the target hole" — a centroid approach within a set
  distance — is recorded as the option not taken.
- **What is an escape-box entry? (O4, D59)** A run at the target hole in which the animal is either
  undetected or seen only as a small or fragmented low-confidence blob within 1.0 × the hole
  radius, lasting at least 1.0 s with no full-size detection elsewhere — **or continuing to the last
  frame of the clip, in which case no minimum duration applies**, because protocol keeps the animal
  in the box until the trial is ended and no later frame could contradict the reading. The trial
  ends at the first such entry that persists for 3 s or to the end of the video. A loss with the
  same signature at a non-target hole is an investigation flagged "physically unlikely — review"; a
  loss away from any hole is a tracking failure and never an event. A user's "in the escape box
  from here" range always produces the entry it asserts, and is flagged when the track puts the
  animal nowhere near a hole (D57). Gawel's own criterion is the whole body in the hole; that is
  not computable from a track with no per-frame mask, and the gap is in Known limitations.
- **Where does the trial start, and when is it cut off? (O5)** Trial start is proposed as the first
  confident, mouse-sized detection inside the platform after the last oversized-foreground frame,
  shown as a timeline marker and adjustable. Latencies are measured from there, never from frame 0.
  The cutoff is 180 s; a trial that never reaches the escape box leaves total latency blank, sets
  `escaped` false and is marked `review` rather than being given the cutoff as a number.
- **What is the target quadrant? (O6)** A 90° sector centred on the target hole — the target plus
  or minus 2.5 holes on a 20-hole ring. Four fixed quadrants with the target's quadrant selected is
  recorded as the alternative.
- **How is search strategy classified? (O7, D58)** Spatial, serial or random, by the rules in
  **Gawel et al. 2019, Table 1**, which the interface names beside the answer. *Spatial*: the target
  reached with no error, or at most 2 non-target investigations, each at a hole adjacent to the
  target, with no crossing of the centre between hole searches. *Serial*: before the first target
  visit, a run of at least 2 investigations at consecutive adjacent holes in one direction around
  the ring — not counting the target or the holes beside it — with no centre crossing during the
  run. *Random*: neither. Every threshold is a hashed parameter, so a lab that classifies
  differently can say so. The rule engine reports six named features alongside the class —
  non-target errors, the maximum hole distance from the target, the longest adjacent run,
  centre-zone crossings, path efficiency (Illouz et al. 2020, Fig. 1C) and cumulative heading
  change — with the rule that fired, any rule that fired and was outranked, and the runner-up.
  Features run over the search phase, from trial start to the first target event, because strategy
  describes how the target was found; a trial that never reaches the target is classified over the
  whole trial window and says so, since Gawel's definitions presuppose a target visit. Thigmotaxis
  and the finer subtypes are not classified. Known weaknesses are in Known limitations.

Five further ambiguities were resolved structurally rather than numerically:

- **Calibration belongs to the maze, not the session (D44).** Platform diameter in centimetres is a
  property of the physical apparatus, so it lives once in the maze map. Each video's pixels per
  centimetre is derived from that map after the video's own transform and reported in
  `quality.csv`; it is never typed in twice. A cohort recorded on two mazes carries two maps.
- **A session exists before a maze, parameters or results do (D47, D52).** The maze map is `null`
  until the maze step is finished, the parameter set is `null` until the first analysis run, and
  the derived layer is `null` until there is something to derive. They are nulls, not placeholders,
  because a fabricated value is a lie and autosave has to work from the first file dropped.
- **Ties in presentation time are broken by picture order count (D45).** All three sample videos
  contain duplicate timestamps, and the decoder emits those pairs in the bitstream's order, not the
  sample table's. "Frame N" therefore means the same picture in the tracking pass, in the scrubber
  and in `ffprobe`'s output.
- **A split animal is merged, and says so (D48).** Pieces within one body length are treated as one
  candidate whose union must still satisfy the single-blob area bounds; the frame is
  `low_confidence` with the reason `fragmented`. Reporting those frames as ambiguous would lose the
  events the tool exists to find; merging them silently would hide the uncertainty.
- **Hole identity lives in the shared map; placement lives per video (D49).** Hole numbering, the
  target and any per-hole nudges are properties of the maze. Where that maze sits in a given frame
  is that video's transform. A genuinely different rig is a second map, not an override.

## What was not built, and why

- **SLEAP `.slp` import** onto `source: imported` — designed for (D8 exists partly to admit it) but
  behind the core features in the order set out in D42.
- **Automatic maze detection** proposing the map — the manual path already costs five clicks and
  none on a reused rig, so the payoff is small (D42).
- **Undo/redo** — every correction is individually revertible and the automatic layer is never
  mutated, which covers the failure undo exists to prevent, at far less complexity.
- **Re-attaching the video automatically after a reload** — the File System Access API could keep a
  handle, and IndexedDB could hold the file, but that puts copies of a lab's video data in a browser
  profile without anyone asking for it. Dropping the same file back in is one gesture, and the
  fingerprint recognises it even if it was renamed.
- **Inter-rater comparison** — corrections carry `source: user` and a timestamp but no reviewer
  identity (O14); adding one is cheap when a lab actually wants two reviewers on the same video.
- **Perspective correction** — the platform is fitted as a circle in image pixels. A camera that is
  not directly overhead images it as an ellipse, so distances near the far rim are slightly
  under-measured. Fixing it properly needs a homography and a ground-plane assumption, a larger
  change to the maze map than these recordings justify. The effect is measured and recorded rather
  than ignored.
- **A DOM test environment** — the pure layers are unit-tested in Node, and the canvas-bound
  interface is covered by TypeScript, by Playwright specs and by a recorded manual pass. Adding
  jsdom to test the parts that are mostly `document` calls was judged not worth the dependency.

## Known limitations

The full list, split into defects, deliberately excluded scope, and findings about the sample data,
is in [`docs/known-limitations.md`](docs/known-limitations.md). The three that matter most:

- **No sample trial escapes under the recorded map, because none of the three animals reaches the
  hole that map calls the target.** O4 reads an entry as a loss of detection at the target hole,
  and in these recordings the animal's rear stays visible while its head is in a hole, so a
  position is still produced. Two clips do end with the animal's head in a hole, and since D59 —
  a run at the target hole continuing to the last frame of the clip needs no minimum duration —
  both are read as persistent escape entries when the map names the hole they actually entered,
  with total latencies of 22.83 s (test53) and 44.04 s (test51) from trial starts at 5.00 s
  (`prototypes/analysis/RESULTS.md`, signature checks). Under the chunk-3 map, whose target is
  hole 7, neither hole is the target: test53's 2.37 s run is long enough to be entry-shaped anyway
  and is flagged "physically unlikely — review", while test51's 0.93 s run is not, and stays an
  ordinary investigation.
  What is still missing is Gawel's actual criterion, the whole body inside the hole; the tracker's
  blob has no per-frame mask, so the tool uses the loss of detection as its proxy and says so.
- **The nose is experimental.** On these re-encoded clips the tail is often below the foreground
  threshold and a hunched animal has no defined major axis, so no nose cue exists at all on 21–32 %
  of the frames that have a blob — and on every frame that has none — while a cue that does exist
  usually stands alone. Events therefore record which point they were judged on, the quality
  report states the fraction judged on the nose, and the interface labels the nose experimental.
- **The example cohort's track is a scripted trajectory, not a real animal.** The bundle behind
  **Load example cohort** carries the three sample videos' real fingerprints and durations over a
  synthetic track, so the demo renders every view without asking anyone to download a video. Its
  latencies, errors, paths and strategies are no longer scripted alongside it: every derived layer
  in the bundle is computed by this tool's own `derive()` from the track it ships, and a test
  re-derives the committed document to prove it. The panel says on screen that the results are
  illustrative. Attach a real file — drop it, or press the fetch button — and every number is
  recomputed from the frames.

## Data handling and cost

**What leaves the user's machine: nothing.** BarnesTrack is a static page. Videos are read from
disk by the browser and decoded in the tab; tracking, analysis, figures and exports all run
locally; the session file and the CSVs are written straight to the downloads folder. There is no
server to send anything to, no account, no telemetry, and no third party in the path — there is not
even a font or a CDN script to fetch. Loading the page and working through a whole cohort of your
own videos issues no request at all beyond the page's own HTML, JavaScript and CSS. Exactly two
requests exist, and both need a button press:

- **Load example cohort** fetches `examples/example-cohort.barnestrack.json.gz` (about 500 kB) from
  the page's own build — same origin, the same static deployment the page was served from, nothing
  leaving it.
- **Fetch test53.mp4** downloads that one clip from the public sample-data repository. This is the
  single outbound request BarnesTrack can make, it is named on the button, and it exists so the demo
  has a real video to scrub.

The other URL-shaped strings in the built bundle are never fetched: XML namespace identifiers — the
SVG namespace passed to `createElementNS`, and exceljs's OOXML namespaces once the XLSX export is in
the bundle — and the sample-data repository link the provenance line renders as an `<a href>` for a
reader to follow. That is checkable rather than promised: open the network tab and work through a
whole cohort. This matters because behavioural recordings sit under an animal-use protocol and
plenty of institutional data cannot leave the building; a tool that cannot phone home does not need
to be trusted not to.

**Keys and cost: there are none.** No API key to obtain, so there is nothing to degrade to when one
is missing — the demo path and the full path are the same path. A run costs nothing because the
computation happens on hardware the lab already owns, and it does not get more expensive with more
videos: sixty videos cost sixty times zero. At scale the only line item is static hosting of a
build of a few hundred kilobytes, which is free on every host that would serve it. The design
choice that buys this is the same one that answers the data question — no server — and the cost of
that choice is paid in browser support (WebCodecs is required) rather than in money.

## Ask Claude about a cohort

Once a cohort is exported, the questions that follow are usually comparisons: how did the lesion
group's latencies change across days, which videos need a second look, why do these two
spreadsheets disagree. [`skills/barnestrack-cohort/`](skills/barnestrack-cohort/) is a Claude skill
that answers them. Add it to Claude Code or claude.ai, point it at an export folder, and ask.

It reads the exported files and nothing else — no server, no connection to the application, no
access to the videos. It works from the three CSVs and the parameter set, and falls back to the
session file in the same folder only when those cannot answer the question. It knows the column
list and the units, and it is
built around the rules that make a cohort answer honest: it will not fold trials marked `review`
into a headline number without saying so, it treats a blank cell as "not recorded" rather than
zero, and it refuses to compare two cohorts without first checking that their `parameters_hash`
values match.

## Accessibility

Accessibility is treated as a requirement per feature rather than a pass at the end (D37). What is
implemented, and how to check it:

- **Everything works from the keyboard.** A complete maze can be built without touching the image:
  the stepper moves with arrow keys, the video frame is in the tab order, numeric fields create and
  move the platform and the ring, arrow keys nudge a selected hole by 1 px (10 px with Shift),
  `+`/`−`/`0` zoom, `Alt` plus arrows pan, and the scrubber steps a frame at a time. The full key
  table is in [`tests/browser/README.md`](tests/browser/README.md). To check: unplug the mouse.
- **Nothing means anything by colour alone.** Detection states and quality tiers are words first;
  in the figures, markers differ by shape, every series carries a text label, gap-filled positions
  are hollow rings, and corrected events are hatched with "corrected by a reviewer" in the legend.
  The rest of what D26 specifies — a corrected point drawn as a diamond with an edit badge — is
  decided but not yet in the figure layer, because the correction tools that would produce a
  corrected point are not in this build. To check what is here: set the display to grayscale and
  work through a video.
- **Every canvas has a DOM equivalent.** The maze overlay is mirrored by a table carrying the same
  values, and the canvas label says so. Each figure carries a `FigureDescription` — the same facts
  as text — built to be rendered beside it; the Review step that puts those tables on the page has
  not landed, so today they are exercised in the tests and in the development gallery.
- **Status is announced, but not narrated.** The shell's shared polite live region carries state
  transitions — tracking started, finished with its summary sentence, cancelled, failed — while
  continuous progress is `aria-live="off"`, so a screen reader is told what happened without a
  running commentary.
- **Usable at 200 % zoom.** Checked at a 483 × 423 CSS viewport, which is what a 1280-wide window
  looks like at 200 %: no horizontal scrolling and every control still reachable. Text contrast was
  measured against the stylesheet's palette — the lowest text pair is 6.56:1 and the two non-text
  borders are 3.04:1 and 3.37:1, against the 4.5:1 and 3:1 thresholds.

There is no automated accessibility test in the suite. These are checked per feature as it lands,
in the Playwright specs where a real browser is needed, and in the manual pass recorded in
[`tests/browser/README.md`](tests/browser/README.md).

## Attribution

Full notices, with licence texts, are in
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md). In short:

**From [`talmolab/vibes`](https://github.com/talmolab/vibes)** (BSD-3-Clause, commit `d9410fa`),
patterns re-implemented in TypeScript, each in a file whose header names the source tool — run
`grep -rn "Adapted from talmolab/vibes" src/` to see every one. Nothing is copied wholesale.

- From `video-player`: the sample-table frame-identity model, keyframe-window decoding and `avcC`
  decoder configuration (`src/video/mp4-index.ts`, `sample-reader.ts`, `frame-source.ts`).
  Rewritten for mp4box 2.x, and extended with the picture-order-count tie-break (D45) that these
  recordings turned out to need.
- From `labelroi`: the two-layer canvas with its screen-to-video transform and device-pixel-ratio
  backing store (`src/ui/canvas-view.ts`, `src/maze/view-transform.ts`). Rewritten as pure
  functions so the transform can be unit-tested without a DOM.
- From `slp-viewer`: the worker-side demux/decode core (`src/video/track-worker.ts`, `decoder.ts`,
  `mp4-index.ts`). Rewritten around backpressure, synthetic decoder timestamps and luma extraction,
  none of which the original needs.
- From `event-annotator`: the row model and the paint-style editing operations
  (`src/session/corrections.ts`, `src/ui/timeline-model.ts`, `src/ui/timeline.ts`,
  `src/ui/review-step.ts`). Rewritten so an edit is an append-only correction record with a source
  and a provenance trail rather than a mutation of the row, which is what makes automatic and
  corrected values distinguishable in every view and every export.

Ideas only, no code: quality tiers from `quality-review-tool`, and the re-encode guidance from
`encoding-helper`.

**Runtime dependencies:** [`mp4box.js`](https://github.com/gpac/mp4box.js) (BSD-3-Clause) for MP4
demuxing, and [`exceljs`](https://github.com/exceljs/exceljs) (MIT) for the XLSX workbook.

**Colour maps:** the `viridis` and `cividis` anchor points in `src/viz/colormap-tables.ts` are
sampled from matplotlib's tables (version 3.9.1) and interpolated here. No matplotlib code is
shipped.

## Licence

MIT — see [`LICENSE`](LICENSE).
