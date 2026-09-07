# Browser checks

What cannot run in Vitest, and how it is verified. Two kinds of check live here.

## Automated — `npx playwright test`

`playwright.config.ts` drives the installed Google Chrome (`channel: 'chrome'`), never a downloaded
browser. These specs are not part of CI (D36); run them locally, and set `BARNESTRACK_SAMPLE_DIR`
to the upstream `data/barnes-maze/` folder to include the sample videos:

```
BARNESTRACK_SAMPLE_DIR=/path/to/barnes-maze npx playwright test
```

- `frame-server.spec.ts` (chunk 1) — WebCodecs decoding: frame identity, sequential order, random
  access against the sequential pass. Measurements in `prototypes/frame-server/RESULTS.md`.
- `app.spec.ts` (chunk 3) — the three app behaviours a person driving a mouse cannot verify: a real
  `drop` event carrying a `DataTransfer` of real `File`s (the file picker is a different code path),
  reload plus re-attach by fingerprint including a renamed copy, and save → reset → load compared as
  a parsed deep-equal. Key order is not part of the session contract, so the comparison is on the
  parsed object, not the bytes.
- `track.spec.ts` (chunk 4) — the four tracking behaviours that need a real worker and a real
  decoder: the Track step naming what it is waiting for until the maze is finished, a pass writing
  an automatic layer that survives a reload, a cancelled pass leaving *nothing* in storage, and
  re-tracking with changed parameters leaving a corrections layer untouched. The corrections layer
  is planted through `window.__barnestrackStore`, which `main.ts` exposes under `import.meta.env.DEV`
  only and the production build strips — the correction UI that would make one lands in a later
  chunk.
- `review.spec.ts` (chunk 6) — the review step driven from the keyboard: a nose placed by hand with
  `N` and the arrows recomputes the analysis and reaches the frames table as `corrected`; a relabel
  through the hole select marks the event `user` and keeps the automatic hole beside it; a threshold
  change leaves both pinned (D20); a reload brings all of it back through the autosave (D27) with
  the video detached; and `Space` plays at the video's own frame rate and pauses on the frame it
  reached.
- `app-smoke.spec.ts` (chunk 9b) — the demo state (D33), plus an `axe-core` scan. It starts its own
  servers rather than using the config's, because `playwright.config.ts` is shared with the specs
  above. Two halves. Against `npm run dev` on port 5175 it drives the loader module through
  `import('/src/demo/example-cohort.ts')` and the dev-only `__barnestrackStore`: three videos with
  results and no file attached, idempotency, survival across a reload, and Reset. Against
  `npm run preview` of the built `dist/` on port 4175 it runs the whole flow through the shipped UI
  — load, review, retune a threshold, export the bundle, reload — which **skips** until chunks 6
  and 9c land the Review step and mount the "Load example cohort" button; the skip message names
  the missing mount. The axe scan covers every step that renders (Videos, Maze, Track) and fails on
  `serious`/`critical` only; one recorded defect is allowed by name (see
  `docs/known-limitations.md`) so a new violation still fails. It makes no network request: the
  fetch verifier is covered offline in `tests/demo/fetch-sample-clip.test.ts`, and the one live
  check there is opt-in through `BARNESTRACK_NET_TEST=1` (D2).

## Manual — recorded here because a fresh clone has no other record (D36)

What each chunk's acceptance list needed that its specs do not cover was verified by hand in Google
Chrome on macOS against `npm run dev`, one section per chunk. What was checked, and what it showed:

### Chunk 3 — intake, maze and the shell

**Intake.** Loading `test53.mp4`, `test51.mp4` and `test50.mp4` together gives three cards reading
905 · 30.000 fps · 0:30, 741 · 14.985 fps · 0:49 and 5539 · 30.000 fps · 3:05, in load order, each
saying "Processed locally — this file never leaves your computer". A `.txt` is listed under
"Not loaded" with its reason.

**Maze click budget (D13, D29).** A new maze on test53 costs five clicks on the image — three rim
points, one ring alignment, one target hole — plus the platform diameter typed in. Applying that map
to test50, which shares the rig and the framing, costs none; applying it to test51 and correcting it
with "Adjust" costs three. The badge on the panel shows the count at all times.

**Keyboard only.** A complete maze can be built without touching the image. The keys used:

| Key | What it does |
| --- | --- |
| `Tab` / `Shift+Tab` | move through the controls; the frame itself is in the tab order |
| `←` `→` on the stepper | change step (also `Home`, `End`); the panel follows focus |
| typed numbers + `Tab` | centre x, centre y and radius create or move the platform; ring angle, target hole, hole count, ring ratio, hole diameter, platform diameter |
| `Enter` in "Hole to nudge" | select that hole and move to the frame |
| `←` `↑` `↓` `→` on the frame | nudge the selected hole or the platform by 1 px |
| `Shift` + those | nudge by 10 px |
| `+` `−` `0` on the frame | zoom in, zoom out, fit |
| `Alt` + arrows on the frame | pan |
| `←` `→` on the scrubber | ±1 frame (`Shift` for ±10, `Home`/`End` for the ends) |
| `Escape` | cancel the Reset session confirmation |

**No network (D2).** Across a full walkthrough the page issued only same-origin requests to the dev
server. `dist/` contains no external URL — the only `http://` string in the build is the SVG
namespace `http://www.w3.org/2000/svg`, which is an XML namespace identifier passed to
`createElementNS` and never fetched.

**200 % zoom (D37).** At a 483 × 423 CSS viewport — what a 1280-wide window looks like at 200 % —
there is no horizontal scrolling and every control stays within the viewport. Text contrast was
measured against the palette in `src/styles/app.css`: the lowest text pair is 6.56:1 and the two
non-text borders are 3.04:1 and 3.37:1, against the 4.5:1 and 3:1 requirements.

### Chunk 4 — tracking in the app

Driven in Google Chrome against `npm run dev`, on the same M1 Pro / 32 GB / macOS 15.5 as the
earlier measurements. Each video was loaded on its own, the maze built from the numeric fields, and
**Track** pressed once.

| video | frames | wall time, click → summary | tracker | session JSON | states |
| ----- | -----: | -------------------------: | ------: | -----------: | ------ |
| test53 | 905 | 1.8 s | 1,910 fps | 0.65 MB | 150 not detected, 165 low confidence, 590 tracked |
| test51 | 741 | 2.3 s | 1,482 fps | 0.54 MB | 75 ambiguous, 83 low confidence, 583 tracked |
| test50 | 5,539 | 4.4 s | 2,148 fps | 4.14 MB | 150 not detected, 1,302 low confidence, 4,087 tracked |

Wall time is the whole thing a user waits for — background sampling, the median, and the pass — so
test50's 5,539 frames at 4.4 s is about 1,260 frames per second end to end, against the ≥ 150 fps
criterion and a 40 s target. The states line up with what chunk 2 measured offline: test53's empty
first 150 frames are `not_detected`, and test51's start-cylinder frames are `ambiguous`.

**The tracked percentage counts only the `tracked` state.** test53 reads "65.2 % of frames" because
150 frames have no animal on the platform at all and 165 more are `low_confidence`; the breakdown
line under it gives all four counts, which is why it is there.

**Responsiveness during a pass (D17).** Sampling `requestAnimationFrame` on the main thread for the
whole of a test50 pass: 286 frames, median 16.7 ms, worst 21.2 ms — a steady 60 fps with no dropped
frame. The Videos and Maze steps were both opened and used mid-pass and rendered normally; the pass
kept running and finished. Decoding and tracking are in the worker, and progress never touches the
session store, so the main thread only paints.

Scrubbing specifically, which is the criterion's own wording: with a test50 pass running, focusing
the Maze step's scrubber on the other video and pressing `ArrowRight` forty times advanced it to
frame 40 a frame at a time, with the main thread at median 16.7 ms and worst 18.0 ms, and the pass
finished normally. Random-access decoding for the scrubber and sequential decoding for the pass are
separate decoder instances over the same file (D5), which is what makes that safe.

**The live thumbnail updates.** A 214 × 160 preview, sampled twice during one pass, differs between
samples. It is captioned and `aria-label`-led "provisional — final track computed at end of pass"
throughout.

**Cancel.** Cancelling mid-pass leaves the card reading "Cancelled — nothing was written, so the
video is still untracked", and the IndexedDB record's `analyses` is empty. Nothing half-written can
exist because the layer is written once, at the end.

**Reload during a pass.** The video comes back **untracked**, not marked cancelled: no run state is
persisted, by design. A video whose pass had already finished is still there. Checked directly
against the stored record, which listed only the completed video.

**Reload after a pass.** The finished layer is present and the card reads "905 frames on record".
Wait for the header to say "All changes saved in this browser" first — a reload inside the ~500 ms
autosave window can lose the last change, which is a limitation already recorded in
`docs/known-limitations.md`, and the browser spec waits for that signal for the same reason.

**`peakHeapBytes` is absent on the worker path.** `performance.memory` is not exposed inside a
worker, so `usedHeapBytes()` returns undefined and the `done` message carries no `peakHeapBytes`.
The field stays in the protocol as optional; nothing reads it.

**Keyboard only.** The whole Track step is reachable and operable from the keyboard: `Tab` through
Track / Cancel / Track all untracked, the parameters disclosure opens with `Enter` or `Space`, and
every parameter is a labelled number input or select with its definition as its `aria-describedby`
hint. The progress text is `aria-live="off"`; only the transitions — started, finished with the
summary sentence, cancelled, failed — are announced through the shell's live region, so a screen
reader is told what happened without a running commentary. Status is carried by words, with colour
only echoing it.

### Chunk 6 — the review step

Driven in Google Chrome against `npm run dev` on the same machine, on test51 (741 frames at
14.985 fps, the chunk-3 map fitted to it: platform 280.0, 239.9 px, radius 222.5 px, target 7) and,
for the timings, test50 (5,539 frames). The Chrome automation window was in the background for the
whole pass, which matters for one check below.

**S4 end to end on test51.** Frame 115 is one of the two head/tail flips in the automatic track (the
nose vector turns 172° against frame 114) and the first frame of the first investigation, at hole
12. With the frame field (`F`, `115`, `Enter`), `N`, four `Shift+→` and two `Shift+↓` the nose moved
from (104, 144) to (144, 164) px: **one** correction entry after six nudges (coalesced), the frame
overlay reads "nose 0.50 · user" on a diamond, the frames table's nose source reads `corrected`
with the automatic centroid still `auto`, the nose track shows the diamond and the corrections
track a mark, and the investigation recomputed from 115–123 to 116–123 — the event no longer
starts on a nose that was really the tail. Selecting that event (`E`) and moving it to hole 13
through the hole select (`H`, then the option) gives a hatched row reading "user (auto: hole 12,
frames 116–123)", the bar labelled "13 user" (or "13·u" when narrow), the overlay "investigation 13 ·
user" with hole 13 bracketed, and the strategy reasoning re-listing the holes visited. Raising
`holeInvestigation.minDuration_s` from 0.2 to 0.5 s dropped the 0.20 s visit at 176–179 (10
events → 9, parameters hash a995a8bf… → 780d374c…) while the 0.47 s corrected event **stayed**, as
did the nose fix (D20). After a reload — "All changes saved in this browser" first — the step
came back with both corrections, the threshold at 0.5, the same hash, and the note that the video
is not attached; the timeline, the tables and every correction still worked on the stored track,
and re-dropping the file restored the frames.

**Recompute time (D22, < 50 ms).** `derive()` measured inside the step, wall clock:

| video | frames | first derive | after a nose fix | after a threshold change |
| ----- | -----: | -----------: | ---------------: | -----------------------: |
| test51 | 741 | 6.9 ms | 2.4–4.6 ms | 6.0 ms |
| test50 | 5,539 | 26.6 ms | 18.6 ms | 11.7 ms |

The status line reports both the derive and the whole edit-to-redraw time (test50: 29 ms with the
redraw). Tracking test50 first took 6.5 s (1,262 frames/s).

**Autosave with the derived cache (D27, D55).** Timing the IndexedDB write directly, the record
holding both videos' automatic layers and derived caches was 4.72 MB and took 19.9 ms to write
after the nose fix and 24.5 ms after the threshold change. Well under the ~100 ms the plan set as
the point at which the cache would move to `flush()` / `pagehide`, so the cache stays in the
ordinary autosave and corrections are saved on every change.

**Every correction from the keyboard.** With focus on the timeline (the step's keyboard home; `F` +
`Enter` or `Escape` returns there): `]` / `[` jump between flagged runs and announce them ("Flagged
run: low confidence, frames 102–107"); `End`, `Shift+←` ×2, `←` land on 719; `=` / `-` / `0` zoom the
window (82–300 of 741 at 3.4 ×, back to the whole clip); `T` sets the trial start at the playhead
and the "Revert trial start" button undoes it; `V` at 300, twenty `→`, `V` marks 300–320 not
visible (the frames table reads `not detected / not_visible`, both sources `corrected`); `A`, ten
`→`, `A` adds an investigation at the nearest hole (10) and `Delete` removes it — an added event
deleted leaves no entry; `E`, `D`, `Shift+→` ×3 move the selected event's end from 527 to 530 as
one edit; `B` at 700 marks the escape box from there (trial end 700, escape entry 700–740 at the
target, latency 41.71 s, escaped yes); the strategy override with a reason reads "spatial (user
override)" and reverts. Every entry has its own "Revert to automatic"; the corrections count and the
derive time are announced each time. An orphan is listed, never dropped: deleting the 176–179 event
and then raising the threshold that removes it anyway lists the delete as "no longer matches an
automatic event … nothing was removed".

**Metrics seek.** "Primary errors 9" seeks to frame 116 (the first error), the corrections list's
"Seek" to 115.

**Play (`Space`).** Requires the tab to be visible: the loop runs on `requestAnimationFrame`, which
Chrome does not fire for a hidden tab, and the automation window was hidden. With
`requestAnimationFrame` stubbed to a 16 ms timer for the check, 1.5 s of play from frame 100 reached
frame 124 (14.985 fps → 22 frames expected, plus the stub's slack), `Space` paused with "Paused at
frame 124", and play from 735 stopped with "Reached the end of the video". `review.spec.ts` plays
for real in a visible Playwright page.

**Grayscale (D26).** With `filter: grayscale(1)` on the document: the automatic centroid is a
filled disc, the corrected nose a hollow diamond with "· user", the target hole a double ring with
"T7 target", the current event's hole bracketed, corrected event bars hatched and tagged, failures
dashed, the trial-start marker a triangle on a line, the selected edge a bar. Nothing is carried by
hue alone.

**200 % zoom (D37).** Emulated with `zoom: 2` on the document (a 640 CSS px layout, the window could
not be resized from the automation): the toolbar wraps group by group, the timeline keeps its full
width with the window slider beneath, the three panels stack, the events and frames tables scroll
inside their own containers, and the document has no horizontal scroll.

**Not attached.** With the file gone after a reload, the step shows the note, runs the scrubber on
the track's own timestamps (741 frames), draws the maze and the markers on a blank platform, and
accepts every correction.

### Chunk 9c-a — the demo state in the shipped build

**No network (D2), restated — this supersedes the chunk-3 paragraph above.** That paragraph said
`dist/` contains no external URL and that the SVG namespace is the only `http://` string in the
build. Both were true only because nothing imported `src/demo/`, so tree-shaking dropped it.
`src/ui/videos-step.ts` now imports `mountExampleCohortPanel`, and the demo modules are in the
shipped JS. `npm run build && grep -oE "https?://[A-Za-z0-9._~:/?#@!$&*+,;=%-]+" dist/assets/*.js |
sort -u` prints three strings and no others:

```
http://www.w3.org/2000/svg
https://github.com/salk-airc/rse-takehome-2026/tree/main/data/barnes-maze
https://raw.githubusercontent.com/salk-airc/rse-takehome-2026/main/data/barnes-maze/test53.mp4
```

The first is an XML namespace identifier passed to `createElementNS` and is never fetched. The
third is `SAMPLE_CLIP_URL` in `src/demo/fetch-sample-clip.ts`, and the **only** outbound request the
application can make: it is issued by `fetchSampleClip()` in that file, only from the "Fetch
test53.mp4 (≈ 0.5 MB) from the sample-data repository" button on the Videos step, only after the
user presses it, and the downloaded bytes are verified against the session's own fingerprint before
anything is attached. The second is `SAMPLE_DATA_URL` in `src/demo/example-cohort.ts`, which is not
requested at all: it is the `href` of the link the banner renders for the reader to follow. The page
also declares its own icon as a data URI in `index.html`, so a walkthrough's network panel no longer
shows even the stray `/favicon.ico` the browser asks for when none is declared.

**One same-origin request is not in that list, because it is not a URL-shaped string.**
`EXAMPLE_BUNDLE_PATH` in `src/demo/example-cohort.ts:31` is the relative path
`examples/example-cohort.barnestrack.json.gz`, resolved against `document.baseURI` and fetched by
`fetchExampleSession()` when the "Load example cohort" button is pressed — 502,688 B from the page's
own build. Measured against `vite preview` of a fresh `dist/`, the complete request list for a page
load followed by that one click is:

```
GET /                                                  (the page)
GET /assets/index-<hash>.js
GET /assets/index-<hash>.css
GET /examples/example-cohort.barnestrack.json.gz       (on the button press)
```

Nothing on load beyond the page's own three files, and nothing at all that leaves the origin until
the fetch button is pressed. Grepping `dist/` for `https?://` cannot show this one, so a walkthrough
that only greps the bundle will under-report it; the network tab is the check that sees everything.

**The manual pass**, in Google Chrome on macOS against `npm run preview` of the built `dist/` on
port 4180, with `indexedDB.deleteDatabase('barnestrack')` first for a clean profile.

- **Keyboard-only load.** From the "Choose videos" file input, two `Tab` presses reach the
  `Load example cohort` button — file input, "Choose a folder", the button — and `Enter` loads.
  After it: the live region reads "Example cohort loaded: 3 videos with results, no video files
  attached. These results are illustrative, not a real tracking run of these clips.", the session
  name reads `Example cohort`, three `.video-card`s are badged "video not attached", and all four
  step tabs read `ready`. The panel sets no `tabindex`; its buttons are ordinary `<button>`s.

  **Where focus ends up was not checked in the first pass, and it is wrong**: `document.activeElement`
  is `BODY` after the load, from Enter and from a mouse click alike, because the panel disables its
  own button before awaiting and the browser blurs it. Recorded in `docs/known-limitations.md` with
  the one-line fix; it lives in `src/demo/example-cohort-ui.ts`. Re-check this line when that lands.
- **The panel is not torn out from under its own action.** After the load, the `.example-cohort`
  node is the same node, and its `.example-status` carries the outcome sentence rather than an empty
  string — the check that the epoch remount in `src/ui/videos-step.ts` skipped the panel's own flow.
  Measured from both a mouse click and Enter.
- **Review with no video attached.** One click on the Review & Export tab: the panel renders three
  canvases and six sections — Thresholds, Metrics, Quality, Events, Frames around the playhead,
  Corrections — with no "Nothing to show yet".
- **The fetch button.** One click downloads, verifies and attaches: `test53.mp4`'s badge becomes
  "file attached", the fetch row hides itself, and the live region reads "test53.mp4 verified and
  attached — frames and corrections are available." `performance.getEntriesByType('resource')`
  filtered to cross-origin entries is empty before the click and afterwards holds exactly the one
  `raw.githubusercontent.com` URL above — no favicon request, no font, nothing else. The unfiltered
  list additionally holds the page's own three files and the example bundle, and nothing else.
- **Reload.** The autosave brings the cohort back with the video detached, and the banner, the
  provenance line and the fetch row are all showing again, from exactly one `.example-cohort`. This
  is the case the panel got wrong when it was first mounted; see the remount in
  `src/ui/videos-step.ts`.
- **Grayscale (D26).** With `filter: grayscale(1)` on the document, the provenance line is a bold
  sentence behind a dark left rule and the banner is regular weight behind a lighter rule on a
  tinted ground. Both read as notices, and they read as different notices, with no hue involved.
- **200 % zoom (D37).** Emulated with `zoom: 2` on the document: `documentElement.scrollWidth`
  equals `clientWidth` — no horizontal scroll — the stepper reflows to two rows, the pickers stack,
  the panel keeps its own full-width row, and the fetch button and its hint stack rather than
  colliding. Every control in the panel stays inside the viewport.

**The `app-smoke.spec.ts` shipped-UI flow still skips, for a different reason.** Its skip used to be
"no `Load example cohort` button in the built app"; that button now ships, so the guard was moved to
the absence of a button matching `/Export bundle/i` — chunk 7b's Review export. Chunk 9c-b un-skips
it once 7b is merged. The spec's `mountPanel()` helper now reuses the panel the Videos step mounts
rather than appending a second one, which would have matched every `.example-*` locator twice.

**Two things the spec's own guards leave for chunk 9c-b.** Its `KNOWN_VIOLATIONS` key for the
recorded maze-step defect is the bare `.table-scroll`, and chunk 6 gave that class to the review
step and the quality panel too, so `axe-core` now names the node
`.maze-step > .mirror > .table-scroll` and the scan fails on a defect it is meant to allow — a
one-string fix, reproduced at `6885937` before chunk 9c-a's first commit and recorded in
`docs/known-limitations.md`. And the axe loop still covers Videos, Maze and Track only, with a
comment saying the Review step is a placeholder until chunk 6; chunk 6 has landed, so the step with
the most markup in the application is the one step never scanned.
