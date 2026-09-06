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
